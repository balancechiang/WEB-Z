/**
 * OPB.Core/Model/GlobalData.cs → TypeScript.
 * The 568-byte project-global block ($0C) and the 292-byte MIDI config ($0F/$10).
 */
import { u16le, w16le } from './bytes.ts';

export const GLOBAL_SIZE = 568;

export class GlobalData {
  data: Uint8Array;

  constructor(data: Uint8Array) {
    if (data.length !== GLOBAL_SIZE) throw new Error(`Global data must be ${GLOBAL_SIZE} bytes (got ${data.length})`);
    this.data = data;
  }

  clone(): GlobalData {
    return new GlobalData(this.data.slice());
  }

  get drumLevel(): number { return this.data[512]; }
  set drumLevel(v: number) { this.data[512] = v & 0xff; }
  get synthLevel(): number { return this.data[513]; }
  set synthLevel(v: number) { this.data[513] = v & 0xff; }
  get punchLevel(): number { return this.data[514]; }
  set punchLevel(v: number) { this.data[514] = v & 0xff; }
  get masterLevel(): number { return this.data[515]; }
  set masterLevel(v: number) { this.data[515] = v & 0xff; }

  get tempo(): number { return u16le(this.data, 516); }
  set tempo(v: number) { w16le(this.data, 516, Math.max(40, Math.min(200, Math.round(v)))); }

  get swing(): number { return this.data[561]; }
  set swing(v: number) { this.data[561] = v & 0xff; }
  get metronomeLevel(): number { return this.data[562]; }
  set metronomeLevel(v: number) { this.data[562] = v & 0xff; }
  get metronomeSound(): number { return this.data[563]; }
  set metronomeSound(v: number) { this.data[563] = v & 0xff; }

  /** Slots 0..14 are saved chains; slot 15 is the live active-chain buffer. */
  get selectedChain(): number { return (this.data[564] << 24) >> 24; }

  chain(slot: number): number[] {
    const chain: number[] = [];
    for (let i = 0; i < 32; i++) {
      const b = this.data[slot * 32 + i];
      if (b === 0xff) break;
      chain.push(b);
    }
    return chain;
  }
}

export const MIDI_CONFIG_SIZE = 292;

export class MidiConfig {
  data: Uint8Array;

  constructor(data: Uint8Array) {
    if (data.length !== MIDI_CONFIG_SIZE) throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes (got ${data.length})`);
    this.data = data;
  }

  clone(): MidiConfig {
    return new MidiConfig(this.data.slice());
  }

  trackEnabled(track: number): boolean { return this.data[track] !== 0; }
  setTrackEnabled(track: number, on: boolean): void { this.data[track] = on ? 1 : 0; }
  channel(track: number): number { return this.data[16 + track] & 0x0f; }
  setChannel(track: number, channel: number): void { this.data[16 + track] = Math.max(0, Math.min(15, channel)); }
  parameterCc(track: number, parameter: number): number { return this.data[32 + track * 16 + parameter]; }
  setParameterCc(track: number, parameter: number, cc: number): void {
    this.data[32 + track * 16 + parameter] = Math.max(0, Math.min(127, cc));
  }

  flag(flag: number): boolean { return (this.data[288] & (1 << flag)) !== 0; }
  setFlag(flag: number, on: boolean): void {
    this.data[288] = on ? (this.data[288] | (1 << flag)) : (this.data[288] & ~(1 << flag));
  }
}

export const MidiFlag = {
  ChannelOneToActive: 0,
  IncomingMidi: 1,
  OutgoingMidi: 2,
  ClockIn: 3,
  ClockOut: 4,
  AltProgramChange: 5,
  MidiEcho: 6,
  ProgramChange: 7,
} as const;
