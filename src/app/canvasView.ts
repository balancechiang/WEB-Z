/**
 * Canvas view: the runtime shell for the Stage 3 screens.
 *
 * It owns the HTML <canvas>, scales the fixed 1600 x 812 design space to fit (letterboxed),
 * runs a requestAnimationFrame loop that builds a ScreenInput each frame and asks the active
 * screen to paint, converts pointer events back into design coordinates, and turns OP-Z note
 * events into the meter pulses the Mixer screen shows. All screen *interaction* (selection,
 * dragging) is resolved here; the screen modules stay pure renderers.
 */
import type { OpzSession } from '../session/opzSession.ts';
import { OpbTheme, DESIGN_WIDTH, DESIGN_HEIGHT } from '../render/theme.ts';
import { writeStatusBadge } from '../render/draw.ts';
import {
  SCREENS, SCREEN_ORDER, routeFor, type ScreenName, type ScreenInput, type SelectedParam,
  type WriteUiState,
} from '../render/screens/index.ts';

/** Screens whose own renderer already draws the full Stage 6 overlay (incl. the badge). */
const WRITE_EDITOR_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>([
  'midisetup', 'steps', 'configurator',
]);

/** Uniform scale + offset (in CSS pixels) that maps design space into the canvas element. */
export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fits the 1600 x 812 design box inside a (cssW x cssH) element with uniform scale and
 * centered letterboxing. Pure and side-effect free so it can be unit tested directly.
 */
