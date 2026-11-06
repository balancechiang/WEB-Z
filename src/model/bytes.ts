/** Little-endian integer helpers shared by the model layer (1:1 with C# BinaryPrimitives). */

export function u16le(p: Uint8Array, off: number): number {
  return (p[off] | (p[off + 1] << 8)) & 0xffff;
}

export function u32le(p: Uint8Array, off: number): number {
  return (p[off] | (p[off + 1] << 8) | (p[off + 2] << 16) | (p[off + 3] << 24)) >>> 0;
}

export function w16le(p: Uint8Array, off: number, v: number): void {
  p[off] = v & 0xff;
  p[off + 1] = (v >> 8) & 0xff;
}

export function w32le(p: Uint8Array, off: number, v: number): void {
  p[off] = v & 0xff;
  p[off + 1] = (v >> 8) & 0xff;
  p[off + 2] = (v >> 16) & 0xff;
  p[off + 3] = (v >>> 24) & 0xff;
}
