/**
 * Track screen — OPB.App/Screens/TrackScreen.cs → Canvas 2D.
 * The main screen for a track: sound, envelope, LFO, sends, pan, level, track settings,
 * the 16-step sequencer and the touch pad. Layout coordinates are identical to the C# original
 * (1600 x 812 design space). Interaction (selection, touch pad, step toggling) lives in the
 * canvas view; this module only renders.
 */
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import {
  label, hLine, vLine, hatch, frame, knob, handle, cross, type Rect,
} from '../draw.ts';
import {
  paramInfo, trackKind, type TrackKindName, type ParamInfo,
} from '../displays.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';
import type { ScreenInput } from './index.ts';

const SOUND_PARAMS = [0, 1, 9, 10]; // P1, P2, Filter, Resonance
const ENVELOPE_PARAMS = [2, 3, 4, 5]; // Attack, Decay, Sustain, Release

// Layout (design units).
const TitleY = 40, Row0 = 82, Row1 = 212, Row2 = 342, EnvLabels = 428, Row3 = 472, Row4 = 602;
const ColLabel = 216, ColW = 130, FxLeft = 736, FxRight = 952, FxEnd = 1212, RightEnd = 1426;
const SeqLabelY = 622, SeqNumTop = 645, SeqDotTop = 688, SeqBottom = 732, StepX0 = 42, StepW = 86.5;

function dialBrush(page: number, dial: number, uiPage: number): string {
  return uiPage === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
}

function pageOneLabels(kind: TrackKindName): string[] {
  switch (kind) {
    case 'Master': return ['CHORUS', 'DRIVE', 'FILTER', 'RES'];
    case 'Lights': return ['COLOR', 'ALT COL', 'SPEED', 'INTENS'];
    case 'Motion': return ['HUE', 'SAT', 'BRIGHT', 'CONTR'];
    case 'Tape': return ['SPEED', 'FINE', 'FILTER', 'RES'];
    default: return ['P1', 'P2', 'FILTER', 'RES'];
  }
}

function formatBipolar(v: number): string {
  const c = Math.round(((v & 0xff) - 128) / 128 * 50);
  return c === 0 ? '0' : c < 0 ? `LP ${-c}` : `HP ${c}`;
}

function hsv(h: number, s: number, v: number): string {
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
  const to = (n: number) => Math.round((n + m) * 255);
  return `rgb(${to(r)},${to(g)},${to(b)})`;
}

