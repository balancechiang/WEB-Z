/**
 * OPB.App/Rendering/{Draw,Widgets}.cs → TypeScript (Canvas 2D edition).
 * Each helper mirrors the Avalonia DrawingContext call it replaces. Coordinates are
 * design units (the 1600 x 812 box); the canvas view applies the uniform scale.
 */
import { OpbTheme, weightToCss, type FontWeight } from './theme.ts';
import type { WriteUiState } from './writeUi.ts';

export interface Rect { x: number; y: number; w: number; h: number; }
export type Align = 'left' | 'center' | 'right';
export type Ctx = CanvasRenderingContext2D;

// Approximate Bahnschrift SemiCondensed on systems without the Windows font.
const TEXT_WIDTH_SCALE = 0.875;

export function fontString(size: number, weight: FontWeight = 'light'): string {
  return `${weightToCss(weight)} ${size}px ${OpbTheme.Font}`;
}

/** Cached text metrics so repeated labels in a frame stay cheap (mirrors Draw.Text's cache). */
const metricCache = new Map<string, number>();

export function textWidth(ctx: Ctx, text: string, size: number, weight: FontWeight = 'light'): number {
  const key = `${text}|${size}|${weight}`;
  const hit = metricCache.get(key);
  if (hit !== undefined) return hit;
  ctx.font = fontString(size, weight);
  const w = ctx.measureText(text).width * TEXT_WIDTH_SCALE;
  if (metricCache.size > 4000) metricCache.clear();
  metricCache.set(key, w);
  return w;
}

/** Draws text with its vertical center at y (C# nudges caps up slightly; we match it). */
export function label(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: Align = 'left',
  weight: FontWeight = 'light',
): void {
  ctx.font = fontString(size, weight);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  const drawY = y + size * 0.04;
  ctx.save();
  ctx.scale(TEXT_WIDTH_SCALE, 1);
  ctx.fillText(text, x / TEXT_WIDTH_SCALE, drawY);
  ctx.restore();
}

export function hLine(ctx: Ctx, x0: number, x1: number, y: number, color: string = OpbTheme.Rule, width = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
}

export function vLine(ctx: Ctx, x: number, y0: number, y1: number, color: string = OpbTheme.Rule, width = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
}

/** Rectangle outline inset by half the stroke so the visible frame matches the C# Frame. */
export function frame(ctx: Ctx, r: Rect, color: string, thickness = 4): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.strokeRect(r.x + thickness / 2, r.y + thickness / 2, Math.max(0, r.w - thickness), Math.max(0, r.h - thickness));
}

/**
 * Fills rect with a 45° (anti-diagonal) hatch, like Draw.Hatch: one stroke every 14 units.
 * Lines satisfy x + y = c over the rect's extent. We clip to the rect so lines don't spill.
 */
