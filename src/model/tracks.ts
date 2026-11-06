/**
 * OPB.Core/Model/Tracks.cs → TypeScript.
 * Track metadata, note geometry and the display conversions the screens use.
 */

export const TRACK_COUNT = 16;

export const TRACK_NAMES = [
  'KICK', 'SNARE', 'PERC', 'SAMPLE', 'BASS', 'LEAD', 'ARP', 'CHORD',
  'FX 1', 'FX 2', 'TAPE', 'MASTER', 'PERFORM', 'MODULE', 'LIGHTS', 'MOTION',
] as const;

export type TrackKind =
  | 'Drum' | 'Synth' | 'Fx' | 'Tape' | 'Master' | 'Perform' | 'Module' | 'Lights' | 'Motion';

/** Notes per step, and the slot offset inside each step's 55-byte run. */
export const NOTES_PER_STEP = [2, 2, 2, 2, 4, 4, 8, 4, 1, 1, 1, 4, 6, 6, 4, 4];
export const NOTE_SLOT_OFFSET = [0, 2, 4, 6, 8, 12, 16, 24, 28, 29, 30, 31, 35, 41, 47, 51];

export function trackKind(track: number): TrackKind {
  if (track <= 3) return 'Drum';        // Kick, Snare, Perc, Sample
  if (track <= 7) return 'Synth';       // Bass, Lead, Arp, Chord
  if (track === 8 || track === 9) return 'Fx';
  if (track === 10) return 'Tape';
  if (track === 11) return 'Master';
  if (track === 12) return 'Perform';
  if (track === 13) return 'Module';
  if (track === 14) return 'Lights';
  return 'Motion';
}

export function hasSound(track: number): boolean {
  const k = trackKind(track);
  return k === 'Drum' || k === 'Synth';
}

/** Index into the 18-byte per-track sound record carried by $0E and pattern storage. */
export const SoundParam = {
  P1: 0, P2: 1, Attack: 2, Decay: 3, Sustain: 4, Release: 5, Fx1Send: 6, Fx2Send: 7,
  Filter: 8, Resonance: 9, Pan: 10, Level: 11, Portamento: 12, LfoDepth: 13,
  LfoSpeed: 14, LfoValue: 15, LfoShape: 16, NoteStyle: 17,
} as const;
export type SoundParamKey = keyof typeof SoundParam;

export const NOTE_LENGTHS = ['DRONE', '1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'];
export const DRUM_NOTE_STYLES = ['RETRIG', 'MONO', 'GATE', 'LOOP'];
export const SYNTH_NOTE_STYLES = ['POLY', 'MONO', 'LEGATO'];
export const LFO_DESTINATIONS = ['P1', 'P2', 'FILTER', 'RES', 'ATTACK', 'PITCH', 'PAN', 'VOLUME'];
export const LFO_SHAPES = [
  'SINE', 'TRIANGLE', 'SQUARE', 'SAW', 'RANDOM', 'GYRO', 'SINE', 'TRIANGLE',
  'SQUARE', 'SAW', 'RANDOM', 'ONCE',
];
export const METRONOME_SOUNDS = ['CLICK', 'SWEDISH', 'ENGLISH', 'GERMAN', 'JAPANESE', 'ITALIAN'];
export const MIC_FX = ['NO FX', 'FX 1', 'FX 2', 'FX 1+2'];
export const STEP_COMPONENTS = [
  'PULSE', 'PARAMETER SPARK', 'JUMP', 'VELOCITY', 'RAMP UP', 'RAMP DOWN', 'RANDOM', 'GLIDE',
  'MULTIPLY', 'SWEEP', 'PULSE HOLD', 'TONALITY', 'TRIGGER SPARK', 'COMPONENT SPARK', '', '',
];

export function percent(raw: number): number {
  return Math.round((raw * 99) / 255);
}

export function fromPercent(value: number): number {
  return Math.max(0, Math.min(255, Math.round((value * 255) / 99)));
}

/** Picks one of <param>options</param> by splitting 0..255 into equal bands (C# Display.Band). */
export function band(raw: number, options: readonly string[]): string {
  return options[Math.min(options.length - 1, Math.floor((raw * options.length) / 256))];
}

export function bandIndex(raw: number, count: number): number {
  return Math.min(count - 1, Math.floor((raw * count) / 256));
}

export function bandCenter(index: number, count: number): number {
  return Math.max(0, Math.min(255, Math.floor((index * 256 + 128) / count)));
}

export function noteName(midiNote: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midiNote % 12) + 12) % 12]}${Math.floor(midiNote / 12) - 1}`;
}
