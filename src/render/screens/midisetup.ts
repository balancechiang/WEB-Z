/**
 * MIDI Setup screen — OPB.App/Screens/MidiSetupScreen.cs → Canvas 2D.
 * Per-track MIDI enable + channel, the 16 outgoing CCs of the active track (4 pages of 4 dials),
 * and the eight global MIDI flags. Pure render port; all editing/interaction lives in the canvas
 * view, so the read-only state here comes straight from session.midiConfig (or a waiting panel).
 *
 * Stage 6: when ScreenInput.write is present, a DRY-RUN write-transaction overlay is drawn on
 * top (staged typed edits, diff, CRCs, evidence grade). It never sends anything by itself.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, hatch, knob, toggle, stepper, fitText, writeEditorOverlay } from '../draw.ts';
import { MidiFlag } from '../../model/globalData.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';

const TitleY = 40, Row0 = 82, ListRight = 520, HeaderBottom = 132, RowH = (812 - HeaderBottom) / 16;
const GridLabel = 520, GridX = 736, RightEnd = 1426, CellW = (RightEnd - GridX) / 4, CellH = 130;
const GlobalTop = Row0 + 4 * CellH, GlobalH = (812 - GlobalTop) / 2;
const OnX = 316, MinusX = 384, ChannelX = 434, PlusX = 484;

const ParamLabels = [
  ['P1', 'P2', 'FILTER', 'RES'],
  ['ATTACK', 'DECAY', 'SUSTAIN', 'RELEASE'],
  ['LFO DEPTH', 'LFO RATE', 'LFO DEST', 'LFO SHAPE'],
  ['FX1', 'FX2', 'PAN', 'LEVEL'],
];
const PageNames = ['SOUND', 'ENVELOPE', 'LFO', 'MIX'];
const Flags: [number, string, string][] = [
  [MidiFlag.ChannelOneToActive, 'CHANNEL 1', 'TO ACTIVE'],
  [MidiFlag.IncomingMidi, 'INCOMING', 'MIDI'],
  [MidiFlag.OutgoingMidi, 'OUTGOING', 'MIDI'],
  [MidiFlag.ClockIn, 'CLOCK IN', ''],
  [MidiFlag.ClockOut, 'CLOCK OUT', ''],
  [MidiFlag.AltProgramChange, 'ALT PROGRAM', 'CHANGE'],
  [MidiFlag.MidiEcho, 'MIDI ECHO', ''],
  [MidiFlag.ProgramChange, 'PROGRAM', 'CHANGE'],
];

export function renderMidiSetup(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const m = session.midiConfig;

  label(ctx, 'MIDI SETUP', RightEnd / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  label(ctx, 'TOUCH PAD', RightEnd + 14, TitleY, 30, OpbTheme.Mid);
  hLine(ctx, input.left, input.right, Row0);
  vLine(ctx, RightEnd, 0, input.bottom);
  vLine(ctx, ListRight, Row0, input.bottom);
  hatch(ctx, { x: RightEnd + 1, y: Row0 + 1, w: input.right - RightEnd - 1, h: input.bottom - Row0 - 1 }, OpbTheme.Rule, OpbTheme.Background);

  if (!m) {
    hatch(ctx, { x: input.left, y: Row0 + 1, w: RightEnd - input.left - 1, h: input.bottom - Row0 - 1 }, OpbTheme.Rule, OpbTheme.Background);
    const panel = { x: RightEnd / 2 - 360, y: 330, w: 720, h: 150 };
    ctx.fillStyle = OpbTheme.Background; ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    label(ctx, session.isConnected ? 'WAITING FOR THE MIDI SETUP' : 'OP-Z NOT CONNECTED', panel.x + panel.w / 2, panel.y + 52, 40, OpbTheme.Ink, 'center', 'normal');
    label(ctx, session.isConnected ? 'REQUESTED FROM THE OP-Z' : 'CONNECT THE OP-Z TO EDIT ITS MIDI SETTINGS', panel.x + panel.w / 2, panel.y + 104, 26, OpbTheme.Mid, 'center');
  } else {
    drawTracks(ctx, session, m);
    drawParameters(ctx, session, m);
    drawGlobals(ctx, m);
  }

  // Stage 6: an open write editor replaces the read-only "IN SYNC" view with a DRY-RUN
  // transaction panel. Staged CC/channel/flag edits are listed; nothing is sent from here.
  if (input.write) {
    writeEditorOverlay(ctx, input.write, {
      subtitle: 'MIDI SETUP · $0F REQUEST / $10 WRITE · 292 B · RESERVED 289..291 PRESERVED',
      footnote: `FRESH $0F READBACK AFTER WRITE · BASELINE ${input.write.baselineBytes} B · EXACT ROLLBACK ON MISMATCH`,
    });
  }
}

function drawTracks(ctx: CanvasRenderingContext2D, session: OpzSession, m: NonNullable<OpzSession['midiConfig']>): void {
  const selectedTrack = session.activeTrack;
  label(ctx, 'TRACK', 20, Row0 + 25, 26, OpbTheme.Mid);
  label(ctx, 'ON', OnX, Row0 + 25, 26, OpbTheme.Mid, 'center');
  label(ctx, 'CHANNEL', ChannelX, Row0 + 25, 26, OpbTheme.Mid, 'center');
  hLine(ctx, 0, ListRight, HeaderBottom);
  for (let t = 0; t < 16; t++) {
    const y = HeaderBottom + t * RowH, cy = y + RowH / 2;
    const selected = t === selectedTrack, on = m.trackEnabled(t);
    if (selected) { ctx.fillStyle = OpbTheme.Rule; ctx.fillRect(0, y + 1, ListRight, RowH - 1); }
    if (t === selectedTrack) { ctx.fillStyle = OpbTheme.Yellow; ctx.fillRect(6, cy - 9, 5, 18); }
    label(ctx, String(t + 1), 22, cy, 24, OpbTheme.Mid);
    label(ctx, TRACK_NAMES[t] ?? `TRACK ${t}`, 64, cy, 28, on ? OpbTheme.Ink : OpbTheme.Mid, 'left', selected ? 'normal' : 'light');
    toggle(ctx, OnX, cy, on, true, 24);
    stepper(ctx, MinusX, cy, false, m.channel(t) > 0, 14);
    label(ctx, String(m.channel(t) + 1), ChannelX, cy, 28, on ? OpbTheme.Ink : OpbTheme.Mid, 'center', 'normal');
    stepper(ctx, PlusX, cy, true, m.channel(t) < 15, 14);
    if (t % 4 === 3 && t < 15) hLine(ctx, 0, ListRight, y + RowH);
  }
}

function drawParameters(ctx: CanvasRenderingContext2D, session: OpzSession, m: NonNullable<OpzSession['midiConfig']>): void {
  const track = session.activeTrack;
  const on = m.trackEnabled(track);
  for (let page = 0; page < 4; page++) {
    const y = Row0 + page * CellH;
    if (page === 0) {
      label(ctx, TRACK_NAMES[track] ?? `TRACK ${track}`, GridLabel + 20, y + 40, 34, on ? OpbTheme.Ink : OpbTheme.Mid, 'left', 'normal');
      label(ctx, on ? `CHANNEL ${m.channel(track) + 1}` : 'MIDI OFF', GridLabel + 20, y + 80, 24, on ? OpbTheme.Mid : OpbTheme.Red);
      label(ctx, 'OUTGOING CC', GridLabel + 20, y + 110, 22, OpbTheme.Mid);
    } else {
      label(ctx, PageNames[page], GridLabel + 20, y + 42, 30, OpbTheme.Mid);
    }
    ctx.fillStyle = OpbTheme.Pages[page];
    ctx.fillRect(GridX - 14, y + 26, 6, CellH - 52);
    for (let dial = 0; dial < 4; dial++) {
      const param = page * 4 + dial;
      const x = GridX + dial * CellW;
      const cc = m.parameterCc(track, param);
      label(ctx, ParamLabels[page][dial], x + 10, y + 20, 26, OpbTheme.Mid);
      knob(ctx, x + CellW / 2, y + 64, cc / 127, on ? OpbTheme.Dials[dial] : OpbTheme.Mid, 20);
      label(ctx, 'CC', x + CellW / 2 - 6, y + 107, 22, OpbTheme.Mid, 'right');
      label(ctx, String(cc), x + CellW / 2, y + 107, 32, OpbTheme.Ink, 'left', 'normal');
      if (dial > 0) vLine(ctx, x, y, y + CellH);
    }
    hLine(ctx, GridLabel, RightEnd, y + CellH);
  }
  vLine(ctx, GridX, Row0, GlobalTop);
  frame(ctx, { x: GridX, y: Row0, w: CellW, h: CellH }, OpbTheme.Red, 4);
}

function drawGlobals(ctx: CanvasRenderingContext2D, m: NonNullable<OpzSession['midiConfig']>): void {
  label(ctx, 'GLOBAL', GridLabel + 20, GlobalTop + 42, 30, OpbTheme.Mid);
  label(ctx, 'IN SYNC', GridLabel + 20, GlobalTop + 82, 22, OpbTheme.Mid);
  vLine(ctx, GridX, GlobalTop, 812);
  for (let i = 0; i < Flags.length; i++) {
    const [flag, line1, line2] = Flags[i];
    const x = GridX + (i % 4) * CellW, y = GlobalTop + Math.floor(i / 4) * GlobalH, cy = y + GlobalH / 2;
    const on = m.flag(flag);
    toggle(ctx, x + 24, cy, on, true, 24);
    const brush = on ? OpbTheme.Ink : OpbTheme.Mid;
    const weight = on ? 'normal' : 'light';
    if (!line2) label(ctx, line1, x + 48, cy, 22, brush, 'left', weight);
    else {
      label(ctx, fitText(ctx, line1, CellW - 52, 22, weight), x + 48, cy - 13, 22, brush, 'left', weight);
      label(ctx, fitText(ctx, line2, CellW - 52, 22, weight), x + 48, cy + 14, 22, brush, 'left', weight);
    }
    if (i % 4 > 0) vLine(ctx, x, y, Math.floor(i / 4) === 1 ? 812 : y + GlobalH);
  }
  hLine(ctx, GridLabel, RightEnd, GlobalTop + GlobalH);
}