export function renderTrack(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const track = session.play.track;
  const kind = trackKind(track);
  const uiPage = session.messageCounts.has(0x06) ? session.ui.page : -1;
  const S = (p: number) => session.currentSound[track][p] & 0xff;
  const snd = (p: number, labelText: string, fmt?: (v: number) => string): ParamInfo =>
    paramInfo(S(p), labelText, fmt);

  label(ctx, TRACK_NAMES[session.play.track] ?? 'TRACK', RightEnd / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  label(ctx, 'TOUCH PAD', RightEnd + 14, TitleY, 30, OpbTheme.Mid, 'left');

  // Grid rules.
  hLine(ctx, input.left, input.right, Row0);
  vLine(ctx, RightEnd, input.top, input.bottom);
  hLine(ctx, input.left, RightEnd, Row1);
  hLine(ctx, input.left, ColLabel, Row3);
  hLine(ctx, input.left, FxLeft, EnvLabels);
  hLine(ctx, input.left, FxLeft, Row3);
  hLine(ctx, input.left, input.right, Row4);
  hLine(ctx, FxEnd, RightEnd, Row2);
  hLine(ctx, FxEnd, RightEnd, Row3);
  vLine(ctx, ColLabel, Row0, Row4);
  for (let i = 1; i < 4; i++) {
    vLine(ctx, ColLabel + i * ColW, Row0, Row1);
    vLine(ctx, ColLabel + i * ColW, EnvLabels, Row4);
  }
  vLine(ctx, FxLeft, Row0, Row4);
  vLine(ctx, FxRight, Row0, Row4);
  vLine(ctx, FxRight + ColW, Row0, Row1);
  vLine(ctx, FxEnd, Row0, Row4);

  hatch(ctx, { x: RightEnd, y: Row0, w: input.right - RightEnd, h: SeqBottom - 2 - Row0 }, OpbTheme.Rule, OpbTheme.Background);

  drawSoundRow(ctx, input, track, kind, S, snd);
  drawEnvelope(ctx, input, kind, S, dialBrush);
  drawLfoRow(ctx, input, track, kind, S, snd, dialBrush);
  drawSends(ctx, input, kind, S, snd, dialBrush);
  drawTrackSettings(ctx, input, kind, session, track, snd);
  drawSequencer(ctx, input, session, track);

  // Active page frame, then the selected parameter on top.
  const pageRect: Rect = uiPage === 0 ? { x: ColLabel, y: Row0, w: 4 * ColW, h: Row1 - Row0 }
    : uiPage === 1 ? { x: ColLabel, y: Row1, w: 4 * ColW, h: Row3 - Row1 }
    : uiPage === 2 ? { x: ColLabel, y: Row3, w: 4 * ColW, h: Row4 - Row3 }
    : { x: FxLeft, y: Row0, w: FxEnd - FxLeft, h: Row4 - Row0 };
  if (uiPage >= 0) frame(ctx, pageRect, OpbTheme.Pages[uiPage]);
  if (input.selected && input.selected.track === track) {
    const sp = input.selected.param;
    // Highlight the matching knob cell on the active page.
    if (uiPage === 0 && SOUND_PARAMS.includes(sp)) {
      const i = SOUND_PARAMS.indexOf(sp);
      frame(ctx, { x: ColLabel + i * ColW, y: Row0, w: ColW, h: Row1 - Row0 }, OpbTheme.Red);
    } else if (uiPage === 2 && (sp === 13 || sp === 14 || sp === 15 || sp === 16)) {
      const i = [13, 14, 15, 16].indexOf(sp);
      frame(ctx, { x: ColLabel + i * ColW, y: Row3, w: ColW, h: Row4 - Row3 }, OpbTheme.Red);
    } else if (uiPage === 3 && (sp === 7 || sp === 8)) {
      const i = sp === 7 ? 0 : 1;
      frame(ctx, { x: FxRight + i * ColW, y: Row0, w: ColW, h: Row1 - Row0 }, OpbTheme.Red);
    }
  }
}

function drawSoundRow(
  ctx: CanvasRenderingContext2D, input: ScreenInput, track: number, kind: TrackKindName,
  S: (p: number) => number, snd: (p: number, l: string, fmt?: (v: number) => string) => ParamInfo,
): void {
  label(ctx, kind === 'Fx' ? 'EFFECT' : 'SOUND', 20, Row0 + 42, 30, OpbTheme.Mid, 'left');
  const name = plugName(input.session, track);
  label(ctx, fit(ctx, name, 190, 32), 20, Row0 + 85, 32, OpbTheme.Ink, 'left', 'normal');
  const labels = pageOneLabels(kind);
  for (let i = 0; i < 4; i++) {
    const p = SOUND_PARAMS[i];
    const fmt = kind === 'Master' && p === 9 ? formatBipolar : undefined;
    paramCell(ctx, ColLabel + i * ColW, Row0, labels[i], snd(p, labels[i], fmt), 0, i);
  }
  if (kind === 'Lights') {
    for (let i = 0; i < 2; i++) {
      const hue = S(i === 0 ? 0 : 1) / 255 * 360;
      ctx.fillStyle = hsv(hue, 0.85, 0.9);
      ctx.fillRect(ColLabel + i * ColW + 92, Row0 + 10, 28, 20);
    }
  }
}

function drawEnvelope(
  ctx: CanvasRenderingContext2D, input: ScreenInput, kind: TrackKindName,
  S: (p: number) => number, dialBrush: (page: number, dial: number, uiPage: number) => string,
): void {
  const hasEnvelope = kind === 'Drum' || kind === 'Synth' || kind === 'Module';
  label(ctx, 'ENVELOPE', 20, Row1 + 42, 30, OpbTheme.Mid, 'left');
  const area: Rect = { x: ColLabel, y: Row1, w: 4 * ColW, h: EnvLabels - Row1 };
  if (!hasEnvelope) {
    hatch(ctx, { x: area.x + 1, y: area.y + 1, w: area.w - 2, h: Row3 - Row1 - 2 }, OpbTheme.Rule, OpbTheme.Background);
    return;
  }
  const letters = kind === 'Drum' ? ['S', 'A', 'H', 'D'] : ['A', 'D', 'S', 'R'];
  for (let i = 0; i < 4; i++) {
    const cx = ColLabel + i * ColW + ColW / 2;
    const param = sndEnv(S, ENVELOPE_PARAMS[i]);
    const lw = textW(ctx, letters[i], 30);
    const vw = textW(ctx, param.text, 30);
    const left = cx - (lw + 10 + vw) / 2;
    label(ctx, letters[i], left, EnvLabels + 22, 30, dialBrush(1, i, input.session.ui.page));
    label(ctx, param.text, left + lw + 10, EnvLabels + 22, 30, OpbTheme.Ink, 'left', 'normal');
  }

  const x0 = 260, x1 = 692, top = Row1 + 43, bottom = Row1 + 173, w = x1 - x0;
  const linePen = OpbTheme.Mid;
  const handleColor = input.session.ui.page === 1 ? OpbTheme.Ink : OpbTheme.Mid;
  const a = S(2) / 255, d = S(3) / 255, s = S(4) / 255, r = S(5) / 255;
  let handles: [number, number][] = [];
  ctx.strokeStyle = linePen;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'Drum') {
    const xs = x0 + a * w * 0.22, xa = xs + d * w * 0.22, xd = x1 - r * w * 0.27;
    const xh = Math.max(xa, xa + (xd - xa) * s);
    ctx.moveTo(x0, bottom);
    ctx.lineTo(xs, bottom);
    ctx.lineTo(xa, top);
    ctx.lineTo(xh, top);
    ctx.bezierCurveTo(xh + (x1 - xh) * 0.55, top, x1, top + (bottom - top) * 0.45, x1, bottom);
    ctx.lineTo(x0, bottom);
    handles = [[xs, bottom], [xa, top], [xh, top], [x1, bottom]];
    dashedLine(ctx, xh, top + 10, xh, bottom, linePen);
  } else {
    const xa = x0 + a * w * 0.3, xd = xa + d * w * 0.3, ys = bottom - s * (bottom - top);
    const xr = Math.max(x1 - r * w * 0.3, xd);
    ctx.moveTo(x0, bottom);
    ctx.lineTo(xa, top);
    ctx.bezierCurveTo(xa + (xd - xa) * 0.3, ys - (ys - top) * 0.1, xd - (xd - xa) * 0.2, ys, xd, ys);
    ctx.lineTo(xr, ys);
    ctx.bezierCurveTo(xr + (x1 - xr) * 0.4, ys, x1, bottom - (bottom - ys) * 0.3, x1, bottom);
    handles = [[xa, top], [xd, ys], [xr, ys], [x1, bottom]];
    dashedLine(ctx, xr, ys + 10, xr, bottom, linePen);
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x1, bottom);
    ctx.stroke();
  }
  ctx.stroke();
  for (let i = 0; i < handles.length; i++) handle(ctx, handles[i][0], handles[i][1], dialBrush(1, i, input.session.ui.page));
  if (kind === 'Drum') handle(ctx, x0, bottom, handleColor);
}

