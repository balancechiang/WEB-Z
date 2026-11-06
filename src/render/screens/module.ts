/**
 * Module screen — OPB.App/Screens/ModuleScreen.cs → Canvas 2D.
 * The four dial pages of the module track's 16 values (each sent out as a MIDI CC), plus the
 * connected expansion module (oplab / line / rumble) decoded from $14 and the audio input
 * routing + microphone state from $04. Pure render port; layout matches the C# original.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, knob, hsvToCss, controlTrackChrome, controlTrackSequencer } from '../draw.ts';
import { SOUND_PARAM, MIC_FX } from '../displays.ts';

interface R { x: number; y: number; w: number; h: number; }
interface PInfo { value: number; text: string; }

const Row0 = 82, RowB = 342, ColLabel = 216, CellW = 130, CellH = 130, PanelLeft = 736, RightEnd = 1426;
const PageNames = ['SOUND', 'ENVELOPE', 'LFO', 'MIX'];
// [byte index in the sound record, label] per [page][dial].
const Pages: [number, string][][] = [
  [[SOUND_PARAM.P1, 'P1'], [SOUND_PARAM.P2, 'P2'], [SOUND_PARAM.Filter, 'FILTER'], [SOUND_PARAM.Resonance, 'RES']],
  [[SOUND_PARAM.Attack, 'ATTACK'], [SOUND_PARAM.Decay, 'DECAY'], [SOUND_PARAM.Sustain, 'SUSTAIN'], [SOUND_PARAM.Release, 'RELEASE']],
  [[SOUND_PARAM.LfoDepth, 'DEPTH'], [SOUND_PARAM.LfoSpeed, 'RATE'], [SOUND_PARAM.LfoDest, 'DEST'], [SOUND_PARAM.LfoShape, 'SHAPE']],
  [[SOUND_PARAM.Fx1Send, 'FX 1'], [SOUND_PARAM.Fx2Send, 'FX 2'], [SOUND_PARAM.Pan, 'PAN'], [SOUND_PARAM.Level, 'LEVEL']],
];

export function renderModule(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const track = 13; // Module track
  const S = (p: number): number => session.currentSound[track][p] & 0xff;
  const dialBrush = (page: number, dial: number): string =>
    session.ui.page === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const mod = session.module;

  controlTrackChrome(ctx, input, 'MODULE');

  vLine(ctx, ColLabel, Row0, RowB);
  vLine(ctx, PanelLeft, Row0, RowB);
  hLine(ctx, PanelLeft, RightEnd, RowB);

  const midi = session.midiConfig;
  for (let page = 0; page < 4; page++) {
    const y = Row0 + page * CellH;
    if (page > 0) hLine(ctx, input.left, PanelLeft, y);
    label(ctx, PageNames[page], 18, y + 42, 30, session.ui.page === page ? OpbTheme.Ink : OpbTheme.Mid);
    label(ctx, `PAGE ${page + 1}`, 18, y + 80, 22, OpbTheme.Mid);
    for (let dial = 0; dial < 4; dial++) {
      const x = ColLabel + dial * CellW;
      if (dial > 0) vLine(ctx, x, y, y + CellH);
      const [param, text] = Pages[page][dial];
      const index = page * 4 + dial;
      const cc = midi ? `CC ${midi.parameterCc(track, index)}` : '';
      cell(ctx, x, y, text, { value: S(param), text: String(Math.round(S(param) / 2)) }, page, dial, cc, dialBrush);
    }
  }

  drawModule(ctx, { x: PanelLeft, y: Row0, w: RightEnd - PanelLeft, h: RowB - Row0 }, mod, session, track);
  drawInput(ctx, { x: PanelLeft, y: RowB, w: RightEnd - PanelLeft, h: 602 - RowB }, session);

  controlTrackSequencer(ctx, input, track);
}

/** A knob cell: caption above, knob in the middle, value (+ optional CC caption) below. */
function cell(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, param: PInfo, _page: number, dial: number, caption: string, dialBrush: (p: number, d: number) => string): void {
  const rect: R = { x, y, w: CellW, h: CellH };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, 'left');
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush(_page, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, 'center', 'normal');
  if (caption) label(ctx, caption, x + CellW - 6, y + 109, 18, OpbTheme.Mid, 'right');
}

function section(ctx: CanvasRenderingContext2D, title: string, x: number, y: number): void {
  label(ctx, title, x + 18, y + 42, 30, OpbTheme.Mid, 'left');
}

