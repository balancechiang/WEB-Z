/**
 * Photomatic screen — OPB.App/Screens/PhotomaticScreen.cs → Canvas 2D.
 * The original Avalonia port defers this screen (it needs the Windows video subsystem, which has no
 * Linux equivalent). We keep it as a registered screen so navigation stays consistent, mirroring the
 * original's placeholder paragraph.
 */
import type { ScreenInput } from './index.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, wrapText } from '../draw.ts';

export function renderPhotomatic(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  label(ctx, 'PHOTOMATIC', input.right / 2, 120, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, 82);
  const text =
    'THE PHOTOMATIC SCREEN IS NOT PART OF THIS LINUX USB-MIDI MVP YET. IT NEEDS THE WINDOWS VIDEO SUBSYSTEM, ' +
    'WHICH HAS NO LINUX COUNTERPART. CONNECT A USB OP-Z TO USE EVERYTHING ELSE.';
  const lines = wrapText(ctx, text, input.right - input.left - 80, 26);
  let y = 180;
  for (const line of lines) {
    label(ctx, line, input.left + 40, y, 26, OpbTheme.Mid);
    y += 36;
  }
}
