/**
 * Stage 5 — SysEx timeline replay + recording for the OP-B Web edition.
 *
 * A timeline is an ordered list of SysEx frames with millisecond offsets. The text
 * format stays compatible with `./OP-B --replay` and tools/webmidi-probe.html:
 * one frame per line as hex, with timing hidden in an inline `# t=<ms>` comment.
 * Both FrameReplay.cs (C#) and src/session/capture.ts strip everything after '#',
 * so a recorded timeline can be replayed by the Avalonia build unchanged.
 *
 * All clocks are injected, so Recorder / TimelinePlayer are deterministic and can
 * be unit tested in Node without a browser or a real OP-Z.
 */
export interface TimedFrame {
  data: Uint8Array;
  /** Offset from the start of the capture, in milliseconds. */
  tMs: number;
}

export interface TimelineCapture {
  frames: TimedFrame[];
  source: string;
}

/** Spacing used when a capture has no timing comments (e.g. the original 31-frame probe log). */
export const DEFAULT_FRAME_GAP_MS = 120;
/** Pause after the last frame so the final state stays visible before a loop restarts. */
export const TAIL_MS = 400;

export function hexOf(data: Uint8Array): string {
  let out = '';
  for (const b of data) out += b.toString(16).padStart(2, '0').toUpperCase();
  return out;
}

/** Short human label for a frame, used by the timeline UI and JSON export. */
export function frameIdLabel(data: Uint8Array): string {
  if (data.length < 6 || data[0] !== 0xf0) return '--';
  if (data[1] === 0x7e) return 'ID';
  return `$${data[5].toString(16).padStart(2, '0')}`;
}

export function byteCount(frames: readonly TimedFrame[]): number {
  return frames.reduce((n, f) => n + f.data.length, 0);
}

export function durationMs(frames: readonly TimedFrame[]): number {
  return frames.length ? frames[frames.length - 1].tMs + TAIL_MS : 0;
}

/**
 * Parses either the classic hex-only capture or a Stage 5 capture with `# t=<ms>`
 * comments. Frames without an explicit timestamp are spread evenly (or continue
 * from the previous frame) so older captures become a watchable timeline.
 */
export function parseTimedCapture(text: string, source = 'capture'): TimelineCapture {
  const frames: TimedFrame[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let comment = '';
    const hash = line.indexOf('#');
    if (hash >= 0) {
      comment = line.slice(hash + 1);
      line = line.slice(0, hash).trim();
    }
    const colon = line.indexOf(':');
    if (colon >= 0 && colon < 4) line = line.slice(colon + 1).trim();
    if (!line || line.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(line)) continue;
    const data = Uint8Array.from(line.match(/../g)!.map((h) => parseInt(h, 16)));
    const match = /(?:^|\s)t=(\d+)(?:\s|$)/.exec(comment);
    frames.push({ data, tMs: match ? Number(match[1]) : -1 });
  }

  const hasExplicit = frames.some((f) => f.tMs >= 0);
  let prev = -DEFAULT_FRAME_GAP_MS;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.tMs < 0) f.tMs = hasExplicit ? prev + DEFAULT_FRAME_GAP_MS : i * DEFAULT_FRAME_GAP_MS;
    if (f.tMs < prev) f.tMs = prev; // keep the timeline monotone even if a comment is out of order
    prev = f.tMs;
  }
  return { frames, source };
}

