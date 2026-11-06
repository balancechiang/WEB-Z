/**
 * Stage 7: gamepad navigation for SteamOS Gaming Mode, where there is no keyboard.
 *
 * This module is deliberately pure and DOM-free: `planGamepadActions(prev, cur)` is an
 * edge-triggered diff of two snapshots, so every mapping can be tested in Node.
 * `GamepadNavigator` only adds polling + a deep copy (Gamepad objects are LIVE and mutate
 * between frames — storing a reference would make edge detection useless).
 *
 * SAFETY: there is intentionally NO gamepad binding for ARM / COMMIT / ROLLBACK / STAGE EDIT.
 * Stage 6 device writes must stay behind a keyboard+mouse, two explicit gates and a native
 * confirmation dialog; an accidental bumper press on a Deck must never send SysEx.
 */
export type GamepadAction =
  | 'next-screen'
  | 'prev-screen'
  | 'toggle-auto'
  | 'toggle-play'
  | 'timeline-play'
  | 'timeline-step-back'
  | 'timeline-step-forward'
  | 'toggle-loop'
  | 'toggle-write-editor';

/** Exported so a regression test can prove no device-mutating action ever appears here. */
export const GAMEPAD_ACTIONS: readonly GamepadAction[] = [
  'next-screen', 'prev-screen', 'toggle-auto', 'toggle-play',
  'timeline-play', 'timeline-step-back', 'timeline-step-forward',
  'toggle-loop', 'toggle-write-editor',
];

/** Standard Gamepad API button indices. */
export const GAMEPAD_BUTTON = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  GUIDE: 16,
} as const;

/** Button → action. Multiple buttons may map to the same action. */
export const GAMEPAD_BINDINGS: Readonly<Record<number, GamepadAction>> = {
  [GAMEPAD_BUTTON.DPAD_RIGHT]: 'next-screen',
  [GAMEPAD_BUTTON.RB]: 'next-screen',
  [GAMEPAD_BUTTON.DPAD_LEFT]: 'prev-screen',
  [GAMEPAD_BUTTON.LB]: 'prev-screen',
  [GAMEPAD_BUTTON.A]: 'toggle-play',
  [GAMEPAD_BUTTON.B]: 'toggle-auto',
  [GAMEPAD_BUTTON.X]: 'timeline-play',
  [GAMEPAD_BUTTON.Y]: 'toggle-loop',
  [GAMEPAD_BUTTON.LT]: 'timeline-step-back',
  [GAMEPAD_BUTTON.RT]: 'timeline-step-forward',
  // 'toggle-write-editor' only OPENS/CLOSES the default DRY RUN editor. It can never arm it.
  [GAMEPAD_BUTTON.START]: 'toggle-write-editor',
};

export const DEFAULT_DEADZONE = 0.65;
export const STICK_X_AXIS = 0;

export interface PadButtonLike { readonly pressed: boolean }
export interface PadLike {
  readonly id?: string;
  readonly connected?: boolean;
  readonly buttons: readonly PadButtonLike[];
  readonly axes: readonly number[];
}

/** An immutable copy of a Gamepad's relevant state. */
export interface PadSnapshot {
  readonly id: string;
  readonly connected: boolean;
  readonly pressed: readonly boolean[];
  readonly axes: readonly number[];
}

export function copyPad(pad: PadLike | null | undefined): PadSnapshot | null {
  if (!pad || pad.connected === false) return null;
  return {
    id: pad.id ?? 'gamepad',
    connected: true,
    pressed: Array.from(pad.buttons ?? [], (b) => Boolean(b?.pressed)),
    axes: Array.from(pad.axes ?? [], (a) => Number(a) || 0),
  };
}

function axisDirection(pad: PadSnapshot | null, deadzone: number): -1 | 0 | 1 {
  const value = pad?.axes[STICK_X_AXIS] ?? 0;
  if (value > deadzone) return 1;
  if (value < -deadzone) return -1;
  return 0;
}

/**
 * Edge-triggered diff. A button held across polls fires ONCE; the left stick must return to
 * the deadzone before it can fire again. `prev === null` (controller just appeared) returns
 * no actions so buttons held by Steam Input at connect time cannot cause a phantom jump.
 */
export function planGamepadActions(
  prev: PadSnapshot | null,
  cur: PadSnapshot | null,
  deadzone: number = DEFAULT_DEADZONE,
): GamepadAction[] {
  if (!cur || !cur.connected) return [];
  if (!prev || prev.id !== cur.id) return [];

  const actions: GamepadAction[] = [];
  for (const [indexText, action] of Object.entries(GAMEPAD_BINDINGS)) {
    const i = Number(indexText);
    if (cur.pressed[i] && !prev.pressed[i]) actions.push(action);
  }

  const before = axisDirection(prev, deadzone);
  const after = axisDirection(cur, deadzone);
  if (after !== 0 && before === 0) {
    actions.push(after > 0 ? 'next-screen' : 'prev-screen');
  }
  return actions;
}

export interface GamepadNavigatorOptions {
  /** Injected so Node tests can feed deterministic pads. Defaults to navigator.getGamepads(). */
  getPads?: () => readonly (PadLike | null)[];
  onAction: (action: GamepadAction) => void;
  onStatus?: (connected: boolean, id: string | null) => void;
  deadzone?: number;
  enabled?: boolean;
}

export class GamepadNavigator {
  private readonly getPads: () => readonly (PadLike | null)[];
  private readonly onAction: (action: GamepadAction) => void;
  private readonly onStatus: ((connected: boolean, id: string | null) => void) | null;
  private readonly deadzone: number;
  private prev: PadSnapshot | null = null;
  private lastConnected = false;
  enabled: boolean;

  constructor(options: GamepadNavigatorOptions) {
    this.getPads = options.getPads ?? defaultGetPads;
    this.onAction = options.onAction;
    this.onStatus = options.onStatus ?? null;
    this.deadzone = options.deadzone ?? DEFAULT_DEADZONE;
    this.enabled = options.enabled ?? true;
  }

  get connected(): boolean { return this.lastConnected; }

  /** Call once per animation frame. Returns the actions emitted this frame. */
  poll(): GamepadAction[] {
    if (!this.enabled) return [];
    let pads: readonly (PadLike | null)[] = [];
    try { pads = this.getPads() ?? []; } catch { pads = []; }
    const cur = copyPad(pads.find((p) => p && p.connected !== false) ?? null);
    if (!cur) {
      if (this.lastConnected) {
        this.lastConnected = false;
        this.onStatus?.(false, null);
      }
      this.prev = null;
      return [];
    }
    if (!this.lastConnected || this.prev?.id !== cur.id) {
      this.lastConnected = true;
      this.onStatus?.(true, cur.id);
    }
    const actions = planGamepadActions(this.prev, cur, this.deadzone);
    this.prev = cur;
    for (const action of actions) this.onAction(action);
    return actions;
  }

  /** Forget held buttons (call after a transport switch or a focus change). */
  reset(): void { this.prev = null; }
}

function defaultGetPads(): readonly (PadLike | null)[] {
  const nav = globalThis.navigator as (Navigator & {
    getGamepads?: () => readonly (PadLike | null)[];
  }) | undefined;
  if (typeof nav?.getGamepads !== 'function') return [];
  return Array.from(nav.getGamepads());
}

/** Human-readable hint shown in the shell; keeps the UI honest about what a pad can do. */
export function gamepadHint(): string {
  return 'PAD · D-pad/LB/RB screens · A play · B AUTO · X timeline · Y loop · LT/RT step · Start write editor (DRY RUN only)';
}
