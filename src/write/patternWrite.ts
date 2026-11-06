/**
 * Stage 6, part 2: typed pattern-bank writes ($08 request / $09 chunks / $0A final / $0B ack).
 *
 * Reference: kmorrill/op-z-sysex docs/typed-pattern-editing.md (device-proven on fw 1.2.45+,
 * 336 typed mutations, 609 changed offsets, exact 342,272-byte readback, exact restoration).
 *
 * Rules we follow:
 *   - Always start from a FRESH 342,272-byte snapshot.
 *   - Edit only the requested typed fields; every unrelated byte is preserved.
 *   - Upload, request another snapshot, and confirm the requested values.
 *   - On upload or confirmation failure, restore the exact pre-edit bank and read back again.
 *
 * IMPORTANT (evidence: unknown): the reference mentions $0B flow control for uploads. This
 * project acknowledges $0B on receive and uses $09/$0A with per-packet $0B acks, but the exact
 * upload-side flow-control semantics are NOT proven here. Pattern writes therefore stay DRY-RUN
 * by default and must be hardware-verified before arming.
 */
import { build, deflateZlib } from '../protocol/opzFrame.ts';
import { PatternBank, PATTERN_BANK_SIZE, PATTERN_COUNT, type PatternNote } from '../model/patternBank.ts';
export { PATTERN_BANK_SIZE, PATTERN_COUNT, PatternBank } from '../model/patternBank.ts';
export type { PatternNote } from '../model/patternBank.ts';
import { liveToBankParam } from '../model/bankParams.ts';
import {
  WriteTransaction, bytesEqual, type WritePort, type ByteDiff, type CommitResult,
} from './transaction.ts';
import { WRITE_EVIDENCE } from './evidence.ts';

export const PATTERN_BANK_REQUEST_ID = 0x08;
export const PATTERN_CHUNK_ID = 0x09;
export const PATTERN_FINAL_CHUNK_ID = 0x0a;
export const PATTERN_ACK_ID = 0x0b;
export const PATTERN_CHUNK_SIZE = 178;
export const PATTERN_HEADER_SIZE = 6;

export const PATTERN_BANK_REQUEST: Uint8Array = build(PATTERN_BANK_REQUEST_ID);

export interface PatternBankTarget {
  /** Address byte from the last received bank packet (only the high nibble is used). */
  address: number;
  /** Transfer id from the last received bank packet. */
  transferId: number;
}

export type PatternMutation =
  | { type: 'notes'; pattern: number; track: number; step: number; notes: PatternNote[] }
  | { type: 'component'; pattern: number; track: number; step: number; component: number; value: number | null }
  | { type: 'lock'; pattern: number; track: number; step: number; param: number; value: number | null }
  | { type: 'sound'; pattern: number; track: number; param: number; value: number; space?: 'bank' | 'live' }
  | { type: 'step-count'; pattern: number; track: number; count: number }
  | { type: 'step-length'; pattern: number; track: number; length: number }
  | { type: 'quantize'; pattern: number; track: number; value: number }
  | { type: 'note-length'; pattern: number; track: number; value: number }
  | { type: 'routing'; pattern: number; master: boolean; track: number; on: boolean };

