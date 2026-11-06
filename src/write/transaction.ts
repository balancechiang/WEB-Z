/**
 * Stage 6 write-transaction core.
 *
 * Every device write goes through here. The rules come from the reversible hardware experiments
 * in kmorrill/op-z-sysex: start from a FRESH baseline, edit a copy, compare the COMPLETE reported
 * structure after the write, and restore the exact baseline on any mismatch.
 *
 * Safety properties, all testable without hardware:
 *   - DRY RUN is the default. `port.send` is never called until `arm()` AND `commit({confirmed:true})`.
 *   - Two explicit gates: arm() unlocks, commit's `confirmed` flag is the second confirmation.
 *   - A concurrency guard re-reads the baseline immediately before the first frame is sent and
 *     aborts if the device (or the official app) changed it while the editor was open.
 *   - A failed readback triggers an automatic rollback: re-encode the original bytes, send them,
 *     then require ANOTHER readback proving the baseline is back.
 *   - A structured audit trail (diff, CRCs, frame count, phase history) can be exported as JSON.
 *
 * All clocks and I/O are injected, so this module is deterministic under Node's test runner.
 */
import type { EvidenceGrade } from '../model/bankParams.ts';
import { crc32, crc32Hex } from './crc32.ts';

export type WritePhase =
  | 'idle' | 'staging' | 'armed' | 'writing' | 'verifying'
  | 'committed' | 'rolled-back' | 'aborted';

export interface WritePort {
  /**
   * Send one manufacturer SysEx frame. MUST NOT be called by a dry-run transaction.
   * May be async: pattern-bank uploads must wait for a $0B ack before the next chunk.
   */
  send(frame: Uint8Array): void | Promise<void>;
  /** Ask the device for a fresh independent readback; null means timeout / no response. */
  readback(): Promise<Uint8Array | null>;
  /** Injected monotonic clock (ms) for the audit trail. */
  now(): number;
  /** Optional fresh baseline read performed immediately before any frame is sent. */
  freshBaseline?(): Promise<Uint8Array | null> | Uint8Array | null;
}

export interface WriteTxOptions {
  kind: string;
  evidence: EvidenceGrade;
  /** Fresh, complete snapshot taken from the device before editing. Copied on construction. */
  baseline: Uint8Array;
  /** Encode the payload into the SysEx frames a real write would send. Pure, may be async. */
  encode(payload: Uint8Array): Uint8Array[] | Promise<Uint8Array[]>;
  port: WritePort;
  /** Compare a fresh device readback with the intended bytes. Defaults to exact byte equality. */
  verify?: (device: Uint8Array, expected: Uint8Array) => boolean;
}

export interface ByteDiff {
  count: number;
  offsets: number[];
  before: number[];
  after: number[];
  truncated: boolean;
}

export interface AuditEntry {
  atMs: number;
  phase: WritePhase;
  message: string;
  frames?: number;
  crc32?: string;
}

export interface WriteAudit {
  kind: string;
  evidence: EvidenceGrade;
  baselineBytes: number;
  baselineCrc32: string;
  stagedBytes: number;
  stagedCrc32: string;
  diff: ByteDiff;
  dryRun: boolean;
  frameCount: number;
  frameBytes: number;
  frameCrc32: string;
  frameHexSample: string[];
  entries: AuditEntry[];
}

export interface CommitResult {
  outcome: 'committed' | 'dry-run' | 'aborted' | 'rolled-back';
  phase: WritePhase;
  reason?: string;
  framesSent: number;
  readbackMatched: boolean | null;
}

const MAX_DIFF_OFFSETS = 512;
const MAX_HEX_SAMPLE = 4;

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function byteDiff(before: Uint8Array, after: Uint8Array): ByteDiff {
  const offsets: number[] = [];
  const ba: number[] = [];
  const aa: number[] = [];
  const n = Math.min(before.length, after.length);
  let truncated = false;
  for (let i = 0; i < n; i++) {
    if (before[i] === after[i]) continue;
    if (offsets.length >= MAX_DIFF_OFFSETS) { truncated = true; break; }
    offsets.push(i);
    ba.push(before[i]);
    aa.push(after[i]);
  }
  if (before.length !== after.length) truncated = true;
  return { count: offsets.length, offsets, before: ba, after: aa, truncated };
}

