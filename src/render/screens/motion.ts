/**
 * Motion page — the 'motion' route has no dedicated screen in the original Avalonia port
 * (AppPage.Motion falls back to a placeholder). We mirror that here with an on-theme placeholder
 * so navigation stays complete; the real Motion-track content lives in the MOTION TRACK screen.
 */
import type { ScreenInput } from './index.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine } from '../draw.ts';

export function renderMotion(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  label(ctx, 'MOTION', input.right / 2, 40, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, 82);
  label(ctx, '(screen not ported yet — the Motion track content', input.right / 2, 200, 30, OpbTheme.Mid, 'center');
  label(ctx, 'lives in the MOTION TRACK screen)', input.right / 2, 244, 30, OpbTheme.Mid, 'center');
  label(ctx, 'OPEN → MOTION TRACK to see the color / transition dials', input.right / 2, 320, 24, OpbTheme.Mid, 'center');
}
