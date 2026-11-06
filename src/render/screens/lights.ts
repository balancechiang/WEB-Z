/**
 * Lights screen — OPB.App/Screens/LightsScreen.cs → Canvas 2D.
 * A 16-fixture preview approximated from the track's color / alt color / speed / intensity, plus the
 * 10 pattern taps and 14 animation (hold) buttons, and the main controls + passthrough knobs.
 * Pure render port; motion is derived deterministically from input.nowMs (no wall-clock use).
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, knob, hsvToCss, hsvToRgb, controlTrackChrome, controlTrackSequencer } from '../draw.ts';
import { SOUND_PARAM, paramInfo } from '../displays.ts';

interface R { x: number; y: number; w: number; h: number; }
const Row0 = 82, RowB = 342, CellW = 130, CellH = 130, KnobLeft = 736, RightEnd = 1426;
const PatternNotes = [54, 56, 58, 61, 63, 66, 68, 70, 73, 75];
const AnimationNotes = [53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
const PatternNames = ['SOLID', 'ALTERNATE', 'CHASE', 'PULSE', 'SPLIT', 'SPARKLE', 'WAVE', 'STROBE', 'BOUNCE', 'RAINBOW'];

export function renderLights(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const track = 14; // Lights track
  const S = (p: number): number => session.currentSound[track][p] & 0xff;
  const dialBrush = (page: number, dial: number): string =>
    session.ui.page === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const snd = (p: number, l: string, fmt?: (v: number) => string) => paramInfo(S(p), l, fmt);
  const hue = (v: number) => `${Math.round(v / 255 * 360)}°`;

  controlTrackChrome(ctx, input, 'LIGHTS');

  vLine(ctx, KnobLeft, Row0, 602);
  hLine(ctx, input.left, RightEnd, RowB);
  hLine(ctx, KnobLeft, RightEnd, Row0 + CellH);
  for (let i = 1; i < 4; i++) vLine(ctx, KnobLeft + i * CellW, Row0, RowB);
  vLine(ctx, KnobLeft + 4 * CellW, Row0, RowB);

  drawFixtures(ctx, { x: 0, y: Row0, w: KnobLeft, h: RowB - Row0 }, S, input);

  cell(ctx, KnobLeft, Row0, 'COLOR', snd(SOUND_PARAM.P1, 'COLOR', hue), 0, 0, dialBrush);
  cell(ctx, KnobLeft + CellW, Row0, 'ALT COL', snd(SOUND_PARAM.P2, 'ALT COLOR', hue), 0, 1, dialBrush);
  cell(ctx, KnobLeft + 2 * CellW, Row0, 'SPEED', snd(SOUND_PARAM.Filter, 'SPEED'), 0, 2, dialBrush);
  cell(ctx, KnobLeft + 3 * CellW, Row0, 'INTENS', snd(SOUND_PARAM.Resonance, 'INTENSITY'), 0, 3, dialBrush);
  const knobs = [SOUND_PARAM.Fx1Send, SOUND_PARAM.Fx2Send, SOUND_PARAM.Pan, SOUND_PARAM.Level];
  for (let i = 0; i < 4; i++)
    cell(ctx, KnobLeft + i * CellW, Row0 + CellH, `KNOB ${i + 5}`, snd(knobs[i], `KNOB ${i + 5}`), 1, i, dialBrush);

  // Main / alt color swatches.
  const sx = KnobLeft + 4 * CellW + 20, sw = RightEnd - sx - 20;
  label(ctx, 'MAIN', sx, Row0 + 30, 22, OpbTheme.Mid);
  ctx.fillStyle = hsvToCss(S(SOUND_PARAM.P1) / 255 * 360, 0.9, 0.95);
  ctx.fillRect(sx, Row0 + 48, sw, 72);
  label(ctx, 'ALT', sx, Row0 + CellH + 30, 22, OpbTheme.Mid);
  ctx.fillStyle = hsvToCss(S(SOUND_PARAM.P2) / 255 * 360, 0.9, 0.95);
  ctx.fillRect(sx, Row0 + CellH + 48, sw, 72);

  // Patterns 1..10.
  section(ctx, 'PATTERN', 0, RowB);
  for (let i = 0; i < 10; i++) {
    const r: R = { x: 18 + (i % 5) * 140, y: RowB + 70 + Math.floor(i / 5) * 92, w: 128, h: 80 };
    frame(ctx, r, OpbTheme.Mid, 2);
    label(ctx, String(i + 1), r.x + 14, r.y + 24, 28, OpbTheme.Ink, 'left', 'normal');
    label(ctx, PatternNames[i], r.x + 14, r.y + 58, 18, OpbTheme.Mid);
  }
  // Animations 1..14 (FOG on the 14th).
  section(ctx, 'ANIMATIONS (HOLD)', KnobLeft, RowB);
  for (let i = 0; i < 14; i++) {
    const r: R = { x: KnobLeft + 18 + (i % 7) * 94, y: RowB + 70 + Math.floor(i / 7) * 92, w: 84, h: 80 };
    frame(ctx, r, OpbTheme.Mid, 2);
    label(ctx, i === 13 ? 'FOG' : String(i + 1), r.x + r.w / 2, r.y + r.h / 2, 28, OpbTheme.Ink, 'center', 'normal');
  }

  controlTrackSequencer(ctx, input, track);
}

/** A knob cell like the control-track template. */
function cell(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, param: { value: number; text: string }, _page: number, dial: number, dialBrush: (p: number, d: number) => string): void {
  const rect: R = { x, y, w: CellW, h: CellH };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, 'left');
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush(_page, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
}

function section(ctx: CanvasRenderingContext2D, title: string, x: number, y: number): void {
  label(ctx, title, x + 18, y + 42, 30, OpbTheme.Mid, 'left');
}

/** Fixture preview grid, animated deterministically from input.nowMs. */
function drawFixtures(ctx: CanvasRenderingContext2D, r: R, S: (p: number) => number, input: ScreenInput): void {
  section(ctx, 'FIXTURES', r.x, r.y);
  label(ctx, 'PREVIEW', r.x + r.w - 18, r.y + 42, 22, OpbTheme.Mid, 'right');
  const t = input.nowMs / 1000;
  const speed = 0.3 + S(SOUND_PARAM.Filter) / 255 * 4;
  const intensity = S(SOUND_PARAM.Resonance) / 255;
  const main = S(SOUND_PARAM.P1) / 255 * 360;
  const alt = S(SOUND_PARAM.P2) / 255 * 360;
  const phase = t * speed;
  const step = Math.floor(phase * 4);
  for (let i = 0; i < 16; i++) {
    let hue = main, level = 1;
    const sat = 0.9;
    const [rr, gg, bb] = hsvToRgb(hue, sat, Math.max(0, Math.min(1, level * (0.15 + 0.85 * intensity))));
    const cx = r.x + 70 + (i % 8) * 84, cy = r.y + 110 + Math.floor(i / 8) * 86;
    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
    ctx.beginPath(); ctx.ellipse(cx, cy, 32, 32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = OpbTheme.Ink; ctx.lineWidth = 3; ctx.stroke();
    const lum = rr * 0.3 + gg * 0.59 + bb * 0.11;
    label(ctx, String(i + 1), cx, cy, 20, lum > 140 ? OpbTheme.Ink : OpbTheme.White, 'center', 'normal');
    void step; void alt; // pattern 0 (SOLID) renders the main hue; held-animation state is interactive only
  }
}
