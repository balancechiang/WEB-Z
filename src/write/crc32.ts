/**
 * CRC-32 (ISO-HDLC / zlib) used by the OP-Z normal-mode file service.
 *
 * Verified against the reference example: crc32(utf8(lowercase("settings/slotConfiguration.json")))
 * === 2873598156 === 0xAB47A0CC (kmorrill/op-z-sysex clean-room-file-transport.md).
 * The path MUST be lower-cased before hashing; the mixed-case spelling hashes to 4127267068.
 */
const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  TABLE[i] = c >>> 0;
}

/** `seed` has the same meaning as zlib.crc32(data, seed): a previous CRC value, or 0 to start. */
export function crc32(data: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = (TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32Text(text: string, seed = 0): number {
  return crc32(new TextEncoder().encode(text), seed);
}

export function crc32Hex(data: Uint8Array): string {
  return `0x${crc32(data).toString(16).padStart(8, '0')}`;
}

/** Reserved IDs are fixed by the firmware; every other file is addressed by its path hash. */
export const RESERVED_FILES: readonly { path: string; id: number }[] = [
  { path: 'settings/slotconfiguration.json', id: 0 },
  { path: 'settings/plugs.json', id: 1 },
  { path: 'syncjob.json', id: 2 },
];

export const SYNC_JOB_FILE_ID = 2;

export function fileIdForPath(path: string): number {
  const lower = path.toLowerCase();
  const reserved = RESERVED_FILES.find((e) => e.path === lower);
  return reserved ? reserved.id : crc32Text(lower);
}
