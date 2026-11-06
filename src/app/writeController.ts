/**
 * Stage 6 shell controller for the three write editors.
 *
 * This module is deliberately free of DOM, clocks, Web MIDI and the render loop: main.ts
 * injects every side effect, and the controller only owns transaction state and the safety
 * gates. That makes the whole "DRY RUN -> ARM -> CONFIRM -> readback -> rollback" policy
 * unit-testable under Node with fake baselines and fake ports.
 *
 * Safety contract (enforced here, not just in the UI):
 *   - The editor is OFF by default; then every screen paints its stage 1-5 read-only layout.
 *   - DRY RUN is the default and can never be skipped: arm() and commit(true) are two gates.
 *   - ARM is refused when there is no live transport, when the baseline is synthetic, or for
 *     the file-service editor (which is PLAN-ONLY and must never push bytes to the device).
 *   - The baseline is always captured separately and can be exported before any write.
 *   - Commit/rollback delegate to WriteTransaction, which performs a fresh-baseline guard,
 *     a complete readback and an exact rollback on any mismatch.
 */
import type { WriteUiState } from '../render/writeUi.ts';
import type { EvidenceGrade } from '../model/bankParams.ts';
import { BANK_PARAM } from '../model/bankParams.ts';
import {
  type WritePhase, type CommitResult, type WritePort, hex,
} from '../write/transaction.ts';
import { crc32Hex } from '../write/crc32.ts';
import { projectWriteUi } from '../write/viewModel.ts';
import { WRITE_EVIDENCE, evidenceLabel } from '../write/evidence.ts';
import {
  MidiConfigWriteSession, describeMidiEdit,
} from '../write/midiConfigWrite.ts';
import {
  PatternWriteSession, describePatternMutation, type PatternBankTarget,
} from '../write/patternWrite.ts';
import {
  buildFileServicePlan, type FileServicePlan,
} from '../write/fileService.ts';

export type WriteEditorKind = 'midi-config' | 'pattern-bank' | 'file-service';

export const WRITE_EDITORS: readonly WriteEditorKind[] = [
  'midi-config', 'pattern-bank', 'file-service',
];

export const WRITE_EDITOR_LABEL: Record<WriteEditorKind, string> = {
  'midi-config': 'MIDI CONFIG',
  'pattern-bank': 'PATTERN BANK',
  'file-service': 'FILE SERVICE',
};

/** Where the offline capture has no $10 config / $0A final bank packet. */
export interface WriteBaseline {
  bytes: Uint8Array;
  origin: 'device' | 'synthetic';
  /** Human-readable provenance, e.g. 'fresh $0F -> $10 (2 confirmed reads)'. */
  label: string;
}

/** Button-gate + status-line snapshot handed to the shell after every state change. */
export interface WriteStatus {
  open: boolean;
  editor: WriteEditorKind;
  live: boolean;
  baselineOrigin: 'device' | 'synthetic' | null;
  canArm: boolean;
  canCommit: boolean;
  canRollback: boolean;
  dryRun: boolean;
  message: string;
}

export interface WriteControllerDeps {
  /** Late-bound: a real Web MIDI transport may connect only after boot. */
  isLive: () => boolean;
  now: () => number;
  onLog: (message: string) => void;
  /** Receives the projected render state (null = all screens read-only) and the button gates. */
  onChange: (ui: WriteUiState | null, status: WriteStatus) => void;
  /** Asks the shell to show the screen that owns this editor's overlay. */
  onNavigate: (editor: WriteEditorKind) => void;
  readBaseline: (editor: WriteEditorKind) => Promise<WriteBaseline>;
  /** Only called for the two transaction editors; never for the plan-only file service. */
  createPort: (editor: WriteEditorKind) => WritePort & { dispose: () => void };
  bankTarget: () => PatternBankTarget;
  filePlanInput: () => { slotMap: Uint8Array; targetPath: string; targetContent: Uint8Array };
}

