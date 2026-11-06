/**
 * Tempo screen — OPB.App/Screens/TempoScreen.cs → Canvas 2D.
 * A metronome whose pendulum swings with the beat and whose weight slides with the BPM.
 * Swing and metronome settings appear in the header.
 */
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, handle } from '../draw.ts';
import { percent, METRONOME_SOUNDS } from '../displays.ts';
import type { ScreenInput } from './index.ts';

const TitleY = 40, Row0 = 82, TopY = 139, BaseY = 564, BottomY = 758, TopHalf = 41, BottomHalf = 195;
const PivotX = 800, RodLength = 400, MaxSwing = 30, BpmY = 661;

export function renderTempo(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const tempo = session.global ? session.global.tempo : 120;
  const playing = input.playing;

  label(ctx, 'TEMPO', PivotX, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  drawReadouts(ctx, session, tempo);
  hLine(ctx, input.left, input.right, Row0);

  // Metronome body (trapezoid).
  ctx.fillStyle = OpbTheme.Ink;
  ctx.beginPath();
  ctx.moveTo(PivotX - TopHalf, TopY);
  ctx.lineTo(PivotX + TopHalf, TopY);
  ctx.lineTo(PivotX + BottomHalf, BottomY);
  ctx.lineTo(PivotX - BottomHalf, BottomY);
  ctx.closePath();
  ctx.fill();
  const light = OpbTheme.Background;
  const half = TopHalf + (BaseY - TopY) / (BottomY - TopY) * (BottomHalf - TopHalf);
  ctx.strokeStyle = light;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PivotX, TopY);
  ctx.lineTo(PivotX, BaseY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(PivotX - half, BaseY);
  ctx.lineTo(PivotX + half, BaseY);
  ctx.stroke();
  label(ctx, tempo.toString(), PivotX, BpmY, 64, light, 'center', 'normal');

  // Pendulum: one beat per side, at the extremes on the beat.
  const beats = input.beats;
  const angle = playing ? -MaxSwing * Math.cos(Math.PI * beats) : -MaxSwing;
  const pivot = [PivotX, BaseY];
  ctx.save();
  ctx.translate(pivot[0], pivot[1]);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-pivot[0], -pivot[1]);
  ctx.fillStyle = OpbTheme.Red;
  ctx.fillRect(PivotX - 5, BaseY - RodLength, 10, RodLength);
  const weightY = BaseY - weightDistance(tempo);
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(PivotX - 33, weightY - 22);
  ctx.lineTo(PivotX + 33, weightY - 22);
  ctx.lineTo(PivotX + 24, weightY + 22);
  ctx.lineTo(PivotX - 24, weightY + 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = OpbTheme.Ink;
  ctx.beginPath(); ctx.ellipse(PivotX - 18, weightY - 4, 3, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(PivotX + 18, weightY - 4, 3, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = OpbTheme.Ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PivotX - 4, weightY - 10);
  ctx.lineTo(PivotX - 4, weightY + 6);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PivotX + 4, weightY - 14);
  ctx.lineTo(PivotX + 4, weightY + 2);
  ctx.stroke();
  ctx.restore();

}

/** Distance of the sliding weight from the pivot: higher tempo, lower weight. */
function weightDistance(bpm: number): number {
  return 340 - (Math.max(40, Math.min(200, bpm)) - 40) / 160 * 250;
}

function drawReadouts(ctx: CanvasRenderingContext2D, session: OpzSession, tempo: number): void {
  const g = session.global;
  const swing = g ? `${Math.round(g.swing * 100 / 255)}%` : '-';
  const level = g ? (g.metronomeLevel === 0 ? 'OFF' : `${percent(g.metronomeLevel)}`) : '-';
  const sound = g ? METRONOME_SOUNDS[Math.min(g.metronomeSound, METRONOME_SOUNDS.length - 1)] : '-';
  const readouts = [
    { x: 129, title: 'BPM', value: tempo.toString(), color: OpbTheme.Green },
    { x: 389, title: 'SWING', value: swing, color: OpbTheme.Blue },
    { x: 1000, title: 'CLICK LEVEL', value: level, color: OpbTheme.Yellow },
    { x: 1285, title: 'CLICK SOUND', value: sound, color: OpbTheme.Red },
  ];
  for (const { x, title, value, color } of readouts) {
    handle(ctx, x, TitleY + 2, color, 22);
    label(ctx, title, x + 41, 24, 26, OpbTheme.Mid);
    label(ctx, value, x + 41, 56, 36, OpbTheme.Ink, 'left', 'normal');
  }
}