function drawModule(ctx: CanvasRenderingContext2D, r: R, mod: { connected: boolean; name: string; status: number }, session: OpzSession, track: number): void {
  section(ctx, 'MODULE', r.x, r.y);
  const name = mod.connected && mod.name.trim() ? mod.name.trim().toLowerCase() : '';
  const kind = name === 'oplab' ? 'OPLAB' : (name === 'line' || name === 'in-out') ? 'LINE' : name === 'rumble' ? 'RUMBLE' : name === '' ? 'NONE' : name.toUpperCase();
  label(ctx, kind, r.x + 18, r.y + 110, 56, mod.connected ? OpbTheme.Ink : OpbTheme.Mid, 'left', 'normal');
  label(ctx, mod.connected ? 'CONNECTED' : 'NO EXPANSION MODULE', r.x + 18, r.y + 160, 24, mod.connected ? OpbTheme.Green : OpbTheme.Mid);

  const cx = r.x + 330, y = r.y + 70;
  const status = mod.status;
  if (kind === 'OPLAB' || kind === 'LINE') {
    const output = ((status >> 24) & 3) === 1 ? 'MIDI' : ((status >> 24) & 3) === 2 ? 'TRIGGER' : ((status >> 24) & 3) === 3 ? 'PO SYNC' : '—';
    const inputSw = ((status >> 27) & 1) === 0 ? 'MIDI' : 'TRIGGER';
    row(ctx, cx, y, 'OUT SWITCH', output);
    row(ctx, cx, y + 44, 'IN SWITCH', inputSw);
    if (kind === 'LINE') {
      const lineOut = ((status >> 20) & 1) === 0 ? '—' : ((status >> 21) & 1) !== 0 ? 'MONO' : 'STEREO';
      const lineIn = ((status >> 22) & 1) === 0 ? '—' : ((status >> 23) & 1) !== 0 ? 'MONO' : 'STEREO';
      row(ctx, cx, y + 88, 'LINE OUT', lineOut);
      row(ctx, cx, y + 132, 'LINE IN', lineIn);
    }
  } else if (kind === 'RUMBLE') {
    const level = Math.min(4, status & 0x0f);
    label(ctx, 'LEVEL', cx, y, 24, OpbTheme.Mid);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < level ? OpbTheme.Ink : OpbTheme.Rule;
      ctx.fillRect(cx + 120 + i * 40, y + 20 - (i + 1) * 14, 28, (i + 1) * 14);
    }
  } else {
    label(ctx, 'WITHOUT A MODULE THE TRACK', cx, y + 10, 24, OpbTheme.Mid);
    label(ctx, 'SENDS ITS 16 VALUES AS MIDI CC', cx, y + 44, 24, OpbTheme.Mid);
    label(ctx, 'AND ITS NOTES ON CHANNEL ' + ((session.midiConfig?.channel(track) ?? track) + 1), cx, y + 78, 24, OpbTheme.Mid);
  }
}

function drawInput(ctx: CanvasRenderingContext2D, r: R, session: OpzSession): void {
  section(ctx, 'INPUT', r.x, r.y);
  const level = session.level;
  const sources: [string, number][] = [['MIC', 1], ['HEADSET', 2], ['MODULE', 4], ['USB', 8]];
  for (let i = 0; i < sources.length; i++) {
    const chip: R = { x: r.x + 18 + i * 162, y: r.y + 70, w: 150, h: 56 };
    const on = (level.inputSelector & sources[i][1]) !== 0;
    if (on) { ctx.fillStyle = OpbTheme.Ink; ctx.fillRect(chip.x, chip.y, chip.w, chip.h); }
    else { frame(ctx, chip, OpbTheme.Mid, 2); }
    label(ctx, sources[i][0], chip.x + chip.w / 2, chip.y + chip.h / 2, 24, on ? OpbTheme.White : OpbTheme.Mid, 'center', 'normal');
  }

  const y = r.y + 160;
  label(ctx, 'MIC LEVEL', r.x + 18, y, 24, OpbTheme.Mid);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i < level.micLevel ? OpbTheme.Ink : OpbTheme.Rule;
    ctx.fillRect(r.x + 160 + i * 14, y - 12, 10, 24);
  }
  row(ctx, r.x + 420, y, 'MIC FX', MIC_FX[Math.max(0, Math.min(3, level.micFx))]);
  row(ctx, r.x + 18, y + 54, 'MONITOR', level.monitor ? 'ON' : 'OFF', 142);
  row(ctx, r.x + 420, y + 54, 'MIC MODE', level.micMode ? 'ON' : 'OFF');
}

function row(ctx: CanvasRenderingContext2D, x: number, y: number, labelText: string, value: string, valueOffset = 150): void {
  label(ctx, labelText, x, y, 24, OpbTheme.Mid);
  label(ctx, value, x + valueOffset, y, 26, OpbTheme.Ink, 'left', 'normal');
}