type TxSession = MidiConfigWriteSession | PatternWriteSession;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Offline stand-in. It still lets preview() encode frames (so the DRY-RUN diff is visible),
 * but any attempt to send throws and every readback returns null. ARM is separately refused
 * whenever the baseline is synthetic, so this port can never reach a device.
 */
function nullPort(now: () => number): WritePort & { dispose: () => void } {
  return {
    send: () => { throw new Error('OFFLINE: device writes are disabled'); },
    readback: async () => null,
    freshBaseline: async () => null,
    now,
    dispose: () => undefined,
  };
}

export class WriteController {
  private editor: WriteEditorKind = 'midi-config';
  private opened = false;
  private baseline: WriteBaseline | null = null;
  private tx: TxSession | null = null;
  private port: (WritePort & { dispose: () => void }) | null = null;
  private plan: FileServicePlan | null = null;
  private edits: string[] = [];
  private extraDetails: string[] = [];
  private result: CommitResult | null = null;
  private phase: WritePhase = 'staging';
  private busy = false;
  private lastUi: WriteUiState | null = null;
  private readonly deps: WriteControllerDeps;

  // Written out instead of a TS parameter property: Node's strip-only mode does not support
  // parameter properties, and the whole src/ tree is imported directly by the test runner.
  constructor(deps: WriteControllerDeps) {
    this.deps = deps;
  }

  get isOpen(): boolean { return this.opened; }
  get currentEditor(): WriteEditorKind { return this.editor; }
  get baselineOrigin(): 'device' | 'synthetic' | null { return this.baseline?.origin ?? null; }
  get ui(): WriteUiState | null { return this.lastUi; }

  /** ARM needs a real transport AND a device-proven baseline AND a real transaction. */
  get canArm(): boolean {
    return this.opened && this.deps.isLive() && this.baseline?.origin === 'device'
      && this.editor !== 'file-service' && this.tx !== null && !this.busy;
  }
  get canCommit(): boolean {
    return this.canArm && this.tx !== null && this.tx.tx.armed
      && this.phase !== 'committed' && this.phase !== 'rolled-back';
  }
  get canRollback(): boolean {
    return this.opened && this.deps.isLive() && this.baseline?.origin === 'device'
      && this.editor !== 'file-service' && this.tx !== null && !this.busy;
  }

  /** Publish the initial OFF state so the shell can disable every write button at boot. */
  sync(): void { this.publish(); }

  // ---- lifecycle ----

  async setOpen(on: boolean): Promise<void> {
    if (on === this.opened) {
      if (on) this.deps.onNavigate(this.editor);
      return;
    }
    if (!on) {
      this.teardown();
      this.opened = false;
      this.baseline = null;
      this.edits = [];
      this.extraDetails = [];
      this.result = null;
      this.phase = 'staging';
      this.publish();
      this.deps.onLog('WRITE EDITOR OFF · all 16 screens back to read-only');
      return;
    }
    this.opened = true;
    await this.rebuild();
    this.deps.onNavigate(this.editor);
  }

  async selectEditor(kind: WriteEditorKind): Promise<void> {
    if (!WRITE_EDITORS.includes(kind)) return;
    this.editor = kind;
    if (!this.opened) {
      this.deps.onLog(`WRITE EDITOR · ${WRITE_EDITOR_LABEL[kind]} (open the editor to inspect)`);
      this.publish();
      return;
    }
    await this.rebuild();
    this.deps.onNavigate(kind);
  }

  /** Re-read a fresh baseline, discard every staged edit and build a new DRY-RUN session. */
  async refresh(): Promise<void> {
    if (!this.opened) return;
    await this.rebuild();
    this.deps.onLog(`WRITE EDITOR · fresh baseline re-read (${this.baseline?.origin})`);
  }

  private teardown(): void {
    try { this.port?.dispose(); } catch { /* already gone */ }
    this.port = null;
    this.tx = null;
    this.plan = null;
  }

