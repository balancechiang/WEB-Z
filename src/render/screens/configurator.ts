/**
 * Configurator screen — OPB.App/Screens/ConfiguratorScreen.cs → Canvas 2D.
 * The original is an interactive plug/slot editor driven by the OP-Z file service (it pulls
 * settings/slotConfiguration.json + settings/plugs.json over USB and commits edits with a sync job).
 *
 * Stage 6 implements the file-service FRAME layer + a reversible transaction PLAN, so this screen
 * now has two states:
 *   - read-only (write == null): the same "OP-Z NOT CONNECTED" panel as stages 1-5;
 *   - editor (write present): the reserved file-ID / CRC evidence table plus a DRY-RUN plan
 *     overlay. Live push is deliberately NOT automatic: it needs arming + a second confirmation.
 */
import type { ScreenInput } from './index.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, hatch, wrapText, writeEditorOverlay } from '../draw.ts';

const TitleY = 40, Row0 = 82;
/**
 * Display-only copy of the reserved ID table. The authority is RESERVED_FILES in
 * src/write/crc32.ts; test/writeUi.test.ts asserts these stay in sync so the screen can
 * remain a pure renderer with no runtime dependency on the write layer.
 */
const FILE_IDS: readonly { path: string; id: number }[] = [
  { path: 'settings/slotconfiguration.json', id: 0 },
  { path: 'settings/plugs.json', id: 1 },
  { path: 'syncjob.json', id: 2 },
];

export function renderConfigurator(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  label(ctx, 'CONFIGURATOR', input.right / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, Row0);
  hatch(ctx, { x: input.left, y: Row0 + 1, w: input.right - input.left, h: input.bottom - Row0 - 1 }, OpbTheme.Rule, OpbTheme.Background);

  if (input.write) {
    drawFileServiceSheet(ctx, input);
    writeEditorOverlay(ctx, input.write, {
      subtitle: 'FILE SERVICE · $51/$34/$52/$35/$53/$33/$55 · <=200 B PER ZLIB PART',
      footnote: '$52 SYNC-ACTIVE=0 BEFORE FIRST $35 · ALL isLast PARTS BEFORE status 127 · PLAN ONLY, NO LIVE PUSH',
    });
    return;
  }

  const title = 'OP-Z NOT CONNECTED';
  const body = 'CONNECT THE OP-Z TO ASSIGN PLUGS TO ITS SLOTS. THE CONFIGURATOR READS AND WRITES THE PLUG SETTINGS STORED ON THE DEVICE. THIS WEB PORT DOES NOT YET IMPLEMENT THE OP-Z FILE SERVICE, SO USE THE OFFICIAL APP TO EDIT PLUG SLOTS.';
  const w = 900, textW = w - 96;
  const lines = wrapText(ctx, body, textW, 28);
  const h = 130 + lines.length * 38;
  const panel = { x: (input.right - w) / 2, y: Row0 + (input.bottom - Row0 - h) / 2, w, h };
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  let y = panel.y + 64;
  label(ctx, title, panel.x + 48, y, 44, OpbTheme.Ink, 'left', 'normal');
  y += 66;
  for (const line of lines) { label(ctx, line, panel.x + 48, y, 28, OpbTheme.Mid); y += 38; }
}

/** The device-proven file-ID rules shown behind the editor overlay. */
function drawFileServiceSheet(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const x = 80, w = 1440, top = 116;
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(x, top, w, 600);
  label(ctx, 'RESERVED FILE IDS', x + 36, top + 44, 30, OpbTheme.Mid);
  hLine(ctx, x + 36, x + w - 36, top + 66, OpbTheme.Rule, 2);
  for (let i = 0; i < FILE_IDS.length; i++) {
    const e = FILE_IDS[i];
    const y = top + 104 + i * 40;
    label(ctx, String(e.id), x + 44, y, 28, OpbTheme.Green, 'left', 'normal');
    label(ctx, e.path, x + 96, y, 26, OpbTheme.Ink);
  }
  const y0 = top + 104 + FILE_IDS.length * 40 + 24;
  label(ctx, 'OTHER PATHS', x + 36, y0, 30, OpbTheme.Mid);
  label(ctx, 'crc32(utf8(lowercase(relativePath)))', x + 96, y0 + 40, 26, OpbTheme.Ink);
  label(ctx, 'DEVICE-PROVEN CHECK', x + 36, y0 + 104, 30, OpbTheme.Mid);
  label(ctx, 'settings/slotconfiguration.json -> 2873598156 / 0xAB47A0CC', x + 96, y0 + 144, 26, OpbTheme.Blue);
  label(ctx, 'mixed case yields 4127267068 — ALWAYS LOWERCASE FIRST', x + 96, y0 + 180, 24, OpbTheme.Mid);
  label(ctx, 'SYNCJOB.JSON MANIFEST', x + 36, y0 + 244, 30, OpbTheme.Mid);
  label(ctx, 'fileId / path / crc / size · each $53 part is independently zlib-compressed',
    x + 96, y0 + 284, 24, OpbTheme.Ink);
  label(ctx, `DESIGN SPACE ${input.left}..${input.right} × ${input.top}..${input.bottom}`,
    x + 36, top + 566, 20, OpbTheme.Mid);
}
