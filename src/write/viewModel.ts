/**
 * Pure projection: WriteTransaction audit -> the render layer's WriteUiState.
 *
 * This is deliberately free of DOM, clocks and device I/O so it can be unit tested under Node.
 * The shell calls it after every editor action and hands the result to CanvasView.writeState.
 */
import type { WriteUiState } from '../render/writeUi.ts';
import type { EvidenceGrade } from '../model/bankParams.ts';
import type { WriteAudit, WritePhase, CommitResult } from './transaction.ts';
import { evidenceLabel } from './evidence.ts';

export interface WriteViewOptions {
  kind: string;
  evidence: EvidenceGrade;
  phase: WritePhase;
  audit: WriteAudit | null;
  edits: readonly string[];
  /** Extra lines appended after the standard audit summary (e.g. file-service plan steps). */
  details?: readonly string[];
  result?: CommitResult | null;
  /** Highest-priority note, e.g. 'SYNTHETIC BASELINE — NOT FROM A DEVICE'. */
  note?: string;
  /** Overrides for editors with no WriteTransaction (e.g. the file-service plan). */
  diffCount?: number;
  frameCount?: number;
  baselineBytes?: number;
}

/** Build a deterministic, primitive-only view of the current write editor. */
export function projectWriteUi(options: WriteViewOptions): WriteUiState {
  const audit = options.audit;
  const details: string[] = [];
  if (options.note) details.push(options.note);
  if (audit) {
    details.push(`BASELINE CRC ${audit.baselineCrc32} (${audit.baselineBytes} B)`);
    details.push(`STAGED CRC ${audit.stagedCrc32}`);
    details.push(`FRAME CRC ${audit.frameCrc32} · ${audit.frameCount} frame(s) / ${audit.frameBytes} B`);
    details.push(`EVIDENCE ${evidenceLabel(options.evidence)} · DRY RUN ${audit.dryRun ? 'ON' : 'OFF'}`);
    for (const entry of audit.entries.slice(-4)) {
      details.push(`[${entry.phase}] ${entry.message}`);
    }
  }
  for (const line of options.details ?? []) details.push(line);
  if (options.result) {
    const rb = options.result.readbackMatched === null
      ? 'N/A' : options.result.readbackMatched ? 'MATCH' : 'MISMATCH';
    details.push(`RESULT ${options.result.outcome.toUpperCase()} · SENT ${options.result.framesSent} · READBACK ${rb}`);
    if (options.result.reason) details.push(`REASON ${options.result.reason}`);
  }

  return {
    kind: options.kind,
    evidence: evidenceLabel(options.evidence),
    phase: options.phase,
    dryRun: audit ? audit.dryRun : true,
    diffCount: options.diffCount ?? (audit ? audit.diff.count : 0),
    frameCount: options.frameCount ?? (audit ? audit.frameCount : 0),
    baselineBytes: options.baselineBytes ?? (audit ? audit.baselineBytes : 0),
    edits: options.edits.slice(0, 24),
    details: details.slice(0, 24),
  };
}
