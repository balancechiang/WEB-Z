/**
 * Stage 6 render contract for the write editor.
 *
 * The 16 screen modules stay PURE renderers: they never import the write layer, never read
 * a clock, and never touch a device. The shell projects the live WriteTransaction into this
 * flat, primitive-only view and passes it through ScreenInput each frame. When `write` is
 * null/undefined every screen paints exactly the read-only layout from stages 1-5.
 *
 * Keeping this type in the render layer (rather than importing from src/write/) avoids a
 * render -> write -> protocol dependency in the drawing helpers.
 */
export interface WriteUiState {
  /** Editor label, e.g. 'MIDI CONFIG' | 'PATTERN BANK' | 'FILE SERVICE'. */
  kind: string;
  /** Evidence grade label: DEVICE-PROVEN / DECODED / OBSERVED / INFERRED / UNKNOWN. */
  evidence: string;
  /** Transaction phase: staging / armed / writing / verifying / committed / rolled-back / aborted. */
  phase: string;
  /**
   * True until arm(). This is the DEFAULT. The badge must never claim a write happened
   * while this is true, and the controller must keep commit disabled until it is false.
   */
  dryRun: boolean;
  /** Bytes changed in the write-copy versus the fresh baseline. */
  diffCount: number;
  /** Frames a real commit would send (0 when nothing has been staged). */
  frameCount: number;
  /** Size of the captured baseline = the backup the user must keep. */
  baselineBytes: number;
  /** Short staged-edit descriptions, e.g. 'TRACK 6 PARAM 9 -> CC 74'. */
  edits: string[];
  /** Transaction / plan detail lines: CRCs, audit entries, plan steps, results. */
  details: string[];
}
