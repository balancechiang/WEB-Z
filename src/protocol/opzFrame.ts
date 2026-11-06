/** OP-Z manufacturer SysEx: F0 00 20 76 01 <id> <pack7 payload> F7. Ported from OpzFrame.cs. */
import { encode, decode } from './pack7.ts';

export const HEADER = Uint8Array.of(0xf0, 0x00, 0x20, 0x76, 0x01);
export const IDENTITY_INQUIRY = Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7);
export const HEARTBEAT = Uint8Array.of(0xf0, 0x00, 0x20, 0x76, 0x01, 0x00, 0x01, 0x4e, 0x2e, 0x06, 0xf7);
export const ALL_NOTES_OFF = Uint8Array.of(0xb0, 0x7b, 0x00);

export interface OpzFrame {
  messageId: number;
  payload: Uint8Array;
}

/** A fresh session id makes OP-Z treat us as a new client and resend its full state burst. */
export function hello(sessionId: number): Uint8Array {
  return build(0x00, Uint8Array.of((sessionId >> 8) & 0xff, sessionId & 0xff, 0x06));
}

export function build(messageId: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const packed = encode(payload);
  const frame = new Uint8Array(HEADER.length + 1 + packed.length + 1);
  frame.set(HEADER, 0);
  frame[HEADER.length] = messageId;
  frame.set(packed, HEADER.length + 1);
  frame[frame.length - 1] = 0xf7;
  return frame;
}

export function tryParse(data: Uint8Array): OpzFrame | null {
  if (data.length < 7 || data[data.length - 1] !== 0xf7) return null;
  for (let i = 0; i < HEADER.length; i++) {
    if (data[i] !== HEADER[i]) return null;
  }
  for (let i = 6; i < data.length - 1; i++) {
    if (data[i] > 0x7f) return null; // Pack7 body must be pure 7-bit
  }
  return { messageId: data[5], payload: decode(data.subarray(6, data.length - 1)) };
}

export function isIdentityReply(data: Uint8Array): boolean {
  return data.length > 9 && data[0] === 0xf0 && data[1] === 0x7e && data[3] === 0x06
    && data[4] === 0x02 && data[5] === 0x00 && data[6] === 0x20 && data[7] === 0x76;
}

/**
 * C# uses ZLibStream (RFC 1950 header, e.g. 78 9c). Web/Node's
 * DecompressionStream('deflate') is the same zlib-wrapped format; 'deflate-raw'
 * would be wrong here.
 */
export async function inflateZlib(payload: Uint8Array, maxSize = 1 << 20): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(payload)]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength > maxSize) {
    throw new Error(`inflated payload exceeds ${maxSize} bytes`);
  }
  return new Uint8Array(buffer);
}

export async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** DeviceInfo.FromMessage11: NUL-separated ASCII serial and firmware. */
export function deviceInfo(payload: Uint8Array): { serial: string; firmware: string } {
  const parts = new TextDecoder('ascii').decode(payload)
    .split('\0').filter((s) => s.length > 0);
  return { serial: parts[0] ?? '', firmware: parts[1] ?? '' };
}
