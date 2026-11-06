/**
 * Serializes an OpzSession into a JSON-friendly state view for the offline driver
 * and (later) the Web UI. Mirrors what the Avalonia screens read from the session.
 */
import { OpzSession } from './opzSession.ts';
import {
  TRACK_NAMES, trackKind, hasSound, SoundParam, percent, METRONOME_SOUNDS,
} from '../model/tracks.ts';
import { supportsFileService } from '../model/firmware.ts';

export interface StateViewMeta {
  [key: string]: unknown;
}

export function toStateView(session: OpzSession, meta: StateViewMeta = {}): Record<string, unknown> {
  const tracks = TRACK_NAMES.map((name, t) => {
    const raw = session.currentSound[t];
    const sound: Record<string, number> = {};
    const soundPercent: Record<string, number> = {};
    for (const key of Object.keys(SoundParam) as (keyof typeof SoundParam)[]) {
      const v = raw[SoundParam[key]];
      sound[key] = v;
      soundPercent[key] = percent(v);
    }
    return {
      index: t,
      name,
      kind: trackKind(t),
      hasSound: hasSound(t),
      sound,
      soundPercent,
    };
  });

  const global = session.global
    ? {
        tempo: session.global.tempo,
        swing: session.global.swing,
        drumLevel: session.global.drumLevel,
        drumLevelPercent: percent(session.global.drumLevel),
        synthLevel: session.global.synthLevel,
        synthLevelPercent: percent(session.global.synthLevel),
        punchLevel: session.global.punchLevel,
        punchLevelPercent: percent(session.global.punchLevel),
        masterLevel: session.global.masterLevel,
        masterLevelPercent: percent(session.global.masterLevel),
        metronomeLevel: session.global.metronomeLevel,
        metronomeSound: METRONOME_SOUNDS[Math.min(session.global.metronomeSound, METRONOME_SOUNDS.length - 1)],
        selectedChain: session.global.selectedChain,
        chains: Array.from({ length: 15 }, (_, slot) => session.global!.chain(slot)),
      }
    : null;

  const midiConfig = session.midiConfig
    ? {
        tracks: Array.from({ length: 16 }, (_, t) => ({
          enabled: session.midiConfig!.trackEnabled(t),
          channel: session.midiConfig!.channel(t),
        })),
      }
    : null;

  const mutedTracks = Array.from({ length: 16 }, (_, t) => t).filter((t) =>
    session.hasMixer && (session.mixer.muteMask & (1 << t)) !== 0);

  const messageCounts: Record<string, number> = {};
  for (const [k, v] of session.messageCounts) messageCounts[`$${k.toString(16).padStart(2, '0')}`] = v;

  return {
    meta: {
      generatedBy: 'opb-web stage2 stateView',
      ...meta,
    },
    receivedFrames: session.receivedFrames,
    messageCounts,
    parseErrors: session.parseErrors,
    connection: {
      isConnected: session.isConnected,
      portName: session.portName,
      clockRunning: session.clockRunning,
      clockTicks: session.clockTicks,
    },
    device: {
      serial: session.device.serial,
      firmware: session.device.firmware,
      supportsFileService: supportsFileService(session.device.firmware),
    },
    play: {
      octave: session.play.octave,
      track: session.play.track,
      trackName: TRACK_NAMES[session.play.track] ?? '?',
      playing: session.play.playing,
    },
    level: {
      battery: session.level.battery,
      masterVolume: session.level.masterVolume,
      masterVolumePercent: percent(session.level.masterVolume),
      micLevel: session.level.micLevel,
      micFx: session.level.micFx,
      monitor: session.level.monitor,
      inputSelector: session.level.inputSelector,
      micMode: session.level.micMode,
    },
    ui: {
      page: session.ui.page,
      heldKey: session.ui.heldKey,
      shift: session.ui.shift,
      tempo: session.ui.tempo,
      mixer: session.ui.mixer,
      screen: session.ui.screen,
      stop: session.ui.stop,
      record: session.ui.record,
      trackHeld: session.ui.trackHeld,
      project: session.ui.project,
    },
    chain: {
      pattern: session.chain.pattern,
      chain: session.chain.chain,
      position: session.chain.position,
      nextIndex: session.chain.nextIndex,
      project: session.chain.project,
      address: session.chain.address,
    },
    mixer: session.hasMixer
      ? {
          levels: Array.from(session.mixer.levels),
          levelsPercent: Array.from(session.mixer.levels).map((v) => percent(v)),
          muteMask: session.mixer.muteMask,
          mutedTracks,
        }
      : null,
    patternState: {
      patternCopied: session.patternState.patternCopied,
      projectCopied: session.patternState.projectCopied,
      liftMode: session.patternState.liftMode,
      chainMode: session.patternState.chainMode,
      autosave: session.patternState.autosave,
      bouncing: session.patternState.bouncing,
    },
    module: {
      caps: session.module.caps,
      status: session.module.status,
      name: session.module.name,
      connected: session.module.connected,
    },
    sampler: {
      context: session.sampler.context,
      packProgress: session.sampler.packProgress,
      position: session.sampler.position,
      page: session.sampler.page,
      active: session.sampler.active,
    },
    audioVis: session.audioVis,
    global,
    midiConfig,
    bank: session.bank
      ? { size: session.bank.data.length, patternCount: 16, present: true }
      : { present: false, pendingPatternBytes: session.patternPacketsLength ?? 0 },
    tracks,
  };
}