function safeSource(source: string): string {
  return source.replace(/[\r\n#]/g, ' ').slice(0, 120);
}

/** Text that `./OP-B --replay <file>` and parseCapture() both accept verbatim. */
export function toReplayText(capture: TimelineCapture): string {
  const { frames } = capture;
  const header = [
    '# OP-B Web SysEx timeline capture; one frame per line as hex.',
    '# Compatible with: ./OP-B --replay <this file>',
    `# source: ${safeSource(capture.source)}`,
    `# ${frames.length} frames, ${byteCount(frames)} bytes, ${durationMs(frames)} ms`,
    '# The inline "# t=<ms>" comment carries replay timing; --replay ignores it.',
  ];
  const lines = frames.map((f) => `${hexOf(f.data)} # t=${Math.round(f.tMs)}`);
  return header.concat(lines).join('\n') + '\n';
}

export interface TimelineJson {
  format: 'opb-web-timeline/1';
  source: string;
  frameCount: number;
  byteCount: number;
  durationMs: number;
  frames: { tMs: number; id: string; hex: string }[];
}

/** Structured export: same frames, plus ids and timing, for diffing or tooling. */
export function toTimelineJson(capture: TimelineCapture): TimelineJson {
  const { frames } = capture;
  return {
    format: 'opb-web-timeline/1',
    source: capture.source,
    frameCount: frames.length,
    byteCount: byteCount(frames),
    durationMs: durationMs(frames),
    frames: frames.map((f) => ({
      tMs: Math.round(f.tMs),
      id: frameIdLabel(f.data),
      hex: hexOf(f.data),
    })),
  };
}

/** Returns null when the text is not a Stage 5 JSON timeline. */
export function parseTimelineJson(text: string, source = 'json'): TimelineCapture | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== 'opb-web-timeline/1' || !Array.isArray(obj.frames)) return null;
  const frames: TimedFrame[] = [];
  for (const entry of obj.frames) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const hex = typeof row.hex === 'string' ? row.hex.replace(/[^0-9A-Fa-f]/g, '') : '';
    if (!hex || hex.length % 2 !== 0) continue;
    const t = typeof row.tMs === 'number' && Number.isFinite(row.tMs) ? row.tMs : -1;
    frames.push({
      data: Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))),
      tMs: t >= 0 ? Math.round(t) : -1,
    });
  }
  let prev = -DEFAULT_FRAME_GAP_MS;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].tMs < 0) frames[i].tMs = i * DEFAULT_FRAME_GAP_MS;
    if (frames[i].tMs < prev) frames[i].tMs = prev;
    prev = frames[i].tMs;
  }
  return { frames, source: typeof obj.source === 'string' ? obj.source : source };
}

/** Accepts either the JSON timeline or the plain hex capture. */
export function loadTimelineText(text: string, source = 'import'): TimelineCapture {
  return parseTimelineJson(text, source) ?? parseTimedCapture(text, source);
}

/** Captures live SysEx frames with their arrival offsets. Clock is injected for tests. */
export class Recorder {
  private readonly clock: () => number;
  private frames: TimedFrame[] = [];
  private startedAt = 0;
  recording = false;

  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
  }

  start(): void {
    this.frames = [];
    this.startedAt = this.clock();
    this.recording = true;
  }

  record(data: Uint8Array): void {
    if (!this.recording) return;
    this.frames.push({
      data: Uint8Array.from(data),
      tMs: Math.max(0, Math.round(this.clock() - this.startedAt)),
    });
  }

  stop(): TimedFrame[] {
    this.recording = false;
    return this.frames.slice();
  }

  get count(): number { return this.frames.length; }
  get elapsedMs(): number {
    return this.recording ? Math.max(0, Math.round(this.clock() - this.startedAt)) : 0;
  }
}

export interface PlayerState {
  playing: boolean;
  /** Number of frames already injected into the session. */
  cursor: number;
  positionMs: number;
  durationMs: number;
  speed: number;
  loop: boolean;
  frameCount: number;
}

export interface PlayerOptions {
  frames: TimedFrame[];
  /** Inject one frame into the current session (async: zlib payloads). */
  inject: (data: Uint8Array) => Promise<void>;
  /**
   * Rebuild the session from scratch and inject frames [0, upTo). Needed for
   * seeking backwards — the state machine can only move forward.
   */
  rebuild: (upTo: number) => Promise<void>;
  clock?: () => number;
  onUpdate?: (state: PlayerState) => void;
  onEnd?: () => void;
}

/**
 * Drives a session from a frame timeline. Call tick() from the render loop; it
 * injects every frame whose tMs has passed, serially, without blocking rAF.
 */
export class TimelinePlayer {
  private readonly frames: TimedFrame[];
  private readonly inject: PlayerOptions['inject'];
  private readonly rebuild: PlayerOptions['rebuild'];
  private readonly clock: () => number;
  private readonly onUpdate: PlayerOptions['onUpdate'];
  private readonly onEnd: PlayerOptions['onEnd'];