export function fitTransform(cssWidth: number, cssHeight: number): Transform {
  if (cssWidth <= 0 || cssHeight <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(cssWidth / DESIGN_WIDTH, cssHeight / DESIGN_HEIGHT);
  const offsetX = (cssWidth - DESIGN_WIDTH * scale) / 2;
  const offsetY = (cssHeight - DESIGN_HEIGHT * scale) / 2;
  return { scale, offsetX, offsetY };
}

export class CanvasView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private session: OpzSession;
  private screen: ScreenName = 'track';
  private transform: Transform = { scale: 1, offsetX: 0, offsetY: 0 };
  private raf = 0;
  private running = false;
  private dpr = 1;

  selected: SelectedParam | null = null;
  /** Stage 6: null keeps every screen in its read-only layout. Set by the write controller. */
  writeState: WriteUiState | null = null;
  /** When true, each frame follows routeFor(session), like the device's held buttons + active track. */
  autoRoute = false;
  onScreenChange: ((name: ScreenName) => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;
  onAutoRouteChange: ((on: boolean) => void) | null = null;
  /** Stage 5: called once per rAF frame so the SysEx timeline can advance. */
  onTick: ((nowMs: number) => void) | null = null;

  // Animation clock.
  private playAccumMs = 0;
  private playStartMs = 0;
  private fakePlaying = false;
  private lastFrameMs = 0;

  // Meter pulses: seconds-since-last-note and 0..1 velocity per track (0..7).
  private meterAt: number[] = new Array(8).fill(-10);
  private meterVel: number[] = new Array(8).fill(0);

  // Last pointer position in design coordinates (for hover/hit-testing).
  pointer = { x: -1, y: -1, inside: false };

  constructor(canvas: HTMLCanvasElement, session: OpzSession) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.session = session;
    session.onNote = (track, _note, velocity) => {
      if (track >= 0 && track < 8) {
        this.meterAt[track] = performance.now() / 1000;
        this.meterVel[track] = Math.max(0, Math.min(1, velocity / 127));
      }
    };
  }

  get currentScreen(): ScreenName { return this.screen; }
  isPlaying(): boolean {
    return this.session.clockRunning || this.session.play.playing || this.fakePlaying;
  }

  setScreen(name: ScreenName): void {
    if (name === this.screen) return;
    this.screen = name;
    this.onScreenChange?.(name);
  }
  /** Manual navigation turns auto-route off so a click sticks (mirrors the device). */
  navigateTo(name: ScreenName): void {
    this.setAutoRoute(false);
    this.setScreen(name);
  }
  setAutoRoute(on: boolean): void {
    if (this.autoRoute === on) return;
    this.autoRoute = on;
    this.onAutoRouteChange?.(on);
    if (on) this.setScreen(routeFor(this.session));
  }
  /** Re-evaluate the device-following route (called each frame while autoRoute is on). */
  followRoute(): void {
    this.setScreen(routeFor(this.session));
  }
  nextScreen(): void {
    this.setAutoRoute(false);
    const i = SCREEN_ORDER.indexOf(this.screen);
    this.setScreen(SCREEN_ORDER[(i + 1) % SCREEN_ORDER.length]);
  }
  prevScreen(): void {
    this.setAutoRoute(false);
    const i = SCREEN_ORDER.indexOf(this.screen);
    this.setScreen(SCREEN_ORDER[(i - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length]);
  }

  togglePlay(): void {
    if (this.session.transport) {
      if (this.isPlaying()) this.session.transportStop();
      else this.session.transportStart();
    } else {
      this.fakePlaying = !this.fakePlaying;
      if (this.fakePlaying) this.playStartMs = performance.now() - this.playAccumMs;
      else this.playAccumMs = performance.now() - this.playStartMs;
    }
    this.onPlayingChange?.(this.isPlaying());
  }

  // ---- DOM wiring ----

  start(): void {
    if (this.running) return;
    this.running = true;
    this.measure();
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.lastFrameMs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
  }

  resize = (): void => this.measure();
  private onResize = this.resize;
  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.transform = fitTransform(rect.width, rect.height);
  }

  private toDesign(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.transform.offsetX) / this.transform.scale;
    const y = (clientY - rect.top - this.transform.offsetY) / this.transform.scale;
    return { x, y };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.toDesign(e.clientX, e.clientY);
    this.pointer = { x: p.x, y: p.y, inside: true };
  };
  private onPointerLeave = (): void => {
    this.pointer = { x: -1, y: -1, inside: false };
  };
  private onPointerDown = (e: PointerEvent): void => {
    const p = this.toDesign(e.clientX, e.clientY);
    this.pointer = { x: p.x, y: p.y, inside: true };
    this.handleClick(p.x, p.y);
  };

  /**
   * Minimal hit-testing so the demo is interactive without magic key combos.
   * - Track screen: clicking a knob/fader cell selects that (track, param).
   * - Mixer screen: clicking a column toggles that track's mute.
   * Clicking empty space clears the selection.
   */
  private handleClick(x: number, y: number): void {
    // Any direct interaction takes manual control, like touching the device's screen.
    if (this.screen === 'mixer') {
      const X0 = 107, ColW = 173.5;
      if (y > 214 && y < 726 && x >= X0 && x <= X0 + 8 * ColW) {
        const t = Math.floor((x - X0) / ColW);
        if (t >= 0 && t < 8) this.session.setTrackMute(t, !this.isMixerMuted(t));
      }
      return;
    }
    if (this.screen === 'track') {
      const track = this.session.play.track;
      const sel = this.trackHitTest(x, y, track);
      this.selected = sel;
      return;
    }
    // Tempo: clicking the body toggles play, like tapping the metronome.
    if (this.screen === 'tempo') this.togglePlay();
  }

  private isMixerMuted(t: number): boolean {
    return this.session.hasMixer
      ? (this.session.mixer.muteMask & (1 << t)) !== 0
      : (this.session.bank?.isMuted(this.session.activePattern, t) ?? false);
  }

  private trackHitTest(x: number, y: number, track: number): SelectedParam | null {
    const ColLabel = 216, ColW = 130, FxRight = 952, RightEnd = 1426;
    const Row0 = 82, Row1 = 212, Row3 = 472, Row4 = 602;
    const cell = (cx: number, cy0: number, cy1: number, p: number): SelectedParam | null => {
      if (x >= cx && x <= cx + ColW && y >= cy0 && y <= cy1) return { track, param: p };
      return null;
    };
    const SOUND = [0, 1, 9, 10];
    const LFO = [13, 14, 15, 16];
    const SETTINGS = [17, 6]; // note style + portamento/dry level share the 4th column rows
    for (let i = 0; i < 4; i++) {
      const cx = ColLabel + i * ColW;
      let hit = cell(cx, Row0, Row1, SOUND[i]);
      if (!hit && this.session.ui.page === 2) hit = cell(cx, Row3, Row4, LFO[i]);
      if (hit) return hit;
    }
    const fxHit = (cx: number, p: number) => cell(cx, Row0, Row1, p);
    const s1 = fxHit(FxRight, 7);
    if (s1) return s1;
    const s2 = fxHit(FxRight + ColW, 8);
    if (s2) return s2;
    const ns = cell(RightEnd + 18, Row0, Row1, 17);
    if (ns) return ns;
    return null;
  }

  // ---- render loop ----

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = now - this.lastFrameMs;
    this.lastFrameMs = now;

    const playing = this.isPlaying();
    if (playing) this.playAccumMs += dt;
    if (this.autoRoute) this.followRoute();
    this.onTick?.(now);

    const tempo = this.session.global ? this.session.global.tempo : 120;
    const beats = (this.playAccumMs / 1000 / 60) * tempo;
    const { scale, offsetX, offsetY } = this.transform;

    const input: ScreenInput = {
      session: this.session,
      left: -offsetX / scale,
      right: DESIGN_WIDTH + offsetX / scale,
      top: -offsetY / scale,
      bottom: DESIGN_HEIGHT + offsetY / scale,
      selected: this.selected,
      playing,
      nowMs: now,
      playMs: this.playAccumMs,
      beats,
      meterAt: this.meterAt,
      meterVel: this.meterVel,
      write: this.writeState,
    };

    this.paint(input);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Paints one frame; exposed for testing the render pipeline without rAF. */
  paint(input: ScreenInput): void {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = this.canvas.getBoundingClientRect();
    ctx.fillStyle = OpbTheme.Background;
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(this.transform.offsetX, this.transform.offsetY);
    ctx.scale(this.transform.scale, this.transform.scale);

    ctx.fillStyle = OpbTheme.Background;
    ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    SCREENS[this.screen].render(ctx, input);
    // Stage 6: on non-editor screens still show the DRY-RUN / ARMED chip so the safety state
    // is never hidden by navigating away from the three editable screens.
    if (input.write && !WRITE_EDITOR_SCREENS.has(this.screen)) {
      writeStatusBadge(ctx, input.write);
    }
    ctx.restore();
  }
}
