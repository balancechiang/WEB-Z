/**
 * Devices screen — OPB.App/Screens/DevicesScreen.cs → Canvas 2D.
 * The MIDI ports, the connected OP-Z (serial / firmware / battery / expansion module), a Bluetooth
 * not-available note, and the firmware/file-service compatibility box. Pure render port; the Web
 * edition has no OS-level port enumeration, so it shows the Web MIDI port name when one is open.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, vLine, frame, button, wrapText, fitText } from '../draw.ts';
import { supportsFileService, FILE_SERVICE_VERSION, DOWNLOAD_URL } from '../../model/firmware.ts';

const TitleY = 40, Row0 = 82, ListRight = 560, InfoX = 600, InfoW = 960, TableTop = 222, TableRow = 74;
const PortRows = 3;
const BluetoothTop = Row0 + 84 + PortRows * TableRow + 24;

export function renderDevices(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  label(ctx, 'DEVICES', input.right / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  hLine(ctx, input.left, input.right, Row0);
  vLine(ctx, ListRight, Row0, input.bottom);
  drawPorts(ctx, session);
  drawBluetooth(ctx, input);
  drawDevice(ctx, session, input);
}

function drawPorts(ctx: CanvasRenderingContext2D, session: OpzSession): void {
  label(ctx, 'MIDI PORTS', 24, Row0 + 42, 30, OpbTheme.Mid);
  hLine(ctx, 0, ListRight, Row0 + 84);
  let y = Row0 + 84;
  const port = session.portName;
  if (!port) {
    label(ctx, 'NO MIDI PORTS FOUND', 24, y + 40, 30, OpbTheme.Mid);
    return;
  }
  const name = port.toUpperCase();
  const opz = /OP-Z/i.test(port);
  const active = session.isConnected;
  ctx.fillStyle = active ? OpbTheme.Green : opz ? OpbTheme.Ink : OpbTheme.Rule;
  ctx.beginPath(); ctx.arc(40, y + 37, 9, 0, Math.PI * 2); ctx.fill();
  label(ctx, fitText(ctx, name, ListRight - 90, 30, opz ? 'normal' : 'light'), 66, y + 30, 30, opz ? OpbTheme.Ink : OpbTheme.Mid, 'left', opz ? 'normal' : 'light');
  label(ctx, active ? 'IN USE BY OP-B' : 'IN', 66, y + 58, 20, active ? OpbTheme.Green : OpbTheme.Mid);
  y += TableRow;
  hLine(ctx, 0, ListRight, y);
}

function drawBluetooth(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const top = BluetoothTop;
  hLine(ctx, input.left, ListRight, top);
  label(ctx, 'BLUETOOTH', 24, top + 42, 30, OpbTheme.Mid);
  label(ctx, 'NOT AVAILABLE', ListRight - 24, top + 42, 20, OpbTheme.Red, 'right');
  const text = 'BLUETOOTH LE-MIDI IS NOT PART OF THIS LINUX USB-MIDI BUILD. CONNECT THE OP-Z WITH A USB CABLE; OP-B USES IT AUTOMATICALLY WHEN PLUGGED IN.';
  let y = top + 84;
  for (const line of wrapText(ctx, text, ListRight - 48, 22)) {
    label(ctx, line, 24, y, 22, OpbTheme.Mid);
    y += 30;
  }
}

function drawDevice(ctx: CanvasRenderingContext2D, session: OpzSession, input: ScreenInput): void {
  const connected = session.isConnected;
  const device = session.device;
  const known = !!device.serial;
  const state = connected ? 'CONNECTED' : 'NOT CONNECTED';
  const stateColor = connected ? OpbTheme.Green : OpbTheme.Red;

  label(ctx, 'OP-Z', InfoX, Row0 + 66, 72, connected ? OpbTheme.Ink : OpbTheme.Mid, 'left', 'normal');
  const titleW = ctx.measureText('OP-Z').width; // approx; used only to place the status dot
  const dotX = InfoX + Math.max(120, titleW) + 36;
  ctx.fillStyle = stateColor;
  ctx.beginPath(); ctx.arc(dotX, Row0 + 70, 10, 0, Math.PI * 2); ctx.fill();
  label(ctx, state, dotX + 22, Row0 + 70, 32, stateColor, 'left', 'normal');

  const battery = connected ? `${session.level.battery} %` : '-';
  const port = (session.portName?.toUpperCase() ?? (connected ? 'OFFLINE PREVIEW' : '-'));
  const module = session.module.connected && session.module.name.trim() ? session.module.name.toUpperCase() : 'NONE';
  const sampler = !connected ? '-' : session.sampler.active ? `SAMPLING (${session.sampler.packProgress} %)` : 'IDLE';
  const left: [string, string][] = [['SERIAL', known ? device.serial : '-'], ['FIRMWARE', known ? device.firmware : '-'], ['MODULE', module]];
  const right: [string, string][] = [['BATTERY', battery], ['PORT', port], ['SAMPLER', sampler]];
  const colW = InfoW / 2;
  hLine(ctx, ListRight, input.right, TableTop);
  for (let i = 0; i < 3; i++) {
    const y = TableTop + i * TableRow;
    label(ctx, left[i][0], InfoX, y + TableRow / 2, 30, OpbTheme.Mid);
    label(ctx, fitText(ctx, left[i][1], colW - 220, 34, 'normal'), InfoX + 190, y + TableRow / 2, 34, OpbTheme.Ink, 'left', 'normal');
    label(ctx, right[i][0], InfoX + colW, y + TableRow / 2, 30, OpbTheme.Mid);
    label(ctx, fitText(ctx, right[i][1], colW - 170, 34, 'normal'), InfoX + colW + 150, y + TableRow / 2, 34, OpbTheme.Ink, 'left', 'normal');
    hLine(ctx, ListRight, input.right, y + TableRow);
  }
  vLine(ctx, InfoX + colW - 24, TableTop, TableTop + 3 * TableRow);

  const boxTop = TableTop + 3 * TableRow + 30;
  const box = { x: InfoX, y: boxTop, w: InfoW, h: 200 };
  const supported = known ? supportsFileService(device.firmware) : null;
  const fv = FILE_SERVICE_VERSION.join('.');
  if (supported === false) {
    frame(ctx, box, OpbTheme.Yellow, 4);
    label(ctx, 'FIRMWARE UPDATE NEEDED', box.x + 28, box.y + 40, 34, OpbTheme.Ink, 'left', 'normal');
    const text = `THIS OP-Z RUNS ${device.firmware}. THE CONFIGURATOR AND FILE TRANSFER NEED FIRMWARE ${fv} OR NEWER. EVERYTHING ELSE WORKS AS IT IS.`;
    let y = box.y + 86;
    for (const line of wrapText(ctx, text, box.w - 56, 26)) { label(ctx, line, box.x + 28, y, 26, OpbTheme.Mid); y += 32; }
    label(ctx, 'UPDATE AT ' + DOWNLOAD_URL.toUpperCase(), box.x + 28, box.y + 160, 28, OpbTheme.Ink, 'left', 'normal');
  } else if (supported === true) {
    frame(ctx, { x: box.x, y: box.y, w: box.w, h: 96 }, OpbTheme.Green, 4);
    label(ctx, 'FIRMWARE UP TO DATE', box.x + 28, box.y + 32, 30, OpbTheme.Green, 'left', 'normal');
    label(ctx, 'ALL FEATURES, INCLUDING THE CONFIGURATOR, ARE AVAILABLE', box.x + 28, box.y + 66, 24, OpbTheme.Mid);
  } else if (!connected) {
    const text = 'CONNECT THE OP-Z WITH A USB CABLE AND TURN IT ON. OP-B CONNECTS BY ITSELF AND PREFERS USB WHEN BOTH ARE THERE.';
    let y = boxTop + 24;
    for (const line of wrapText(ctx, text, InfoW, 28)) { label(ctx, line, InfoX, y, 28, OpbTheme.Mid); y += 34; }
  }

  const reconnect = { x: InfoX, y: input.bottom - 112, w: 300, h: 80 };
  button(ctx, reconnect, 'RECONNECT');
  const hint = connected ? 'CLOSES AND REOPENS THE MIDI PORT' : 'LOOKS FOR THE OP-Z AGAIN';
  label(ctx, fitText(ctx, hint, input.right - (reconnect.x + reconnect.w + 28) - 24, 24), reconnect.x + reconnect.w + 28, reconnect.y + reconnect.h / 2, 24, OpbTheme.Mid);
}