export function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s.toUpperCase();
}

export class WriteTransaction {
  readonly kind: string;
  readonly evidence: EvidenceGrade;

  private readonly baseline: Uint8Array;
  private staged: Uint8Array;
  private readonly opts: WriteTxOptions;
  private readonly entries: AuditEntry[] = [];
  private _phase: WritePhase = 'idle';
  private _armed = false;
  private _frames: Uint8Array[] = [];
  private _framesSent = 0;
  private _readbackMatched: boolean | null = null;

  constructor(opts: WriteTxOptions) {
    this.opts = opts;
    this.kind = opts.kind;
    this.evidence = opts.evidence;
    this.baseline = opts.baseline.slice();
    this.staged = opts.baseline.slice();
    this.log('idle', `fresh baseline: ${this.baseline.length} bytes ${crc32Hex(this.baseline)}`);
    this._phase = 'staging';
  }

  get phase(): WritePhase { return this._phase; }
  get armed(): boolean { return this._armed; }
  get dryRun(): boolean { return !this._armed; }
  get framesSent(): number { return this._framesSent; }
  get readbackMatched(): boolean | null { return this._readbackMatched; }
  get baselineBytes(): Uint8Array { return this.baseline.slice(); }
  get stagedBytes(): Uint8Array { return this.staged.slice(); }
  get frames(): readonly Uint8Array[] { return this._frames.map((f) => f.slice()); }
  get entriesView(): readonly AuditEntry[] { return this.entries; }

  /** Apply an edit to the write-copy. Never touches the captured baseline or the device. */
  stage(edit: (draft: Uint8Array) => void): ByteDiff {
    if (this._phase === 'committed' || this._phase === 'rolled-back') {
      throw new Error(`cannot stage a ${this._phase} transaction`);
    }
    edit(this.staged);
    const d = this.diff();
    this.log('staging', `staged edit: ${d.count} byte(s) changed${d.truncated ? ' (diff truncated)' : ''}`,
      undefined, crc32Hex(this.staged));
    return d;
  }

  reset(): void {
    this.staged = this.baseline.slice();
    this._frames = [];
    this._phase = this._armed ? 'armed' : 'staging';
    this.log(this._phase, 'staged edits discarded, write-copy reset to baseline');
  }

  diff(): ByteDiff { return byteDiff(this.baseline, this.staged); }

  /** Encode the current write-copy into frames WITHOUT sending anything. */
  async preview(): Promise<Uint8Array[]> {
    this._frames = (await this.opts.encode(this.staged)).map((f) => f.slice());
    this.log(this._phase, `encoded ${this._frames.length} frame(s), 0 sent`, this._frames.length);
    return this.frames as Uint8Array[];
  }

  /** First gate: explicitly unlock real sends. */
  arm(): void {
    this._armed = true;
    this._phase = 'armed';
    this.log('armed', 'device writes unlocked (second confirmation still required at commit)');
  }

  disarm(): void {
    this._armed = false;
    if (this._phase === 'armed') this._phase = 'staging';
    this.log(this._phase, 'device writes locked again');
  }

