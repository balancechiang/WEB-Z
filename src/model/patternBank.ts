/**
 * OPB.Core/Model/PatternBank.cs → TypeScript.
 * The 16-pattern bank of the active project, transferred by $09/$0A (342,272 bytes).
 */
import { TRACK_COUNT, TRACK_NAMES, NOTES_PER_STEP, NOTE_SLOT_OFFSET } from './tracks.ts';
import { u32le, w32le, u16le, w16le } from './bytes.ts';

export const PATTERN_SIZE = 21392;
export const PATTERN_COUNT = 16;
export const PATTERN_BANK_SIZE = PATTERN_SIZE * PATTERN_COUNT;

const TRACK_RECORDS_OFFSET = 0;
const NOTES_OFFSET = 192;
const STEPS_OFFSET = 7232;
const SOUND_OFFSET = 21056;
const MUTE_GROUPS_OFFSET = 21344;
const TAPE_ROUTING_OFFSET = 21384;
const MASTER_ROUTING_OFFSET = 21386;
const ACTIVE_MUTE_GROUP_OFFSET = 21388;

export const STEP_RECORD_SIZE = 54;
export const DURATION_PER_STEP = 6200;

export interface PatternNote {
  duration: number;
  pitch: number;
  velocity: number;
  microTiming: number;
  age: number;
  steps: number;
}

export class PatternBank {
  data: Uint8Array;

  constructor(data: Uint8Array) {
    if (data.length !== PATTERN_BANK_SIZE) {
      throw new Error(`Pattern bank must be ${PATTERN_BANK_SIZE} bytes (got ${data.length})`);
    }
    this.data = data;
  }

  clone(): PatternBank {
    return new PatternBank(this.data.slice());
  }

  private base(pattern: number): number {
    return pattern * PATTERN_SIZE;
  }

  private trackRecord(pattern: number, track: number): number {
    return this.base(pattern) + TRACK_RECORDS_OFFSET + track * 12;
  }

  plug(pattern: number, track: number): number {
    return u32le(this.data, this.trackRecord(pattern, track));
  }
  stepCount(pattern: number, track: number): number {
    return Math.max(1, Math.min(16, this.data[this.trackRecord(pattern, track) + 4]));
  }
  stepLength(pattern: number, track: number): number {
    return Math.max(1, this.data[this.trackRecord(pattern, track) + 6]);
  }
  quantize(pattern: number, track: number): number {
    return this.data[this.trackRecord(pattern, track) + 7];
  }
  noteLength(pattern: number, track: number): number {
    return this.data[this.trackRecord(pattern, track) + 9];
  }
  setStepCount(pattern: number, track: number, count: number): void {
    this.data[this.trackRecord(pattern, track) + 4] = Math.max(1, Math.min(16, count));
  }
  setStepLength(pattern: number, track: number, length: number): void {
    this.data[this.trackRecord(pattern, track) + 6] = Math.max(1, Math.min(16, length));
  }
  setQuantize(pattern: number, track: number, value: number): void {
    this.data[this.trackRecord(pattern, track) + 7] = value & 0xff;
  }
  setNoteLength(pattern: number, track: number, value: number): void {
    this.data[this.trackRecord(pattern, track) + 9] = value & 0xff;
  }

  sound(pattern: number, track: number, p: number): number {
    return this.data[this.base(pattern) + SOUND_OFFSET + track * 18 + p];
  }
  setSound(pattern: number, track: number, p: number, value: number): void {
    this.data[this.base(pattern) + SOUND_OFFSET + track * 18 + p] = value & 0xff;
  }
  soundRecord(pattern: number, track: number): Uint8Array {
    const off = this.base(pattern) + SOUND_OFFSET + track * 18;
    return this.data.slice(off, off + 18);
  }
  setSoundRecord(pattern: number, track: number, record: Uint8Array): void {
    const off = this.base(pattern) + SOUND_OFFSET + track * 18;
    this.data.set(record.subarray(0, 18), off);
  }

