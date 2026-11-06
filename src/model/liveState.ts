/**
 * OPB.Core/Model/LiveState.cs → TypeScript.
 * Decode/encode for the live state messages: $03/$04/$06/$07/$12/$13/$14/$1A/$11.
 */
import { u16le, u32le } from './bytes.ts';
import { deviceInfo } from '../protocol/opzFrame.ts';

export interface DeviceInfo {
  serial: string;
  firmware: string;
}

/** $03 PlayState: octave, selected track, playing flag. */
export interface PlayState {
  octave: number;
  track: number;
  playing: boolean;
}
export function decodePlayState(p: Uint8Array): PlayState {
  if (p.length < 2) return { octave: 0, track: 0, playing: false };
  return { octave: p[0], track: p[1] & 0x0f, playing: (p[1] & 0x10) !== 0 };
}
export function encodePlayState(s: PlayState): Uint8Array {
  return Uint8Array.of(s.octave & 0xff, ((s.track & 0x0f) | (s.playing ? 0x10 : 0)) & 0xff);
}

/** $04 input/level state. */
export interface LevelState {
  battery: number;
  masterVolume: number;
  micLevel: number;
  micFx: number;
  monitor: boolean;
  inputSelector: number;
  micMode: boolean;
}
export function decodeLevelState(p: Uint8Array): LevelState {
  if (p.length < 4) {
    return { battery: 0, masterVolume: 0, micLevel: 1, micFx: 0, monitor: false, inputSelector: 0, micMode: false };
  }
  return {
    battery: p[0],
    masterVolume: p[1],
    micLevel: (p[2] & 0x0f) + 1,
    micFx: (p[2] >> 4) & 0x03,
    monitor: (p[2] & 0x40) !== 0,
    inputSelector: p[3] & 0x0f,
    micMode: (p[3] & 0x10) !== 0,
  };
}

/** $06 UI state: parameter page, held buttons. */
export interface UiState {
  page: number;
  heldKey: number;
  shift: boolean;
  tempo: boolean;
  mixer: boolean;
  screen: boolean;
  stop: boolean;
  record: boolean;
  trackHeld: boolean;
  project: boolean;
  raw: Uint8Array;
}
export function decodeUiState(p: Uint8Array): UiState {
  if (p.length < 4) {
    return {
      page: 0, heldKey: -1, shift: false, tempo: false, mixer: false, screen: false,
      stop: false, record: false, trackHeld: false, project: false, raw: p,
    };
  }
  const step = p[1] & 0x1f;
  return {
    page: (p[0] >> 6) & 0x03,
    heldKey: step < 16 ? step : -1,
    shift: (p[1] & 0x20) !== 0,
    tempo: (p[1] & 0x40) !== 0,
    mixer: (p[1] & 0x80) !== 0,
    screen: (p[2] & 0x20) !== 0,
    stop: (p[2] & 0x40) !== 0,
    record: (p[2] & 0x80) !== 0,
    trackHeld: (p[3] & 0x01) !== 0,
    project: (p[3] & 0x02) !== 0,
    raw: p,
  };
}

/** $07 chain state. */
export interface ChainState {
  chain: number[];
  pattern: number;
  nextIndex: number;
  project: number;
  address: number;
  position: number;
}
export function decodeChainState(p: Uint8Array): ChainState {
  if (p.length < 20) return { chain: [], pattern: 0, nextIndex: 0, project: 0, address: 0, position: 0 };
  const length = Math.min(p[16] & 0x1f, 31);
  const chain: number[] = [];
  for (let i = 0; i < length; i++) {
    chain.push((p[Math.floor(i / 2)] >> (i % 2 === 0 ? 0 : 4)) & 0x0f);
  }
  const pattern = p[17] & 0x0f;
  const nextIndex = p[18];
  const project = p[19] & 0x0f;
  const address = p[17];
  const position = chain.length === 0 ? 0 : nextIndex === 0 ? chain.length : nextIndex;
  return { chain, pattern, nextIndex, project, address, position };
}
export function encodeChainState(chain: number[], project: number): Uint8Array {
  const payload = new Uint8Array(20);
  for (let i = 0; i < chain.length; i++) {
    payload[Math.floor(i / 2)] |= ((chain[i] & 0x0f) << (i % 2 === 0 ? 0 : 4));
  }
  payload[16] = chain.length & 0xff;
  payload[17] = (((project & 0x0f) << 4) | (chain[0] & 0x0f)) & 0xff;
  payload[18] = (chain.length > 1 ? 1 : 0) & 0xff;
  payload[19] = project & 0x0f;
  return payload;
}

/** $12 mixer state. */
export interface MixerState {
  levels: Uint8Array;
  muteMask: number;
}
export function decodeMixerState(p: Uint8Array): MixerState {
  if (p.length < 18) return { levels: new Uint8Array(16), muteMask: 0 };
  return { levels: p.slice(0, 16), muteMask: u16le(p, 16) };
}
export function mixerIsMuted(m: MixerState, track: number): boolean {
  return (m.muteMask & (1 << track)) !== 0;
}
export function encodeMixerState(m: MixerState): Uint8Array {
  const payload = new Uint8Array(18);
  payload.set(m.levels.subarray(0, 16), 0);
  payload[16] = m.muteMask & 0xff;
  payload[17] = (m.muteMask >> 8) & 0xff;
  return payload;
}

/** $13 pattern state. */
export interface PatternState {
  patternCopied: boolean;
  projectCopied: boolean;
  liftMode: number;
  chainMode: boolean;
  autosave: boolean;
  bouncing: boolean;
}
export function decodePatternState(p: Uint8Array): PatternState {
  if (p.length < 3) {
    return { patternCopied: false, projectCopied: false, liftMode: 0, chainMode: false, autosave: false, bouncing: false };
  }
  return {
    patternCopied: p[0] !== 0,
    projectCopied: p[1] !== 0,
    liftMode: p[2] & 0x0f,
    chainMode: (p[2] & 0x10) !== 0,
    autosave: (p[2] & 0x20) !== 0,
    bouncing: (p[2] & 0x40) !== 0,
  };
}

/** $14 expansion module info. */
export interface ModuleInfo {
  caps: number;
  status: number;
  name: string;
  connected: boolean;
}
export function decodeModuleInfo(p: Uint8Array): ModuleInfo {
  if (p.length < 19) return { caps: 0, status: 0, name: '', connected: false };
  const searchEnd = Math.min(p.length, 8 + 10);
  let end = -1;
  for (let i = 8; i < searchEnd; i++) {
    if (p[i] === 0) { end = i; break; }
  }
  const nameLen = (end < 0 ? 18 : end) - 8;
  const name = new TextDecoder('ascii').decode(p.subarray(8, 8 + Math.max(0, nameLen)));
  return { caps: u32le(p, 0), status: u32le(p, 4), name, connected: p[18] !== 0 };
}

/** $1A sampler UI state. */
export interface SamplerUiState {
  context: number;
  packProgress: number;
  position: number;
  page: number;
  active: boolean;
}
export function decodeSamplerUiState(p: Uint8Array): SamplerUiState {
  if (p.length < 5) return { context: 0, packProgress: 0, position: 0, page: 0, active: false };
  return { context: p[0], packProgress: p[1], position: p[2], page: p[3], active: (p[4] & 1) !== 0 };
}

/** $11 device info (NUL-separated ASCII serial then firmware). */
export function deviceInfoFrom11(p: Uint8Array): DeviceInfo {
  return deviceInfo(p);
}
