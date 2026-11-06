/**
 * MIDI over Bluetooth LE — the MMA/Apple BLE-MIDI 1.0 packet format.
 *
 * This is a 1:1 TypeScript port of OPB.Core/Midi/BleMidiCodec.cs and BleMidiDecoder.cs,
 * whose behaviour is pinned by OP-Z-Windows/tests/OPB.Core.Tests/BleMidiTests.cs. We do NOT
 * re-derive the wire format: the C# implementation is the device-proven reference in this
 * repository (it was used against a real OP-Z over Windows BLE).
 *
 * Packet shape:
 *   [header 0x80 | timestampHi(6)] [stamp 0x80 | timestampLo(7)] <MIDI bytes...>
 * A SysEx longer than one packet continues in the NEXT packet straight after its header byte
 * (no second timestamp). Its closing F7 gets its own timestamp byte. Running status and
 * an unfinished SysEx are both carried across packets.
 *
 * EVIDENCE: decoded (BLE-MIDI 1.0 spec + local C# reference with unit tests).
 * Whether a *browser* Web Bluetooth host can do the same on SteamOS is `unknown` — see
 * src/midi/transportEvidence.ts. Nothing here claims that path has been hardware-verified.
 */
import type { MidiTransport } from './midiTransport.ts';

/** BLE-MIDI service and its single MIDI I/O characteristic (as used by the C# connector). */
export const BLE_MIDI_SERVICE_UUID = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC_UUID = '7772e5db-3868-4112-a1a9-f2669d106bf3';

/**
 * Largest packet written to the OP-Z: the default 23-byte ATT MTU minus 3. The OP-Z sends
 * 184-byte packets on the larger MTU Windows negotiates, but DROPS THE LINK as soon as it
 * receives a write longer than this (a 31-byte sound edit did it every time).
 * Ported verbatim from BleMidiConnection.MaxWrite; never "optimise" this to a larger MTU.
 */
export const BLE_MIDI_MAX_WRITE = 20;

/** EncodeSysex clamps small MTUs to 5 so a packet can still hold header + stamp + F0. */
export const BLE_MIDI_MIN_PACKET = 5;

/** C# uses Environment.TickCount64 & 0x1FFF: a 13-bit millisecond timestamp. */
export const BLE_TIMESTAMP_MASK = 0x1fff;

/** Bytes in a MIDI message with this status byte (status included). */
export function messageLength(status: number): number {
  if (status < 0x80) return 0;
  if (status < 0xc0) return 3;
  if (status < 0xe0) return 2;
  if (status < 0xf0) return 3;
  if (status === 0xf1 || status === 0xf3) return 2;
  if (status === 0xf2) return 3;
  return 1;
}

function headerByte(timestamp: number): number {
  return 0x80 | ((timestamp >> 7) & 0x3f);
}

function stampByte(timestamp: number): number {
  return 0x80 | (timestamp & 0x7f);
}

/** One short message (note, CC, realtime...) as a single packet. */
export function encodeShort(
  status: number,
  data1 = 0,
  data2 = 0,
  timestamp = 0,
): Uint8Array {
  const length = messageLength(status);
  const packet = new Uint8Array(2 + length);
  packet[0] = headerByte(timestamp);
  packet[1] = stampByte(timestamp);
  packet[2] = status & 0xff;
  if (length > 1) packet[3] = data1 & 0x7f;
  if (length > 2) packet[4] = data2 & 0x7f;
  return packet;
}

/**
 * A complete SysEx (F0 ... F7) split into packets of at most `maxPacket` bytes
 * (the ATT MTU minus 3). Continuation packets contain ONLY the header byte before data.
 */
export function encodeSysex(
  message: Uint8Array | readonly number[],
  maxPacket: number = BLE_MIDI_MAX_WRITE,
  timestamp = 0,
): Uint8Array[] {
  const src = message instanceof Uint8Array ? message : Uint8Array.from(message);
  if (src.length < 2 || src[0] !== 0xf0 || src[src.length - 1] !== 0xf7) {
    throw new Error('Not a complete SysEx message (expected F0 ... F7)');
  }
  const limit = Math.max(maxPacket, BLE_MIDI_MIN_PACKET);
  const packets: Uint8Array[] = [];
  let packet: number[] = [headerByte(timestamp), stampByte(timestamp), 0xf0];
  const last = src.length - 1;
  for (let i = 1; i < last; i++) {
    if (packet.length === limit) {
      packets.push(Uint8Array.from(packet));
      packet = [headerByte(timestamp)];
    }
    packet.push(src[i]);
  }
  if (packet.length + 2 > limit) {
    packets.push(Uint8Array.from(packet));
    packet = [headerByte(timestamp)];
  }
  packet.push(stampByte(timestamp));
  packet.push(0xf7);
  packets.push(Uint8Array.from(packet));
  return packets;
}

