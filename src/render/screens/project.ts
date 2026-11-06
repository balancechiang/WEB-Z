/**
 * Project screen — OPB.App/Screens/ProjectScreen.cs → Canvas 2D.
 * The 16 patterns of the active project, the active chain with its playing position, and the
 * 15 saved chains. Layout coordinates match the C# original (1600 x 812 design space).
 * Interaction (pattern/chain building, tap-to-recall) lives in the canvas view; this renders.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, hatch, knob, handle, cross, stepper, button, toggle, wrapText, textWidth } from '../draw.ts';
import { percent, fromPercent, band, bandName, bandIndex, noteName, trackKind, hasSound, paramInfo, SOUND_PARAM, NOTE_LENGTHS, DRUM_NOTE_STYLES, SYNTH_NOTE_STYLES, LFO_DESTINATIONS, LFO_SHAPES, METRONOME_SOUNDS, MIC_FX } from '../displays.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';

const TitleY = 40, Row0 = 82, Row1 = 212, Row2 = 342, Row3 = 472, ColLabel = 216, ColW = 130;
const GridEnd = ColLabel + 8 * ColW;
const PATTERN_COUNT = 16;

function patternRect(p: number): { x: number; y: number; w: number; h: number } {
  return { x: ColLabel + (p % 8) * ColW, y: Row0 + Math.floor(p / 8) * (Row1 - Row0), w: ColW, h: Row1 - Row0 };
}

export function renderProject(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;

  label(ctx, `PROJECT ${session.chain.project + 1}`, input.right / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');

  hLine(ctx, input.left, input.right, Row0);
  hLine(ctx, ColLabel, GridEnd, Row1);
  hLine(ctx, input.left, input.right, Row2);
  hLine(ctx, input.left, input.right, Row3);
  vLine(ctx, ColLabel, Row0, input.bottom);
  vLine(ctx, GridEnd, Row0, input.bottom);
  for (let i = 1; i < 8; i++) vLine(ctx, ColLabel + i * ColW, Row0, Row2);

  drawPatterns(ctx, input, session);
  drawChain(ctx, input, session);
  drawSavedChains(ctx, input, session);
  drawStatus(ctx, input, session);
}

function drawPatterns(ctx: CanvasRenderingContext2D, input: ScreenInput, session: OpzSession): void {
  label(ctx, 'PATTERNS', 20, Row0 + 42, 30, OpbTheme.Mid, 'left');
  const bank = session.bank;
  const inChain = session.chain.chain;
  for (let p = 0; p < PATTERN_COUNT; p++) {
    const r = patternRect(p);
    label(ctx, (p + 1).toString(), r.x + 10, r.y + 26, 40, OpbTheme.Mid, 'left');
    const filled = bank !== null && !bank.isEmpty(p);
    ctx.fillStyle = filled ? OpbTheme.Ink : OpbTheme.Rule;
    ctx.beginPath();
    ctx.ellipse(r.x + ColW / 2, r.y + 84, 11, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    if (inChain.length > 1 && inChain.includes(p)) {
      ctx.fillStyle = OpbTheme.Green;
      ctx.beginPath();
      ctx.ellipse(r.x + r.w - 18, r.y + 22, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  frame(ctx, patternRect(session.activePattern), OpbTheme.Yellow);
}

function drawChain(ctx: CanvasRenderingContext2D, input: ScreenInput, session: OpzSession): void {
  label(ctx, 'CHAIN', 20, Row2 + 42, 30, OpbTheme.Mid, 'left');
  const chain = session.chain.chain;
  if (chain.length === 0) {
    label(ctx, '-', ColLabel + 20, Row2 + 65, 32, OpbTheme.Mid, 'left');
    return;
  }
  const w = Math.min(ColW / 2, (GridEnd - ColLabel) / chain.length);
  const top = Row2 + 18, h = 64;
  for (let i = 0; i < chain.length; i++) {
    const x = ColLabel + i * w;
    if (i > 0) vLine(ctx, x, top + 8, top + h - 8, i % 4 === 0 ? OpbTheme.Ink : OpbTheme.Rule, i % 4 === 0 ? 2 : 1);
    label(ctx, (chain[i] + 1).toString(), x + w / 2, top + h / 2, w < 40 ? 24 : 32, OpbTheme.Ink, 'center', 'normal');
  }
  const pos = session.chain.position - 1;
  if (pos >= 0 && pos < chain.length) frame(ctx, { x: ColLabel + pos * w, y: top, w, h }, OpbTheme.Yellow);
  const caption = `${Math.max(1, session.chain.position)} / ${chain.length}`;
  label(ctx, caption, ColLabel + 14, Row3 - 26, 24, OpbTheme.Mid, 'left');
}

function drawSavedChains(ctx: CanvasRenderingContext2D, input: ScreenInput, session: OpzSession): void {
  label(ctx, 'SAVED', 20, Row3 + 42, 30, OpbTheme.Mid, 'left');
  label(ctx, 'CHAINS', 20, Row3 + 78, 30, OpbTheme.Mid, 'left');
  const global = session.global;
  const w = (GridEnd - ColLabel) / 5, h = (input.bottom - Row3) / 3;
  for (let i = 1; i < 5; i++) vLine(ctx, ColLabel + i * w, Row3, input.bottom);
  for (let i = 1; i < 3; i++) hLine(ctx, ColLabel, GridEnd, Row3 + i * h);
  for (let slot = 0; slot < 15; slot++) {
    const r = { x: ColLabel + (slot % 5) * w, y: Row3 + Math.floor(slot / 5) * h, w, h };
    const chain = global ? global.chain(slot) : [];
    label(ctx, (slot + 1).toString(), r.x + 12, r.y + 26, 30, OpbTheme.Mid, 'left');
    if (chain.length === 0) {
      label(ctx, 'EMPTY', r.x + 12, r.y + 72, 26, OpbTheme.Rule, 'left');
    } else {
      label(ctx, chain.length.toString(), r.x + r.w - 12, r.y + 26, 24, OpbTheme.Mid, 'right');
      const text = chain.map((x) => (x + 1).toString()).join(' ');
      label(ctx, fit(ctx, text, r.w - 24, 26), r.x + 12, r.y + 72, 26, OpbTheme.Ink, 'left', 'normal');
    }
    if (global && global.selectedChain === slot) frame(ctx, r, OpbTheme.Yellow);
  }
}

function drawStatus(ctx: CanvasRenderingContext2D, input: ScreenInput, session: OpzSession): void {
  const ps = session.patternState;
  const clipboard = ps.projectCopied ? 'PROJECT' : ps.patternCopied ? 'PATTERN' : '-';
  const items: { label: string; value: string; brush: string }[] = [
    { label: 'PATTERN', value: (session.activePattern + 1).toString(), brush: OpbTheme.Ink },
    { label: 'SAVE', value: ps.autosave ? 'AUTO' : 'MANUAL', brush: ps.autosave ? OpbTheme.Green : OpbTheme.Ink },
    { label: 'CHAIN MODE', value: ps.chainMode ? 'ON' : 'OFF', brush: ps.chainMode ? OpbTheme.Green : OpbTheme.Ink },
    { label: 'COPIED', value: clipboard, brush: OpbTheme.Ink },
  ];
  const rows = [Row0, Row1, Row2, Row3];
  const cx = (GridEnd + input.right) / 2;
  hLine(ctx, GridEnd, input.right, Row1);
  for (let i = 0; i < items.length; i++) {
    label(ctx, items[i].label, GridEnd + 18, rows[i] + 42, 30, OpbTheme.Mid, 'left');
    label(ctx, items[i].value, cx, rows[i] + 90, 42, items[i].brush, 'center', 'normal');
  }
}

/** Greedy ellipsis fit to a width, mirroring C#'s Draw.Fit. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, size: number): string {
  if (textWidth(ctx, text, size, 'normal') <= width) return text;
  let t = text;
  while (t.length > 1 && textWidth(ctx, t + '…', size, 'normal') > width) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