function check(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be ${min}..${max} (got ${value})`);
  }
}

/** Apply one validated typed mutation. `param` for 'lock' is a BANK_PARAM index. */
export function applyPatternMutation(bank: PatternBank, m: PatternMutation): void {
  check(m.pattern, 0, PATTERN_COUNT - 1, 'pattern');
  check(m.track, 0, 15, 'track');
  switch (m.type) {
    case 'notes':
      check(m.step, 0, 15, 'step');
      bank.setNotes(m.pattern, m.track, m.step, m.notes);
      return;
    case 'component':
      check(m.step, 0, 15, 'step');
      check(m.component, 0, 15, 'component');
      bank.setComponent(m.pattern, m.track, m.step, m.component, m.value);
      return;
    case 'lock':
      check(m.step, 0, 15, 'step');
      check(m.param, 0, 17, 'lock param (BANK_PARAM)');
      if (m.value === null) bank.clearLock(m.pattern, m.track, m.step, m.param);
      else {
        check(m.value, 0, 255, 'lock value');
        bank.setLock(m.pattern, m.track, m.step, m.param, m.value);
      }
      return;
    case 'sound': {
      check(m.param, 0, 17, 'sound param');
      check(m.value, 0, 255, 'sound value');
      const p = m.space === 'live' ? liveToBankParam(m.param) : m.param;
      bank.setSound(m.pattern, m.track, p, m.value);
      return;
    }
    case 'step-count': bank.setStepCount(m.pattern, m.track, m.count); return;
    case 'step-length': bank.setStepLength(m.pattern, m.track, m.length); return;
    case 'quantize': bank.setQuantize(m.pattern, m.track, m.value); return;
    case 'note-length': bank.setNoteLength(m.pattern, m.track, m.value); return;
    case 'routing': bank.setRouted(m.pattern, m.master, m.track, m.on); return;
  }
}

export function describePatternMutation(m: PatternMutation): string {
  const where = `P${m.pattern + 1}/T${m.track + 1}`;
  switch (m.type) {
    case 'notes': return `${where} STEP ${m.step + 1}: ${m.notes.length} note(s)`;
    case 'component': return `${where} STEP ${m.step + 1} COMP ${m.component}: ${m.value ?? 'OFF'}`;
    case 'lock': return `${where} STEP ${m.step + 1} LOCK ${m.param}: ${m.value ?? 'CLEAR'}`;
    case 'sound': return `${where} SOUND ${m.param}: ${m.value}`;
    case 'step-count': return `${where} STEP COUNT ${m.count}`;
    case 'step-length': return `${where} STEP LENGTH ${m.length}`;
    case 'quantize': return `${where} QUANTIZE ${m.value}`;
    case 'note-length': return `${where} NOTE LENGTH ${m.value}`;
    case 'routing': return `${where} ${m.master ? 'MASTER' : 'TAPE'} ROUTING ${m.on ? 'ON' : 'OFF'}`;
  }
}

/**
 * Packetize a complete bank: 178 compressed bytes per $09 chunk, $0A for the final one.
 * The 6-byte header matches OpzSession.sendBankPacketsAsync (port of OPB.Core).
 */
export async function encodePatternBankFrames(
  bank: Uint8Array,
  target: PatternBankTarget,
): Promise<Uint8Array[]> {
  if (bank.length !== PATTERN_BANK_SIZE) {
    throw new Error(`pattern bank must be ${PATTERN_BANK_SIZE} bytes (got ${bank.length})`);
  }
  const compressed = await deflateZlib(bank);
  const count = Math.max(1, Math.ceil(compressed.length / PATTERN_CHUNK_SIZE));
  const address = target.address & 0xf0;
  const frames: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const chunk = compressed.subarray(index * PATTERN_CHUNK_SIZE,
      Math.min(compressed.length, (index + 1) * PATTERN_CHUNK_SIZE));
    const payload = new Uint8Array(PATTERN_HEADER_SIZE + chunk.length);
    payload[0] = address;
    payload[2] = target.transferId & 0xff;
    payload[3] = (target.transferId >> 8) & 0xff;
    payload[4] = index & 0xff;
    payload[5] = (index >> 8) & 0xff;
    payload.set(chunk, PATTERN_HEADER_SIZE);
    const last = index === count - 1;
    frames.push(build(last ? PATTERN_FINAL_CHUNK_ID : PATTERN_CHUNK_ID, payload));
  }
  return frames;
}

export class PatternWriteSession {
  readonly tx: WriteTransaction;
  private readonly mutations: PatternMutation[] = [];
  readonly target: PatternBankTarget;

  constructor(baseline: Uint8Array, port: WritePort, target: PatternBankTarget) {
    this.target = target;
    this.tx = new WriteTransaction({
      kind: 'pattern-bank',
      evidence: WRITE_EVIDENCE.patternUpload.grade,
      baseline,
      encode: (payload) => encodePatternBankFrames(payload, target),
      port,
      verify: (device, expected) => device.length === PATTERN_BANK_SIZE && bytesEqual(device, expected),
    });
  }

  get mutationsView(): readonly PatternMutation[] { return this.mutations; }

  stage(mutation: PatternMutation): ByteDiff {
    // Validate against a throwaway copy first so a bad mutation never lands mid-way.
    applyPatternMutation(new PatternBank(this.tx.stagedBytes), mutation);
    const d = this.tx.stage((draft) => applyPatternMutation(new PatternBank(draft), mutation));
    this.mutations.push(mutation);
    return d;
  }

  stageMany(mutations: readonly PatternMutation[]): ByteDiff {
    for (const m of mutations) applyPatternMutation(new PatternBank(this.tx.stagedBytes), m);
    const d = this.tx.stage((draft) => {
      const bank = new PatternBank(draft);
      for (const m of mutations) applyPatternMutation(bank, m);
    });
    this.mutations.push(...mutations);
    return d;
  }

  preview(): Promise<Uint8Array[]> { return this.tx.preview(); }
  arm(): void { this.tx.arm(); }
  disarm(): void { this.tx.disarm(); }
  commit(confirmed = false): Promise<CommitResult> { return this.tx.commit({ confirmed }); }
  rollback(): Promise<CommitResult> { return this.tx.rollback('manual rollback'); }
  auditJson(): string { return this.tx.auditJson(); }
}
