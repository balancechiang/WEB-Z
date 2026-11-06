/**
 * OPB.Core/Model/Firmware.cs → TypeScript.
 * Firmware version parsing and the file-service feature gate.
 */

/** First firmware known to answer the file service ($51 then $34). */
export const FILE_SERVICE_VERSION: readonly [number, number, number] = [1, 2, 45];

export const DOWNLOAD_URL = 'teenage.engineering/downloads/op-z';

/** Returns up to four version numbers, or null when the string is not parseable. */
export function parseFirmware(firmware: string | null | undefined): number[] | null {
  if (firmware == null) return null;
  const trimmed = firmware.trim();
  if (!trimmed) return null;
  let s = '';
  for (const ch of trimmed) {
    if ((ch >= '0' && ch <= '9') || ch === '.') s += ch;
    else break;
  }
  s = s.replace(/^\.+|\.+$/g, '');
  const parts = s.split('.').filter((p) => p !== '');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return null;
  return nums;
}

/** True/false when the version is known, null when it isn't. */
export function supportsFileService(firmware: string | null | undefined): boolean | null {
  const v = parseFirmware(firmware);
  if (!v) return null;
  const target = FILE_SERVICE_VERSION;
  const len = Math.max(v.length, target.length);
  for (let i = 0; i < len; i++) {
    const a = v[i] ?? 0;
    const b = target[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}