export interface BleMidiDecodeHandlers {
  onSysex?: ((message: Uint8Array) => void) | null;
  onShort?: ((status: number, data1: number, data2: number) => void) | null;
}

/**
 * Turns received BLE-MIDI packets back into complete MIDI messages. Keeps the running status
 * and a SysEx in progress across packets. Timestamps are dropped.
 */
export class BleMidiDecoder {
  onSysex: ((message: Uint8Array) => void) | null = null;
  onShort: ((status: number, data1: number, data2: number) => void) | null = null;

  private sysex: number[] = [];
  private inSysex = false;
  private running = 0;

  constructor(handlers: BleMidiDecodeHandlers = {}) {
    this.onSysex = handlers.onSysex ?? null;
    this.onShort = handlers.onShort ?? null;
  }

  /** True while a SysEx is being reassembled across packets. Exposed for diagnostics/tests. */
  get reassembling(): boolean { return this.inSysex; }

  /** Discard any partial SysEx and running status (call on link loss / reconnect). */
  reset(): void {
    this.sysex = [];
    this.inSysex = false;
    this.running = 0;
  }

  feed(packet: Uint8Array | readonly number[]): void {
    const p = packet instanceof Uint8Array ? packet : Uint8Array.from(packet);
    if (p.length < 2 || (p[0] & 0x80) === 0) return; // no header: not BLE-MIDI

    let i = 1;
    while (i < p.length) {
      let b = p[i];
      if (this.inSysex) {
        if (b < 0x80) {
          this.sysex.push(b);
          i++;
          continue;
        }
        // A timestamp inside a SysEx: the end, an interleaved realtime byte, or an abort.
        if (i + 1 >= p.length) {
          if (b === 0xf7) this.endSysex(); // lenient: an F7 without its timestamp
          return;
        }
        const next = p[i + 1];
        if (next === 0xf7) {
          this.endSysex();
          i += 2;
          continue;
        }
        if (next >= 0xf8) {
          this.onShort?.(next, 0, 0);
          i += 2;
          continue;
        }
        this.inSysex = false;
        this.sysex = [];
      }

      if (b >= 0x80) {
        // Timestamp, then a status byte or running-status data.
        if (++i >= p.length) return;
        b = p[i];
      }
      if (b < 0x80) {
        if (this.running === 0) {
          i++;
          continue;
        }
        i = this.readMessage(p, i, this.running);
        continue;
      }
      if (b === 0xf0) {
        this.inSysex = true;
        this.sysex = [0xf0];
        i++;
        continue;
      }
      if (b >= 0xf8) {
        this.onShort?.(b, 0, 0);
        i++;
        continue;
      }
      this.running = b < 0xf0 ? b : 0;
      i = this.readMessage(p, i + 1, b);
    }
  }

  /** Reads the data bytes of a message starting at `i`; returns the next index. */
  private readMessage(packet: Uint8Array, i: number, status: number): number {
    const dataBytes = messageLength(status) - 1;
    let d1 = 0;
    let d2 = 0;
    let cursor = i;
    if (dataBytes >= 1) {
      if (cursor >= packet.length || packet[cursor] >= 0x80) return cursor;
      d1 = packet[cursor++];
    }
    if (dataBytes >= 2) {
      if (cursor >= packet.length || packet[cursor] >= 0x80) return cursor;
      d2 = packet[cursor++];
    }
    this.onShort?.(status, d1, d2);
    return cursor;
  }

  private endSysex(): void {
    this.sysex.push(0xf7);
    this.inSysex = false;
    const message = Uint8Array.from(this.sysex);
    this.sysex = [];
    this.onSysex?.(message);
  }
}

/**
 * Convenience factory used by the Web Bluetooth adapter: decode packets straight into an
 * existing MidiTransport-shaped callback pair. Kept here so the codec stays DOM-free.
 */
export function decoderFor(
  onSysex: (data: Uint8Array) => void,
  onShort: (status: number, data1: number, data2: number) => void,
): BleMidiDecoder {
  return new BleMidiDecoder({ onSysex, onShort });
}

/** Runtime capability probe. `unknown` on SteamOS until checked on a real Deck. */
export function webBluetoothAvailable(nav: unknown = globalThis.navigator): boolean {
  const candidate = nav as { bluetooth?: { requestDevice?: unknown } } | undefined;
  return typeof candidate?.bluetooth?.requestDevice === 'function';
}

// Re-export so callers can import every BLE-MIDI piece from one module.
export type { MidiTransport };
