/**
 * Browser adapter: MidiTransport -> WritePort (the interface WriteTransaction requires).
 *
 * The critical part is an INDEPENDENT fresh read. For MIDI config that means sending a new
 * empty $0F and decoding the NEXT $10 (not the applied-state echo the device sends right
 * after a write). Because $0F carries no request token, a single $10 cannot be attributed
 * with certainty: the reference documents a delayed applied-state echo. We therefore perform
 * TWO independent $0F requests and require both decoded 292-byte structures to be identical
 * before trusting either. A stale echo followed by a real (reverted) read then disagrees and
 * the readback returns null, which makes WriteTransaction roll back to the exact baseline.
 *
 * Pattern-bank reads are delegated to the shell, which reuses the already verified
 * OpzSession.refreshBankAsync() ($08 -> $09/$0A packets -> full 342272 bytes).
 *
 * No device I/O happens at module load; everything is lazy, injected and Node-testable with
 * a fake MidiTransport.
 */
import type { MidiTransport } from '../midi/midiTransport.ts';
import { tryParse } from '../protocol/opzFrame.ts';
import { bytesEqual, type WritePort } from './transaction.ts';
import {
  MIDI_CONFIG_REQUEST, MIDI_CONFIG_DATA_ID, parseMidiConfigFrame,
} from './midiConfigWrite.ts';

export type ReadbackKind = 'midi-config' | 'pattern-bank';

export interface WebMidiWritePortOptions {
  kind: ReadbackKind;
  timeoutMs?: number;
  now?: () => number;
  onLog?: (message: string) => void;
  /**
   * Override for the independent read. Required for 'pattern-bank': the shell supplies a
   * callback that calls OpzSession.refreshBankAsync() and returns the fresh bank bytes.
   */
  readCurrent?: () => Promise<Uint8Array | null>;
  /**
   * Independent $0F requests per readback. Default 2: one response may be an applied-state
   * echo, so two identical consecutive reads are required. Tests can lower this to 1.
   */
  confirmReads?: number;
}

export interface WebMidiWritePort extends WritePort {
  dispose(): void;
}

export function createWebMidiWritePort(
  transport: MidiTransport,
  options: WebMidiWritePortOptions,
): WebMidiWritePort {
  const timeoutMs = options.timeoutMs ?? 4000;
  const clock = options.now ?? (() => Date.now());
  const log = options.onLog ?? (() => undefined);
  const confirmReads = Math.max(1, Math.floor(options.confirmReads ?? 2));
  const previous = transport.onSysex;
  let disposed = false;
  let activeTap: ((data: Uint8Array) => void) | null = null;

  /** One empty $0F request -> one decoded 292-byte $10. Frames are never swallowed. */
  function oneMidiConfigRead(): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let tapped: (data: Uint8Array) => void;

      function finish(value: Uint8Array | null): void {
        if (done) return;
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        // Only unhook ourselves; the recorder / session may have replaced the handler.
        if (transport.onSysex === tapped) transport.onSysex = previous;
        activeTap = null;
        resolve(value);
      }

      tapped = (data: Uint8Array) => {
        previous?.(data); // never swallow frames headed for the live session or the recorder
        if (done) return;
        const frame = tryParse(data);
        if (!frame || frame.messageId !== MIDI_CONFIG_DATA_ID || frame.payload.length === 0) return;
        void parseMidiConfigFrame(data).then((raw) => {
          if (raw) finish(raw);
        }).catch(() => undefined);
      };

      transport.onSysex = tapped;
      activeTap = tapped;
      timer = setTimeout(() => {
        log(`fresh $0F readback timed out after ${timeoutMs} ms`);
        finish(null);
      }, timeoutMs);
      transport.sendSysex(MIDI_CONFIG_REQUEST);
    });
  }

  /** Two independent reads that must agree; otherwise the state is not trusted. */
  async function midiConfigRead(): Promise<Uint8Array | null> {
    let first: Uint8Array | null = null;
    for (let i = 0; i < confirmReads; i++) {
      const raw = await oneMidiConfigRead();
      if (!raw) {
        log(`fresh $0F read ${i + 1}/${confirmReads} failed; readback refused`);
        return null;
      }
      if (first === null) first = raw;
      else if (!bytesEqual(first, raw)) {
        log(`fresh $0F reads disagree (read ${i + 1}/${confirmReads}); readback refused`);
        return null;
      }
    }
    log(`fresh $0F readback confirmed by ${confirmReads} identical independent read(s)`);
    return first;
  }

  const read: () => Promise<Uint8Array | null> = options.readCurrent
    ?? (options.kind === 'midi-config' ? midiConfigRead : async () => null);

  return {
    send: async (frame: Uint8Array): Promise<void> => {
      if (disposed) throw new Error('write port is disposed');
      transport.sendSysex(frame);
      if (options.kind === 'pattern-bank') {
        // EVIDENCE: unknown. Upload-side $0B flow control is NOT proven in this project, and
        // we refuse to guess a handshake. A failed upload is still contained: WriteTransaction
        // always performs a full fresh readback and restores the EXACT baseline on mismatch.
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
    },
    readback: read,
    freshBaseline: read,
    now: clock,
    dispose: (): void => {
      disposed = true;
      if (activeTap && transport.onSysex === activeTap) transport.onSysex = previous;
      activeTap = null;
      log('write port disposed');
    },
  };
}