  private async rebuild(): Promise<void> {
    this.teardown();
    this.edits = [];
    this.result = null;
    this.phase = 'staging';
    this.extraDetails = [];

    const baseline = await this.deps.readBaseline(this.editor);
    this.baseline = baseline;
    const synthetic = baseline.origin === 'synthetic';
    const protocol = this.editor === 'file-service'
      ? WRITE_EVIDENCE.fileTransport.grade
      : this.editor === 'midi-config'
        ? WRITE_EVIDENCE.midiConfigWrite.grade
        : WRITE_EVIDENCE.patternUpload.grade;

    this.extraDetails.push(`PROTOCOL ${evidenceLabel(protocol)} · BASELINE ${baseline.origin.toUpperCase()} · ${baseline.label}`);

    if (this.editor === 'file-service') {
      const input = this.deps.filePlanInput();
      this.plan = await buildFileServicePlan(input);
      this.extraDetails.push(
        `TARGET ${this.plan.targetPath} · fileId ${this.plan.targetFileId} · CRC ${this.plan.targetCrc}`,
        `MANIFEST syncjob.json · fileId ${this.plan.jobFileId} · ${this.plan.jobParts} part(s)`,
        `TARGET PARTS ${this.plan.targetParts} · <=200 UNCOMPRESSED BYTES PER $53`,
      );
      for (const step of this.plan.steps) {
        this.extraDetails.push(`${step.order}. ${step.kind.toUpperCase()} · ${step.detail}`);
      }
      this.extraDetails.push('NO LIVE PUSH · host write permission is UNKNOWN in this project');
    } else {
      this.port = this.deps.isLive()
        ? this.deps.createPort(this.editor)
        : nullPort(this.deps.now);
      if (this.editor === 'midi-config') {
        this.tx = new MidiConfigWriteSession(baseline.bytes, this.port);
      } else {
        this.tx = new PatternWriteSession(baseline.bytes, this.port, this.deps.bankTarget());
      }
      // Encode (without sending) so the audit's frame count is populated immediately.
      await this.tx.preview();
      this.extraDetails.push(
        `BACKUP READY · ${baseline.bytes.length} B · CRC ${crc32Hex(baseline.bytes)}`,
        synthetic
          ? 'SYNTHETIC DATA — this capture contains no $10 config and no $0A final bank packet'
          : 'FRESH BASELINE GUARD AT COMMIT · FULL READBACK · EXACT ROLLBACK',
      );
    }

    this.publish();
    this.deps.onLog(
      `WRITE EDITOR · ${WRITE_EDITOR_LABEL[this.editor]} · baseline ${baseline.bytes.length} B `
      + `(${baseline.origin}) · DRY RUN · 0 frames sent`,
    );
  }

  // ---- edit staging ----

