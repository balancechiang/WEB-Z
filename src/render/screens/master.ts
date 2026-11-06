/**
 * Master screen — OPB.App/Screens/MasterScreen.cs → Canvas 2D.
 * Chorus/drive/filter/resonance on page 1 with a filter response curve and a drive wave, the
 * live transpose keyboard, which tracks follow the master routing, and note style + playback
 * speed. Pure render port; layout coordinates match the C# original (1600 x 812 design space).
 * Knob/dial colors follow the active parameter page like the device LED.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, hatch, knob, handle, cross, stepper, button, toggle, wrapText, textWidth } from '../draw.ts';
import { percent, fromPercent, band, bandName, bandIndex, noteName, trackKind, hasSound, paramInfo, SOUND_PARAM, NOTE_LENGTHS, DRUM_NOTE_STYLES, SYNTH_NOTE_STYLES, LFO_DESTINATIONS, LFO_SHAPES, METRONOME_SOUNDS, MIC_FX } from '../displays.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';

interface R { x: number; y: number; w: number; h: number; }
interface PInfo { label: string; value: number; text: string; }

const Row0 = 82, RowB = 342, ColLabel = 216, CellW = 130, CellH = 130;
const GraphLeft = 736, RightEnd = 1426;
const NoteClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KeyWhite = [5, 7, 9, 11, 0, 2, 4];                 // F G A B C D E, like the OP-Z keyboard
const KeyBlack: [number, number][] = [[6, 0], [8, 1], [10, 2], [1, 4], [3, 5]];
const Styles = ['LATCH', 'FREE'];

export function renderMaster(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const track = 11; // Master track
  const uiPage = session.ui.page;
  const S = (p: number): number => session.currentSound[track][p] & 0xff;
  const dialBrush = (page: number, dial: number): string =>
    uiPage === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const snd = (p: number, l: string, fmt?: (v: number) => string): PInfo => paramInfo(S(p), l, fmt);

  label(ctx, 'MASTER', input.right / 2, 40, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, Row0);

  // Rules.
  hLine(ctx, input.left, RightEnd, RowB);
  vLine(ctx, ColLabel, Row0, input.bottom);
  vLine(ctx, GraphLeft, Row0, input.bottom);
  for (let i = 1; i < 4; i++) vLine(ctx, ColLabel + i * CellW, Row0, Row0 + CellH);
  hLine(ctx, ColLabel, GraphLeft, Row0 + CellH);
  vLine(ctx, 1212, RowB, input.bottom);
  hLine(ctx, 1212, RightEnd, RowB + 130);

  // Effects: chorus, drive, filter, resonance on page 1.
  section(ctx, 'EFFECTS', 0, Row0);
  cell(ctx, ColLabel, Row0, 'CHORUS', snd(SOUND_PARAM.P1, 'CHORUS'), 0, 0, dialBrush);
  cell(ctx, ColLabel + CellW, Row0, 'DRIVE', snd(SOUND_PARAM.P2, 'DRIVE'), 0, 1, dialBrush);
  cell(ctx, ColLabel + 2 * CellW, Row0, 'FILTER', snd(SOUND_PARAM.Filter, 'FILTER', filterText), 0, 2, dialBrush);
  cell(ctx, ColLabel + 3 * CellW, Row0, 'RES', snd(SOUND_PARAM.Resonance, 'RES'), 0, 3, dialBrush);
  label(ctx, 'LP', ColLabel + 2 * CellW + 14, Row0 + 82, 20, OpbTheme.Mid);
  label(ctx, 'HP', ColLabel + 3 * CellW - 14, Row0 + 82, 20, OpbTheme.Mid, 'right');
  drawFilterCurve(ctx, { x: GraphLeft + 40, y: Row0 + 50, w: RightEnd - GraphLeft - 80, h: RowB - Row0 - 100 }, S, dialBrush);
  drawDrive(ctx, { x: ColLabel + 20, y: Row0 + CellH + 10, w: 4 * CellW - 40, h: RowB - Row0 - CellH - 20 }, S, dialBrush);

  // Transposition: the master notes playing now.
  section(ctx, 'TRANSPOSE', 0, RowB);
  const active = activeNotes(session, input);
  const keyText = active.length === 0 ? '—' : active.map((n) => NoteClasses[((n % 12) + 12) % 12]).filter((v, i, a) => a.indexOf(v) === i).join(' ');
  label(ctx, keyText, 108, RowB + 150, 64, OpbTheme.Ink, 'center', 'normal');
  label(ctx, active.length === 0 ? 'NO NOTE' : 'KEY', 108, RowB + 215, 24, OpbTheme.Mid, 'center');
  const lit = new Set<number>(active.map((n) => ((n % 12) + 12) % 12));
  drawKeyboard(ctx, { x: 236, y: RowB + 30, w: 480, h: 200 }, lit);

  // Which tracks follow the transposition (master routing mask).
  section(ctx, 'TRACKS', GraphLeft, RowB);
  const mask = session.bank ? session.bank.masterRouting(session.activePattern) : 0;
  for (let t = 0; t < 8; t++) {
    const r: R = { x: GraphLeft + 18 + (t % 4) * 114, y: RowB + 80 + Math.floor(t / 4) * 84, w: 104, h: 70 };
    const on = (mask & (1 << t)) !== 0;
    if (on) { ctx.fillStyle = OpbTheme.Ink; ctx.fillRect(r.x, r.y, r.w, r.h); }
    frame(ctx, r, on ? OpbTheme.Ink : OpbTheme.Mid, 2);
    label(ctx, TRACK_NAMES[t], r.x + r.w / 2, r.y + r.h / 2, 24, on ? OpbTheme.White : OpbTheme.Mid, 'center', 'normal');
  }

  // Note style and playback speed (the master's step length).
  const style = snd(SOUND_PARAM.NoteStyle, 'NOTE STYLE', (v) => band(v, Styles));
  label(ctx, 'NOTE STYLE', 1230, RowB + 42, 28, OpbTheme.Mid);
  label(ctx, style.text, 1319, RowB + 92, 40, OpbTheme.Ink, 'center', 'normal');
  const length = session.bank ? session.bank.stepLength(session.activePattern, track) : 1;
  label(ctx, 'SPEED', 1230, RowB + 172, 28, OpbTheme.Mid);
  label(ctx, `x${length}`, 1319, RowB + 222, 40, OpbTheme.Ink, 'center', 'normal');
}

/** A parameter cell: caption above, knob in the middle, value below. */
function cell(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, param: PInfo, _page: number, dial: number, dialBrush: (p: number, d: number) => string): void {
  const rect: R = { x, y, w: CellW, h: CellH };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, 'left');
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush(0, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
}

