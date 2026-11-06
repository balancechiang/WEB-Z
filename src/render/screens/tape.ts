/**
 * Tape screen — OPB.App/Screens/TapeScreen.cs → Canvas 2D.
 * A scrolling waveform strip and two reels that turn while playing, at the speed set by the
 * tape's speed (P1) and fine (P2) parameters. Layout coordinates match the C# original
 * (1600 x 812 design space). Animation is derived from the transport clock; this module renders.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, hatch, knob, handle, cross, stepper, button, toggle, wrapText, textWidth } from '../draw.ts';
import { percent, fromPercent, band, bandName, bandIndex, noteName, trackKind, hasSound, paramInfo, SOUND_PARAM, NOTE_LENGTHS, DRUM_NOTE_STYLES, SYNTH_NOTE_STYLES, LFO_DESTINATIONS, LFO_SHAPES, METRONOME_SOUNDS, MIC_FX } from '../displays.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';

const TAPE_TRACK = 10;
const TitleY = 40, Row0 = 82, WaveY = 171, WaveX0 = 525, BarStep = 17.5, BarW = 8;
const ReelY = 492, ReelR = 216, BandHalf = 47, BandReach = 190, TapeOuter = 128, HubR = 64;
const RevsPerSecond = 0.35, BarsPerSecond = 8;

/** Bar heights of the official app's idle waveform. */
const Wave: number[] = [
  83, 39, 19, 12, 76, 39, 23, 12, 85, 39, 37, 39, 58, 29, 16, 10,
  37, 23, 12, 43, 56, 29, 16, 12, 85, 39, 25, 47, 23, 16, 43, 23,
];

const RedBand = '#9B1A27';
const BlueBand = '#0F3556';
const TapeBrown = '#6B3A36';
const Hub = '#505050';
const Spindle = '#1A1A1A';
const Cap = '#4D4D4D';

export function renderTape(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const playing = input.playing || session.clockRunning;

  label(ctx, 'TAPE', input.right / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, Row0);

  // AudioVis carries two 4-bit visualization levels.
  const vis = session.audioVis;
  const visLevel = ((vis & 0x0f) + (vis >> 4)) / 30.0;
  const activity = Math.max(visLevel, playing ? 1 : 0);
  const live = playing || activity > 0.02;
  const gain = 0.4 + 0.6 * Math.min(1, activity);

  // Animation derived from the transport clock (C# integrates rotation/scroll while playing).
  const speed = speedFactor(session);
  const t = input.playMs / 1000;
  const rotation = playing ? (t * 360 * RevsPerSecond * speed) % 360 : 0;
  const scroll = playing ? (t * BarsPerSecond * speed) % Wave.length : 0;
  const offset = Math.floor(scroll);

  for (let i = 0; i < Wave.length; i++) {
    const h = live ? Math.max(8, Wave[(i + offset) % Wave.length] * gain) : Wave[i];
    ctx.fillStyle = OpbTheme.Ink;
    ctx.fillRect(WaveX0 + i * BarStep - BarW / 2, WaveY - h / 2, BarW, h);
  }

  drawReel(ctx, 562, ReelY, OpbTheme.Red, RedBand, 35 + rotation);
  drawReel(ctx, 1039, ReelY, OpbTheme.TapeBlue, BlueBand, -55 + rotation);
}

/** Coarse speed: left is normal, turning right speeds up then slows to a stop. Fine: center normal, left half, right double. */
function speedFactor(session: OpzSession): number {
  const s = session.currentSound[TAPE_TRACK];
  const p1 = (s[SOUND_PARAM.P1] & 0xff) / 255.0;
  const coarse = p1 < 0.6 ? 1 + p1 / 0.6 : 2 * (1 - (p1 - 0.6) / 0.4);
  return coarse * Math.pow(2, ((s[SOUND_PARAM.P2] & 0xff) - 128) / 128.0);
}

function drawReel(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, bandColor: string, angle: number): void {
  // Outer disc.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ReelR, ReelR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rotate the flange, band, wound tape and hub assembly about the reel center.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  const bandRect = { x: cx - BandHalf, y: cy - BandReach, w: BandHalf * 2, h: BandReach * 2 };
  ctx.fillStyle = bandColor;
  ctx.fillRect(bandRect.x, bandRect.y, bandRect.w, bandRect.h);

  // The wound tape shows through the window in the flange.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bandRect.x, bandRect.y, bandRect.w, bandRect.h);
  ctx.clip();
  ctx.fillStyle = TapeBrown;
  ctx.beginPath();
  ctx.ellipse(cx, cy, TapeOuter, TapeOuter, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Hub ring, hub, spindle.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, HubR + 5, HubR + 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Hub;
  ctx.beginPath();
  ctx.ellipse(cx, cy, HubR, HubR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Spindle;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 50, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  // Three spokes.
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((i * 120 + 20) * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = Spindle;
    ctx.fillRect(cx - 12, cy - 63, 24, 22);
    ctx.restore();
  }

  // Center cap.
  ctx.fillStyle = Cap;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 19, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
