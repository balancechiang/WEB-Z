/**
 * Mixer screen — OPB.App/Screens/MixerScreen.cs → Canvas 2D.
 * Group levels in the header, faders for tracks 1-8 and activity meters that pulse with each note.
 * (Mute toggling and fader dragging are handled by the canvas view; this module renders state.)
 */
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, hatch, handle } from '../draw.ts';
import { percent } from '../displays.ts';
import type { ScreenInput } from './index.ts';

const TitleY = 40, Row0 = 82, IconRow = 150, ValueY = 184, FaderTop = 214, FaderBottom = 641, MeterY = 726;
const X0 = 107, ColW = 173.5, BarW = 130, BarH = 21, MeterR = 64;
const PULSE_SECONDS = 0.45;

const GROUP_NAMES = ['DRUM GROUP', 'SYNTH GROUP', 'PUNCH', 'MASTER'];
const GROUP_X = [129, 389, 1083, 1343];
const GROUP_BRUSHES = [OpbTheme.Green, OpbTheme.Blue, OpbTheme.Yellow, OpbTheme.Red];

export function renderMixer(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const now = input.nowMs / 1000;

  label(ctx, 'MIXER', (input.left + input.right) / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  for (let g = 0; g < 4; g++) {
    handle(ctx, GROUP_X[g], TitleY + 2, GROUP_BRUSHES[g], 22);
    const gl = groupLevel(session, g);
    label(ctx, GROUP_NAMES[g], GROUP_X[g] + 41, 24, 26, OpbTheme.Mid, 'left');
    label(ctx, `${percent(gl)}`, GROUP_X[g] + 41, 56, 36, OpbTheme.Ink, 'left', 'normal');
  }

  for (let t = 0; t < 8; t++) {
    const x = X0 + t * ColW, cx = x + ColW / 2;
    const muted = isMuted(session, t);
    if (muted) hatch(ctx, { x, y: FaderTop, w: ColW, h: input.bottom - FaderTop }, OpbTheme.Rule, OpbTheme.Background);
    drawGlyph(ctx, t, x + 17, (Row0 + IconRow) / 2);

    const level = session.hasMixer ? session.mixer.levels[t] : session.currentSound[t][12];
    label(ctx, `${percent(level & 0xff)}`, cx, ValueY, 42, OpbTheme.Ink, 'center', 'normal');
    const y = FaderBottom - (level & 0xff) / 255 * (FaderBottom - FaderTop);
    const color = muted ? OpbTheme.Rule : t < 4 ? OpbTheme.Green : OpbTheme.Blue;
    ctx.strokeStyle = OpbTheme.Rule;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, FaderTop);
    ctx.lineTo(cx, FaderBottom);
    ctx.stroke();
    if (!muted) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, FaderBottom);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.fillRect(cx - BarW / 2, y - BarH / 2, BarW, BarH);

    const center = [cx, MeterY];
    // Circular clip for the hatch meter background.
    ctx.save();
    ctx.beginPath();
    ctx.arc(center[0], center[1], MeterR, 0, Math.PI * 2);
    ctx.clip();
    hatch(ctx, { x: center[0] - MeterR, y: center[1] - MeterR, w: MeterR * 2, h: MeterR * 2 }, OpbTheme.Rule, OpbTheme.Background);
    ctx.restore();

    const at = input.meterAt[t];
    const k = Math.max(0, Math.min(1, 1 - (now - at) / PULSE_SECONDS));
    const amp = 0.4 + 0.6 * input.meterVel[t];
    if (k > 0) {
      const ring = 12 + (MeterR - 12) * amp * (1 - k * k);
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = OpbTheme.White;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(center[0], center[1], ring, ring, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const dot = 10 + 14 * k * k * amp;
    ctx.fillStyle = OpbTheme.White;
    ctx.beginPath();
    ctx.ellipse(center[0], center[1], dot, dot, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  hLine(ctx, input.left, input.right, Row0);
  hLine(ctx, input.left, input.right, IconRow);
  hLine(ctx, input.left, input.right, FaderBottom);
  for (let i = 0; i <= 8; i++) vLine(ctx, X0 + i * ColW, Row0, input.bottom);
}

function groupLevel(session: OpzSession, g: number): number {
  if (!session.global) return 0;
  return [session.global.drumLevel, session.global.synthLevel, session.global.punchLevel, session.global.masterLevel][g] & 0xff;
}

function isMuted(session: OpzSession, t: number): boolean {
  if (session.hasMixer) return (session.mixer.muteMask & (1 << t)) !== 0;
  return session.bank ? session.bank.isMuted(session.activePattern, t) : false;
}

/** The small track icons of the official mixer header. */
function drawGlyph(ctx: CanvasRenderingContext2D, track: number, x: number, y: number): void {
  ctx.strokeStyle = OpbTheme.Mid;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'butt';
  switch (track) {
    case 0:
      ctx.beginPath();
      ctx.ellipse(x + 14, y - 3, 13, 13, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.ellipse(x + 14, y - 5, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 2);
      ctx.lineTo(x + 14, y + 16);
      ctx.stroke();
      break;
    case 1:
      ctx.strokeRect(x + 1, y - 11, 26, 10);
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 1);
      ctx.lineTo(x + 14, y + 15);
      ctx.stroke();
      break;
    case 2:
      ctx.beginPath();
      ctx.moveTo(x, y - 1);
      ctx.lineTo(x + 28, y - 1);
      ctx.stroke();
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x + 14, y - 12);
      ctx.lineTo(x + 23, y - 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 14);
      ctx.lineTo(x + 14, y + 15);
      ctx.stroke();
      break;
    case 3: {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8, y);
      const h = [16, 26, 12, 20];
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(x + 11 + i * 5, y - h[i] / 2);
        ctx.lineTo(x + 11 + i * 5, y + h[i] / 2);
      }
      ctx.moveTo(x + 29, y);
      ctx.lineTo(x + 37, y);
      ctx.stroke();
      break;
    }
    case 4: label(ctx, 'B', x + 2, y, 36, OpbTheme.Mid, 'left'); break;
    case 5:
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.ellipse(x + 7, y + 10, 6.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 9);
      ctx.lineTo(x + 12, y - 14);
      ctx.stroke();
      break;
    case 6:
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.ellipse(x + 14, y - 7, 5.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 5, y + 6, 5.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 23, y + 6, 5.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: label(ctx, 'CH', x + 2, y, 36, OpbTheme.Mid, 'left'); break;
  }
}