function section(ctx: CanvasRenderingContext2D, title: string, x: number, y: number): void {
  label(ctx, title, x + 20, y + 42, 30, OpbTheme.Mid, 'left');
}

function filterText(v: number): string {
  const c = Math.round((v - 128) / 128 * 50);
  return c === 0 ? 'OFF' : c < 0 ? `LP ${-c}` : `HP ${c}`;
}

/** Master notes sounding at the current step: the latest step at or before the playhead with notes. */
function activeNotes(session: OpzSession, input: ScreenInput): number[] {
  const bank = session.bank;
  if (!bank) return [];
  const p = session.activePattern;
  const count = bank.stepCount(p, 11);
  const length = bank.stepLength(p, 11);
  let step = 0;
  if (input.playing) {
    let sixteenths: number;
    if (session.clockTicks > 0) sixteenths = session.clockTicks / 6;
    else {
      const bpm = session.global ? session.global.tempo : 120;
      sixteenths = (input.playMs / 1000 / 60) * bpm * 4;
    }
    step = Math.floor(sixteenths / Math.max(1, length) % Math.max(1, count));
  }
  for (let back = 0; back < count; back++) {
    const s = (((step - back) % count) + count) % count;
    const notes = bank.notes(p, 11, s);
    if (notes.length > 0) return notes.map((n) => n.pitch);
  }
  return [];
}