  private playingFlag = false;
  private cursorIndex = 0;
  private baseMs = 0;
  private startedAt = 0;
  private speedValue = 1;
  private loopFlag = false;
  private pumping = false;
  /** Invalidates in-flight async injections when a seek rebuilds the session. */
  private token = 0;

  constructor(options: PlayerOptions) {
    this.frames = options.frames.slice();
    this.inject = options.inject;
    this.rebuild = options.rebuild;
    this.clock = options.clock ?? (() => performance.now());
    this.onUpdate = options.onUpdate;
    this.onEnd = options.onEnd;
  }

  get durationMs(): number { return durationMs(this.frames); }
  get cursor(): number { return this.cursorIndex; }
  get playing(): boolean { return this.playingFlag; }
  get loop(): boolean { return this.loopFlag; }
  get speed(): number { return this.speedValue; }

  get state(): PlayerState {
    return {
      playing: this.playingFlag,
      cursor: this.cursorIndex,
      positionMs: this.positionMs(),
      durationMs: this.durationMs,
      speed: this.speedValue,
      loop: this.loopFlag,
      frameCount: this.frames.length,
    };
  }

  positionMs(): number {
    if (!this.playingFlag) return Math.min(this.baseMs, this.durationMs);
    const elapsed = Math.max(0, this.clock() - this.startedAt) * this.speedValue;
    return Math.min(this.durationMs, this.baseMs + elapsed);
  }

  play(): void {
    if (this.playingFlag || !this.frames.length) return;
    // At the end the caller must seek(0) first (see replay() in main.ts).
    if (this.cursorIndex >= this.frames.length) return;
    this.playingFlag = true;
    this.baseMs = this.frames[this.cursorIndex].tMs;
    this.startedAt = this.clock();
    this.notify();
  }

  pause(): void {
    if (!this.playingFlag) return;
    this.baseMs = this.positionMs();
    this.playingFlag = false;
    this.notify();
  }

  setLoop(on: boolean): void {
    this.loopFlag = on;
    this.notify();
  }

  setSpeed(value: number): void {
    const position = this.positionMs();
    this.speedValue = Math.max(0.1, Math.min(8, value));
    this.baseMs = position;
    this.startedAt = this.clock();
    this.notify();
  }

  /** Rebuilds the session up to `index`, which is how seeking backwards works. */
  async seek(index: number): Promise<void> {
    const target = Math.max(0, Math.min(this.frames.length, Math.round(index)));
    this.playingFlag = false;
    this.token++;
    this.pumping = false;
    this.cursorIndex = target;
    this.baseMs = target < this.frames.length ? this.frames[target].tMs : this.durationMs;
    await this.rebuild(target);
    this.notify();
  }

  async step(delta: number): Promise<void> {
    await this.seek(this.cursorIndex + delta);
  }

  /** Called from the rAF loop. Never awaits; injections are serialized by `pumping`. */
  tick(): void {
    if (!this.playingFlag) return;
    const position = this.positionMs();

    if (!this.pumping) {
      const batch: TimedFrame[] = [];
      while (this.cursorIndex < this.frames.length && this.frames[this.cursorIndex].tMs <= position) {
        batch.push(this.frames[this.cursorIndex++]);
      }
      if (batch.length) void this.pump(batch, this.token);
    }

    if (position >= this.durationMs && !this.pumping) {
      this.playingFlag = false;
      this.baseMs = this.durationMs;
      if (this.loopFlag) {
        void this.seek(0).then(() => this.play());
      } else {
        this.notify();
        this.onEnd?.();
      }
    }
  }

  private async pump(batch: TimedFrame[], token: number): Promise<void> {
    this.pumping = true;
    try {
      for (const frame of batch) {
        if (token !== this.token) return; // a seek rebuilt the session; drop stale frames
        await this.inject(frame.data);
      }
    } finally {
      if (token === this.token) this.pumping = false;
      this.notify();
    }
  }

  private notify(): void { this.onUpdate?.(this.state); }
}
