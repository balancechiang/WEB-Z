/**
 * Offline driver: feed a captured SysEx log into an OpzSession and emit a JSON
 * state view. No hardware, browser or network required.
 *
 *   node tools/replay.ts <capture.txt> [-o sample/state.json] [--stdout]
 *
 * The capture format is the same as tools/captures/webmidi-20261105.txt and the
 * C# --replay input: one frame per line as hex, with optional `#` comments and an
 * optional `NN: HEX` prefix.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { OpzSession } from '../src/session/opzSession.ts';
import { toStateView } from '../src/session/stateView.ts';
import { parseCapture } from '../src/session/capture.ts';

interface Args {
  input: string;
  out?: string;
  stdout: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { input: '', stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '--stdout') args.stdout = true;
    else if (!args.input) args.input = a;
  }
  return args;
}

function summary(view: Record<string, unknown>): string {
  const device = view.device as Record<string, unknown>;
  const play = view.play as Record<string, unknown>;
  const global = view.global as Record<string, unknown> | null;
  const lines = [
    `frames        : ${view.receivedFrames}`,
    `messages      : ${Object.keys(view.messageCounts as object).length} distinct ids`,
    `parse errors  : ${(view.parseErrors as string[]).length}`,
    `connected     : ${(view.connection as Record<string, unknown>).isConnected}`,
    `device        : ${device.serial} / ${device.firmware} (fileService=${device.supportsFileService})`,
    `active track  : ${play.track} (${play.trackName}) playing=${play.playing}`,
    `tempo         : ${global ? global.tempo : 'n/a'}`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    process.stderr.write('usage: replay.ts <capture.txt> [-o out.json] [--stdout]\n');
    process.exit(2);
    return;
  }
  const text = await readFile(args.input, 'utf8');
  const frames = parseCapture(text);
  const session = new OpzSession();
  for (const f of frames) await session.injectSysex(f);

  const view = toStateView(session, { source: args.input, frames: frames.length });
  const json = JSON.stringify(view, null, 2);

  if (args.stdout || !args.out) process.stdout.write(json + '\n');
  if (args.out) {
    await writeFile(args.out, json + '\n', 'utf8');
    process.stderr.write(`wrote ${args.out}\n`);
  }
  process.stderr.write('\n' + summary(view) + '\n');
}

main().catch((e) => {
  process.stderr.write(`${String(e)}\n`);
  process.exit(1);
});
