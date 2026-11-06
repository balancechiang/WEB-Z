/**
 * Teenage Engineering 7-bit packing, ported 1:1 from OPB.Core/Protocol/Pack7.cs.
 *
 * Each group of up to 7 source bytes is preceded by one mask byte; bit N of the
 * mask holds the high bit of source byte N in that group. The wire format must
 * stay bit-identical with the C# implementation or OP-Z rejects every frame.
 */
export function encode(source: Uint8Array): Uint8Array {
  const groups = Math.ceil(source.length / 7);
  const output = new Uint8Array(source.length + groups);
  let o = 0;
  for (let start = 0; start < source.length; start += 7) {
    const count = Math.min(7, source.length - start);
    let mask = 0;
    for (let i = 0; i < count; i++) {
      mask |= ((source[start + i] >> 7) & 1) << i;
    }
    output[o++] = mask;
    for (let i = 0; i < count; i++) {
      output[o++] = source[start + i] & 0x7f;
    }
  }
  return output;
}

export function decode(source: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let start = 0; start < source.length; start += 8) {
    const count = Math.min(8, source.length - start);
    const mask = source[start];
    for (let i = 1; i < count; i++) {
      output.push(source[start + i] | (((mask >> (i - 1)) & 1) << 7));
    }
  }
  return Uint8Array.from(output);
}
