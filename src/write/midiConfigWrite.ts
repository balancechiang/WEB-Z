/**
 * Stage 6, part 1: MIDI configuration write transaction ($0F / $10, 292 bytes).
 *
 * Reference: kmorrill/op-z-sysex docs/midi-configuration-sysex.md (device-proven on fw 1.2.45+).
 *   Read request:            F0 00 20 76 01 0F F7
 *   Read response OR write:  F0 00 20 76 01 10 <7-bit-packed zlib stream> F7
 *
 * Layout (all offsets zero-based):
 *   0..15    track MIDI enable (0 = off, nonzero = on)
 *   16..31   track channel (0..15)
 *   32..287  outgoing parameter CC, offset = 32 + track*16 + parameter
 *   288      eight global flags
 *   289..291 padding/reserved — MUST be preserved from the fresh baseline
 *
 * Proven write sequence: save/decode $10 -> send modified full $10 -> wait for the device's
 * applied-state $10 -> send a NEW $0F -> verify the second $10 equals the complete modified
 * config -> on failure send the original $10 and verify again. Never assume a fixed latency:
 * the reference observed a ~2 s delayed rollback report, so wait for matching CONTENT.
 */
import { build, tryParse, inflateZlib, deflateZlib } from '../protocol/opzFrame.ts';
import { MidiConfig, MIDI_CONFIG_SIZE } from '../model/globalData.ts';
export { MIDI_CONFIG_SIZE, MidiConfig, MidiFlag } from '../model/globalData.ts';
import {
  WriteTransaction, bytesEqual, type WritePort, type ByteDiff, type CommitResult,
} from './transaction.ts';
import { WRITE_EVIDENCE } from './evidence.ts';

export const MIDI_CONFIG_REQUEST_ID = 0x0f;
export const MIDI_CONFIG_DATA_ID = 0x10;
export const MIDI_CONFIG_RESERVED_OFFSET = 289;
export const MIDI_CONFIG_RESERVED_SIZE = 3;

/** Empty $0F: the only way to get an INDEPENDENT fresh read (as opposed to the applied-state echo). */
export const MIDI_CONFIG_REQUEST: Uint8Array = build(MIDI_CONFIG_REQUEST_ID);

export type MidiConfigEdit =
  | { type: 'track-enable'; track: number; value: boolean }
  | { type: 'channel'; track: number; value: number }
  | { type: 'cc'; track: number; parameter: number; value: number }
  | { type: 'flag'; flag: number; value: boolean };

function requireTrack(track: number): void {
  if (!Number.isInteger(track) || track < 0 || track > 15) throw new RangeError(`track must be 0..15 (got ${track})`);
}

/** Typed, validated mutation of a 292-byte config. Reserved bytes are never touched. */
export function applyMidiConfigEdit(data: Uint8Array, edit: MidiConfigEdit): void {
  if (data.length !== MIDI_CONFIG_SIZE) throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes`);
  switch (edit.type) {
    case 'track-enable':
      requireTrack(edit.track);
      data[edit.track] = edit.value ? 1 : 0;
      return;
    case 'channel':
      requireTrack(edit.track);
      if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 15) {
        throw new RangeError(`channel must be 0..15 (got ${edit.value})`);
      }
      data[16 + edit.track] = edit.value;
      return;
    case 'cc':
      requireTrack(edit.track);
      if (!Number.isInteger(edit.parameter) || edit.parameter < 0 || edit.parameter > 15) {
        throw new RangeError(`parameter must be 0..15 (got ${edit.parameter})`);
      }
      if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 127) {
        throw new RangeError(`CC must be 0..127 (got ${edit.value})`);
      }
      data[32 + edit.track * 16 + edit.parameter] = edit.value;
      return;
    case 'flag':
      if (!Number.isInteger(edit.flag) || edit.flag < 0 || edit.flag > 7) {
        throw new RangeError(`flag must be 0..7 (got ${edit.flag})`);
      }
      data[288] = edit.value ? (data[288] | (1 << edit.flag)) : (data[288] & ~(1 << edit.flag));
      return;
  }
}

export function describeMidiEdit(edit: MidiConfigEdit): string {
  switch (edit.type) {
    case 'track-enable': return `TRACK ${edit.track + 1} MIDI ${edit.value ? 'ON' : 'OFF'}`;
    case 'channel': return `TRACK ${edit.track + 1} CHANNEL ${edit.value + 1}`;
    case 'cc': return `TRACK ${edit.track + 1} PARAM ${edit.parameter + 1} -> CC ${edit.value}`;
    case 'flag': return `FLAG ${edit.flag} ${edit.value ? 'ON' : 'OFF'}`;
  }
}

/** Encode a complete 292-byte config as one compressed $10 frame. */
export async function buildMidiConfigFrame(config: Uint8Array): Promise<Uint8Array> {
  if (config.length !== MIDI_CONFIG_SIZE) {
    throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes (got ${config.length})`);
  }
  return build(MIDI_CONFIG_DATA_ID, await deflateZlib(config));
}

