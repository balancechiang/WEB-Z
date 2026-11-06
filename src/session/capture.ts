/**
 * Parses a captured SysEx log into frames. The format is shared by the browser
 * probe export and the C# `--replay` input: one frame per line as hex, with
 * optional `#` comments and an optional `NN: HEX` prefix.
 */
export function parseCapture(text: string): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const comment = line.indexOf('#');
    if (comment >= 0) line = line.slice(0, comment).trim();
    const colon = line.indexOf(':');
    if (colon >= 0 && colon < 4) line = line.slice(colon + 1).trim();
    if (!/^[0-9A-Fa-f]+$/.test(line)) continue;
    const bytes = Uint8Array.from(line.match(/../g)!.map((x) => parseInt(x, 16)));
    frames.push(bytes);
  }
  return frames;
}