  /**
   * Stage one small, proven-safe typed edit so the diff / frame preview is visible without a
   * full production editor:
   *   MIDI CONFIG   -> TRACK 6 PARAM 9 CC (one byte at 32 + 5*16 + 8)
   *   PATTERN BANK  -> P1/T6 step-1 filter parameter lock (device-proven 11578 / 11596)
   * The value comes from the toolbar's VALUE input.
   */
  async stageSample(rawValue: string): Promise<void> {
    if (!this.opened || this.busy) return;
    if (this.editor === 'file-service') {
      this.deps.onLog('FILE SERVICE is PLAN-ONLY — no bytes are staged or sent');
      return;
    }
    const tx = this.tx;
    if (!tx) return;
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value)) {
      this.deps.onLog('STAGE refused · VALUE must be an integer');
      return;
    }
    try {
      let description: string;
      let changed: number;
      if (this.editor === 'midi-config') {
        const edit = { type: 'cc' as const, track: 5, parameter: 8, value: clamp(value, 0, 127) };
        changed = (tx as MidiConfigWriteSession).stage(edit).count;
        description = describeMidiEdit(edit);
      } else {
        const mutation = {
          type: 'lock' as const, pattern: 0, track: 5, step: 0,
          param: BANK_PARAM.Filter, value: clamp(value, 0, 255),
        };
        changed = (tx as PatternWriteSession).stage(mutation).count;
        description = describePatternMutation(mutation);
      }
      this.edits.push(description);
      this.result = null;
      this.phase = tx.tx.phase;
      await tx.preview();
      this.publish();
      this.deps.onLog(`STAGED ${description} · ${changed} byte(s) changed · 0 frames sent`);
    } catch (err) {
      this.deps.onLog(`STAGE refused · ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async reset(): Promise<void> {
    if (!this.tx || this.busy) return;
    this.tx.tx.reset();
    this.edits = [];
    this.result = null;
    this.phase = this.tx.tx.phase;
    await this.tx.preview();
    this.publish();
    this.deps.onLog('STAGED EDITS DISCARDED · write-copy restored to the exact baseline');
  }

  // ---- safety gates ----

  arm(): void {
    if (!this.canArm || !this.tx) {
      this.deps.onLog(this.armRefusal());
      return;
    }
    this.tx.arm();
    this.phase = this.tx.tx.phase;
    this.publish();
    this.deps.onLog('ARMED · real sends unlocked, but COMMIT still requires explicit confirmation');
  }

  disarm(): void {
    if (!this.tx) return;
    this.tx.disarm();
    this.phase = this.tx.tx.phase;
    this.publish();
    this.deps.onLog('DISARMED · DRY RUN restored, no frames can be sent');
  }

  async commit(): Promise<void> {
    if (!this.canCommit || !this.tx) {
      this.deps.onLog('COMMIT refused · open a live editor, capture a device baseline, stage an edit, ARM, then confirm');
      return;
    }
    this.busy = true;
    this.phase = 'writing';
    this.publish();
    try {
      // `confirmed: true` is the SECOND explicit gate (arm() was the first).
      this.result = await this.tx.commit(true);
      this.phase = this.result.phase;
      this.publish();
      const rb = this.result.readbackMatched === null ? 'N/A'
        : this.result.readbackMatched ? 'MATCH' : 'MISMATCH';
      this.deps.onLog(
        `COMMIT ${this.result.outcome.toUpperCase()} · ${this.result.framesSent} frame(s) sent · readback ${rb}`
        + (this.result.reason ? ` · ${this.result.reason}` : ''),
      );
    } catch (err) {
      this.phase = 'aborted';
      this.deps.onLog(`COMMIT ERROR · ${err instanceof Error ? err.message : String(err)}`);
      this.publish();
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  async rollback(): Promise<void> {
    if (!this.canRollback || !this.tx) {
      this.deps.onLog('ROLLBACK refused · requires a live editor with a device baseline');
      return;
    }
    this.busy = true;
    try {
      this.result = await this.tx.rollback();
      this.phase = this.result.phase;
      this.publish();
      this.deps.onLog(
        `ROLLBACK ${this.result.readbackMatched ? 'VERIFIED' : 'UNVERIFIED — KEEP THE BACKUP'} · `
        + `exact ${this.baseline?.bytes.length ?? 0} B restored`,
      );
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  // ---- exports ----

  /** Exact baseline bytes + CRC: the backup the user must keep before arming. */
  backupJson(): string {
    if (!this.baseline) return '';
    return JSON.stringify({
      kind: WRITE_EDITOR_LABEL[this.editor],
      origin: this.baseline.origin,
      provenance: this.baseline.label,
      bytes: this.baseline.bytes.length,
      crc32: crc32Hex(this.baseline.bytes),
      atMs: this.deps.now(),
      hex: hex(this.baseline.bytes),
    }, null, 2) + '\n';
  }

  /** Structured audit trail (diff, CRCs, frames, phase history, result) or the plan JSON. */
  auditJson(): string {
    const body = this.tx
      ? { ...this.tx.tx.audit(), stagedEdits: this.edits, commitResult: this.result }
      : this.plan ?? {};
    return JSON.stringify(body, null, 2) + '\n';
  }

  dispose(): void {
    this.teardown();
    this.opened = false;
    this.publish();
  }

  // ---- projection ----

  private armRefusal(): string {
    if (!this.deps.isLive()) return 'ARM refused · OFFLINE: no Web MIDI transport; connect a device first';
    if (this.editor === 'file-service') return 'ARM refused · FILE SERVICE is PLAN-ONLY (no live push)';
    if (this.baseline?.origin !== 'device') return 'ARM refused · SYNTHETIC baseline; only a fresh device snapshot may be written';
    return 'ARM refused · editor is not ready';
  }

  private note(): string {
    if (this.editor === 'file-service') {
      return 'PLAN ONLY — NO LIVE PUSH · HOST WRITE PERMISSION UNKNOWN';
    }
    if (this.baseline?.origin === 'synthetic') {
      return 'SYNTHETIC BASELINE — NOT FROM A DEVICE · ARM / COMMIT DISABLED';
    }
    return 'FRESH DEVICE BASELINE · BACKUP FIRST · EXACT ROLLBACK ON MISMATCH';
  }

  private evidence(): EvidenceGrade {
    if (this.baseline?.origin === 'synthetic') return 'unknown';
    if (this.editor === 'file-service') return WRITE_EVIDENCE.fileTransport.grade;
    return this.editor === 'midi-config'
      ? WRITE_EVIDENCE.midiConfigWrite.grade
      : WRITE_EVIDENCE.patternUpload.grade;
  }

  private buildUi(): WriteUiState {
    if (this.editor === 'file-service') {
      const plan = this.plan;
      return projectWriteUi({
        kind: WRITE_EDITOR_LABEL[this.editor],
        evidence: this.evidence(),
        phase: 'staging',
        audit: null,
        edits: plan ? plan.steps.map((s) => `${s.order}. ${s.kind.toUpperCase()} · ${s.detail}`) : [],
        details: this.extraDetails,
        note: this.note(),
        diffCount: 0,
        frameCount: plan ? plan.jobParts + plan.targetParts : 0,
        baselineBytes: this.baseline?.bytes.length ?? 0,
      });
    }
    return projectWriteUi({
      kind: WRITE_EDITOR_LABEL[this.editor],
      evidence: this.evidence(),
      phase: this.phase,
      audit: this.tx ? this.tx.tx.audit() : null,
      edits: this.edits,
      details: this.extraDetails,
      result: this.result,
      note: this.note(),
    });
  }

  private status(): WriteStatus {
    let message: string;
    if (!this.opened) message = 'editor OFF · read-only';
    else if (this.busy) message = 'transaction in progress';
    else if (this.editor === 'file-service') message = 'PLAN-ONLY · no device writes';
    else if (this.baseline?.origin === 'synthetic') message = 'SYNTHETIC baseline · ARM disabled';
    else if (this.result) message = `${this.result.outcome.toUpperCase()} · ${this.result.framesSent} frame(s)`;
    else if (this.tx?.tx.armed) message = 'ARMED · confirm COMMIT to send';
    else message = 'DRY RUN · stage an edit to preview the diff';
    return {
      open: this.opened,
      editor: this.editor,
      live: this.deps.isLive(),
      baselineOrigin: this.baselineOrigin,
      canArm: this.canArm,
      canCommit: this.canCommit,
      canRollback: this.canRollback,
      dryRun: this.tx ? this.tx.tx.dryRun : true,
      message,
    };
  }

  private publish(): void {
    const ui = this.opened ? this.buildUi() : null;
    this.lastUi = ui;
    this.deps.onChange(ui, this.status());
  }
}
