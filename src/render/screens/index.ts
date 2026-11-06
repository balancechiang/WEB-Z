/**
 * Screen registry + the input contract every screen render function receives.
 *
 * All 16 OP-Z screens are pure rendering functions: given a CanvasRenderingContext2D and a
 * ScreenInput (the session plus the live animation/selection state the canvas view computes each
 * frame), they paint the 1600 x 812 design space. All hit-testing, input translation and the
 * animation clock live in the canvas view, not here.
 *
 * The route keys mirror OPB.App/Screens/ScreenRegistry.cs (ScreenKeys), so the Web edition and the
 * Avalonia/Linux edition expose the same screen set.
 */
import type { OpzSession } from '../../session/opzSession.ts';
import type { WriteUiState } from '../writeUi.ts';
export type { WriteUiState } from '../writeUi.ts';
import { renderTrack } from './track.ts';
import { renderMixer } from './mixer.ts';
import { renderTempo } from './tempo.ts';
import { renderProject } from './project.ts';
import { renderTape } from './tape.ts';
import { renderPerform } from './perform.ts';
import { renderMaster } from './master.ts';
import { renderModule } from './module.ts';
import { renderLights } from './lights.ts';
import { renderMotionTrack } from './motiontrack.ts';
import { renderSteps } from './steps.ts';
import { renderConfigurator } from './configurator.ts';
import { renderPhotomatic } from './photomatic.ts';
import { renderMotion } from './motion.ts';
import { renderMidiSetup } from './midisetup.ts';
import { renderDevices } from './devices.ts';

/** Which parameter (if any) is currently selected on a screen. */
export interface SelectedParam {
  track: number;
  param: number;
}

/**
 * Everything a screen needs beyond the raw session:
 * - the design-space bounds (normally 0,0 .. 1600,812)
 * - the animation clock (nowMs wall clock, playMs since transport start, beats)
 * - the live play flag
 * - per-track meter pulse state (seconds-since-note and 0..1 velocity)
 * - the selected parameter (or null)
 * - optional Stage 6 write-editor state (null keeps the read-only layout from stages 1-5)
 */
export interface ScreenInput {
  session: OpzSession;
  left: number;
  right: number;
  top: number;
  bottom: number;
  selected: SelectedParam | null;
  playing: boolean;
  nowMs: number;
  playMs: number;
  beats: number;
  meterAt: number[];
  meterVel: number[];
  write?: WriteUiState | null;
}

/** All 16 OP-Z screen route keys (ScreenKeys in ScreenRegistry.cs). */
export type ScreenName =
  | 'track' | 'mixer' | 'tempo'
  | 'project' | 'tape' | 'perform'
  | 'master' | 'module' | 'lights' | 'motiontrack'
  | 'steps' | 'configurator' | 'photomatic' | 'motion'
  | 'midisetup' | 'devices';

export interface ScreenModule {
  title: string;
  render: (ctx: CanvasRenderingContext2D, input: ScreenInput) => void;
}

export const SCREENS: Record<ScreenName, ScreenModule> = {
  track: { title: 'Track', render: renderTrack },
  mixer: { title: 'Mixer', render: renderMixer },
  tempo: { title: 'Tempo', render: renderTempo },
  project: { title: 'Project', render: renderProject },
  tape: { title: 'Tape', render: renderTape },
  perform: { title: 'Perform', render: renderPerform },
  master: { title: 'Master', render: renderMaster },
  module: { title: 'Module', render: renderModule },
  lights: { title: 'Lights', render: renderLights },
  motiontrack: { title: 'Motion Track', render: renderMotionTrack },
  steps: { title: 'Step Components', render: renderSteps },
  configurator: { title: 'Configurator', render: renderConfigurator },
  photomatic: { title: 'Photomatic', render: renderPhotomatic },
  motion: { title: 'Motion', render: renderMotion },
  midisetup: { title: 'MIDI Setup', render: renderMidiSetup },
  devices: { title: 'Devices', render: renderDevices },
};

/**
 * Stable ordering used by next/previous navigation. Grouped like the OP-Z: the three high-frequency
 * screens, then the pages, then the control tracks, then the utility/config screens.
 */
export const SCREEN_ORDER: ScreenName[] = [
  'track', 'mixer', 'tempo',
  'project', 'tape', 'perform',
  'master', 'module', 'lights', 'motiontrack',
  'steps', 'configurator', 'photomatic', 'motion',
  'midisetup', 'devices',
];

export function renderScreen(name: ScreenName, ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  SCREENS[name].render(ctx, input);
}

/**
 * Mirrors ScreenRegistry.RouteFor: which screen the "screen" page should show for the live UI state.
 * Held buttons + the active track decide the main screen, exactly like the device. The Web edition
 * has no AppPage navigation state, so the AppPage.* branches collapse to the activeTrack cases.
 */
export function routeFor(session: OpzSession): ScreenName {
  const ui = session.ui;
  if (ui.mixer && SCREENS.mixer) return 'mixer';
  if (ui.tempo && SCREENS.tempo) return 'tempo';
  if (ui.project && SCREENS.project) return 'project';
  const t = session.activeTrack;
  if (ui.shift && ui.heldKey >= 0 && t <= 7) return 'steps';
  switch (t) {
    case 10: return 'tape';
    case 11: return 'master';
    case 12: return 'perform';
    case 13: return 'module';
    case 14: return 'lights';
    case 15: return 'motiontrack';
    default: return 'track';
  }
}

/** Builds a default ScreenInput for a session (used by tests and the shell). */
export function defaultInput(session: OpzSession): ScreenInput {
  return {
    session,
    left: 0,
    right: 1600,
    top: 0,
    bottom: 812,
    selected: null,
    playing: false,
    nowMs: 0,
    playMs: 0,
    beats: 0,
    meterAt: new Array(8).fill(-10),
    meterVel: new Array(8).fill(0),
    write: null,
  };
}