function drawFilterCurve(ctx: CanvasRenderingContext2D, r: R, S: (p: number) => number, dialBrush: (p: number, d: number) => string): void {
  const f = S(SOUND_PARAM.Filter), q = S(SOUND_PARAM.Resonance) / 255;
  const lowPass = f < 128;
  const amount = Math.abs(f - 128) / 128;
  const cutoff = lowPass ? 4.3 - amount * 2.8 : 1.3 + amount * 2.8;
  // Dashed center (0 dB) line.
  ctx.save();
  ctx.strokeStyle = OpbTheme.Rule;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + r.h * 0.45);
  ctx.lineTo(r.x + r.w, r.y + r.h * 0.45);
  ctx.stroke();
  ctx.restore();
  // Response curve.
  ctx.strokeStyle = dialBrush(0, 2);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const lf = 1.3 + 3.0 * i / 120;
    const d = (lf - cutoff) * 3;
    let gain = amount < 0.02 ? 0 : lowPass ? -Math.max(0, d) * 12 : -Math.max(0, -d) * 12;
    gain += amount < 0.02 ? 0 : q * 9 * Math.exp(-d * d * 4);
    let y = r.y + r.h * 0.45 - (gain / 36) * r.h;
    y = Math.max(r.y, Math.min(r.y + r.h, y));
    const x = r.x + r.w * i / 120;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const ticks = ['20', '200', '2K', '20K'];
  for (let i = 0; i < 4; i++) {
    label(ctx, ticks[i], r.x + r.w * i / 3, r.y + r.h + 22, 22, OpbTheme.Mid, i === 0 ? 'left' : i === 3 ? 'right' : 'center');
  }
  label(ctx, amount < 0.02 ? 'FILTER OFF' : lowPass ? 'LOW PASS' : 'HIGH PASS', r.x + r.w, r.y - 20, 24, OpbTheme.Mid, 'right');
}

function drawDrive(ctx: CanvasRenderingContext2D, r: R, S: (p: number) => number, dialBrush: (p: number, d: number) => string): void {
  const drive = S(SOUND_PARAM.P2) / 255, chorus = S(SOUND_PARAM.P1) / 255;
  const wave = (phase: number, clip: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 4 + phase;
      const v = Math.tanh(Math.sin(t) * (1 + clip * 6)) / Math.tanh(1 + clip * 6);
      pts.push([r.x + r.w * i / 80, r.y + r.h / 2 - v * r.h * 0.4]);
    }
    return pts;
  };
  const strokeWave = (pts: [number, number][], brush: string): void => {
    ctx.strokeStyle = brush;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.stroke();
  };
  if (chorus > 0.02) strokeWave(wave(chorus * 1.2, drive), dialBrush(0, 0));
  strokeWave(wave(0, drive), dialBrush(0, 1));
}

function drawKeyboard(ctx: CanvasRenderingContext2D, r: R, lit: Set<number>): void {
  const w = r.w / 7, bw = w * 0.62, bh = r.h * 0.58;
  for (let i = 0; i < 7; i++) {
    const k: R = { x: r.x + i * w, y: r.y, w, h: r.h };
    const on = lit.has(KeyWhite[i]);
    ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Background;
    ctx.fillRect(k.x, k.y, k.w, k.h);
    frame(ctx, k, OpbTheme.Rule, 2);
    label(ctx, NoteClasses[KeyWhite[i]], k.x + w / 2, k.y + k.h - 22, 22, OpbTheme.Mid, 'center');
  }
  for (const [note, after] of KeyBlack) {
    const on = lit.has(note);
    ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Ink;
    ctx.fillRect(r.x + (after + 1) * w - bw / 2, r.y, bw, bh);
  }
}