  /**
   * Second gate is `confirmed`. Unarmed commits are a pure preview; armed but unconfirmed
   * commits abort without touching the device.
   */
  async commit(options: { confirmed?: boolean } = {}): Promise<CommitResult> {
    if (this._phase === 'committed' || this._phase === 'rolled-back') {
      return {
        outcome: this._phase, phase: this._phase,
        framesSent: this._framesSent, readbackMatched: this._readbackMatched,
      };
    }

    const frames = await this.preview();
    if (!this._armed) {
      this.log('staging', `DRY RUN: ${frames.length} frame(s) prepared, 0 sent`, frames.length);
      return { outcome: 'dry-run', phase: this._phase, framesSent: 0, readbackMatched: null };
    }
    if (!options.confirmed) {
      return this.abort('explicit confirmation required before writing to the device');
    }

    // Concurrency guard: refuse to overwrite changes made by the hardware or the official app.
    if (this.opts.port.freshBaseline) {
      const fresh = await this.opts.port.freshBaseline();
      if (!fresh || !bytesEqual(fresh, this.baseline)) {
        return this.abort('baseline changed since the editor opened; refusing to overwrite concurrent edits');
      }
      this.log('armed', 'fresh baseline matches the captured snapshot');
    }

    this._phase = 'writing';
    for (const frame of frames) {
      await this.opts.port.send(frame);
      this._framesSent++;
    }
    this.log('writing', `sent ${frames.length} frame(s)`, frames.length);

    this._phase = 'verifying';
    const rb = await this.opts.port.readback();
    const verify = this.opts.verify ?? bytesEqual;
    const ok = rb !== null && verify(rb, this.staged);
    this._readbackMatched = ok;
    if (ok) {
      this._phase = 'committed';
      this.log('committed', 'full fresh readback matches the staged bytes', undefined, crc32Hex(rb!));
      return { outcome: 'committed', phase: this._phase, framesSent: this._framesSent, readbackMatched: true };
    }
    const why = rb === null ? 'no readback response' : 'readback does not match the staged bytes';
    return this.rollback(why);
  }

  /** Restore the exact captured baseline and require a second readback proving it. */
  async rollback(reason: string): Promise<CommitResult> {
    const frames = await this.opts.encode(this.baseline);
    for (const frame of frames) {
      await this.opts.port.send(frame);
      this._framesSent++;
    }
    this.log('rolled-back', `restoring ${this.baseline.length} baseline bytes (${reason})`, frames.length);
    const rb = await this.opts.port.readback();
    const restored = rb !== null && bytesEqual(rb, this.baseline);
    this._readbackMatched = restored;
    this._phase = 'rolled-back';
    this.log('rolled-back', `baseline restoration ${restored ? 'VERIFIED' : 'UNVERIFIED — keep the backup'}`);
    return {
      outcome: 'rolled-back', phase: this._phase, reason,
      framesSent: this._framesSent, readbackMatched: restored,
    };
  }

  private abort(reason: string): CommitResult {
    this._phase = 'aborted';
    this.log('aborted', reason);
    return {
      outcome: 'aborted', phase: this._phase, reason,
      framesSent: this._framesSent, readbackMatched: null,
    };
  }

  audit(): WriteAudit {
    const frameBytes = this._frames.reduce((n, f) => n + f.length, 0);
    const joined = new Uint8Array(frameBytes);
    let o = 0;
    for (const f of this._frames) { joined.set(f, o); o += f.length; }
    return {
      kind: this.kind,
      evidence: this.evidence,
      baselineBytes: this.baseline.length,
      baselineCrc32: crc32Hex(this.baseline),
      stagedBytes: this.staged.length,
      stagedCrc32: crc32Hex(this.staged),
      diff: this.diff(),
      dryRun: this.dryRun,
      frameCount: this._frames.length,
      frameBytes,
      frameCrc32: crc32Hex(joined),
      frameHexSample: this._frames.slice(0, MAX_HEX_SAMPLE).map(hex),
      entries: this.entries.slice(),
    };
  }

  auditJson(): string { return JSON.stringify(this.audit(), null, 2); }

  private log(phase: WritePhase, message: string, frames?: number, crc?: string): void {
    this.entries.push({ atMs: this.opts.port.now(), phase, message, frames, crc32: crc });
  }
}

/** Convenience for a deterministic test clock. */
export function fixedClock(start = 0): () => number {
  let t = start;
  return () => t++;
}

/** Exported for callers that want a stable digest of an arbitrary buffer. */
export function digest(data: Uint8Array): string {
  return `${crc32(data)}`;
}
