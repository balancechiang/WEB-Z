/**
 * OPB.Core/Model/Tracks.cs (Display + Tracks) → TypeScript.
 * Conversions between raw 0..255 bytes and the values the OP-Z shows, plus the banded
 * option tables the screens use. Mirrors the C# Display static class.
 */

export const NOTE_LENGTHS = ['DRONE', '1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'];
export const DRUM_NOTE_STYLES = ['RETRIG', 'MONO', 'GATE', 'LOOP'];
export const SYNTH_NOTE_STYLES = ['POLY', 'MONO', 'LEGATO'];
export const LFO_DESTINATIONS = ['P1', 'P2', 'FILTER', 'RES', 'ATTACK', 'PITCH', 'PAN', 'VOLUME'];
export const LFO_SHAPES = ['SINE', 'TRIANGLE', 'SQUARE', 'SAW', 'RANDOM', 'GYRO', 'SINE', 'TRIANGLE', 'SQUARE', 'SAW', 'RANDOM', 'ONCE'];
export const METRONOME_SOUNDS = ['CLICK', 'SWEDISH', 'ENGLISH', 'GERMAN', 'JAPANESE', 'ITALIAN'];
export const MIC_FX = ['NO FX', 'FX 1', 'FX 2', 'FX 1+2'];

/**
 * Index into the Web view's normalized `session.currentSound[track]` record.
 * The session converts between this order and the OP-Z wire/bank order.
 */
export const SOUND_PARAM = {
  P1: 0, P2: 1, Attack: 2, Decay: 3, Sustain: 4, Release: 5, Portamento: 6,
  Fx1Send: 7, Fx2Send: 8, Filter: 9, Resonance: 10, Pan: 11, Level: 12,
  LfoDepth: 13, LfoSpeed: 14, LfoDest: 15, LfoShape: 16, NoteStyle: 17,
} as const;
export type SoundParamName = keyof typeof SOUND_PARAM;

export function percent(raw: number): number {
  return Math.round((raw & 0xff) * 99 / 255);
}

export function fromPercent(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255 / 99)));
}

/** Picks one of options by splitting 0..255 into equal bands. */
export function band(raw: number, options: readonly string[]): string {
  return options[bandIndex(raw, options.length)] ?? '';
}

/** C# Display.BandName alias: pick an option by splitting 0..255 into equal bands. */
export const bandName = band;

export function bandIndex(raw: number, count: number): number {
  return Math.min(count - 1, Math.floor(((raw & 0xff) * count) / 256));
}

export function noteName(midiNote: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midiNote % 12) + 12) % 12]}${Math.floor(midiNote / 12) - 1}`;
}

export type TrackKindName = 'Drum' | 'Synth' | 'Fx' | 'Tape' | 'Master' | 'Perform' | 'Module' | 'Lights' | 'Motion';

export function trackKind(track: number): TrackKindName {
  if (track <= 3) return 'Drum';
  if (track <= 7) return 'Synth';
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

/** A parameter as the screen needs it: its label, raw 0..255 value, and display text. */
export interface ParamInfo {
  label: string;
  value: number;
  text: string;
}

/**
 * Builds a ParamInfo from a raw sound byte, like C# ParamRef.Sound.
 * @param value raw 0..255 sound byte
 * @param label the parameter name shown above the knob
 * @param format optional formatter; defaults to "NN%" (Display.Percent)
 */
export function paramInfo(value: number, label: string, format?: (v: number) => string): ParamInfo {
  return {
    label,
    value: value & 0xff,
    text: format ? format(value & 0xff) : `${percent(value & 0xff)}`,
  };
}
