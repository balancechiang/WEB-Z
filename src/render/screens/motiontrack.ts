/**
 * Motion Track screen — OPB.App/Screens/MotionTrackScreen.cs → Canvas 2D.
 * The color dials (page 1) and transition dials (page 2) with a live color preview, the keyboard
 * map of what each note triggers (slots 1..24), and shortcuts to the Photomatic and Motion pages.
 * Pure render port; layout matches the C# original (1600 x 812 design space).
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, knob, hsvToRgb, controlTrackChrome, controlTrackSequencer } from '../draw.ts';
import { SOUND_PARAM, paramInfo } from '../displays.ts';

interface R { x: number; y: number; w: number; h: number; }
const Row0 = 82, RowB = 342, CellW = 130, CellH = 130, PreviewLeft = 736, KeysRight = 1110, RightEnd = 1426;

export function renderMotionTrack(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const track = 15; // Motion track
  const S = (p: number): number => session.currentSound[track][p] & 0xff;
  const dialBrush = (page: number, dial: number): string =>
    session.ui.page === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const snd = (p: number, l: string, fmt?: (v: number) => string) => paramInfo(S(p), l, fmt);
  const signed = (v: number): string => {
    const c = Math.round((v - 128) / 128 * 50);
    return c > 0 ? `+${c}` : String(c);
  };

  controlTrackChrome(ctx, input, 'MOTION TRACK');

  vLine(ctx, 216, Row0, RowB);
  vLine(ctx, PreviewLeft, Row0, RowB);
  hLine(ctx, input.left, RightEnd, RowB);
  hLine(ctx, input.left, PreviewLeft, Row0 + CellH);
  for (let i = 1; i < 4; i++) vLine(ctx, 216 + i * CellW, Row0, RowB);
  vLine(ctx, KeysRight, RowB, 602);

  section(ctx, 'COLOR', 0, Row0);
  cell(ctx, 216, Row0, 'HUE', snd(SOUND_PARAM.P1, 'HUE', signed), 0, 0, dialBrush);
  cell(ctx, 216 + CellW, Row0, 'SAT', snd(SOUND_PARAM.P2, 'SATURATION', signed), 0, 1, dialBrush);
  cell(ctx, 216 + 2 * CellW, Row0, 'BRIGHT', snd(SOUND_PARAM.Filter, 'BRIGHTNESS', signed), 0, 2, dialBrush);
  cell(ctx, 216 + 3 * CellW, Row0, 'CONTR', snd(SOUND_PARAM.Resonance, 'CONTRAST', signed), 0, 3, dialBrush);
  section(ctx, 'SHIFT', 0, Row0 + CellH);
  cell(ctx, 216, Row0 + CellH, 'XFADE', snd(SOUND_PARAM.Attack, 'CROSSFADE'), 1, 0, dialBrush);
  cell(ctx, 216 + CellW, Row0 + CellH, 'ZOOM', snd(SOUND_PARAM.Decay, 'ZOOM'), 1, 1, dialBrush);
  cell(ctx, 216 + 2 * CellW, Row0 + CellH, 'DOUBLE', snd(SOUND_PARAM.Sustain, 'DOUBLE'), 1, 2, dialBrush);
  cell(ctx, 216 + 3 * CellW, Row0 + CellH, 'WOOZY', snd(SOUND_PARAM.Release, 'WOOZY'), 1, 3, dialBrush);

  drawPreview(ctx, { x: PreviewLeft + 30, y: Row0 + 54, w: RightEnd - PreviewLeft - 60, h: RowB - Row0 - 84 }, S);
  drawKeys(ctx, { x: 18, y: RowB + 60, w: KeysRight - 36, h: 602 - RowB - 80 }, S);

  section(ctx, 'OPEN', KeysRight, RowB);
  const pages: [string][] = [['PHOTOMATIC'], ['MOTION']];
  for (let i = 0; i < pages.length; i++) {
    const r: R = { x: KeysRight + 18, y: RowB + 70 + i * 92, w: RightEnd - KeysRight - 36, h: 78 };
    ctx.fillStyle = OpbTheme.Ink; ctx.fillRect(r.x, r.y, r.w, r.h);
    label(ctx, pages[i][0], r.x + r.w / 2, r.y + r.h / 2, 28, OpbTheme.White, 'center', 'normal');
  }

  controlTrackSequencer(ctx, input, track);
}

function cell(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, param: { value: number; text: string }, _page: number, dial: number, dialBrush: (p: number, d: number) => string): void {
  const rect: R = { x, y, w: CellW, h: CellH };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, 'left');
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush(_page, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
}

function section(ctx: CanvasRenderingContext2D, title: string, x: number, y: number): void {
  label(ctx, title, x + 18, y + 42, 30, OpbTheme.Mid, 'left');
}

/** Hue bars and a grey ramp run through the current hue/saturation/brightness/contrast settings. */
function drawPreview(ctx: CanvasRenderingContext2D, r: R, S: (p: number) => number): void {
  label(ctx, 'PREVIEW', r.x - 12, Row0 + 30, 22, OpbTheme.Mid);
  const hueShift = (S(SOUND_PARAM.P1) - 128) / 128 * 180, sat = S(SOUND_PARAM.P2) / 128;
  const bright = (S(SOUND_PARAM.Filter) - 128) / 128, contrast = S(SOUND_PARAM.Resonance) / 128;
  const apply = (hue: number, s: number, v: number): string => {
    const [cr, cg, cb] = hsvToRgb(hue + hueShift, Math.max(0, Math.min(1, s * sat)), 1);
    const ch = (x: number): number => Math.max(0, Math.min(1, ((x / 255 * v) - 0.5) * contrast + 0.5 + bright * 0.5));
    return `rgb(${Math.round(ch(cr) * 255)},${Math.round(ch(cg) * 255)},${Math.round(ch(cb) * 255)})`;
  };
  const bars = 12, bw = r.w / bars, top = r.h * 0.62;
  for (let i = 0; i < bars; i++) {
    ctx.fillStyle = apply(i * 30, 0.85, 0.95);
    ctx.fillRect(r.x + i * bw, r.y, bw + 0.5, top);
    ctx.fillStyle = apply(0, 0, i / (bars - 1));
    ctx.fillRect(r.x + i * bw, r.y + top, bw + 0.5, r.h - top);
  }
  frame(ctx, r, OpbTheme.Ink, 2);
}

/** The OP-Z keyboard's two octaves: 24 slot keys (interaction/lit-state lives in the canvas view). */
function drawKeys(ctx: CanvasRenderingContext2D, r: R, _S: (p: number) => number): void {
  section(ctx, 'KEYS → PHOTOMATIC SLOTS', 0, RowB);
  const white = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23];
  const black = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22];
  const w = r.w / 14, bw = w * 0.62, bh = r.h * 0.58;
  for (let i = 0; i < white.length; i++) {
    const k: R = { x: r.x + i * w, y: r.y, w, h: r.h };
    frame(ctx, k, OpbTheme.Rule, 2);
    label(ctx, String(white[i] + 1), k.x + w / 2, k.y + k.h - 22, 22, OpbTheme.Mid, 'center');
  }
  for (const key of black) {
    let after = 0;
    for (let j = 0; j < white.length; j++) if (white[j] < key) after = j;
    const k: R = { x: r.x + (after + 1) * w - bw / 2, y: r.y, w: bw, h: bh };
    ctx.fillStyle = OpbTheme.Ink; ctx.fillRect(k.x, k.y, k.w, k.h);
    label(ctx, String(key + 1), k.x + bw / 2, k.y + bh - 20, 18, OpbTheme.Mid, 'center');
  }
}
