/**
 * Perform screen — OPB.App/Screens/PerformScreen.cs → Canvas 2D.
 * The two-octave punch-in effect keyboard (F..E twice): the low octave acts on the
 * drum tracks, the high octave on the synth tracks. Pure render port; the lit keys
 * reflect the held shift+key state. Layout coordinates match the C# original
 * (1600 x 812 design space). Interaction (touch, note echo) lives in the canvas view.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, hatch, knob, handle, cross, stepper, button, toggle, wrapText, textWidth } from '../draw.ts';
import { percent, fromPercent, band, bandName, bandIndex, noteName, trackKind, hasSound, paramInfo, SOUND_PARAM, NOTE_LENGTHS, DRUM_NOTE_STYLES, SYNTH_NOTE_STYLES, LFO_DESTINATIONS, LFO_SHAPES, METRONOME_SOUNDS, MIC_FX } from '../displays.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';

/** Local rect alias so we don't need to touch the shared draw.ts Rect export. */
interface R { x: number; y: number; w: number; h: number; }

const TitleY = 40, Row0 = 82, LabelY = 116, KeyTop = 148, KeyBottom = 720, BlackBottom = 460;
const WhiteW = 106, BlackW = 66;

/** Effects from F upward (index = semitones above F). Some labels span two lines. */
const Effects = [
  'DUCK', 'FILTER\nSWEEP', 'LOOP\n1', 'STEREO', 'LOOP\n2', 'PITCH',
  'FOLLOW\nECHO', 'RAMP UP\nFILL 1', 'SHORT', 'RAMP\nDOWN\nFILL 2', 'LONG', 'RANDOM',
];
const Octaves = ['DRUMS', 'SYNTHS'];
const WhiteKeys = [0, 2, 4, 6, 7, 9, 11];
const BlackKeys: [number, number][] = [[1, 0], [3, 1], [5, 2], [8, 4], [10, 5]];

export function renderPerform(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  label(ctx, 'PERFORM', input.right / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, Row0);

  // Keys lit now: touched keys, held perform notes, or shift + a held key on the OP-Z.
  // Render-only: surface the shift+heldKey case; live note/touch state is interactive.
  const active = new Set<number>();
  if (session.ui.shift && session.ui.heldKey >= 0) active.add(session.ui.heldKey % 24);

  const X0 = (input.right - 14 * WhiteW) / 2;
  const whiteRect = (octave: number, i: number): R => ({
    x: X0 + (octave * 7 + i) * WhiteW, y: KeyTop, w: WhiteW, h: KeyBottom - KeyTop,
  });
  const blackRect = (octave: number, after: number): R => ({
    x: X0 + (octave * 7 + after + 1) * WhiteW - BlackW / 2, y: KeyTop, w: BlackW, h: BlackBottom - KeyTop,
  });

  // White keys + octave captions.
  for (let octave = 0; octave < 2; octave++) {
    const left = X0 + octave * 7 * WhiteW;
    let any = false;
    for (const k of active) if (Math.floor(k / 12) === octave) { any = true; break; }
    label(ctx, Octaves[octave], left + 7 * WhiteW / 2, LabelY, 30,
      any ? OpbTheme.Ink : OpbTheme.Mid, 'center', any ? 'normal' : 'light');
    for (let i = 0; i < WhiteKeys.length; i++) {
      const key = octave * 12 + WhiteKeys[i];
      const on = active.has(key);
      const r = whiteRect(octave, i);
      ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Background;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      frame(ctx, r, OpbTheme.Rule, 2);
      drawEffect(ctx, WhiteKeys[i], r.x + WhiteW / 2, KeyBottom - 80, on ? OpbTheme.Ink : OpbTheme.Mid, 22);
    }
  }

  // The octave boundary, a little heavier, like the split on the device.
  vLine(ctx, X0 + 7 * WhiteW, KeyTop, KeyBottom, OpbTheme.Ink, 3);

  // Black keys sit on top of the white keys.
  for (let octave = 0; octave < 2; octave++) {
    for (const [key, after] of BlackKeys) {
      const on = active.has(octave * 12 + key);
      const r = blackRect(octave, after);
      ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Ink;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      drawEffect(ctx, key, r.x + BlackW / 2, BlackBottom - 60, on ? OpbTheme.Ink : OpbTheme.Mid, 19);
    }
  }

  label(ctx, 'TOUCH A KEY OR HOLD SHIFT + KEY', input.right / 2, KeyBottom + 48, 30, OpbTheme.Mid, 'center');
}

/** Draws the one-or-two line effect caption centered at (cx, y). */
function drawEffect(ctx: CanvasRenderingContext2D, effect: number, cx: number, y: number, brush: string, size = 22): void {
  const lines = Effects[effect].split('\n');
  const top = y - (lines.length - 1) * size * 0.6;
  for (let i = 0; i < lines.length; i++) {
    label(ctx, lines[i], cx, top + i * size * 1.2, size, brush, 'center');
  }
}