/** Decode a $10 frame into its 292 bytes; null when it is not a valid config frame. */
export async function parseMidiConfigFrame(data: Uint8Array): Promise<Uint8Array | null> {
  const frame = tryParse(data);
  if (!frame || frame.messageId !== MIDI_CONFIG_DATA_ID) return null;
  try {
    const raw = await inflateZlib(frame.payload, MIDI_CONFIG_SIZE);
    return raw.length === MIDI_CONFIG_SIZE ? raw : null;
  } catch {
    return null;
  }
}

export function reservedBytesPreserved(baseline: Uint8Array, staged: Uint8Array): boolean {
  for (let i = MIDI_CONFIG_RESERVED_OFFSET; i < MIDI_CONFIG_SIZE; i++) {
    if (baseline[i] !== staged[i]) return false;
  }
  return true;
}

/** Encode callback for WriteTransaction: one $10 frame carrying the complete structure. */
export async function encodeMidiConfig(payload: Uint8Array): Promise<Uint8Array[]> {
  return [await buildMidiConfigFrame(payload)];
}

/**
 * A guarded editor. Construct it from a FRESH $10 snapshot; stage typed edits; preview the
 * frames; only arm + confirm when the user has a backup and accepts the risk.
 */
export class MidiConfigWriteSession {
  readonly tx: WriteTransaction;
  private readonly edits: MidiConfigEdit[] = [];

  constructor(baseline: Uint8Array, port: WritePort) {
    if (baseline.length !== MIDI_CONFIG_SIZE) {
      throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes (got ${baseline.length})`);
    }
    this.tx = new WriteTransaction({
      kind: 'midi-config',
      evidence: WRITE_EVIDENCE.midiConfigWrite.grade,
      baseline,
      encode: encodeMidiConfig,
      port,
      // The reference compares the COMPLETE 292-byte structure, not just the edited field.
      verify: (device, expected) => device.length === MIDI_CONFIG_SIZE && bytesEqual(device, expected),
    });
  }

  get editsView(): readonly MidiConfigEdit[] { return this.edits; }
  get baselineView(): MidiConfig { return new MidiConfig(this.tx.baselineBytes); }
  get current(): MidiConfig { return new MidiConfig(this.tx.stagedBytes); }

  stage(edit: MidiConfigEdit): ByteDiff {
    applyMidiConfigEdit(this.tx.stagedBytes, edit); // validation pass on a copy first
    const d = this.tx.stage((draft) => applyMidiConfigEdit(draft, edit));
    this.edits.push(edit);
    return d;
  }

  stageMany(edits: readonly MidiConfigEdit[]): ByteDiff {
    for (const e of edits) applyMidiConfigEdit(this.tx.stagedBytes, e);
    const d = this.tx.stage((draft) => { for (const e of edits) applyMidiConfigEdit(draft, e); });
    this.edits.push(...edits);
    return d;
  }

  /** Defensive invariant: an editor must never synthesize the three reserved bytes. */
  get reservedIntact(): boolean {
    return reservedBytesPreserved(this.tx.baselineBytes, this.tx.stagedBytes);
  }

  preview(): Promise<Uint8Array[]> { return this.tx.preview(); }
  arm(): void { this.tx.arm(); }
  disarm(): void { this.tx.disarm(); }
  commit(confirmed = false): Promise<CommitResult> { return this.tx.commit({ confirmed }); }
  rollback(): Promise<CommitResult> { return this.tx.rollback('manual rollback'); }
  auditJson(): string { return this.tx.auditJson(); }
}