function drawLfoRow(
  ctx: CanvasRenderingContext2D, input: ScreenInput, track: number, kind: TrackKindName,
  S: (p: number) => number, snd: (p: number, l: string, fmt?: (v: number) => string) => ParamInfo,
  dialBrush: (page: number, dial: number, uiPage: number) => string,
): void {
  const arp = track === 6;
  label(ctx, arp ? 'ARP' : 'LFO', 20, Row3 + 42, 30, OpbTheme.Mid, 'left');
  const y = Row3;
  if (arp) {
    paramCell(ctx, ColLabel, y, 'SPEED', snd(13, 'SPEED', (v) => v < 16 ? 'OFF' : bandName(v, ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'])), 2, 0);
    textCell(ctx, ColLabel + ColW, y, 'PATTERN', snd(14, 'PATTERN', (v) => bandName(v, ['MANUAL', 'UP', 'DOWN', 'UP/DN', 'DN/UP', 'RANDOM'])), 2, 1);
    textCell(ctx, ColLabel + 2 * ColW, y, 'STYLE', snd(15, 'STYLE', (v) => (bandIndex(v, 6) + 1).toString()), 2, 2);
    paramCell(ctx, ColLabel + 3 * ColW, y, 'RANGE', snd(16, 'RANGE', (v) => (bandIndex(v, 4) + 1).toString()), 2, 3);
    return;
  }
  paramCell(ctx, ColLabel, y, 'DEPTH', snd(13, 'DEPTH', (v) => `${percent(v)}`), 2, 0);
  paramCell(ctx, ColLabel + ColW, y, 'RATE', snd(14, 'RATE'), 2, 1);
  const dest = snd(15, 'DEST', (v) => bandName(v, LFO_DEST));
  const dx = ColLabel + 2 * ColW;
  label(ctx, 'DEST', dx + 8, y + 20, 30, OpbTheme.Mid, 'left');
  ctx.fillStyle = dialBrush(2, 2, input.session.ui.page);
  ctx.beginPath();
  ctx.ellipse(dx + 65, y + 65, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, dest.text, dx + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
  const shapeIndex = bandIndex(S(16), LFO_SHAPE.length);
  const sx = ColLabel + 3 * ColW;
  label(ctx, 'SHAPE', sx + 8, y + 20, 30, OpbTheme.Mid, 'left');
  drawLfoShape(ctx, shapeIndex, { x: sx + 20, y: y + 42, w: 90, h: 42 }, dialBrush(2, 3, input.session.ui.page));
  label(ctx, shapeIndex.toString(), sx + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
}

function drawSends(
  ctx: CanvasRenderingContext2D, input: ScreenInput, kind: TrackKindName,
  S: (p: number) => number, snd: (p: number, l: string, fmt?: (v: number) => string) => ParamInfo,
  dialBrush: (page: number, dial: number, uiPage: number) => string,
): void {
  if (kind === 'Fx' || kind === 'Lights') {
    hatch(ctx, { x: FxLeft + 1, y: Row0 + 1, w: FxEnd - FxLeft - 2, h: Row4 - Row0 - 2 }, OpbTheme.Rule, OpbTheme.Background);
    return;
  }
  label(ctx, 'FX SEND', FxLeft + 18, Row0 + 42, 30, OpbTheme.Mid, 'left');
  paramCell(ctx, FxRight, Row0, '1', snd(7, 'FX SEND 1'), 3, 0);
  paramCell(ctx, FxRight + ColW, Row0, '2', snd(8, 'FX SEND 2'), 3, 1);

  const pan = snd(11, 'PAN', (v) => v === 128 ? 'C' : v < 128 ? `L${percent(((128 - v) * 2 - 1) & 0xff)}` : `R${percent(((v - 128) * 2 + 1) & 0xff)}`);
  label(ctx, 'PAN', FxLeft + 18, Row1 + 42, 30, OpbTheme.Mid, 'left');
  const pcx = FxRight + ColW, pcy = Row1 + 64;
  label(ctx, 'L', pcx - 65, pcy, 30, OpbTheme.Ink, 'center');
  label(ctx, 'R', pcx + 65, pcy, 30, OpbTheme.Ink, 'center');
  const px = pcx + (S(11) - 128) / 128 * 42;
  const panBrush = dialBrush(3, 2, input.session.ui.page);
  ctx.strokeStyle = panBrush;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(pcx, pcy - 42);
  ctx.lineTo(pcx, pcy - 22);
  ctx.stroke();
  ctx.fillStyle = panBrush;
  ctx.beginPath();
  ctx.ellipse(px, pcy, 22, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  cross(ctx, px, pcy, 11, 0);

  const level = snd(12, 'LEVEL');
  label(ctx, 'LEVEL', FxLeft + 18, Row2 + 42, 30, OpbTheme.Mid, 'left');
  const lx = FxRight + ColW, ltop = Row2 + 30, lbottom = Row2 + 193;
  const ly = lbottom - S(12) / 255 * (lbottom - ltop);
  const levelBrush = dialBrush(3, 3, input.session.ui.page);
  ctx.strokeStyle = OpbTheme.Rule;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(lx, ltop - 8);
  ctx.lineTo(lx, lbottom);
  ctx.stroke();
  ctx.strokeStyle = levelBrush;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx, lbottom);
  ctx.stroke();
  ctx.fillStyle = levelBrush;
  ctx.beginPath();
  ctx.ellipse(lx, ly, 16, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  cross(ctx, lx, ly, 8, 0);
  label(ctx, level.text, lx, lbottom + 32, 32, OpbTheme.Ink, 'center', 'normal');
}

function drawTrackSettings(
  ctx: CanvasRenderingContext2D, input: ScreenInput, kind: TrackKindName,
  session: OpzSession, track: number,
  snd: (p: number, l: string, fmt?: (v: number) => string) => ParamInfo,
): void {
  const bank = session.bank;
  const styles = kind === 'Drum' ? DRUM_NOTE_STYLES : kind === 'Master' ? ['LATCH', 'FREE'] : SYNTH_NOTE_STYLES;
  const noteLengthValue = bank ? bank.noteLength(session.activePattern, track) : 0;
  const noteLength: ParamInfo = {
    label: 'NOTE LENGTH',
    value: noteLengthValue,
    text: bandName(noteLengthValue, ['1/64', '1/32', '1/16', '1/8', '1/4', '1/2', '1', 'DRONE']),
  };
  const noteStyle = snd(17, 'NOTE STYLE', (v) => bandName(v, styles));
  const quantizeValue = bank ? bank.quantize(session.activePattern, track) : 0;
  const quantize: ParamInfo = {
    label: 'QUANTIZE',
    value: quantizeValue,
    text: `${percent(quantizeValue)}`,
  };
  const fourth = kind === 'Tape' || kind === 'Module' ? 'DRY LEVEL' : 'PORTAMENTO';
  const portamento = snd(6, fourth);
  const items: ParamInfo[] = [noteLength, noteStyle, quantize, portamento];
  const rows = [Row0, Row1, Row2, Row3];
  for (let i = 0; i < 4; i++) {
    label(ctx, items[i].label, FxEnd + 18, rows[i] + 42, 30, OpbTheme.Mid, 'left');
    label(ctx, items[i].text, FxEnd + 106, rows[i] + 90, 42, OpbTheme.Ink, 'center', 'normal');
  }
}

function drawSequencer(ctx: CanvasRenderingContext2D, input: ScreenInput, session: OpzSession, track: number): void {
  label(ctx, 'SEQUENCER', 30, SeqLabelY, 30, OpbTheme.Mid, 'left');
  hLine(ctx, input.left, RightEnd, SeqNumTop);
  ctx.fillStyle = OpbTheme.Rule;
  ctx.fillRect(input.left, SeqDotTop, RightEnd - input.left, SeqBottom - SeqDotTop);
  hLine(ctx, input.left, input.right, SeqBottom);

  const bank = session.bank;
  const count = bank ? bank.stepCount(session.activePattern, track) : 16;
  const length = bank ? bank.stepLength(session.activePattern, track) : 1;
  const playStep = currentStep(session, count, length, input);

  for (let step = 0; step < 16; step++) {
    const x = StepX0 + step * StepW;
    const beyond = step >= count;
    const sepColor = step % 4 === 0 ? OpbTheme.Ink : OpbTheme.Rule;
    if (step > 0) vLine(ctx, x, SeqNumTop, SeqDotTop, sepColor, step % 4 === 0 ? 2 : 1);
    label(ctx, (step + 1).toString(), x + 4, SeqNumTop + 22, 40, beyond ? OpbTheme.Rule : OpbTheme.Mid, 'left', 'normal');
    const cx = x + StepW / 2 - 21, cy = SeqDotTop + 22;
    const trig = bank ? bank.hasTrig(session.activePattern, track, step) : false;
    ctx.fillStyle = beyond ? OpbTheme.Background : trig ? OpbTheme.Ink : OpbTheme.Mid;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 11, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    if (bank && !beyond) {
      if (bank.hasAnyLock(session.activePattern, track, step)) {
        ctx.strokeStyle = OpbTheme.Red;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 16, 16, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (bank.componentMask(session.activePattern, track, step) !== 0) {
        ctx.fillStyle = OpbTheme.Green;
        ctx.beginPath();
        ctx.ellipse(cx + 26, cy - 10, 5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const frameColor = OpbTheme.Yellow;
  if (playStep >= 0) frame(ctx, { x: StepX0 + playStep * StepW - 2, y: SeqNumTop - 2, w: StepW + 2, h: SeqBottom - SeqNumTop + 4 }, frameColor);
  else frame(ctx, { x: StepX0 - 2, y: SeqNumTop - 2, w: StepW + 2, h: SeqBottom - SeqNumTop + 4 }, frameColor);

  label(ctx, 'STEP COUNT', 52, SeqBottom + 40, 32, OpbTheme.Mid, 'left');
  label(ctx, count.toString(), 247, SeqBottom + 40, 42, OpbTheme.Ink, 'left', 'normal');
  label(ctx, 'STEP LENGTH', 398, SeqBottom + 40, 32, OpbTheme.Mid, 'left');
  label(ctx, length.toString(), 592, SeqBottom + 40, 42, OpbTheme.Ink, 'left', 'normal');
  label(ctx, 'SUM', 1315, SeqBottom + 40, 32, OpbTheme.Mid, 'right');
  label(ctx, (count * length).toString(), 1350, SeqBottom + 40, 42, OpbTheme.Green, 'left', 'normal');
}

// ---- shared cell helpers ----

function paramCell(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, param: ParamInfo, _page: number, dial: number): void {
  const rect: Rect = { x, y, w: ColW, h: Row1 - Row0 };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, 'left');
  knob(ctx, x + 65, y + 65, param.value / 255, OpbTheme.Dials[dial]);
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
}

function textCell(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, param: ParamInfo, _page: number, dial: number): void {
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, 'left');
  ctx.fillStyle = OpbTheme.Dials[dial];
  ctx.beginPath();
  ctx.ellipse(x + 65, y + 65, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, param.text, x + 65, y + 107, 30, OpbTheme.Ink, 'center', 'normal');
}

function drawLfoShape(ctx: CanvasRenderingContext2D, index: number, r: Rect, brush: string): void {
  ctx.strokeStyle = brush;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const l = r.x, rt = r.x + r.w, t = r.y, b = r.y + r.h, m = (t + b) / 2, cx = (l + rt) / 2;
  ctx.beginPath();
  switch (index % 6) {
    case 0:
      ctx.moveTo(l, m);
      ctx.bezierCurveTo(l + r.w * 0.18, t - 6, cx - r.w * 0.12, t - 6, cx, m);
      ctx.bezierCurveTo(cx + r.w * 0.12, b + 6, rt - r.w * 0.18, b + 6, rt, m);
      break;
    case 1:
      ctx.moveTo(l, b);
      ctx.lineTo(cx, t);
      ctx.lineTo(rt, b);
      break;
    case 2:
      ctx.moveTo(l, b);
      ctx.lineTo(l, t);
      ctx.lineTo(cx, t);
      ctx.lineTo(cx, b);
      ctx.lineTo(rt, b);
      break;
    case 3:
      ctx.moveTo(l, b);
      ctx.lineTo(rt, t);
      ctx.lineTo(rt, b);
      break;
    case 4: {
      const ys = [m, t, t, b, b, m + 6, m + 6, t + 8, t + 8, m];
      ctx.moveTo(l, m);
      for (let i = 1; i < ys.length; i++) ctx.lineTo(l + r.w * Math.floor((i + 1) / 2) / 5, ys[i]);
      break;
    }
    default:
      ctx.ellipse(cx + r.h / 2, m, r.h / 2, r.h / 2, 0, -Math.PI / 2, Math.PI / 2);
      ctx.ellipse(cx - r.h / 2, m, r.h / 2, r.h / 2, 0, Math.PI / 2, -Math.PI / 2);
      break;
  }
  ctx.stroke();
  if (index >= 6) {
    ctx.fillStyle = brush;
    ctx.beginPath();
    ctx.ellipse(r.x - 6, r.y + r.h, 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- small local helpers (kept inline to avoid importing session helpers here) ----

import { percent, bandName, bandIndex, DRUM_NOTE_STYLES, SYNTH_NOTE_STYLES, LFO_DESTINATIONS as LFO_DEST, LFO_SHAPES as LFO_SHAPE } from '../displays.ts';
import { textWidth as textW } from '../draw.ts';

function sndEnv(S: (p: number) => number, p: number): ParamInfo {
  return paramInfo(S(p), '', (v) => `${percent(v)}`);
}

function dashedLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number, size: number): string {
  let t = text;
  while (t.length > 1 && textW(ctx, t, size, 'normal') > width) t = t.slice(0, -1);
  return t;
}

function plugName(session: OpzSession, track: number): string {
  // PlugNames.Get equivalent: a short, deterministic name from the serial-free local state.
  // (The C# version maps a device plug id to a name; we surface the track's sound bytes as a hint.)
  const s = session.currentSound[track];
  if (s && s[0] !== 0) return `PLUG ${s[0]}`;
  return ['KICK', 'SNARE', 'PERC', 'SAMPLE', 'BASS', 'LEAD', 'ARP', 'CHORD', 'FX1', 'FX2', 'TAPE', 'MASTER', 'PERFORM', 'MODULE', 'LIGHTS', 'MOTION'][track] ?? 'TRACK';
}

function currentStep(session: OpzSession, count: number, length: number, input: ScreenInput): number {
  if (!input.playing) return -1;
  let sixteenths: number;
  if (session.clockTicks > 0) sixteenths = session.clockTicks / 6;
  else {
    const bpm = session.global ? session.global.tempo : 120;
    sixteenths = (input.playMs / 1000 / 60) * bpm * 4;
  }
  return Math.floor(sixteenths / Math.max(1, length) % Math.max(1, count));
}