  private noteOffset(pattern: number, track: number, step: number, slot: number): number {
    return this.base(pattern) + NOTES_OFFSET + (step * 55 + NOTE_SLOT_OFFSET[track] + slot) * 8;
  }
  notes(pattern: number, track: number, step: number): PatternNote[] {
    const notes: PatternNote[] = [];
    for (let slot = 0; slot < NOTES_PER_STEP[track]; slot++) {
      const o = this.noteOffset(pattern, track, step, slot);
      if (this.data[o + 4] === 0xff) continue;
      const duration = u32le(this.data, o);
      notes.push({
        duration,
        pitch: this.data[o + 4],
        velocity: this.data[o + 5],
        microTiming: this.data[o + 6],
        age: this.data[o + 7],
        steps: duration / DURATION_PER_STEP,
      });
    }
    return notes;
  }
  hasTrig(pattern: number, track: number, step: number): boolean {
    for (let slot = 0; slot < NOTES_PER_STEP[track]; slot++) {
      if (this.data[this.noteOffset(pattern, track, step, slot) + 4] !== 0xff) return true;
    }
    return false;
  }
  setNotes(pattern: number, track: number, step: number, notes: PatternNote[]): void {
    const slots = NOTES_PER_STEP[track];
    if (notes.length > slots) throw new Error(`${TRACK_NAMES[track]} holds ${slots} notes per step`);
    for (let slot = 0; slot < slots; slot++) {
      const o = this.noteOffset(pattern, track, step, slot);
      if (slot < notes.length) {
        const n = notes[slot];
        w32le(this.data, o, n.duration);
        this.data[o + 4] = n.pitch & 0xff;
        this.data[o + 5] = n.velocity & 0xff;
        this.data[o + 6] = n.microTiming & 0xff;
        this.data[o + 7] = n.age & 0xff;
      } else {
        this.data[o + 4] = 0xff;
      }
    }
  }

  private stepOffset(pattern: number, track: number, step: number): number {
    return this.base(pattern) + STEPS_OFFSET + (track * 16 + step) * STEP_RECORD_SIZE;
  }
  componentMask(pattern: number, track: number, step: number): number {
    return u16le(this.data, this.stepOffset(pattern, track, step));
  }
  componentValue(pattern: number, track: number, step: number, component: number): number {
    return this.data[this.stepOffset(pattern, track, step) + 2 + component];
  }
  setComponent(pattern: number, track: number, step: number, component: number, value: number | null): void {
    const o = this.stepOffset(pattern, track, step);
    let mask = u16le(this.data, o);
    if (value == null) {
      mask &= ~(1 << component);
    } else {
      mask |= 1 << component;
      this.data[o + 2 + component] = value & 0xff;
    }
    w16le(this.data, o, mask);
  }
  isLocked(pattern: number, track: number, step: number, p: number): boolean {
    return this.data[this.stepOffset(pattern, track, step) + 36 + p] !== 0;
  }
  lockValue(pattern: number, track: number, step: number, p: number): number {
    return this.data[this.stepOffset(pattern, track, step) + 18 + p];
  }

  /**
   * Stage 6: write a parameter lock. `p` MUST be a BANK_PARAM index, not a live SOUND_PARAM one.
   * Genuine locks on the connected device use 0xFF in the enable byte
   * (kmorrill/op-z-sysex typed-pattern-editing.md, device-proven on fw 1.2.45+).
   */
  setLock(pattern: number, track: number, step: number, p: number, value: number): void {
    const o = this.stepOffset(pattern, track, step);
    this.data[o + 18 + p] = value & 0xff;
    this.data[o + 36 + p] = 0xff;
  }

  /** Clearing a lock touches ONLY the enable byte; the device preserves the last value. */
  clearLock(pattern: number, track: number, step: number, p: number): void {
    this.data[this.stepOffset(pattern, track, step) + 36 + p] = 0;
  }

  hasAnyLock(pattern: number, track: number, step: number): boolean {
    const o = this.stepOffset(pattern, track, step) + 36;
    for (let i = 0; i < 18; i++) if (this.data[o + i] !== 0) return true;
    return false;
  }

  activeMuteGroup(pattern: number): number {
    return Math.min(this.data[this.base(pattern) + ACTIVE_MUTE_GROUP_OFFSET], 9);
  }
  isMuted(pattern: number, track: number): boolean {
    const o = this.base(pattern) + MUTE_GROUPS_OFFSET + this.activeMuteGroup(pattern) * 4 + (track >> 2);
    return (this.data[o] & (1 << ((track % 4) * 2 + 1))) !== 0;
  }
  tapeRouting(pattern: number): number {
    return u16le(this.data, this.base(pattern) + TAPE_ROUTING_OFFSET);
  }
  masterRouting(pattern: number): number {
    return u16le(this.data, this.base(pattern) + MASTER_ROUTING_OFFSET);
  }
  setRouted(pattern: number, master: boolean, track: number, on: boolean): void {
    const off = this.base(pattern) + (master ? MASTER_ROUTING_OFFSET : TAPE_ROUTING_OFFSET);
    let mask = u16le(this.data, off);
    mask = on ? (mask | (1 << track)) : (mask & ~(1 << track));
    w16le(this.data, off, mask);
  }
  isEmpty(pattern: number): boolean {
    for (let track = 0; track < TRACK_COUNT; track++) {
      for (let step = 0; step < 16; step++) {
        if (this.hasTrig(pattern, track, step)) return false;
      }
    }
    return true;
  }
}