export function hatch(ctx: Ctx, r: Rect, lineColor: string, backColor: string): void {
  ctx.save();
  ctx.fillStyle = backColor;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const step = 14;
  for (let c = r.x + r.y; c <= r.x + r.w + r.y + r.h; c += step) {
    const xl = Math.max(r.x, c - (r.y + r.h));
    const xr = Math.min(r.x + r.w, c - r.y);
    if (xr >= xl) {
      ctx.moveTo(xl, c - xl);
      ctx.lineTo(xr, c - xr);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Knob angle in radians clockwise from 12 o'clock for a 0..1 value (270° sweep). */
export function knobAngle(value01: number): number {
  const deg = -135 + 270 * Math.max(0, Math.min(1, value01));
  return (deg * Math.PI) / 180;
}

/** The app's round parameter indicator: filled disc with a screw-head cross and outward stem. */
export function knob(
  ctx: Ctx,
  cx: number,
  cy: number,
  value01: number,
  color: string,
  radius = 22,
  stem = true,
): void {
  const angle = knobAngle(value01);
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  if (stem) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(cx + dx * radius * 0.9, cy + dy * radius * 0.9);
    ctx.lineTo(cx + dx * radius * 1.75, cy + dy * radius * 1.75);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  cross(ctx, cx, cy, radius * 0.5, angle);
}

export function cross(ctx: Ctx, cx: number, cy: number, half: number, angleRad = 0): void {
  ctx.strokeStyle = OpbTheme.White;
  ctx.lineWidth = half * 0.42;
  ctx.lineCap = 'butt';
  const ax = Math.cos(angleRad) * half;
  const ay = Math.sin(angleRad) * half;
  const bx = -Math.sin(angleRad) * half;
  const by = Math.cos(angleRad) * half;
  ctx.beginPath();
  ctx.moveTo(cx - ax, cy - ay);
  ctx.lineTo(cx + ax, cy + ay);
  ctx.moveTo(cx - bx, cy - by);
  ctx.lineTo(cx + bx, cy + by);
  ctx.stroke();
}

/** A small solid disc with a plus, used as an envelope handle. */
export function handle(ctx: Ctx, cx: number, cy: number, color: string, radius = 16): void {
  knob(ctx, cx, cy, 0.5, color, radius, false);
}

/** A small round +/- button. */
export function stepper(ctx: Ctx, cx: number, cy: number, plus: boolean, enabled = true, radius = 15): void {
  if (enabled) {
    ctx.fillStyle = OpbTheme.Mid;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = OpbTheme.Mid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = enabled ? OpbTheme.White : OpbTheme.Mid;
  ctx.lineWidth = radius * 0.24;
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.5, cy);
  ctx.lineTo(cx + radius * 0.5, cy);
  if (plus) {
    ctx.moveTo(cx, cy - radius * 0.5);
    ctx.lineTo(cx, cy + radius * 0.5);
  }
  ctx.stroke();
}

/** A flat framed button with a centered caption. */
export function button(ctx: Ctx, r: Rect, text: string, enabled = true, primary = false, size = 30): void {
  if (primary && enabled) {
    ctx.fillStyle = OpbTheme.Ink;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else {
    frame(ctx, r, enabled ? OpbTheme.Ink : OpbTheme.Rule, 3);
  }
  label(ctx, text, r.x + r.w / 2, r.y + r.h / 2, size, primary && enabled ? OpbTheme.White : enabled ? OpbTheme.Ink : OpbTheme.Mid, 'center', 'normal');
}

/** A square on/off box: solid with a cross when on, outline when off. */
export function toggle(ctx: Ctx, cx: number, cy: number, on: boolean, enabled = true, size = 28): void {
  const s = size;
  const x = cx - s / 2;
  const y = cy - s / 2;
  if (on) {
    ctx.fillStyle = enabled ? OpbTheme.Ink : OpbTheme.Mid;
    ctx.fillRect(x, y, s, s);
    cross(ctx, cx, cy, s * 0.3, Math.PI / 4);
  } else {
    frame(ctx, { x, y, w: s, h: s }, enabled ? OpbTheme.Mid : OpbTheme.Rule, 3);
  }
}

/** Greedy word wrap to a width (mirrors Widgets.Wrap); relies on textWidth for metrics. */
export function wrapText(ctx: Ctx, text: string, width: number, size: number, weight: FontWeight = 'light'): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line.length === 0 ? word : line + ' ' + word;
    if (line.length > 0 && textWidth(ctx, candidate, size, weight) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** HSV (h in degrees, s/v in 0..1) → CSS rgb() string, used by the lights/motion previews. */
export function hsvToCss(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `rgb(${r},${g},${b})`;
}

/** Truncates text to a max pixel width (mirrors Widgets.Fit) using cached text metrics. */
export function fitText(ctx: Ctx, text: string, maxW: number, size: number, weight: FontWeight = 'light'): string {
  if (textWidth(ctx, text, size, weight) <= maxW) return text;
  let s = text;
  while (s.length > 1 && textWidth(ctx, s + '…', size, weight) > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** Numeric HSV→RGB (0..255 triples) so callers can pick label contrast from luminance. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Shared layout constants for the control-track screens (master/module/lights/motion),
// mirrored from ControlTrackScreen.cs.
const CT_ROW0 = 82, CT_BODY_BOTTOM = 602, CT_RIGHT_END = 1426, CT_BOTTOM = 812;
const CT_SEQ_LABEL_Y = 622, CT_SEQ_NUM_TOP = 645, CT_SEQ_DOT_TOP = 688, CT_SEQ_BOTTOM = 732;
const CT_STEP_X0 = 42, CT_STEP_W = 86.5;

/**
 * The common chrome for a control-track screen: centered title, the right-hand touch-pad hatch,
 * the frame rules and the body divider. Mirrors ControlTrackScreen.RenderContent's frame drawing.
 */
export function controlTrackChrome(ctx: Ctx, input: { left: number; right: number }, title: string): void {
  label(ctx, title, CT_RIGHT_END / 2, 40, 56, OpbTheme.Ink, 'center', 'normal');
  label(ctx, 'TOUCH PAD', CT_RIGHT_END + 14, 40, 30, OpbTheme.Mid);
  hLine(ctx, input.left, input.right, CT_ROW0);
  vLine(ctx, CT_RIGHT_END, 0, CT_BOTTOM);
  hLine(ctx, input.left, input.right, CT_BODY_BOTTOM);
  hatch(ctx, { x: CT_RIGHT_END, y: CT_ROW0, w: input.right - CT_RIGHT_END, h: 648 }, OpbTheme.Rule, OpbTheme.Background);
}

/** The playing step of a track, derived deterministically from clock or the input play clock. */
function controlTrackStep(
  input: { playing: boolean; playMs: number; session: { clockTicks: number; clockRunning: boolean; play: { playing: boolean }; global: { tempo: number } | null } },
  count: number,
  length: number,
): number {
  const s = input.session;
  if (!s.clockRunning && !s.play.playing && !input.playing) return -1;
  let sixteenths: number;
  if (s.clockTicks > 0) sixteenths = s.clockTicks / 6;
  else if (input.playMs > 0) {
    const bpm = s.global ? s.global.tempo : 120;
    sixteenths = (input.playMs / 1000 / 60) * bpm * 4;
  } else return -1;
  return Math.floor(sixteenths / Math.max(1, length) % Math.max(1, count));
}

/**
 * The bottom 16-step sequencer strip shared by every control-track screen. Reads the pattern
 * bank for step count/length/triggers; deterministic given the input clock (no wall-clock use).
 */
export function controlTrackSequencer(
  ctx: Ctx,
  input: { left: number; right: number; playing: boolean; playMs: number; session: import('./screens/index.ts').ScreenInput['session'] },
  track: number,
): void {
  const LeftEdge = input.left, RightEdge = input.right;
  const session = input.session;
  const bank = session.bank;
  const pattern = session.activePattern;
  const count = bank ? bank.stepCount(pattern, track) : 16;
  const length = bank ? bank.stepLength(pattern, track) : 1;
  const playStep = controlTrackStep(input, count, length);

  label(ctx, 'SEQUENCER', 30, CT_SEQ_LABEL_Y, 30, OpbTheme.Mid);
  hLine(ctx, LeftEdge, CT_RIGHT_END, CT_SEQ_NUM_TOP);
  ctx.fillStyle = OpbTheme.Rule;
  ctx.fillRect(LeftEdge, CT_SEQ_DOT_TOP, CT_RIGHT_END - LeftEdge, CT_SEQ_BOTTOM - CT_SEQ_DOT_TOP);
  hLine(ctx, LeftEdge, RightEdge, CT_SEQ_BOTTOM);

  for (let step = 0; step < 16; step++) {
    const x = CT_STEP_X0 + step * CT_STEP_W;
    const beyond = step >= count;
    if (step > 0) vLine(ctx, x, CT_SEQ_NUM_TOP, CT_SEQ_DOT_TOP, step % 4 === 0 ? OpbTheme.Ink : OpbTheme.Rule, step % 4 === 0 ? 2 : 1);
    label(ctx, String(step + 1), x + 4, CT_SEQ_NUM_TOP + 22, 40, beyond ? OpbTheme.Rule : OpbTheme.Mid);
    const notes = bank ? bank.notes(pattern, track, step) : [];
    const cx = x + CT_STEP_W / 2 - 21, cy = CT_SEQ_DOT_TOP + 22;
    if (beyond) {
      ctx.fillStyle = OpbTheme.Background;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
    } else if (notes.length > 0) {
      ctx.fillStyle = OpbTheme.Ink;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = OpbTheme.Mid; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (playStep >= 0) {
    const fx = CT_STEP_X0 + playStep * CT_STEP_W;
    frame(ctx, { x: fx - 2, y: CT_SEQ_NUM_TOP - 2, w: CT_STEP_W + 2, h: CT_SEQ_BOTTOM - CT_SEQ_NUM_TOP + 4 }, OpbTheme.Yellow);
  }
  label(ctx, 'STEP COUNT', 52, CT_SEQ_BOTTOM + 40, 32, OpbTheme.Mid);
  label(ctx, String(count), 247, CT_SEQ_BOTTOM + 40, 42, OpbTheme.Ink, 'left', 'normal');
  label(ctx, 'STEP LENGTH', 398, CT_SEQ_BOTTOM + 40, 32, OpbTheme.Mid);
  label(ctx, String(length), 592, CT_SEQ_BOTTOM + 40, 42, OpbTheme.Ink, 'left', 'normal');
  label(ctx, 'SUM', 1315, CT_SEQ_BOTTOM + 40, 32, OpbTheme.Mid, 'right');
  label(ctx, String(count * length), 1350, CT_SEQ_BOTTOM + 40, 42, OpbTheme.Green, 'left', 'normal');
}

// ---------------------------------------------------------------- Stage 6 write editor

/** Top-right status chip; small enough not to collide with any screen title. */
export const WRITE_BADGE_RECT: Rect = { x: 1088, y: 8, w: 338, h: 58 };
/** Centred modal editor panel; drawn opaque so it stays readable over any screen. */
export const WRITE_PANEL_RECT: Rect = { x: 300, y: 120, w: 1000, h: 580 };

const WRITE_MAX_LIST = 6;
const WRITE_LINE_H = 24;

/** Yellow = no frames may be sent; red = armed / failed; green = verified commit. */
export function writeAccent(state: WriteUiState): string {
  if (state.phase === 'committed') return OpbTheme.Green;
  if (state.phase === 'rolled-back' || state.phase === 'aborted') return OpbTheme.Red;
  return state.dryRun ? OpbTheme.Yellow : OpbTheme.Red;
}

/** Compact always-visible chip showing the current safety state. */
export function writeStatusBadge(ctx: Ctx, state: WriteUiState): void {
  const r = WRITE_BADGE_RECT;
  const accent = writeAccent(state);
  ctx.fillStyle = OpbTheme.Ink;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = accent;
  ctx.fillRect(r.x, r.y, 8, r.h);
  label(ctx, fitText(ctx, state.kind, r.w - 32, 22, 'normal'), r.x + 22, r.y + 20, 22,
    OpbTheme.White, 'left', 'normal');
  label(ctx, state.dryRun
    ? `DRY RUN · 0 FRAMES SENT · ${state.phase.toUpperCase()}`
    : `ARMED · ${state.phase.toUpperCase()}`, r.x + 22, r.y + 42, 18, accent);
}

/**
 * Full edit-state overlay for the three Stage 6 editable screens (MIDI Setup, Configurator,
 * Step Components). Deterministic: no clock, no randomness; everything comes from `state`.
 * Read-only mode (write == null) never calls this, so stages 1-5 pixels are unchanged.
 */
export function writeEditorOverlay(
  ctx: Ctx,
  state: WriteUiState,
  options: { subtitle: string; footnote?: string },
): void {
  writeStatusBadge(ctx, state);
  const r = WRITE_PANEL_RECT;
  const accent = writeAccent(state);
  const left = r.x + 32, right = r.x + r.w - 32;
  const colW = (r.w - 96) / 2;
  const rightCol = left + colW + 32;

  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  frame(ctx, r, accent, 6);

  label(ctx, 'WRITE EDITOR · STAGE 6', left, r.y + 40, 26, OpbTheme.Mid);
  label(ctx, fitText(ctx, options.subtitle, r.w - 64, 30, 'normal'), left, r.y + 82, 30,
    OpbTheme.Ink, 'left', 'normal');
  hLine(ctx, left, right, r.y + 108, accent, 3);

  label(ctx, `EVIDENCE  ${state.evidence}`, left, r.y + 144, 24, OpbTheme.Mid);
  label(ctx, `PHASE  ${state.phase.toUpperCase()}`, left, r.y + 176, 24,
    OpbTheme.Ink, 'left', 'normal');
  label(ctx, state.dryRun
    ? 'DRY RUN — NO FRAMES HAVE BEEN SENT TO THE DEVICE'
    : 'ARMED — COMMIT STILL REQUIRES A SECOND EXPLICIT CONFIRMATION',
  left, r.y + 208, 24, accent, 'left', 'normal');

  const statY = r.y + 252;
  const statW = (r.w - 64) / 3;
  const stats: [string, string][] = [
    ['DIFF BYTES', String(state.diffCount)],
    ['FRAMES TO SEND', String(state.frameCount)],
    ['BASELINE BYTES', String(state.baselineBytes)],
  ];
  for (let i = 0; i < stats.length; i++) {
    const x = left + i * statW;
    if (i > 0) vLine(ctx, x - 16, statY - 14, statY + 52);
    label(ctx, stats[i][0], x, statY, 20, OpbTheme.Mid);
    label(ctx, stats[i][1], x, statY + 34, 34, OpbTheme.Ink, 'left', 'normal');
  }
  hLine(ctx, left, right, r.y + 310, OpbTheme.Rule, 2);

  label(ctx, 'STAGED EDITS', left, r.y + 344, 24, OpbTheme.Green);
  label(ctx, 'TRANSACTION / PLAN', rightCol, r.y + 344, 24, OpbTheme.Blue);
  vLine(ctx, rightCol - 16, r.y + 326, r.y + 540);

  const edits = state.edits.length ? state.edits : ['(none — stage a typed edit first)'];
  const details = state.details.length ? state.details : ['(no transaction yet)'];
  const listTop = r.y + 380;
  for (let i = 0; i < WRITE_MAX_LIST; i++) {
    if (edits[i]) label(ctx, fitText(ctx, edits[i], colW - 8, 20), left,
      listTop + i * WRITE_LINE_H, 20, OpbTheme.Ink);
    if (details[i]) label(ctx, fitText(ctx, details[i], colW - 8, 20), rightCol,
      listTop + i * WRITE_LINE_H, 20, OpbTheme.Ink);
  }
  const moreY = listTop + WRITE_MAX_LIST * WRITE_LINE_H;
  if (state.edits.length > WRITE_MAX_LIST) {
    label(ctx, `+${state.edits.length - WRITE_MAX_LIST} MORE`, left, moreY, 20, OpbTheme.Mid);
  }
  if (state.details.length > WRITE_MAX_LIST) {
    label(ctx, `+${state.details.length - WRITE_MAX_LIST} MORE`, rightCol, moreY, 20, OpbTheme.Mid);
  }

  hLine(ctx, left, right, r.y + 548, OpbTheme.Rule, 2);
  label(ctx, fitText(ctx, options.footnote
    ?? 'BACKUP FIRST · FRESH READBACK · FULL DIFF · EXACT ROLLBACK', r.w - 64, 20),
  left, r.y + 566, 20, OpbTheme.Mid);
}

