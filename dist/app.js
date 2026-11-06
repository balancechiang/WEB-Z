// src/protocol/pack7.ts
function encode(source) {
  const groups = Math.ceil(source.length / 7);
  const output = new Uint8Array(source.length + groups);
  let o = 0;
  for (let start = 0; start < source.length; start += 7) {
    const count = Math.min(7, source.length - start);
    let mask = 0;
    for (let i = 0; i < count; i++) {
      mask |= (source[start + i] >> 7 & 1) << i;
    }
    output[o++] = mask;
    for (let i = 0; i < count; i++) {
      output[o++] = source[start + i] & 127;
    }
  }
  return output;
}
function decode(source) {
  const output = [];
  for (let start = 0; start < source.length; start += 8) {
    const count = Math.min(8, source.length - start);
    const mask = source[start];
    for (let i = 1; i < count; i++) {
      output.push(source[start + i] | (mask >> i - 1 & 1) << 7);
    }
  }
  return Uint8Array.from(output);
}

// src/protocol/opzFrame.ts
var HEADER = Uint8Array.of(240, 0, 32, 118, 1);
var IDENTITY_INQUIRY = Uint8Array.of(240, 126, 127, 6, 1, 247);
var HEARTBEAT = Uint8Array.of(240, 0, 32, 118, 1, 0, 1, 78, 46, 6, 247);
var ALL_NOTES_OFF = Uint8Array.of(176, 123, 0);
function hello(sessionId) {
  return build(0, Uint8Array.of(sessionId >> 8 & 255, sessionId & 255, 6));
}
function build(messageId, payload = new Uint8Array(0)) {
  const packed = encode(payload);
  const frame3 = new Uint8Array(HEADER.length + 1 + packed.length + 1);
  frame3.set(HEADER, 0);
  frame3[HEADER.length] = messageId;
  frame3.set(packed, HEADER.length + 1);
  frame3[frame3.length - 1] = 247;
  return frame3;
}
function tryParse(data) {
  if (data.length < 7 || data[data.length - 1] !== 247) return null;
  for (let i = 0; i < HEADER.length; i++) {
    if (data[i] !== HEADER[i]) return null;
  }
  for (let i = 6; i < data.length - 1; i++) {
    if (data[i] > 127) return null;
  }
  return { messageId: data[5], payload: decode(data.subarray(6, data.length - 1)) };
}
function isIdentityReply(data) {
  return data.length > 9 && data[0] === 240 && data[1] === 126 && data[3] === 6 && data[4] === 2 && data[5] === 0 && data[6] === 32 && data[7] === 118;
}
async function inflateZlib(payload, maxSize = 1 << 20) {
  const stream = new Blob([new Uint8Array(payload)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength > maxSize) {
    throw new Error(`inflated payload exceeds ${maxSize} bytes`);
  }
  return new Uint8Array(buffer);
}
async function deflateZlib(data) {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function deviceInfo(payload) {
  const parts = new TextDecoder("ascii").decode(payload).split("\0").filter((s) => s.length > 0);
  return { serial: parts[0] ?? "", firmware: parts[1] ?? "" };
}

// src/model/bytes.ts
function u16le(p, off) {
  return (p[off] | p[off + 1] << 8) & 65535;
}
function u32le(p, off) {
  return (p[off] | p[off + 1] << 8 | p[off + 2] << 16 | p[off + 3] << 24) >>> 0;
}
function w16le(p, off, v) {
  p[off] = v & 255;
  p[off + 1] = v >> 8 & 255;
}
function w32le(p, off, v) {
  p[off] = v & 255;
  p[off + 1] = v >> 8 & 255;
  p[off + 2] = v >> 16 & 255;
  p[off + 3] = v >>> 24 & 255;
}

// src/model/globalData.ts
var GLOBAL_SIZE = 568;
var GlobalData = class _GlobalData {
  data;
  constructor(data) {
    if (data.length !== GLOBAL_SIZE) throw new Error(`Global data must be ${GLOBAL_SIZE} bytes (got ${data.length})`);
    this.data = data;
  }
  clone() {
    return new _GlobalData(this.data.slice());
  }
  get drumLevel() {
    return this.data[512];
  }
  set drumLevel(v) {
    this.data[512] = v & 255;
  }
  get synthLevel() {
    return this.data[513];
  }
  set synthLevel(v) {
    this.data[513] = v & 255;
  }
  get punchLevel() {
    return this.data[514];
  }
  set punchLevel(v) {
    this.data[514] = v & 255;
  }
  get masterLevel() {
    return this.data[515];
  }
  set masterLevel(v) {
    this.data[515] = v & 255;
  }
  get tempo() {
    return u16le(this.data, 516);
  }
  set tempo(v) {
    w16le(this.data, 516, Math.max(40, Math.min(200, Math.round(v))));
  }
  get swing() {
    return this.data[561];
  }
  set swing(v) {
    this.data[561] = v & 255;
  }
  get metronomeLevel() {
    return this.data[562];
  }
  set metronomeLevel(v) {
    this.data[562] = v & 255;
  }
  get metronomeSound() {
    return this.data[563];
  }
  set metronomeSound(v) {
    this.data[563] = v & 255;
  }
  /** Slots 0..14 are saved chains; slot 15 is the live active-chain buffer. */
  get selectedChain() {
    return this.data[564] << 24 >> 24;
  }
  chain(slot) {
    const chain = [];
    for (let i = 0; i < 32; i++) {
      const b = this.data[slot * 32 + i];
      if (b === 255) break;
      chain.push(b);
    }
    return chain;
  }
};
var MIDI_CONFIG_SIZE = 292;
var MidiConfig = class _MidiConfig {
  data;
  constructor(data) {
    if (data.length !== MIDI_CONFIG_SIZE) throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes (got ${data.length})`);
    this.data = data;
  }
  clone() {
    return new _MidiConfig(this.data.slice());
  }
  trackEnabled(track) {
    return this.data[track] !== 0;
  }
  setTrackEnabled(track, on) {
    this.data[track] = on ? 1 : 0;
  }
  channel(track) {
    return this.data[16 + track] & 15;
  }
  setChannel(track, channel) {
    this.data[16 + track] = Math.max(0, Math.min(15, channel));
  }
  parameterCc(track, parameter) {
    return this.data[32 + track * 16 + parameter];
  }
  setParameterCc(track, parameter, cc) {
    this.data[32 + track * 16 + parameter] = Math.max(0, Math.min(127, cc));
  }
  flag(flag) {
    return (this.data[288] & 1 << flag) !== 0;
  }
  setFlag(flag, on) {
    this.data[288] = on ? this.data[288] | 1 << flag : this.data[288] & ~(1 << flag);
  }
};
var MidiFlag = {
  ChannelOneToActive: 0,
  IncomingMidi: 1,
  OutgoingMidi: 2,
  ClockIn: 3,
  ClockOut: 4,
  AltProgramChange: 5,
  MidiEcho: 6,
  ProgramChange: 7
};

// src/model/tracks.ts
var TRACK_COUNT = 16;
var TRACK_NAMES = [
  "KICK",
  "SNARE",
  "PERC",
  "SAMPLE",
  "BASS",
  "LEAD",
  "ARP",
  "CHORD",
  "FX 1",
  "FX 2",
  "TAPE",
  "MASTER",
  "PERFORM",
  "MODULE",
  "LIGHTS",
  "MOTION"
];
var NOTES_PER_STEP = [2, 2, 2, 2, 4, 4, 8, 4, 1, 1, 1, 4, 6, 6, 4, 4];
var NOTE_SLOT_OFFSET = [0, 2, 4, 6, 8, 12, 16, 24, 28, 29, 30, 31, 35, 41, 47, 51];

// src/model/patternBank.ts
var PATTERN_SIZE = 21392;
var PATTERN_COUNT = 16;
var PATTERN_BANK_SIZE = PATTERN_SIZE * PATTERN_COUNT;
var TRACK_RECORDS_OFFSET = 0;
var NOTES_OFFSET = 192;
var STEPS_OFFSET = 7232;
var SOUND_OFFSET = 21056;
var MUTE_GROUPS_OFFSET = 21344;
var TAPE_ROUTING_OFFSET = 21384;
var MASTER_ROUTING_OFFSET = 21386;
var ACTIVE_MUTE_GROUP_OFFSET = 21388;
var STEP_RECORD_SIZE = 54;
var DURATION_PER_STEP = 6200;
var PatternBank = class _PatternBank {
  data;
  constructor(data) {
    if (data.length !== PATTERN_BANK_SIZE) {
      throw new Error(`Pattern bank must be ${PATTERN_BANK_SIZE} bytes (got ${data.length})`);
    }
    this.data = data;
  }
  clone() {
    return new _PatternBank(this.data.slice());
  }
  base(pattern) {
    return pattern * PATTERN_SIZE;
  }
  trackRecord(pattern, track) {
    return this.base(pattern) + TRACK_RECORDS_OFFSET + track * 12;
  }
  plug(pattern, track) {
    return u32le(this.data, this.trackRecord(pattern, track));
  }
  stepCount(pattern, track) {
    return Math.max(1, Math.min(16, this.data[this.trackRecord(pattern, track) + 4]));
  }
  stepLength(pattern, track) {
    return Math.max(1, this.data[this.trackRecord(pattern, track) + 6]);
  }
  quantize(pattern, track) {
    return this.data[this.trackRecord(pattern, track) + 7];
  }
  noteLength(pattern, track) {
    return this.data[this.trackRecord(pattern, track) + 9];
  }
  setStepCount(pattern, track, count) {
    this.data[this.trackRecord(pattern, track) + 4] = Math.max(1, Math.min(16, count));
  }
  setStepLength(pattern, track, length) {
    this.data[this.trackRecord(pattern, track) + 6] = Math.max(1, Math.min(16, length));
  }
  setQuantize(pattern, track, value) {
    this.data[this.trackRecord(pattern, track) + 7] = value & 255;
  }
  setNoteLength(pattern, track, value) {
    this.data[this.trackRecord(pattern, track) + 9] = value & 255;
  }
  sound(pattern, track, p) {
    return this.data[this.base(pattern) + SOUND_OFFSET + track * 18 + p];
  }
  setSound(pattern, track, p, value) {
    this.data[this.base(pattern) + SOUND_OFFSET + track * 18 + p] = value & 255;
  }
  soundRecord(pattern, track) {
    const off = this.base(pattern) + SOUND_OFFSET + track * 18;
    return this.data.slice(off, off + 18);
  }
  setSoundRecord(pattern, track, record) {
    const off = this.base(pattern) + SOUND_OFFSET + track * 18;
    this.data.set(record.subarray(0, 18), off);
  }
  noteOffset(pattern, track, step, slot) {
    return this.base(pattern) + NOTES_OFFSET + (step * 55 + NOTE_SLOT_OFFSET[track] + slot) * 8;
  }
  notes(pattern, track, step) {
    const notes = [];
    for (let slot = 0; slot < NOTES_PER_STEP[track]; slot++) {
      const o = this.noteOffset(pattern, track, step, slot);
      if (this.data[o + 4] === 255) continue;
      const duration = u32le(this.data, o);
      notes.push({
        duration,
        pitch: this.data[o + 4],
        velocity: this.data[o + 5],
        microTiming: this.data[o + 6],
        age: this.data[o + 7],
        steps: duration / DURATION_PER_STEP
      });
    }
    return notes;
  }
  hasTrig(pattern, track, step) {
    for (let slot = 0; slot < NOTES_PER_STEP[track]; slot++) {
      if (this.data[this.noteOffset(pattern, track, step, slot) + 4] !== 255) return true;
    }
    return false;
  }
  setNotes(pattern, track, step, notes) {
    const slots = NOTES_PER_STEP[track];
    if (notes.length > slots) throw new Error(`${TRACK_NAMES[track]} holds ${slots} notes per step`);
    for (let slot = 0; slot < slots; slot++) {
      const o = this.noteOffset(pattern, track, step, slot);
      if (slot < notes.length) {
        const n = notes[slot];
        w32le(this.data, o, n.duration);
        this.data[o + 4] = n.pitch & 255;
        this.data[o + 5] = n.velocity & 255;
        this.data[o + 6] = n.microTiming & 255;
        this.data[o + 7] = n.age & 255;
      } else {
        this.data[o + 4] = 255;
      }
    }
  }
  stepOffset(pattern, track, step) {
    return this.base(pattern) + STEPS_OFFSET + (track * 16 + step) * STEP_RECORD_SIZE;
  }
  componentMask(pattern, track, step) {
    return u16le(this.data, this.stepOffset(pattern, track, step));
  }
  componentValue(pattern, track, step, component) {
    return this.data[this.stepOffset(pattern, track, step) + 2 + component];
  }
  setComponent(pattern, track, step, component, value) {
    const o = this.stepOffset(pattern, track, step);
    let mask = u16le(this.data, o);
    if (value == null) {
      mask &= ~(1 << component);
    } else {
      mask |= 1 << component;
      this.data[o + 2 + component] = value & 255;
    }
    w16le(this.data, o, mask);
  }
  isLocked(pattern, track, step, p) {
    return this.data[this.stepOffset(pattern, track, step) + 36 + p] !== 0;
  }
  lockValue(pattern, track, step, p) {
    return this.data[this.stepOffset(pattern, track, step) + 18 + p];
  }
  /**
   * Stage 6: write a parameter lock. `p` MUST be a BANK_PARAM index, not a live SOUND_PARAM one.
   * Genuine locks on the connected device use 0xFF in the enable byte
   * (kmorrill/op-z-sysex typed-pattern-editing.md, device-proven on fw 1.2.45+).
   */
  setLock(pattern, track, step, p, value) {
    const o = this.stepOffset(pattern, track, step);
    this.data[o + 18 + p] = value & 255;
    this.data[o + 36 + p] = 255;
  }
  /** Clearing a lock touches ONLY the enable byte; the device preserves the last value. */
  clearLock(pattern, track, step, p) {
    this.data[this.stepOffset(pattern, track, step) + 36 + p] = 0;
  }
  hasAnyLock(pattern, track, step) {
    const o = this.stepOffset(pattern, track, step) + 36;
    for (let i = 0; i < 18; i++) if (this.data[o + i] !== 0) return true;
    return false;
  }
  activeMuteGroup(pattern) {
    return Math.min(this.data[this.base(pattern) + ACTIVE_MUTE_GROUP_OFFSET], 9);
  }
  isMuted(pattern, track) {
    const o = this.base(pattern) + MUTE_GROUPS_OFFSET + this.activeMuteGroup(pattern) * 4 + (track >> 2);
    return (this.data[o] & 1 << track % 4 * 2 + 1) !== 0;
  }
  tapeRouting(pattern) {
    return u16le(this.data, this.base(pattern) + TAPE_ROUTING_OFFSET);
  }
  masterRouting(pattern) {
    return u16le(this.data, this.base(pattern) + MASTER_ROUTING_OFFSET);
  }
  setRouted(pattern, master, track, on) {
    const off = this.base(pattern) + (master ? MASTER_ROUTING_OFFSET : TAPE_ROUTING_OFFSET);
    let mask = u16le(this.data, off);
    mask = on ? mask | 1 << track : mask & ~(1 << track);
    w16le(this.data, off, mask);
  }
  isEmpty(pattern) {
    for (let track = 0; track < TRACK_COUNT; track++) {
      for (let step = 0; step < 16; step++) {
        if (this.hasTrig(pattern, track, step)) return false;
      }
    }
    return true;
  }
};

// src/model/bankParams.ts
var BANK_PARAM = {
  P1: 0,
  P2: 1,
  Attack: 2,
  Decay: 3,
  Sustain: 4,
  Release: 5,
  Fx1Send: 6,
  Fx2Send: 7,
  Filter: 8,
  Resonance: 9,
  Pan: 10,
  Level: 11,
  Portamento: 12,
  LfoDepth: 13,
  LfoSpeed: 14,
  LfoDest: 15,
  LfoShape: 16,
  NoteStyle: 17
};
var BANK_PARAM_COUNT = 18;
var BANK_PARAM_NAMES = [
  "P1",
  "P2",
  "ATTACK",
  "DECAY",
  "SUSTAIN",
  "RELEASE",
  "FX 1",
  "FX 2",
  "FILTER",
  "RES",
  "PAN",
  "LEVEL",
  "PORTAMENTO",
  "LFO DEPTH",
  "LFO RATE",
  "LFO DEST",
  "LFO SHAPE",
  "NOTE STYLE"
];
var LIVE_TO_BANK = [
  0,
  1,
  2,
  3,
  4,
  5,
  12,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  14,
  15,
  16,
  17
];
var BANK_TO_LIVE = Array.from(
  { length: BANK_PARAM_COUNT },
  (_, bank) => LIVE_TO_BANK.indexOf(bank)
);
function liveToBankParam(live) {
  return LIVE_TO_BANK[live] ?? live;
}
function remapLiveSoundToBank(live) {
  const out = new Uint8Array(BANK_PARAM_COUNT);
  for (let i = 0; i < BANK_PARAM_COUNT; i++) out[LIVE_TO_BANK[i]] = live[i] ?? 0;
  return out;
}
function remapBankSoundToLive(bank) {
  const out = new Uint8Array(BANK_PARAM_COUNT);
  for (let i = 0; i < BANK_PARAM_COUNT; i++) out[BANK_TO_LIVE[i]] = bank[i] ?? 0;
  return out;
}

// src/model/liveState.ts
function decodePlayState(p) {
  if (p.length < 2) return { octave: 0, track: 0, playing: false };
  return { octave: p[0], track: p[1] & 15, playing: (p[1] & 16) !== 0 };
}
function encodePlayState(s) {
  return Uint8Array.of(s.octave & 255, (s.track & 15 | (s.playing ? 16 : 0)) & 255);
}
function decodeLevelState(p) {
  if (p.length < 4) {
    return { battery: 0, masterVolume: 0, micLevel: 1, micFx: 0, monitor: false, inputSelector: 0, micMode: false };
  }
  return {
    battery: p[0],
    masterVolume: p[1],
    micLevel: (p[2] & 15) + 1,
    micFx: p[2] >> 4 & 3,
    monitor: (p[2] & 64) !== 0,
    inputSelector: p[3] & 15,
    micMode: (p[3] & 16) !== 0
  };
}
function decodeUiState(p) {
  if (p.length < 4) {
    return {
      page: 0,
      heldKey: -1,
      shift: false,
      tempo: false,
      mixer: false,
      screen: false,
      stop: false,
      record: false,
      trackHeld: false,
      project: false,
      raw: p
    };
  }
  const step = p[1] & 31;
  return {
    page: p[0] >> 6 & 3,
    heldKey: step < 16 ? step : -1,
    shift: (p[1] & 32) !== 0,
    tempo: (p[1] & 64) !== 0,
    mixer: (p[1] & 128) !== 0,
    screen: (p[2] & 32) !== 0,
    stop: (p[2] & 64) !== 0,
    record: (p[2] & 128) !== 0,
    trackHeld: (p[3] & 1) !== 0,
    project: (p[3] & 2) !== 0,
    raw: p
  };
}
function decodeChainState(p) {
  if (p.length < 20) return { chain: [], pattern: 0, nextIndex: 0, project: 0, address: 0, position: 0 };
  const length = Math.min(p[16] & 31, 31);
  const chain = [];
  for (let i = 0; i < length; i++) {
    chain.push(p[Math.floor(i / 2)] >> (i % 2 === 0 ? 0 : 4) & 15);
  }
  const pattern = p[17] & 15;
  const nextIndex = p[18];
  const project = p[19] & 15;
  const address = p[17];
  const position = chain.length === 0 ? 0 : nextIndex === 0 ? chain.length : nextIndex;
  return { chain, pattern, nextIndex, project, address, position };
}
function encodeChainState(chain, project) {
  const payload = new Uint8Array(20);
  for (let i = 0; i < chain.length; i++) {
    payload[Math.floor(i / 2)] |= (chain[i] & 15) << (i % 2 === 0 ? 0 : 4);
  }
  payload[16] = chain.length & 255;
  payload[17] = ((project & 15) << 4 | chain[0] & 15) & 255;
  payload[18] = (chain.length > 1 ? 1 : 0) & 255;
  payload[19] = project & 15;
  return payload;
}
function decodeMixerState(p) {
  if (p.length < 18) return { levels: new Uint8Array(16), muteMask: 0 };
  return { levels: p.slice(0, 16), muteMask: u16le(p, 16) };
}
function encodeMixerState(m) {
  const payload = new Uint8Array(18);
  payload.set(m.levels.subarray(0, 16), 0);
  payload[16] = m.muteMask & 255;
  payload[17] = m.muteMask >> 8 & 255;
  return payload;
}
function decodePatternState(p) {
  if (p.length < 3) {
    return { patternCopied: false, projectCopied: false, liftMode: 0, chainMode: false, autosave: false, bouncing: false };
  }
  return {
    patternCopied: p[0] !== 0,
    projectCopied: p[1] !== 0,
    liftMode: p[2] & 15,
    chainMode: (p[2] & 16) !== 0,
    autosave: (p[2] & 32) !== 0,
    bouncing: (p[2] & 64) !== 0
  };
}
function decodeModuleInfo(p) {
  if (p.length < 19) return { caps: 0, status: 0, name: "", connected: false };
  const searchEnd = Math.min(p.length, 8 + 10);
  let end = -1;
  for (let i = 8; i < searchEnd; i++) {
    if (p[i] === 0) {
      end = i;
      break;
    }
  }
  const nameLen = (end < 0 ? 18 : end) - 8;
  const name = new TextDecoder("ascii").decode(p.subarray(8, 8 + Math.max(0, nameLen)));
  return { caps: u32le(p, 0), status: u32le(p, 4), name, connected: p[18] !== 0 };
}
function decodeSamplerUiState(p) {
  if (p.length < 5) return { context: 0, packProgress: 0, position: 0, page: 0, active: false };
  return { context: p[0], packProgress: p[1], position: p[2], page: p[3], active: (p[4] & 1) !== 0 };
}
function deviceInfoFrom11(p) {
  return deviceInfo(p);
}

// src/session/opzSession.ts
var Changes = {
  None: 0,
  Connection: 1 << 0,
  Device: 1 << 1,
  Play: 1 << 2,
  Level: 1 << 3,
  Ui: 1 << 4,
  Chain: 1 << 5,
  Bank: 1 << 6,
  Global: 1 << 7,
  Sound: 1 << 8,
  Mixer: 1 << 9,
  PatternState: 1 << 10,
  Module: 1 << 11,
  MidiConfig: 1 << 12,
  Sampler: 1 << 13,
  AudioVis: 1 << 14,
  Transport: 1 << 15
};
var nowMs = () => Date.now();
var OpzSession = class {
  // ---- connection ----
  isConnected = false;
  portName = null;
  clockRunning = false;
  clockTicks = 0;
  // ---- mirrored state ----
  device = { serial: "", firmware: "" };
  play = decodePlayState(new Uint8Array(0));
  level = decodeLevelState(new Uint8Array(0));
  ui = decodeUiState(new Uint8Array(0));
  chain = decodeChainState(new Uint8Array(0));
  bank = null;
  bankAddress = 0;
  bankTransferId = 0;
  global = null;
  midiConfig = null;
  mixer = decodeMixerState(new Uint8Array(0));
  hasMixer = false;
  patternState = decodePatternState(new Uint8Array(0));
  module = decodeModuleInfo(new Uint8Array(0));
  sampler = decodeSamplerUiState(new Uint8Array(0));
  audioVis = 0;
  currentSound = Array.from({ length: TRACK_COUNT }, () => new Uint8Array(18));
  // ---- events ----
  onChanged = null;
  onNote = null;
  onControlChange = null;
  onLog = null;
  onRawSysex = null;
  // ---- diagnostics ----
  receivedFrames = 0;
  messageCounts = /* @__PURE__ */ new Map();
  parseErrors = [];
  transport;
  autoRequest;
  heartbeat;
  lastAckTicks = 0;
  patternPackets = [];
  pendingAck = null;
  pendingAckPacket = -1;
  pendingBank = null;
  /** Serializes frame processing so async zlib work never interleaves. */
  queue = Promise.resolve();
  constructor(options = {}) {
    this.transport = options.transport ?? null;
    this.autoRequest = options.autoRequest ?? this.transport != null;
    if (this.transport) {
      this.transport.onSysex = (data) => {
        void this.injectSysex(data);
      };
      this.transport.onShort = (s, d1, d2) => {
        void this.injectShort(s, d1, d2);
      };
    }
  }
  get activePattern() {
    return this.chain.pattern;
  }
  get activeTrack() {
    return this.play.track;
  }
  /** Bytes accumulated from incomplete pattern packets (no $0A terminator yet). */
  get patternPacketsLength() {
    return this.patternPackets.length;
  }
  emit(message) {
    this.onLog?.(message);
  }
  changed(flags) {
    this.onChanged?.(flags);
  }
  // ---------------------------------------------------------------- receive
  async injectSysex(data) {
    const run = this.queue.then(() => this.processSysex(data));
    this.queue = run.catch(() => {
    });
    await run;
  }
  async injectShort(status, data1 = 0, data2 = 0) {
    const run = this.queue.then(() => this.processShort(status, data1, data2));
    this.queue = run.catch(() => {
    });
    await run;
  }
  async processSysex(data) {
    this.receivedFrames++;
    if (isIdentityReply(data)) {
      this.processIdentity(data);
      return;
    }
    const frame3 = tryParse(data);
    if (!frame3) return;
    this.messageCounts.set(frame3.messageId, (this.messageCounts.get(frame3.messageId) ?? 0) + 1);
    this.onRawSysex?.(data);
    try {
      await this.handle(frame3);
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : String(ex);
      this.parseErrors.push(`$${frame3.messageId.toString(16)}: ${msg}`);
      this.emit(`Error handling $${frame3.messageId.toString(16)}: ${msg}`);
    }
  }
  processIdentity(data) {
    let body = new TextDecoder("ascii").decode(data.subarray(9, data.length - 1));
    body = body.replace(/[\0\x06]+$/, "");
    const nul = body.indexOf("\0");
    if (nul >= 0) body = body.slice(0, nul);
    if (body.length > 8 && this.device.serial === "") {
      this.device = { serial: body.slice(0, 8), firmware: body.slice(8) };
      this.changed(Changes.Device);
    }
  }
  processShort(status, d1, d2) {
    switch (status) {
      case 248:
        this.clockTicks++;
        return;
      case 250:
        this.clockTicks = 0;
        this.clockRunning = true;
        this.changed(Changes.Transport);
        return;
      case 251:
        this.clockRunning = true;
        this.changed(Changes.Transport);
        return;
      case 252:
        this.clockRunning = false;
        this.changed(Changes.Transport);
        return;
    }
    const kind = status & 240;
    const channel = status & 15;
    if (kind === 144 || kind === 128 || kind === 176) {
      const track = this.trackForChannel(channel);
      if (track < 0) return;
      if (kind === 176) this.onControlChange?.(track, d1, d2);
      else this.onNote?.(track, d1, kind === 128 ? 0 : d2);
    }
  }
  trackForChannel(channel) {
    if (!this.midiConfig) return channel;
    for (let t = 0; t < TRACK_COUNT; t++) if (this.midiConfig.channel(t) === channel) return t;
    return -1;
  }
  async handle(frame3) {
    const p = frame3.payload;
    switch (frame3.messageId) {
      case 1:
        this.lastAckTicks = nowMs();
        if (!this.isConnected) {
          this.setConnected(true);
          if (this.autoRequest && this.transport) this.scheduleAutoRequest();
        }
        break;
      case 2:
        this.applyPatternDelta(p);
        break;
      case 3:
        this.play = decodePlayState(p);
        this.changed(Changes.Play);
        break;
      case 4:
        this.level = decodeLevelState(p);
        this.changed(Changes.Level);
        break;
      case 6:
        this.ui = decodeUiState(p);
        this.changed(Changes.Ui);
        break;
      case 7: {
        const previous = this.chain.pattern;
        this.chain = decodeChainState(p);
        if (this.bank && previous !== this.chain.pattern) this.loadSoundFromBank();
        this.changed(Changes.Chain | Changes.Sound);
        break;
      }
      case 8:
        if (p.length >= 4 && p[0] === 255 && p[1] === 255) {
          this.emit("OP-Z rejected a pattern upload");
          this.pendingAck?.reject(new Error("upload rejected"));
        }
        break;
      case 9:
      case 10:
        await this.receivePatternPacket(frame3.messageId, p);
        break;
      case 11:
        if (p.length >= 8 && this.pendingAck) {
          const packet = (p[6] | p[7] << 8) & 65535;
          if (packet === this.pendingAckPacket) this.pendingAck.resolve(packet);
        }
        break;
      case 12:
        this.global = new GlobalData(await inflateZlib(p, GLOBAL_SIZE));
        this.changed(Changes.Global);
        break;
      case 14:
        if (p.length >= 19) {
          const track = p[0] & 15;
          const sound = p.subarray(1, 19);
          this.currentSound[track] = remapBankSoundToLive(sound);
          this.bank?.setSoundRecord(this.activePattern, track, sound);
          this.changed(Changes.Sound);
        }
        break;
      case 16:
        this.midiConfig = new MidiConfig(await inflateZlib(p, MIDI_CONFIG_SIZE));
        this.changed(Changes.MidiConfig);
        break;
      case 17:
        this.device = deviceInfoFrom11(p);
        this.changed(Changes.Device);
        break;
      case 18:
        this.mixer = decodeMixerState(p);
        this.hasMixer = true;
        this.changed(Changes.Mixer);
        break;
      case 19:
        this.patternState = decodePatternState(p);
        this.changed(Changes.PatternState);
        break;
      case 20:
        this.module = decodeModuleInfo(p);
        this.changed(Changes.Module);
        break;
      case 26:
        this.sampler = decodeSamplerUiState(p);
        this.changed(Changes.Sampler);
        break;
      case 27:
        if (p.length > 0) {
          this.audioVis = p[0];
          this.changed(Changes.AudioVis);
        }
        break;
    }
  }
  async receivePatternPacket(id, p) {
    if (p.length < 6) return;
    const packet = (p[4] | p[5] << 8) & 65535;
    if (packet === 0) this.patternPackets = [];
    for (let i = 6; i < p.length; i++) this.patternPackets.push(p[i]);
    this.bankAddress = p[0];
    this.bankTransferId = (p[2] | p[3] << 8) & 65535;
    if (id === 9) {
      const ack = Uint8Array.of(9, 0, 0, 0, p[2], p[3], p[4], p[5]);
      this.send(build(11, ack));
      return;
    }
    try {
      const data = await inflateZlib(Uint8Array.from(this.patternPackets), PATTERN_BANK_SIZE);
      if (data.length === PATTERN_BANK_SIZE) {
        this.bank = new PatternBank(data);
        this.loadSoundFromBank();
        this.pendingBank?.resolve(true);
        this.changed(Changes.Bank | Changes.Sound);
      }
    } catch (ex) {
      this.emit(`Pattern bank decode failed: ${String(ex)}`);
    }
    this.patternPackets = [];
  }
  loadSoundFromBank() {
    if (!this.bank) return;
    for (let t = 0; t < TRACK_COUNT; t++) {
      this.currentSound[t] = remapBankSoundToLive(this.bank.soundRecord(this.activePattern, t));
    }
  }
  applyPatternDelta(p) {
    let needsRefresh = false;
    let i = 0;
    while (this.bank && i + 7 <= p.length) {
      const offset = p[i + 2] | p[i + 3] << 8;
      const pattern = p[i + 4] & 15;
      const length = p[i + 5];
      const type = p[i + 6];
      if (i + 7 + length > p.length) break;
      if (type === 4 || type === 5) needsRefresh = true;
      else if (offset + length <= PATTERN_SIZE) {
        this.bank.data.set(p.subarray(i + 7, i + 7 + length), pattern * PATTERN_SIZE + offset);
      }
      i += 7 + length;
    }
    if (this.bank) {
      this.loadSoundFromBank();
      this.changed(Changes.Bank | Changes.Sound);
    }
    if (needsRefresh) this.scheduleBankRefresh();
  }
  scheduleBankRefresh() {
    if (this.transport) this.requestBank();
  }
  // ---------------------------------------------------------------- lifecycle
  start() {
    if (!this.transport || this.heartbeat !== void 0) return;
    const sessionId = 1 + Math.floor(Math.random() * 32767);
    const greeting = hello(sessionId);
    this.send(IDENTITY_INQUIRY);
    this.send(greeting);
    this.heartbeat = setInterval(() => this.send(greeting), 900);
  }
  scheduleAutoRequest() {
    setTimeout(() => {
      if (!this.bank) this.requestBank();
      if (!this.midiConfig) this.requestMidiConfig();
    }, 1500);
  }
  setConnected(connected) {
    if (this.isConnected === connected) return;
    this.isConnected = connected;
    if (!connected) {
      this.hasMixer = false;
      this.clockRunning = false;
    }
    this.emit(connected ? "Connected to OP-Z" : "Disconnected");
    this.changed(Changes.Connection);
  }
  // ---------------------------------------------------------------- send
  send(message) {
    try {
      this.transport?.sendSysex(message);
    } catch (ex) {
      this.emit(`Send failed: ${String(ex)}`);
    }
  }
  sendShort(status, d1 = 0, d2 = 0) {
    try {
      this.transport?.sendShort(status, d1, d2);
    } catch (ex) {
      this.emit(`Send failed: ${String(ex)}`);
    }
  }
  sendFrame(id, payload) {
    this.send(build(id, payload));
  }
  sendState(_key, message) {
    this.send(message);
  }
  requestBank() {
    if (!this.isConnected || !this.transport) return;
    this.send(build(8));
  }
  requestMidiConfig() {
    this.send(build(15));
  }
  async refreshBankAsync(timeoutMs = 3e3) {
    this.pendingBank = { resolve: () => {
    } };
    let resolveFn;
    const promise = new Promise((res) => {
      resolveFn = res;
    });
    this.pendingBank.resolve = resolveFn;
    this.requestBank();
    const result = await Promise.race([promise, new Promise((res) => setTimeout(() => res(false), timeoutMs))]);
    this.pendingBank = null;
    return result;
  }
  // ---- writable state (offline: no-op sends; live: dispatched to OP-Z) ----
  setSound(track, param, value) {
    this.currentSound[track][param] = value & 255;
    this.bank?.setSound(this.activePattern, track, liveToBankParam(param), value);
    const payload = new Uint8Array(19);
    payload[0] = track & 255;
    payload.set(remapLiveSoundToBank(this.currentSound[track]), 1);
    this.sendState(3584 | track, build(14, payload));
    this.changed(Changes.Sound);
  }
  selectTrack(track, octave) {
    this.play = { ...this.play, track, octave: octave ?? this.play.octave };
    this.send(build(3, encodePlayState(this.play)));
    this.changed(Changes.Play);
  }
  setOctave(octave) {
    this.selectTrack(this.play.track, Math.max(-3, Math.min(3, octave)));
  }
  selectPatterns(patterns) {
    if (patterns.length === 0) return;
    this.send(build(7, encodeChainState(patterns, this.chain.project)));
  }
  setMixer(state) {
    this.mixer = state;
    this.sendState(18, build(18, encodeMixerState(state)));
    this.changed(Changes.Mixer);
  }
  setTrackMute(track, muted) {
    let mask = this.mixer.muteMask;
    mask = muted ? mask | 1 << track : mask & ~(1 << track);
    this.setMixer({ levels: this.mixer.levels, muteMask: mask });
  }
  setGlobal(global) {
    this.global = global;
    void deflateZlib(global.data).then((compressed) => {
      this.sendState(12, build(12, compressed));
    });
    this.changed(Changes.Global);
  }
  editGlobal(edit) {
    if (!this.global) return;
    const copy = this.global.clone();
    edit(copy);
    this.setGlobal(copy);
  }
  setMidiConfig(config) {
    this.midiConfig = config;
    void deflateZlib(config.data).then((compressed) => {
      this.sendState(16, build(16, compressed));
    });
    this.changed(Changes.MidiConfig);
  }
  transportStart() {
    this.sendShort(250);
  }
  transportStop() {
    this.sendShort(252);
  }
  async uploadBankAsync(bank) {
    if (!this.isConnected || !this.transport) return false;
    const ok = await this.sendBankPacketsAsync(bank);
    if (ok) {
      this.bank = bank;
      this.loadSoundFromBank();
      this.changed(Changes.Bank | Changes.Sound);
      await this.refreshBankAsync(3e3);
      return true;
    }
    this.emit("Pattern upload failed");
    return false;
  }
  async sendBankPacketsAsync(bank) {
    const compressed = await deflateZlib(bank.data);
    const chunks = Math.ceil(compressed.length / 178);
    const address = this.bankAddress & 240;
    for (let index = 0; index < chunks; index++) {
      const chunk = compressed.subarray(index * 178, Math.min(compressed.length, index * 178 + 178));
      const payload = new Uint8Array(6 + chunk.length);
      payload[0] = address;
      payload[2] = this.bankTransferId & 255;
      payload[3] = this.bankTransferId >> 8 & 255;
      payload[4] = index & 255;
      payload[5] = index >> 8 & 255;
      payload.set(chunk, 6);
      const last = index === chunks - 1;
      if (last) {
        this.send(build(10, payload));
        return true;
      }
      const ack = new Promise((resolve, reject) => {
        this.pendingAck = { resolve, reject };
      });
      this.pendingAckPacket = index;
      this.send(build(9, payload));
      const done = await Promise.race([ack, new Promise((_, rej) => setTimeout(() => rej(new Error("ack timeout")), 1500))]);
      if (typeof done !== "number" || done !== index) return false;
    }
    return true;
  }
  dispose() {
    clearInterval(this.heartbeat);
    this.heartbeat = void 0;
    try {
      this.transport?.close();
    } catch {
    }
  }
};

// src/render/theme.ts
var OpbTheme = {
  Background: "#d0d0d0",
  Rule: "#b3b3b3",
  Mid: "#808080",
  Ink: "#131313",
  Red: "#d11d32",
  Yellow: "#ebb000",
  Green: "#025a30",
  Blue: "#175e83",
  White: "#f2f2f2",
  TapeBlue: "#136aa3",
  /** The four encoder colors in dial order: green, blue, yellow, red. */
  Dials: ["#025a30", "#175e83", "#ebb000", "#d11d32"],
  /** Frame color of each parameter page (device LED: white, green, purple, orange). */
  Pages: ["#131313", "#025a30", "#175e83", "#ebb000"],
  /** CSS font stack; Bahnschrift is not on Linux/SteamOS, so we fall back to a condensed sans. */
  Font: '"Bahnschrift", "DIN Condensed", "Roboto Condensed", "Segoe UI", system-ui, sans-serif'
};
var DESIGN_WIDTH = 1600;
var DESIGN_HEIGHT = 812;
function weightToCss(w) {
  return w === "light" ? "300" : w === "semibold" ? "600" : "400";
}

// src/render/draw.ts
var TEXT_WIDTH_SCALE = 0.875;
function fontString(size, weight = "light") {
  return `${weightToCss(weight)} ${size}px ${OpbTheme.Font}`;
}
var metricCache = /* @__PURE__ */ new Map();
function textWidth(ctx, text, size, weight = "light") {
  const key = `${text}|${size}|${weight}`;
  const hit = metricCache.get(key);
  if (hit !== void 0) return hit;
  ctx.font = fontString(size, weight);
  const w = ctx.measureText(text).width * TEXT_WIDTH_SCALE;
  if (metricCache.size > 4e3) metricCache.clear();
  metricCache.set(key, w);
  return w;
}
function label(ctx, text, x, y, size, color, align = "left", weight = "light") {
  ctx.font = fontString(size, weight);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  const drawY = y + size * 0.04;
  ctx.save();
  ctx.scale(TEXT_WIDTH_SCALE, 1);
  ctx.fillText(text, x / TEXT_WIDTH_SCALE, drawY);
  ctx.restore();
}
function hLine(ctx, x0, x1, y, color = OpbTheme.Rule, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
}
function vLine(ctx, x, y0, y1, color = OpbTheme.Rule, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
}
function frame(ctx, r, color, thickness = 4) {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.strokeRect(r.x + thickness / 2, r.y + thickness / 2, Math.max(0, r.w - thickness), Math.max(0, r.h - thickness));
}
function hatch(ctx, r, lineColor, backColor) {
  ctx.save();
  ctx.fillStyle = backColor;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const step = 14;
  for (let c = r.x + r.y; c <= r.x + r.w + r.y + r.h; c += step) {
    const xl = Math.max(r.x, c - (r.y + r.h));
    const xr = Math.min(r.x + r.w, c - r.y);
    if (xr >= xl) {
      ctx.moveTo(xl, c - xl);
      ctx.lineTo(xr, c - xr);
    }
  }
  ctx.stroke();
  ctx.restore();
}
function knobAngle(value01) {
  const deg = -135 + 270 * Math.max(0, Math.min(1, value01));
  return deg * Math.PI / 180;
}
function knob(ctx, cx, cy, value01, color, radius = 22, stem = true) {
  const angle = knobAngle(value01);
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  if (stem) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(cx + dx * radius * 0.9, cy + dy * radius * 0.9);
    ctx.lineTo(cx + dx * radius * 1.75, cy + dy * radius * 1.75);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  cross(ctx, cx, cy, radius * 0.5, angle);
}
function cross(ctx, cx, cy, half, angleRad = 0) {
  ctx.strokeStyle = OpbTheme.White;
  ctx.lineWidth = half * 0.42;
  ctx.lineCap = "butt";
  const ax = Math.cos(angleRad) * half;
  const ay = Math.sin(angleRad) * half;
  const bx = -Math.sin(angleRad) * half;
  const by = Math.cos(angleRad) * half;
  ctx.beginPath();
  ctx.moveTo(cx - ax, cy - ay);
  ctx.lineTo(cx + ax, cy + ay);
  ctx.moveTo(cx - bx, cy - by);
  ctx.lineTo(cx + bx, cy + by);
  ctx.stroke();
}
function handle(ctx, cx, cy, color, radius = 16) {
  knob(ctx, cx, cy, 0.5, color, radius, false);
}
function stepper(ctx, cx, cy, plus, enabled = true, radius = 15) {
  if (enabled) {
    ctx.fillStyle = OpbTheme.Mid;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = OpbTheme.Mid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = enabled ? OpbTheme.White : OpbTheme.Mid;
  ctx.lineWidth = radius * 0.24;
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.5, cy);
  ctx.lineTo(cx + radius * 0.5, cy);
  if (plus) {
    ctx.moveTo(cx, cy - radius * 0.5);
    ctx.lineTo(cx, cy + radius * 0.5);
  }
  ctx.stroke();
}
function button(ctx, r, text, enabled = true, primary = false, size = 30) {
  if (primary && enabled) {
    ctx.fillStyle = OpbTheme.Ink;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else {
    frame(ctx, r, enabled ? OpbTheme.Ink : OpbTheme.Rule, 3);
  }
  label(ctx, text, r.x + r.w / 2, r.y + r.h / 2, size, primary && enabled ? OpbTheme.White : enabled ? OpbTheme.Ink : OpbTheme.Mid, "center", "normal");
}
function toggle(ctx, cx, cy, on, enabled = true, size = 28) {
  const s = size;
  const x = cx - s / 2;
  const y = cy - s / 2;
  if (on) {
    ctx.fillStyle = enabled ? OpbTheme.Ink : OpbTheme.Mid;
    ctx.fillRect(x, y, s, s);
    cross(ctx, cx, cy, s * 0.3, Math.PI / 4);
  } else {
    frame(ctx, { x, y, w: s, h: s }, enabled ? OpbTheme.Mid : OpbTheme.Rule, 3);
  }
}
function wrapText(ctx, text, width, size, weight = "light") {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line.length === 0 ? word : line + " " + word;
    if (line.length > 0 && textWidth(ctx, candidate, size, weight) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}
function hsvToCss(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `rgb(${r},${g},${b})`;
}
function fitText(ctx, text, maxW, size, weight = "light") {
  if (textWidth(ctx, text, size, weight) <= maxW) return text;
  let s = text;
  while (s.length > 1 && textWidth(ctx, s + "\u2026", size, weight) > maxW) s = s.slice(0, -1);
  return s + "\u2026";
}
function hsvToRgb(h, s, v) {
  h = (h % 360 + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(h / 60 % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
var CT_ROW0 = 82;
var CT_BODY_BOTTOM = 602;
var CT_RIGHT_END = 1426;
var CT_BOTTOM = 812;
var CT_SEQ_LABEL_Y = 622;
var CT_SEQ_NUM_TOP = 645;
var CT_SEQ_DOT_TOP = 688;
var CT_SEQ_BOTTOM = 732;
var CT_STEP_X0 = 42;
var CT_STEP_W = 86.5;
function controlTrackChrome(ctx, input, title) {
  label(ctx, title, CT_RIGHT_END / 2, 40, 56, OpbTheme.Ink, "center", "normal");
  label(ctx, "TOUCH PAD", CT_RIGHT_END + 14, 40, 30, OpbTheme.Mid);
  hLine(ctx, input.left, input.right, CT_ROW0);
  vLine(ctx, CT_RIGHT_END, 0, CT_BOTTOM);
  hLine(ctx, input.left, input.right, CT_BODY_BOTTOM);
  hatch(ctx, { x: CT_RIGHT_END, y: CT_ROW0, w: input.right - CT_RIGHT_END, h: 648 }, OpbTheme.Rule, OpbTheme.Background);
}
function controlTrackStep(input, count, length) {
  const s = input.session;
  if (!s.clockRunning && !s.play.playing && !input.playing) return -1;
  let sixteenths;
  if (s.clockTicks > 0) sixteenths = s.clockTicks / 6;
  else if (input.playMs > 0) {
    const bpm = s.global ? s.global.tempo : 120;
    sixteenths = input.playMs / 1e3 / 60 * bpm * 4;
  } else return -1;
  return Math.floor(sixteenths / Math.max(1, length) % Math.max(1, count));
}
function controlTrackSequencer(ctx, input, track) {
  const LeftEdge = input.left, RightEdge = input.right;
  const session2 = input.session;
  const bank = session2.bank;
  const pattern = session2.activePattern;
  const count = bank ? bank.stepCount(pattern, track) : 16;
  const length = bank ? bank.stepLength(pattern, track) : 1;
  const playStep = controlTrackStep(input, count, length);
  label(ctx, "SEQUENCER", 30, CT_SEQ_LABEL_Y, 30, OpbTheme.Mid);
  hLine(ctx, LeftEdge, CT_RIGHT_END, CT_SEQ_NUM_TOP);
  ctx.fillStyle = OpbTheme.Rule;
  ctx.fillRect(LeftEdge, CT_SEQ_DOT_TOP, CT_RIGHT_END - LeftEdge, CT_SEQ_BOTTOM - CT_SEQ_DOT_TOP);
  hLine(ctx, LeftEdge, RightEdge, CT_SEQ_BOTTOM);
  for (let step = 0; step < 16; step++) {
    const x = CT_STEP_X0 + step * CT_STEP_W;
    const beyond = step >= count;
    if (step > 0) vLine(ctx, x, CT_SEQ_NUM_TOP, CT_SEQ_DOT_TOP, step % 4 === 0 ? OpbTheme.Ink : OpbTheme.Rule, step % 4 === 0 ? 2 : 1);
    label(ctx, String(step + 1), x + 4, CT_SEQ_NUM_TOP + 22, 40, beyond ? OpbTheme.Rule : OpbTheme.Mid);
    const notes = bank ? bank.notes(pattern, track, step) : [];
    const cx = x + CT_STEP_W / 2 - 21, cy = CT_SEQ_DOT_TOP + 22;
    if (beyond) {
      ctx.fillStyle = OpbTheme.Background;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
    } else if (notes.length > 0) {
      ctx.fillStyle = OpbTheme.Ink;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = OpbTheme.Mid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (playStep >= 0) {
    const fx = CT_STEP_X0 + playStep * CT_STEP_W;
    frame(ctx, { x: fx - 2, y: CT_SEQ_NUM_TOP - 2, w: CT_STEP_W + 2, h: CT_SEQ_BOTTOM - CT_SEQ_NUM_TOP + 4 }, OpbTheme.Yellow);
  }
  label(ctx, "STEP COUNT", 52, CT_SEQ_BOTTOM + 40, 32, OpbTheme.Mid);
  label(ctx, String(count), 247, CT_SEQ_BOTTOM + 40, 42, OpbTheme.Ink, "left", "normal");
  label(ctx, "STEP LENGTH", 398, CT_SEQ_BOTTOM + 40, 32, OpbTheme.Mid);
  label(ctx, String(length), 592, CT_SEQ_BOTTOM + 40, 42, OpbTheme.Ink, "left", "normal");
  label(ctx, "SUM", 1315, CT_SEQ_BOTTOM + 40, 32, OpbTheme.Mid, "right");
  label(ctx, String(count * length), 1350, CT_SEQ_BOTTOM + 40, 42, OpbTheme.Green, "left", "normal");
}
var WRITE_BADGE_RECT = { x: 1088, y: 8, w: 338, h: 58 };
var WRITE_PANEL_RECT = { x: 300, y: 120, w: 1e3, h: 580 };
var WRITE_MAX_LIST = 6;
var WRITE_LINE_H = 24;
function writeAccent(state) {
  if (state.phase === "committed") return OpbTheme.Green;
  if (state.phase === "rolled-back" || state.phase === "aborted") return OpbTheme.Red;
  return state.dryRun ? OpbTheme.Yellow : OpbTheme.Red;
}
function writeStatusBadge(ctx, state) {
  const r = WRITE_BADGE_RECT;
  const accent = writeAccent(state);
  ctx.fillStyle = OpbTheme.Ink;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = accent;
  ctx.fillRect(r.x, r.y, 8, r.h);
  label(
    ctx,
    fitText(ctx, state.kind, r.w - 32, 22, "normal"),
    r.x + 22,
    r.y + 20,
    22,
    OpbTheme.White,
    "left",
    "normal"
  );
  label(ctx, state.dryRun ? `DRY RUN \xB7 0 FRAMES SENT \xB7 ${state.phase.toUpperCase()}` : `ARMED \xB7 ${state.phase.toUpperCase()}`, r.x + 22, r.y + 42, 18, accent);
}
function writeEditorOverlay(ctx, state, options) {
  writeStatusBadge(ctx, state);
  const r = WRITE_PANEL_RECT;
  const accent = writeAccent(state);
  const left = r.x + 32, right = r.x + r.w - 32;
  const colW = (r.w - 96) / 2;
  const rightCol = left + colW + 32;
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  frame(ctx, r, accent, 6);
  label(ctx, "WRITE EDITOR \xB7 STAGE 6", left, r.y + 40, 26, OpbTheme.Mid);
  label(
    ctx,
    fitText(ctx, options.subtitle, r.w - 64, 30, "normal"),
    left,
    r.y + 82,
    30,
    OpbTheme.Ink,
    "left",
    "normal"
  );
  hLine(ctx, left, right, r.y + 108, accent, 3);
  label(ctx, `EVIDENCE  ${state.evidence}`, left, r.y + 144, 24, OpbTheme.Mid);
  label(
    ctx,
    `PHASE  ${state.phase.toUpperCase()}`,
    left,
    r.y + 176,
    24,
    OpbTheme.Ink,
    "left",
    "normal"
  );
  label(
    ctx,
    state.dryRun ? "DRY RUN \u2014 NO FRAMES HAVE BEEN SENT TO THE DEVICE" : "ARMED \u2014 COMMIT STILL REQUIRES A SECOND EXPLICIT CONFIRMATION",
    left,
    r.y + 208,
    24,
    accent,
    "left",
    "normal"
  );
  const statY = r.y + 252;
  const statW = (r.w - 64) / 3;
  const stats = [
    ["DIFF BYTES", String(state.diffCount)],
    ["FRAMES TO SEND", String(state.frameCount)],
    ["BASELINE BYTES", String(state.baselineBytes)]
  ];
  for (let i = 0; i < stats.length; i++) {
    const x = left + i * statW;
    if (i > 0) vLine(ctx, x - 16, statY - 14, statY + 52);
    label(ctx, stats[i][0], x, statY, 20, OpbTheme.Mid);
    label(ctx, stats[i][1], x, statY + 34, 34, OpbTheme.Ink, "left", "normal");
  }
  hLine(ctx, left, right, r.y + 310, OpbTheme.Rule, 2);
  label(ctx, "STAGED EDITS", left, r.y + 344, 24, OpbTheme.Green);
  label(ctx, "TRANSACTION / PLAN", rightCol, r.y + 344, 24, OpbTheme.Blue);
  vLine(ctx, rightCol - 16, r.y + 326, r.y + 540);
  const edits = state.edits.length ? state.edits : ["(none \u2014 stage a typed edit first)"];
  const details = state.details.length ? state.details : ["(no transaction yet)"];
  const listTop = r.y + 380;
  for (let i = 0; i < WRITE_MAX_LIST; i++) {
    if (edits[i]) label(
      ctx,
      fitText(ctx, edits[i], colW - 8, 20),
      left,
      listTop + i * WRITE_LINE_H,
      20,
      OpbTheme.Ink
    );
    if (details[i]) label(
      ctx,
      fitText(ctx, details[i], colW - 8, 20),
      rightCol,
      listTop + i * WRITE_LINE_H,
      20,
      OpbTheme.Ink
    );
  }
  const moreY = listTop + WRITE_MAX_LIST * WRITE_LINE_H;
  if (state.edits.length > WRITE_MAX_LIST) {
    label(ctx, `+${state.edits.length - WRITE_MAX_LIST} MORE`, left, moreY, 20, OpbTheme.Mid);
  }
  if (state.details.length > WRITE_MAX_LIST) {
    label(ctx, `+${state.details.length - WRITE_MAX_LIST} MORE`, rightCol, moreY, 20, OpbTheme.Mid);
  }
  hLine(ctx, left, right, r.y + 548, OpbTheme.Rule, 2);
  label(
    ctx,
    fitText(ctx, options.footnote ?? "BACKUP FIRST \xB7 FRESH READBACK \xB7 FULL DIFF \xB7 EXACT ROLLBACK", r.w - 64, 20),
    left,
    r.y + 566,
    20,
    OpbTheme.Mid
  );
}

// src/render/displays.ts
var DRUM_NOTE_STYLES = ["RETRIG", "MONO", "GATE", "LOOP"];
var SYNTH_NOTE_STYLES = ["POLY", "MONO", "LEGATO"];
var LFO_DESTINATIONS = ["P1", "P2", "FILTER", "RES", "ATTACK", "PITCH", "PAN", "VOLUME"];
var LFO_SHAPES = ["SINE", "TRIANGLE", "SQUARE", "SAW", "RANDOM", "GYRO", "SINE", "TRIANGLE", "SQUARE", "SAW", "RANDOM", "ONCE"];
var METRONOME_SOUNDS = ["CLICK", "SWEDISH", "ENGLISH", "GERMAN", "JAPANESE", "ITALIAN"];
var MIC_FX = ["NO FX", "FX 1", "FX 2", "FX 1+2"];
var SOUND_PARAM = {
  P1: 0,
  P2: 1,
  Attack: 2,
  Decay: 3,
  Sustain: 4,
  Release: 5,
  Portamento: 6,
  Fx1Send: 7,
  Fx2Send: 8,
  Filter: 9,
  Resonance: 10,
  Pan: 11,
  Level: 12,
  LfoDepth: 13,
  LfoSpeed: 14,
  LfoDest: 15,
  LfoShape: 16,
  NoteStyle: 17
};
function percent(raw) {
  return Math.round((raw & 255) * 99 / 255);
}
function band(raw, options) {
  return options[bandIndex(raw, options.length)] ?? "";
}
var bandName = band;
function bandIndex(raw, count) {
  return Math.min(count - 1, Math.floor((raw & 255) * count / 256));
}
function trackKind(track) {
  if (track <= 3) return "Drum";
  if (track <= 7) return "Synth";
  if (track === 8 || track === 9) return "Fx";
  if (track === 10) return "Tape";
  if (track === 11) return "Master";
  if (track === 12) return "Perform";
  if (track === 13) return "Module";
  if (track === 14) return "Lights";
  return "Motion";
}
function paramInfo(value, label2, format) {
  return {
    label: label2,
    value: value & 255,
    text: format ? format(value & 255) : `${percent(value & 255)}`
  };
}

// src/render/screens/track.ts
var SOUND_PARAMS = [0, 1, 9, 10];
var ENVELOPE_PARAMS = [2, 3, 4, 5];
var TitleY = 40;
var Row0 = 82;
var Row1 = 212;
var Row2 = 342;
var EnvLabels = 428;
var Row3 = 472;
var Row4 = 602;
var ColLabel = 216;
var ColW = 130;
var FxLeft = 736;
var FxRight = 952;
var FxEnd = 1212;
var RightEnd = 1426;
var SeqLabelY = 622;
var SeqNumTop = 645;
var SeqDotTop = 688;
var SeqBottom = 732;
var StepX0 = 42;
var StepW = 86.5;
function dialBrush(page, dial, uiPage) {
  return uiPage === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
}
function pageOneLabels(kind) {
  switch (kind) {
    case "Master":
      return ["CHORUS", "DRIVE", "FILTER", "RES"];
    case "Lights":
      return ["COLOR", "ALT COL", "SPEED", "INTENS"];
    case "Motion":
      return ["HUE", "SAT", "BRIGHT", "CONTR"];
    case "Tape":
      return ["SPEED", "FINE", "FILTER", "RES"];
    default:
      return ["P1", "P2", "FILTER", "RES"];
  }
}
function formatBipolar(v) {
  const c = Math.round(((v & 255) - 128) / 128 * 50);
  return c === 0 ? "0" : c < 0 ? `LP ${-c}` : `HP ${c}`;
}
function hsv(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(h / 60 % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (n) => Math.round((n + m) * 255);
  return `rgb(${to(r)},${to(g)},${to(b)})`;
}
function renderTrack(ctx, input) {
  const session2 = input.session;
  const track = session2.play.track;
  const kind = trackKind(track);
  const uiPage = session2.messageCounts.has(6) ? session2.ui.page : -1;
  const S = (p) => session2.currentSound[track][p] & 255;
  const snd = (p, labelText, fmt) => paramInfo(S(p), labelText, fmt);
  label(ctx, TRACK_NAMES[session2.play.track] ?? "TRACK", RightEnd / 2, TitleY, 56, OpbTheme.Ink, "center", "normal");
  label(ctx, "TOUCH PAD", RightEnd + 14, TitleY, 30, OpbTheme.Mid, "left");
  hLine(ctx, input.left, input.right, Row0);
  vLine(ctx, RightEnd, input.top, input.bottom);
  hLine(ctx, input.left, RightEnd, Row1);
  hLine(ctx, input.left, ColLabel, Row3);
  hLine(ctx, input.left, FxLeft, EnvLabels);
  hLine(ctx, input.left, FxLeft, Row3);
  hLine(ctx, input.left, input.right, Row4);
  hLine(ctx, FxEnd, RightEnd, Row2);
  hLine(ctx, FxEnd, RightEnd, Row3);
  vLine(ctx, ColLabel, Row0, Row4);
  for (let i = 1; i < 4; i++) {
    vLine(ctx, ColLabel + i * ColW, Row0, Row1);
    vLine(ctx, ColLabel + i * ColW, EnvLabels, Row4);
  }
  vLine(ctx, FxLeft, Row0, Row4);
  vLine(ctx, FxRight, Row0, Row4);
  vLine(ctx, FxRight + ColW, Row0, Row1);
  vLine(ctx, FxEnd, Row0, Row4);
  hatch(ctx, { x: RightEnd, y: Row0, w: input.right - RightEnd, h: SeqBottom - 2 - Row0 }, OpbTheme.Rule, OpbTheme.Background);
  drawSoundRow(ctx, input, track, kind, S, snd);
  drawEnvelope(ctx, input, kind, S, dialBrush);
  drawLfoRow(ctx, input, track, kind, S, snd, dialBrush);
  drawSends(ctx, input, kind, S, snd, dialBrush);
  drawTrackSettings(ctx, input, kind, session2, track, snd);
  drawSequencer(ctx, input, session2, track);
  const pageRect = uiPage === 0 ? { x: ColLabel, y: Row0, w: 4 * ColW, h: Row1 - Row0 } : uiPage === 1 ? { x: ColLabel, y: Row1, w: 4 * ColW, h: Row3 - Row1 } : uiPage === 2 ? { x: ColLabel, y: Row3, w: 4 * ColW, h: Row4 - Row3 } : { x: FxLeft, y: Row0, w: FxEnd - FxLeft, h: Row4 - Row0 };
  if (uiPage >= 0) frame(ctx, pageRect, OpbTheme.Pages[uiPage]);
  if (input.selected && input.selected.track === track) {
    const sp = input.selected.param;
    if (uiPage === 0 && SOUND_PARAMS.includes(sp)) {
      const i = SOUND_PARAMS.indexOf(sp);
      frame(ctx, { x: ColLabel + i * ColW, y: Row0, w: ColW, h: Row1 - Row0 }, OpbTheme.Red);
    } else if (uiPage === 2 && (sp === 13 || sp === 14 || sp === 15 || sp === 16)) {
      const i = [13, 14, 15, 16].indexOf(sp);
      frame(ctx, { x: ColLabel + i * ColW, y: Row3, w: ColW, h: Row4 - Row3 }, OpbTheme.Red);
    } else if (uiPage === 3 && (sp === 7 || sp === 8)) {
      const i = sp === 7 ? 0 : 1;
      frame(ctx, { x: FxRight + i * ColW, y: Row0, w: ColW, h: Row1 - Row0 }, OpbTheme.Red);
    }
  }
}
function drawSoundRow(ctx, input, track, kind, S, snd) {
  label(ctx, kind === "Fx" ? "EFFECT" : "SOUND", 20, Row0 + 42, 30, OpbTheme.Mid, "left");
  const name = plugName(input.session, track);
  label(ctx, fit(ctx, name, 190, 32), 20, Row0 + 85, 32, OpbTheme.Ink, "left", "normal");
  const labels = pageOneLabels(kind);
  for (let i = 0; i < 4; i++) {
    const p = SOUND_PARAMS[i];
    const fmt = kind === "Master" && p === 9 ? formatBipolar : void 0;
    paramCell(ctx, ColLabel + i * ColW, Row0, labels[i], snd(p, labels[i], fmt), 0, i);
  }
  if (kind === "Lights") {
    for (let i = 0; i < 2; i++) {
      const hue = S(i === 0 ? 0 : 1) / 255 * 360;
      ctx.fillStyle = hsv(hue, 0.85, 0.9);
      ctx.fillRect(ColLabel + i * ColW + 92, Row0 + 10, 28, 20);
    }
  }
}
function drawEnvelope(ctx, input, kind, S, dialBrush2) {
  const hasEnvelope = kind === "Drum" || kind === "Synth" || kind === "Module";
  label(ctx, "ENVELOPE", 20, Row1 + 42, 30, OpbTheme.Mid, "left");
  const area = { x: ColLabel, y: Row1, w: 4 * ColW, h: EnvLabels - Row1 };
  if (!hasEnvelope) {
    hatch(ctx, { x: area.x + 1, y: area.y + 1, w: area.w - 2, h: Row3 - Row1 - 2 }, OpbTheme.Rule, OpbTheme.Background);
    return;
  }
  const letters = kind === "Drum" ? ["S", "A", "H", "D"] : ["A", "D", "S", "R"];
  for (let i = 0; i < 4; i++) {
    const cx = ColLabel + i * ColW + ColW / 2;
    const param = sndEnv(S, ENVELOPE_PARAMS[i]);
    const lw = textWidth(ctx, letters[i], 30);
    const vw = textWidth(ctx, param.text, 30);
    const left = cx - (lw + 10 + vw) / 2;
    label(ctx, letters[i], left, EnvLabels + 22, 30, dialBrush2(1, i, input.session.ui.page));
    label(ctx, param.text, left + lw + 10, EnvLabels + 22, 30, OpbTheme.Ink, "left", "normal");
  }
  const x0 = 260, x1 = 692, top = Row1 + 43, bottom = Row1 + 173, w = x1 - x0;
  const linePen = OpbTheme.Mid;
  const handleColor = input.session.ui.page === 1 ? OpbTheme.Ink : OpbTheme.Mid;
  const a = S(2) / 255, d = S(3) / 255, s = S(4) / 255, r = S(5) / 255;
  let handles = [];
  ctx.strokeStyle = linePen;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "Drum") {
    const xs = x0 + a * w * 0.22, xa = xs + d * w * 0.22, xd = x1 - r * w * 0.27;
    const xh = Math.max(xa, xa + (xd - xa) * s);
    ctx.moveTo(x0, bottom);
    ctx.lineTo(xs, bottom);
    ctx.lineTo(xa, top);
    ctx.lineTo(xh, top);
    ctx.bezierCurveTo(xh + (x1 - xh) * 0.55, top, x1, top + (bottom - top) * 0.45, x1, bottom);
    ctx.lineTo(x0, bottom);
    handles = [[xs, bottom], [xa, top], [xh, top], [x1, bottom]];
    dashedLine(ctx, xh, top + 10, xh, bottom, linePen);
  } else {
    const xa = x0 + a * w * 0.3, xd = xa + d * w * 0.3, ys = bottom - s * (bottom - top);
    const xr = Math.max(x1 - r * w * 0.3, xd);
    ctx.moveTo(x0, bottom);
    ctx.lineTo(xa, top);
    ctx.bezierCurveTo(xa + (xd - xa) * 0.3, ys - (ys - top) * 0.1, xd - (xd - xa) * 0.2, ys, xd, ys);
    ctx.lineTo(xr, ys);
    ctx.bezierCurveTo(xr + (x1 - xr) * 0.4, ys, x1, bottom - (bottom - ys) * 0.3, x1, bottom);
    handles = [[xa, top], [xd, ys], [xr, ys], [x1, bottom]];
    dashedLine(ctx, xr, ys + 10, xr, bottom, linePen);
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x1, bottom);
    ctx.stroke();
  }
  ctx.stroke();
  for (let i = 0; i < handles.length; i++) handle(ctx, handles[i][0], handles[i][1], dialBrush2(1, i, input.session.ui.page));
  if (kind === "Drum") handle(ctx, x0, bottom, handleColor);
}
function drawLfoRow(ctx, input, track, kind, S, snd, dialBrush2) {
  const arp = track === 6;
  label(ctx, arp ? "ARP" : "LFO", 20, Row3 + 42, 30, OpbTheme.Mid, "left");
  const y = Row3;
  if (arp) {
    paramCell(ctx, ColLabel, y, "SPEED", snd(13, "SPEED", (v) => v < 16 ? "OFF" : bandName(v, ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/64"])), 2, 0);
    textCell(ctx, ColLabel + ColW, y, "PATTERN", snd(14, "PATTERN", (v) => bandName(v, ["MANUAL", "UP", "DOWN", "UP/DN", "DN/UP", "RANDOM"])), 2, 1);
    textCell(ctx, ColLabel + 2 * ColW, y, "STYLE", snd(15, "STYLE", (v) => (bandIndex(v, 6) + 1).toString()), 2, 2);
    paramCell(ctx, ColLabel + 3 * ColW, y, "RANGE", snd(16, "RANGE", (v) => (bandIndex(v, 4) + 1).toString()), 2, 3);
    return;
  }
  paramCell(ctx, ColLabel, y, "DEPTH", snd(13, "DEPTH", (v) => `${percent(v)}`), 2, 0);
  paramCell(ctx, ColLabel + ColW, y, "RATE", snd(14, "RATE"), 2, 1);
  const dest = snd(15, "DEST", (v) => bandName(v, LFO_DESTINATIONS));
  const dx = ColLabel + 2 * ColW;
  label(ctx, "DEST", dx + 8, y + 20, 30, OpbTheme.Mid, "left");
  ctx.fillStyle = dialBrush2(2, 2, input.session.ui.page);
  ctx.beginPath();
  ctx.ellipse(dx + 65, y + 65, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, dest.text, dx + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
  const shapeIndex = bandIndex(S(16), LFO_SHAPES.length);
  const sx = ColLabel + 3 * ColW;
  label(ctx, "SHAPE", sx + 8, y + 20, 30, OpbTheme.Mid, "left");
  drawLfoShape(ctx, shapeIndex, { x: sx + 20, y: y + 42, w: 90, h: 42 }, dialBrush2(2, 3, input.session.ui.page));
  label(ctx, shapeIndex.toString(), sx + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
}
function drawSends(ctx, input, kind, S, snd, dialBrush2) {
  if (kind === "Fx" || kind === "Lights") {
    hatch(ctx, { x: FxLeft + 1, y: Row0 + 1, w: FxEnd - FxLeft - 2, h: Row4 - Row0 - 2 }, OpbTheme.Rule, OpbTheme.Background);
    return;
  }
  label(ctx, "FX SEND", FxLeft + 18, Row0 + 42, 30, OpbTheme.Mid, "left");
  paramCell(ctx, FxRight, Row0, "1", snd(7, "FX SEND 1"), 3, 0);
  paramCell(ctx, FxRight + ColW, Row0, "2", snd(8, "FX SEND 2"), 3, 1);
  const pan = snd(11, "PAN", (v) => v === 128 ? "C" : v < 128 ? `L${percent((128 - v) * 2 - 1 & 255)}` : `R${percent((v - 128) * 2 + 1 & 255)}`);
  label(ctx, "PAN", FxLeft + 18, Row1 + 42, 30, OpbTheme.Mid, "left");
  const pcx = FxRight + ColW, pcy = Row1 + 64;
  label(ctx, "L", pcx - 65, pcy, 30, OpbTheme.Ink, "center");
  label(ctx, "R", pcx + 65, pcy, 30, OpbTheme.Ink, "center");
  const px = pcx + (S(11) - 128) / 128 * 42;
  const panBrush = dialBrush2(3, 2, input.session.ui.page);
  ctx.strokeStyle = panBrush;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(pcx, pcy - 42);
  ctx.lineTo(pcx, pcy - 22);
  ctx.stroke();
  ctx.fillStyle = panBrush;
  ctx.beginPath();
  ctx.ellipse(px, pcy, 22, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  cross(ctx, px, pcy, 11, 0);
  const level = snd(12, "LEVEL");
  label(ctx, "LEVEL", FxLeft + 18, Row2 + 42, 30, OpbTheme.Mid, "left");
  const lx = FxRight + ColW, ltop = Row2 + 30, lbottom = Row2 + 193;
  const ly = lbottom - S(12) / 255 * (lbottom - ltop);
  const levelBrush = dialBrush2(3, 3, input.session.ui.page);
  ctx.strokeStyle = OpbTheme.Rule;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(lx, ltop - 8);
  ctx.lineTo(lx, lbottom);
  ctx.stroke();
  ctx.strokeStyle = levelBrush;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx, lbottom);
  ctx.stroke();
  ctx.fillStyle = levelBrush;
  ctx.beginPath();
  ctx.ellipse(lx, ly, 16, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  cross(ctx, lx, ly, 8, 0);
  label(ctx, level.text, lx, lbottom + 32, 32, OpbTheme.Ink, "center", "normal");
}
function drawTrackSettings(ctx, input, kind, session2, track, snd) {
  const bank = session2.bank;
  const styles = kind === "Drum" ? DRUM_NOTE_STYLES : kind === "Master" ? ["LATCH", "FREE"] : SYNTH_NOTE_STYLES;
  const noteLengthValue = bank ? bank.noteLength(session2.activePattern, track) : 0;
  const noteLength = {
    label: "NOTE LENGTH",
    value: noteLengthValue,
    text: bandName(noteLengthValue, ["1/64", "1/32", "1/16", "1/8", "1/4", "1/2", "1", "DRONE"])
  };
  const noteStyle = snd(17, "NOTE STYLE", (v) => bandName(v, styles));
  const quantizeValue = bank ? bank.quantize(session2.activePattern, track) : 0;
  const quantize = {
    label: "QUANTIZE",
    value: quantizeValue,
    text: `${percent(quantizeValue)}`
  };
  const fourth = kind === "Tape" || kind === "Module" ? "DRY LEVEL" : "PORTAMENTO";
  const portamento = snd(6, fourth);
  const items = [noteLength, noteStyle, quantize, portamento];
  const rows2 = [Row0, Row1, Row2, Row3];
  for (let i = 0; i < 4; i++) {
    label(ctx, items[i].label, FxEnd + 18, rows2[i] + 42, 30, OpbTheme.Mid, "left");
    label(ctx, items[i].text, FxEnd + 106, rows2[i] + 90, 42, OpbTheme.Ink, "center", "normal");
  }
}
function drawSequencer(ctx, input, session2, track) {
  label(ctx, "SEQUENCER", 30, SeqLabelY, 30, OpbTheme.Mid, "left");
  hLine(ctx, input.left, RightEnd, SeqNumTop);
  ctx.fillStyle = OpbTheme.Rule;
  ctx.fillRect(input.left, SeqDotTop, RightEnd - input.left, SeqBottom - SeqDotTop);
  hLine(ctx, input.left, input.right, SeqBottom);
  const bank = session2.bank;
  const count = bank ? bank.stepCount(session2.activePattern, track) : 16;
  const length = bank ? bank.stepLength(session2.activePattern, track) : 1;
  const playStep = currentStep(session2, count, length, input);
  for (let step = 0; step < 16; step++) {
    const x = StepX0 + step * StepW;
    const beyond = step >= count;
    const sepColor = step % 4 === 0 ? OpbTheme.Ink : OpbTheme.Rule;
    if (step > 0) vLine(ctx, x, SeqNumTop, SeqDotTop, sepColor, step % 4 === 0 ? 2 : 1);
    label(ctx, (step + 1).toString(), x + 4, SeqNumTop + 22, 40, beyond ? OpbTheme.Rule : OpbTheme.Mid, "left", "normal");
    const cx = x + StepW / 2 - 21, cy = SeqDotTop + 22;
    const trig = bank ? bank.hasTrig(session2.activePattern, track, step) : false;
    ctx.fillStyle = beyond ? OpbTheme.Background : trig ? OpbTheme.Ink : OpbTheme.Mid;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 11, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    if (bank && !beyond) {
      if (bank.hasAnyLock(session2.activePattern, track, step)) {
        ctx.strokeStyle = OpbTheme.Red;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 16, 16, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (bank.componentMask(session2.activePattern, track, step) !== 0) {
        ctx.fillStyle = OpbTheme.Green;
        ctx.beginPath();
        ctx.ellipse(cx + 26, cy - 10, 5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const frameColor = OpbTheme.Yellow;
  if (playStep >= 0) frame(ctx, { x: StepX0 + playStep * StepW - 2, y: SeqNumTop - 2, w: StepW + 2, h: SeqBottom - SeqNumTop + 4 }, frameColor);
  else frame(ctx, { x: StepX0 - 2, y: SeqNumTop - 2, w: StepW + 2, h: SeqBottom - SeqNumTop + 4 }, frameColor);
  label(ctx, "STEP COUNT", 52, SeqBottom + 40, 32, OpbTheme.Mid, "left");
  label(ctx, count.toString(), 247, SeqBottom + 40, 42, OpbTheme.Ink, "left", "normal");
  label(ctx, "STEP LENGTH", 398, SeqBottom + 40, 32, OpbTheme.Mid, "left");
  label(ctx, length.toString(), 592, SeqBottom + 40, 42, OpbTheme.Ink, "left", "normal");
  label(ctx, "SUM", 1315, SeqBottom + 40, 32, OpbTheme.Mid, "right");
  label(ctx, (count * length).toString(), 1350, SeqBottom + 40, 42, OpbTheme.Green, "left", "normal");
}
function paramCell(ctx, x, y, labelText, param, _page, dial) {
  const rect = { x, y, w: ColW, h: Row1 - Row0 };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, "left");
  knob(ctx, x + 65, y + 65, param.value / 255, OpbTheme.Dials[dial]);
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
}
function textCell(ctx, x, y, labelText, param, _page, dial) {
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, "left");
  ctx.fillStyle = OpbTheme.Dials[dial];
  ctx.beginPath();
  ctx.ellipse(x + 65, y + 65, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, param.text, x + 65, y + 107, 30, OpbTheme.Ink, "center", "normal");
}
function drawLfoShape(ctx, index, r, brush) {
  ctx.strokeStyle = brush;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const l = r.x, rt = r.x + r.w, t = r.y, b = r.y + r.h, m = (t + b) / 2, cx = (l + rt) / 2;
  ctx.beginPath();
  switch (index % 6) {
    case 0:
      ctx.moveTo(l, m);
      ctx.bezierCurveTo(l + r.w * 0.18, t - 6, cx - r.w * 0.12, t - 6, cx, m);
      ctx.bezierCurveTo(cx + r.w * 0.12, b + 6, rt - r.w * 0.18, b + 6, rt, m);
      break;
    case 1:
      ctx.moveTo(l, b);
      ctx.lineTo(cx, t);
      ctx.lineTo(rt, b);
      break;
    case 2:
      ctx.moveTo(l, b);
      ctx.lineTo(l, t);
      ctx.lineTo(cx, t);
      ctx.lineTo(cx, b);
      ctx.lineTo(rt, b);
      break;
    case 3:
      ctx.moveTo(l, b);
      ctx.lineTo(rt, t);
      ctx.lineTo(rt, b);
      break;
    case 4: {
      const ys = [m, t, t, b, b, m + 6, m + 6, t + 8, t + 8, m];
      ctx.moveTo(l, m);
      for (let i = 1; i < ys.length; i++) ctx.lineTo(l + r.w * Math.floor((i + 1) / 2) / 5, ys[i]);
      break;
    }
    default:
      ctx.ellipse(cx + r.h / 2, m, r.h / 2, r.h / 2, 0, -Math.PI / 2, Math.PI / 2);
      ctx.ellipse(cx - r.h / 2, m, r.h / 2, r.h / 2, 0, Math.PI / 2, -Math.PI / 2);
      break;
  }
  ctx.stroke();
  if (index >= 6) {
    ctx.fillStyle = brush;
    ctx.beginPath();
    ctx.ellipse(r.x - 6, r.y + r.h, 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
function sndEnv(S, p) {
  return paramInfo(S(p), "", (v) => `${percent(v)}`);
}
function dashedLine(ctx, x0, y0, x1, y1, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}
function fit(ctx, text, width, size) {
  let t = text;
  while (t.length > 1 && textWidth(ctx, t, size, "normal") > width) t = t.slice(0, -1);
  return t;
}
function plugName(session2, track) {
  const s = session2.currentSound[track];
  if (s && s[0] !== 0) return `PLUG ${s[0]}`;
  return ["KICK", "SNARE", "PERC", "SAMPLE", "BASS", "LEAD", "ARP", "CHORD", "FX1", "FX2", "TAPE", "MASTER", "PERFORM", "MODULE", "LIGHTS", "MOTION"][track] ?? "TRACK";
}
function currentStep(session2, count, length, input) {
  if (!input.playing) return -1;
  let sixteenths;
  if (session2.clockTicks > 0) sixteenths = session2.clockTicks / 6;
  else {
    const bpm = session2.global ? session2.global.tempo : 120;
    sixteenths = input.playMs / 1e3 / 60 * bpm * 4;
  }
  return Math.floor(sixteenths / Math.max(1, length) % Math.max(1, count));
}

// src/render/screens/mixer.ts
var TitleY2 = 40;
var Row02 = 82;
var IconRow = 150;
var ValueY = 184;
var FaderTop = 214;
var FaderBottom = 641;
var MeterY = 726;
var X0 = 107;
var ColW2 = 173.5;
var BarW = 130;
var BarH = 21;
var MeterR = 64;
var PULSE_SECONDS = 0.45;
var GROUP_NAMES = ["DRUM GROUP", "SYNTH GROUP", "PUNCH", "MASTER"];
var GROUP_X = [129, 389, 1083, 1343];
var GROUP_BRUSHES = [OpbTheme.Green, OpbTheme.Blue, OpbTheme.Yellow, OpbTheme.Red];
function renderMixer(ctx, input) {
  const session2 = input.session;
  const now = input.nowMs / 1e3;
  label(ctx, "MIXER", input.right / 2, TitleY2, 56, OpbTheme.Ink, "center", "normal");
  for (let g = 0; g < 4; g++) {
    handle(ctx, GROUP_X[g], TitleY2 + 2, GROUP_BRUSHES[g], 22);
    const gl = groupLevel(session2, g);
    label(ctx, `${percent(gl)}`, GROUP_X[g] + 41, TitleY2, 36, OpbTheme.Ink, "left", "normal");
    label(ctx, GROUP_NAMES[g], GROUP_X[g] + 41, TitleY2, 30, OpbTheme.Mid, "left");
  }
  for (let t = 0; t < 8; t++) {
    const x = X0 + t * ColW2, cx = x + ColW2 / 2;
    const muted = isMuted(session2, t);
    if (muted) hatch(ctx, { x, y: FaderTop, w: ColW2, h: input.bottom - FaderTop }, OpbTheme.Rule, OpbTheme.Background);
    drawGlyph(ctx, t, x + 17, (Row02 + IconRow) / 2);
    const level = session2.hasMixer ? session2.mixer.levels[t] : session2.currentSound[t][12];
    label(ctx, `${percent(level & 255)}`, cx, ValueY, 42, OpbTheme.Ink, "center", "normal");
    const y = FaderBottom - (level & 255) / 255 * (FaderBottom - FaderTop);
    const color = muted ? OpbTheme.Rule : t < 4 ? OpbTheme.Green : OpbTheme.Blue;
    ctx.strokeStyle = OpbTheme.Rule;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, FaderTop);
    ctx.lineTo(cx, FaderBottom);
    ctx.stroke();
    if (!muted) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, FaderBottom);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.fillRect(cx - BarW / 2, y - BarH / 2, BarW, BarH);
    const center = [cx, MeterY];
    ctx.save();
    ctx.beginPath();
    ctx.arc(center[0], center[1], MeterR, 0, Math.PI * 2);
    ctx.clip();
    hatch(ctx, { x: center[0] - MeterR, y: center[1] - MeterR, w: MeterR * 2, h: MeterR * 2 }, OpbTheme.Rule, OpbTheme.Background);
    ctx.restore();
    const at = input.meterAt[t];
    const k = Math.max(0, Math.min(1, 1 - (now - at) / PULSE_SECONDS));
    const amp = 0.4 + 0.6 * input.meterVel[t];
    if (k > 0) {
      const ring = 12 + (MeterR - 12) * amp * (1 - k * k);
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = OpbTheme.White;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(center[0], center[1], ring, ring, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const dot = 10 + 14 * k * k * amp;
    ctx.fillStyle = OpbTheme.White;
    ctx.beginPath();
    ctx.ellipse(center[0], center[1], dot, dot, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  hLine(ctx, input.left, input.right, Row02);
  hLine(ctx, input.left, input.right, IconRow);
  hLine(ctx, input.left, input.right, FaderBottom);
  for (let i = 0; i <= 8; i++) vLine(ctx, X0 + i * ColW2, Row02, input.bottom);
}
function groupLevel(session2, g) {
  if (!session2.global) return 0;
  return [session2.global.drumLevel, session2.global.synthLevel, session2.global.punchLevel, session2.global.masterLevel][g] & 255;
}
function isMuted(session2, t) {
  if (session2.hasMixer) return (session2.mixer.muteMask & 1 << t) !== 0;
  return session2.bank ? session2.bank.isMuted(session2.activePattern, t) : false;
}
function drawGlyph(ctx, track, x, y) {
  ctx.strokeStyle = OpbTheme.Mid;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "butt";
  switch (track) {
    case 0:
      ctx.beginPath();
      ctx.ellipse(x + 14, y - 3, 13, 13, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.ellipse(x + 14, y - 5, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 2);
      ctx.lineTo(x + 14, y + 16);
      ctx.stroke();
      break;
    case 1:
      ctx.strokeRect(x + 1, y - 11, 26, 10);
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 1);
      ctx.lineTo(x + 14, y + 15);
      ctx.stroke();
      break;
    case 2:
      ctx.beginPath();
      ctx.moveTo(x, y - 1);
      ctx.lineTo(x + 28, y - 1);
      ctx.stroke();
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x + 14, y - 12);
      ctx.lineTo(x + 23, y - 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 14);
      ctx.lineTo(x + 14, y + 15);
      ctx.stroke();
      break;
    case 3: {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8, y);
      const h = [16, 26, 12, 20];
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(x + 11 + i * 5, y - h[i] / 2);
        ctx.lineTo(x + 11 + i * 5, y + h[i] / 2);
      }
      ctx.moveTo(x + 29, y);
      ctx.lineTo(x + 37, y);
      ctx.stroke();
      break;
    }
    case 4:
      label(ctx, "B", x + 2, y, 36, OpbTheme.Mid, "left");
      break;
    case 5:
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.ellipse(x + 7, y + 10, 6.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 9);
      ctx.lineTo(x + 12, y - 14);
      ctx.stroke();
      break;
    case 6:
      ctx.fillStyle = OpbTheme.Mid;
      ctx.beginPath();
      ctx.ellipse(x + 14, y - 7, 5.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 5, y + 6, 5.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 23, y + 6, 5.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      label(ctx, "CH", x + 2, y, 36, OpbTheme.Mid, "left");
      break;
  }
}

// src/render/screens/tempo.ts
var TitleY3 = 40;
var Row03 = 82;
var TopY = 139;
var BaseY = 564;
var BottomY = 758;
var TopHalf = 41;
var BottomHalf = 195;
var PivotX = 800;
var RodLength = 400;
var MaxSwing = 30;
var BpmY = 661;
function renderTempo(ctx, input) {
  const session2 = input.session;
  const tempo = session2.global ? session2.global.tempo : 120;
  const playing = input.playing;
  label(ctx, "TEMPO", input.right / 2, TitleY3, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row03);
  ctx.fillStyle = OpbTheme.Ink;
  ctx.beginPath();
  ctx.moveTo(PivotX - TopHalf, TopY);
  ctx.lineTo(PivotX + TopHalf, TopY);
  ctx.lineTo(PivotX + BottomHalf, BottomY);
  ctx.lineTo(PivotX - BottomHalf, BottomY);
  ctx.closePath();
  ctx.fill();
  const light = OpbTheme.Background;
  const half = TopHalf + (BaseY - TopY) / (BottomY - TopY) * (BottomHalf - TopHalf);
  ctx.strokeStyle = light;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PivotX, TopY);
  ctx.lineTo(PivotX, BaseY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(PivotX - half, BaseY);
  ctx.lineTo(PivotX + half, BaseY);
  ctx.stroke();
  label(ctx, tempo.toString(), PivotX, BpmY, 64, light, "center", "normal");
  const beats = input.beats;
  const angle = playing ? -MaxSwing * Math.cos(Math.PI * beats) : -MaxSwing;
  const pivot = [PivotX, BaseY];
  ctx.save();
  ctx.translate(pivot[0], pivot[1]);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-pivot[0], -pivot[1]);
  ctx.fillStyle = OpbTheme.Red;
  ctx.fillRect(PivotX - 5, BaseY - RodLength, 10, RodLength);
  const weightY = BaseY - weightDistance(tempo);
  ctx.fillStyle = "#7a7a7a";
  ctx.beginPath();
  ctx.moveTo(PivotX - 33, weightY - 22);
  ctx.lineTo(PivotX + 33, weightY - 22);
  ctx.lineTo(PivotX + 24, weightY + 22);
  ctx.lineTo(PivotX - 24, weightY + 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = OpbTheme.Ink;
  ctx.beginPath();
  ctx.ellipse(PivotX - 18, weightY - 4, 3, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(PivotX + 18, weightY - 4, 3, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OpbTheme.Ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PivotX - 4, weightY - 10);
  ctx.lineTo(PivotX - 4, weightY + 6);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PivotX + 4, weightY - 14);
  ctx.lineTo(PivotX + 4, weightY + 2);
  ctx.stroke();
  ctx.restore();
  drawReadouts(ctx, session2, input);
}
function weightDistance(bpm) {
  return 340 - (Math.max(40, Math.min(200, bpm)) - 40) / 160 * 250;
}
function drawReadouts(ctx, session2, input) {
  const g = session2.global;
  const swing = g ? `${Math.round(g.swing * 100 / 255)}%` : "-";
  label(ctx, "SWING", 60, 300, 30, OpbTheme.Mid, "left");
  label(ctx, swing, 60, 350, 40, OpbTheme.Ink, "left", "normal");
  const right = input.right - 60;
  const level = g ? g.metronomeLevel === 0 ? "OFF" : `${percent(g.metronomeLevel)}` : "-";
  const sound = g ? METRONOME_SOUNDS[Math.min(g.metronomeSound, METRONOME_SOUNDS.length - 1)] : "-";
  label(ctx, "METRONOME", right, 300, 30, OpbTheme.Mid, "right");
  label(ctx, level, right, 350, 40, OpbTheme.Ink, "right", "normal");
  label(ctx, sound, right, 410, 30, OpbTheme.Mid, "right");
}

// src/render/screens/project.ts
var TitleY4 = 40;
var Row04 = 82;
var Row12 = 212;
var Row22 = 342;
var Row32 = 472;
var ColLabel2 = 216;
var ColW3 = 130;
var GridEnd = ColLabel2 + 8 * ColW3;
var PATTERN_COUNT2 = 16;
function patternRect(p) {
  return { x: ColLabel2 + p % 8 * ColW3, y: Row04 + Math.floor(p / 8) * (Row12 - Row04), w: ColW3, h: Row12 - Row04 };
}
function renderProject(ctx, input) {
  const session2 = input.session;
  label(ctx, `PROJECT ${session2.chain.project + 1}`, input.right / 2, TitleY4, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row04);
  hLine(ctx, ColLabel2, GridEnd, Row12);
  hLine(ctx, input.left, input.right, Row22);
  hLine(ctx, input.left, input.right, Row32);
  vLine(ctx, ColLabel2, Row04, input.bottom);
  vLine(ctx, GridEnd, Row04, input.bottom);
  for (let i = 1; i < 8; i++) vLine(ctx, ColLabel2 + i * ColW3, Row04, Row22);
  drawPatterns(ctx, input, session2);
  drawChain(ctx, input, session2);
  drawSavedChains(ctx, input, session2);
  drawStatus(ctx, input, session2);
}
function drawPatterns(ctx, input, session2) {
  label(ctx, "PATTERNS", 20, Row04 + 42, 30, OpbTheme.Mid, "left");
  const bank = session2.bank;
  const inChain = session2.chain.chain;
  for (let p = 0; p < PATTERN_COUNT2; p++) {
    const r = patternRect(p);
    label(ctx, (p + 1).toString(), r.x + 10, r.y + 26, 40, OpbTheme.Mid, "left");
    const filled = bank !== null && !bank.isEmpty(p);
    ctx.fillStyle = filled ? OpbTheme.Ink : OpbTheme.Rule;
    ctx.beginPath();
    ctx.ellipse(r.x + ColW3 / 2, r.y + 84, 11, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    if (inChain.length > 1 && inChain.includes(p)) {
      ctx.fillStyle = OpbTheme.Green;
      ctx.beginPath();
      ctx.ellipse(r.x + r.w - 18, r.y + 22, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  frame(ctx, patternRect(session2.activePattern), OpbTheme.Yellow);
}
function drawChain(ctx, input, session2) {
  label(ctx, "CHAIN", 20, Row22 + 42, 30, OpbTheme.Mid, "left");
  const chain = session2.chain.chain;
  if (chain.length === 0) {
    label(ctx, "-", ColLabel2 + 20, Row22 + 65, 32, OpbTheme.Mid, "left");
    return;
  }
  const w = Math.min(ColW3 / 2, (GridEnd - ColLabel2) / chain.length);
  const top = Row22 + 18, h = 64;
  for (let i = 0; i < chain.length; i++) {
    const x = ColLabel2 + i * w;
    if (i > 0) vLine(ctx, x, top + 8, top + h - 8, i % 4 === 0 ? OpbTheme.Ink : OpbTheme.Rule, i % 4 === 0 ? 2 : 1);
    label(ctx, (chain[i] + 1).toString(), x + w / 2, top + h / 2, w < 40 ? 24 : 32, OpbTheme.Ink, "center", "normal");
  }
  const pos = session2.chain.position - 1;
  if (pos >= 0 && pos < chain.length) frame(ctx, { x: ColLabel2 + pos * w, y: top, w, h }, OpbTheme.Yellow);
  const caption = `${Math.max(1, session2.chain.position)} / ${chain.length}`;
  label(ctx, caption, ColLabel2 + 14, Row32 - 26, 24, OpbTheme.Mid, "left");
}
function drawSavedChains(ctx, input, session2) {
  label(ctx, "SAVED", 20, Row32 + 42, 30, OpbTheme.Mid, "left");
  label(ctx, "CHAINS", 20, Row32 + 78, 30, OpbTheme.Mid, "left");
  const global = session2.global;
  const w = (GridEnd - ColLabel2) / 5, h = (input.bottom - Row32) / 3;
  for (let i = 1; i < 5; i++) vLine(ctx, ColLabel2 + i * w, Row32, input.bottom);
  for (let i = 1; i < 3; i++) hLine(ctx, ColLabel2, GridEnd, Row32 + i * h);
  for (let slot = 0; slot < 15; slot++) {
    const r = { x: ColLabel2 + slot % 5 * w, y: Row32 + Math.floor(slot / 5) * h, w, h };
    const chain = global ? global.chain(slot) : [];
    label(ctx, (slot + 1).toString(), r.x + 12, r.y + 26, 30, OpbTheme.Mid, "left");
    if (chain.length === 0) {
      label(ctx, "EMPTY", r.x + 12, r.y + 72, 26, OpbTheme.Rule, "left");
    } else {
      label(ctx, chain.length.toString(), r.x + r.w - 12, r.y + 26, 24, OpbTheme.Mid, "right");
      const text = chain.map((x) => (x + 1).toString()).join(" ");
      label(ctx, fit2(ctx, text, r.w - 24, 26), r.x + 12, r.y + 72, 26, OpbTheme.Ink, "left", "normal");
    }
    if (global && global.selectedChain === slot) frame(ctx, r, OpbTheme.Yellow);
  }
}
function drawStatus(ctx, input, session2) {
  const ps = session2.patternState;
  const clipboard = ps.projectCopied ? "PROJECT" : ps.patternCopied ? "PATTERN" : "-";
  const items = [
    { label: "PATTERN", value: (session2.activePattern + 1).toString(), brush: OpbTheme.Ink },
    { label: "SAVE", value: ps.autosave ? "AUTO" : "MANUAL", brush: ps.autosave ? OpbTheme.Green : OpbTheme.Ink },
    { label: "CHAIN MODE", value: ps.chainMode ? "ON" : "OFF", brush: ps.chainMode ? OpbTheme.Green : OpbTheme.Ink },
    { label: "COPIED", value: clipboard, brush: OpbTheme.Ink }
  ];
  const rows2 = [Row04, Row12, Row22, Row32];
  const cx = (GridEnd + input.right) / 2;
  hLine(ctx, GridEnd, input.right, Row12);
  for (let i = 0; i < items.length; i++) {
    label(ctx, items[i].label, GridEnd + 18, rows2[i] + 42, 30, OpbTheme.Mid, "left");
    label(ctx, items[i].value, cx, rows2[i] + 90, 42, items[i].brush, "center", "normal");
  }
}
function fit2(ctx, text, width, size) {
  if (textWidth(ctx, text, size, "normal") <= width) return text;
  let t = text;
  while (t.length > 1 && textWidth(ctx, t + "\u2026", size, "normal") > width) t = t.slice(0, -1);
  return t.trimEnd() + "\u2026";
}

// src/render/screens/tape.ts
var TAPE_TRACK = 10;
var TitleY5 = 40;
var Row05 = 82;
var WaveY = 171;
var WaveX0 = 525;
var BarStep = 17.5;
var BarW2 = 8;
var ReelY = 492;
var ReelR = 216;
var BandHalf = 47;
var BandReach = 190;
var TapeOuter = 128;
var HubR = 64;
var RevsPerSecond = 0.35;
var BarsPerSecond = 8;
var Wave = [
  83,
  39,
  19,
  12,
  76,
  39,
  23,
  12,
  85,
  39,
  37,
  39,
  58,
  29,
  16,
  10,
  37,
  23,
  12,
  43,
  56,
  29,
  16,
  12,
  85,
  39,
  25,
  47,
  23,
  16,
  43,
  23
];
var RedBand = "#9B1A27";
var BlueBand = "#0F3556";
var TapeBrown = "#6B3A36";
var Hub = "#505050";
var Spindle = "#1A1A1A";
var Cap = "#4D4D4D";
function renderTape(ctx, input) {
  const session2 = input.session;
  const playing = input.playing || session2.clockRunning;
  label(ctx, "TAPE", input.right / 2, TitleY5, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row05);
  const vis = session2.audioVis;
  const visLevel = ((vis & 15) + (vis >> 4)) / 30;
  const activity = Math.max(visLevel, playing ? 1 : 0);
  const live = playing || activity > 0.02;
  const gain = 0.4 + 0.6 * Math.min(1, activity);
  const speed = speedFactor(session2);
  const t = input.playMs / 1e3;
  const rotation = playing ? t * 360 * RevsPerSecond * speed % 360 : 0;
  const scroll = playing ? t * BarsPerSecond * speed % Wave.length : 0;
  const offset = Math.floor(scroll);
  for (let i = 0; i < Wave.length; i++) {
    const h = live ? Math.max(8, Wave[(i + offset) % Wave.length] * gain) : Wave[i];
    ctx.fillStyle = OpbTheme.Ink;
    ctx.fillRect(WaveX0 + i * BarStep - BarW2 / 2, WaveY - h / 2, BarW2, h);
  }
  drawReel(ctx, 562, ReelY, OpbTheme.Red, RedBand, 35 + rotation);
  drawReel(ctx, 1039, ReelY, OpbTheme.TapeBlue, BlueBand, -55 + rotation);
}
function speedFactor(session2) {
  const s = session2.currentSound[TAPE_TRACK];
  const p1 = (s[SOUND_PARAM.P1] & 255) / 255;
  const coarse = p1 < 0.6 ? 1 + p1 / 0.6 : 2 * (1 - (p1 - 0.6) / 0.4);
  return coarse * Math.pow(2, ((s[SOUND_PARAM.P2] & 255) - 128) / 128);
}
function drawReel(ctx, cx, cy, color, bandColor, angle) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ReelR, ReelR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-cx, -cy);
  const bandRect = { x: cx - BandHalf, y: cy - BandReach, w: BandHalf * 2, h: BandReach * 2 };
  ctx.fillStyle = bandColor;
  ctx.fillRect(bandRect.x, bandRect.y, bandRect.w, bandRect.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bandRect.x, bandRect.y, bandRect.w, bandRect.h);
  ctx.clip();
  ctx.fillStyle = TapeBrown;
  ctx.beginPath();
  ctx.ellipse(cx, cy, TapeOuter, TapeOuter, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, HubR + 5, HubR + 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Hub;
  ctx.beginPath();
  ctx.ellipse(cx, cy, HubR, HubR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Spindle;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 50, 50, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * 120 + 20) * Math.PI / 180);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = Spindle;
    ctx.fillRect(cx - 12, cy - 63, 24, 22);
    ctx.restore();
  }
  ctx.fillStyle = Cap;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 19, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// src/render/screens/perform.ts
var TitleY6 = 40;
var Row06 = 82;
var LabelY = 116;
var KeyTop = 148;
var KeyBottom = 720;
var BlackBottom = 460;
var WhiteW = 106;
var BlackW = 66;
var Effects = [
  "DUCK",
  "FILTER\nSWEEP",
  "LOOP\n1",
  "STEREO",
  "LOOP\n2",
  "PITCH",
  "FOLLOW\nECHO",
  "RAMP UP\nFILL 1",
  "SHORT",
  "RAMP\nDOWN\nFILL 2",
  "LONG",
  "RANDOM"
];
var Octaves = ["DRUMS", "SYNTHS"];
var WhiteKeys = [0, 2, 4, 6, 7, 9, 11];
var BlackKeys = [[1, 0], [3, 1], [5, 2], [8, 4], [10, 5]];
function renderPerform(ctx, input) {
  const session2 = input.session;
  label(ctx, "PERFORM", input.right / 2, TitleY6, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row06);
  const active = /* @__PURE__ */ new Set();
  if (session2.ui.shift && session2.ui.heldKey >= 0) active.add(session2.ui.heldKey % 24);
  const X02 = (input.right - 14 * WhiteW) / 2;
  const whiteRect = (octave, i) => ({
    x: X02 + (octave * 7 + i) * WhiteW,
    y: KeyTop,
    w: WhiteW,
    h: KeyBottom - KeyTop
  });
  const blackRect = (octave, after) => ({
    x: X02 + (octave * 7 + after + 1) * WhiteW - BlackW / 2,
    y: KeyTop,
    w: BlackW,
    h: BlackBottom - KeyTop
  });
  for (let octave = 0; octave < 2; octave++) {
    const left = X02 + octave * 7 * WhiteW;
    let any = false;
    for (const k of active) if (Math.floor(k / 12) === octave) {
      any = true;
      break;
    }
    label(
      ctx,
      Octaves[octave],
      left + 7 * WhiteW / 2,
      LabelY,
      30,
      any ? OpbTheme.Ink : OpbTheme.Mid,
      "center",
      any ? "normal" : "light"
    );
    for (let i = 0; i < WhiteKeys.length; i++) {
      const key = octave * 12 + WhiteKeys[i];
      const on = active.has(key);
      const r = whiteRect(octave, i);
      ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Background;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      frame(ctx, r, OpbTheme.Rule, 2);
      drawEffect(ctx, WhiteKeys[i], r.x + WhiteW / 2, KeyBottom - 80, on ? OpbTheme.Ink : OpbTheme.Mid, 22);
    }
  }
  vLine(ctx, X02 + 7 * WhiteW, KeyTop, KeyBottom, OpbTheme.Ink, 3);
  for (let octave = 0; octave < 2; octave++) {
    for (const [key, after] of BlackKeys) {
      const on = active.has(octave * 12 + key);
      const r = blackRect(octave, after);
      ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Ink;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      drawEffect(ctx, key, r.x + BlackW / 2, BlackBottom - 60, on ? OpbTheme.Ink : OpbTheme.Mid, 19);
    }
  }
  label(ctx, "TOUCH A KEY OR HOLD SHIFT + KEY", input.right / 2, KeyBottom + 48, 30, OpbTheme.Mid, "center");
}
function drawEffect(ctx, effect, cx, y, brush, size = 22) {
  const lines = Effects[effect].split("\n");
  const top = y - (lines.length - 1) * size * 0.6;
  for (let i = 0; i < lines.length; i++) {
    label(ctx, lines[i], cx, top + i * size * 1.2, size, brush, "center");
  }
}

// src/render/screens/master.ts
var Row07 = 82;
var RowB = 342;
var ColLabel3 = 216;
var CellW = 130;
var CellH = 130;
var GraphLeft = 736;
var RightEnd2 = 1426;
var NoteClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var KeyWhite = [5, 7, 9, 11, 0, 2, 4];
var KeyBlack = [[6, 0], [8, 1], [10, 2], [1, 4], [3, 5]];
var Styles = ["LATCH", "FREE"];
function renderMaster(ctx, input) {
  const session2 = input.session;
  const track = 11;
  const uiPage = session2.ui.page;
  const S = (p) => session2.currentSound[track][p] & 255;
  const dialBrush2 = (page, dial) => uiPage === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const snd = (p, l, fmt) => paramInfo(S(p), l, fmt);
  label(ctx, "MASTER", input.right / 2, 40, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row07);
  hLine(ctx, input.left, RightEnd2, RowB);
  vLine(ctx, ColLabel3, Row07, input.bottom);
  vLine(ctx, GraphLeft, Row07, input.bottom);
  for (let i = 1; i < 4; i++) vLine(ctx, ColLabel3 + i * CellW, Row07, Row07 + CellH);
  hLine(ctx, ColLabel3, GraphLeft, Row07 + CellH);
  vLine(ctx, 1212, RowB, input.bottom);
  hLine(ctx, 1212, RightEnd2, RowB + 130);
  section(ctx, "EFFECTS", 0, Row07);
  cell(ctx, ColLabel3, Row07, "CHORUS", snd(SOUND_PARAM.P1, "CHORUS"), 0, 0, dialBrush2);
  cell(ctx, ColLabel3 + CellW, Row07, "DRIVE", snd(SOUND_PARAM.P2, "DRIVE"), 0, 1, dialBrush2);
  cell(ctx, ColLabel3 + 2 * CellW, Row07, "FILTER", snd(SOUND_PARAM.Filter, "FILTER", filterText), 0, 2, dialBrush2);
  cell(ctx, ColLabel3 + 3 * CellW, Row07, "RES", snd(SOUND_PARAM.Resonance, "RES"), 0, 3, dialBrush2);
  label(ctx, "LP", ColLabel3 + 2 * CellW + 14, Row07 + 82, 20, OpbTheme.Mid);
  label(ctx, "HP", ColLabel3 + 3 * CellW - 14, Row07 + 82, 20, OpbTheme.Mid, "right");
  drawFilterCurve(ctx, { x: GraphLeft + 40, y: Row07 + 50, w: RightEnd2 - GraphLeft - 80, h: RowB - Row07 - 100 }, S, dialBrush2);
  drawDrive(ctx, { x: ColLabel3 + 20, y: Row07 + CellH + 10, w: 4 * CellW - 40, h: RowB - Row07 - CellH - 20 }, S, dialBrush2);
  section(ctx, "TRANSPOSE", 0, RowB);
  const active = activeNotes(session2, input);
  const keyText = active.length === 0 ? "\u2014" : active.map((n) => NoteClasses[(n % 12 + 12) % 12]).filter((v, i, a) => a.indexOf(v) === i).join(" ");
  label(ctx, keyText, 108, RowB + 150, 64, OpbTheme.Ink, "center", "normal");
  label(ctx, active.length === 0 ? "NO NOTE" : "KEY", 108, RowB + 215, 24, OpbTheme.Mid, "center");
  const lit = new Set(active.map((n) => (n % 12 + 12) % 12));
  drawKeyboard(ctx, { x: 236, y: RowB + 30, w: 480, h: 200 }, lit);
  section(ctx, "TRACKS", GraphLeft, RowB);
  const mask = session2.bank ? session2.bank.masterRouting(session2.activePattern) : 0;
  for (let t = 0; t < 8; t++) {
    const r = { x: GraphLeft + 18 + t % 4 * 114, y: RowB + 80 + Math.floor(t / 4) * 84, w: 104, h: 70 };
    const on = (mask & 1 << t) !== 0;
    if (on) {
      ctx.fillStyle = OpbTheme.Ink;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    frame(ctx, r, on ? OpbTheme.Ink : OpbTheme.Mid, 2);
    label(ctx, TRACK_NAMES[t], r.x + r.w / 2, r.y + r.h / 2, 24, on ? OpbTheme.White : OpbTheme.Mid, "center", "normal");
  }
  const style = snd(SOUND_PARAM.NoteStyle, "NOTE STYLE", (v) => band(v, Styles));
  label(ctx, "NOTE STYLE", 1230, RowB + 42, 28, OpbTheme.Mid);
  label(ctx, style.text, 1319, RowB + 92, 40, OpbTheme.Ink, "center", "normal");
  const length = session2.bank ? session2.bank.stepLength(session2.activePattern, track) : 1;
  label(ctx, "SPEED", 1230, RowB + 172, 28, OpbTheme.Mid);
  label(ctx, `x${length}`, 1319, RowB + 222, 40, OpbTheme.Ink, "center", "normal");
}
function cell(ctx, x, y, labelText, param, _page, dial, dialBrush2) {
  const rect = { x, y, w: CellW, h: CellH };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, "left");
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush2(0, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
}
function section(ctx, title, x, y) {
  label(ctx, title, x + 20, y + 42, 30, OpbTheme.Mid, "left");
}
function filterText(v) {
  const c = Math.round((v - 128) / 128 * 50);
  return c === 0 ? "OFF" : c < 0 ? `LP ${-c}` : `HP ${c}`;
}
function activeNotes(session2, input) {
  const bank = session2.bank;
  if (!bank) return [];
  const p = session2.activePattern;
  const count = bank.stepCount(p, 11);
  const length = bank.stepLength(p, 11);
  let step = 0;
  if (input.playing) {
    let sixteenths;
    if (session2.clockTicks > 0) sixteenths = session2.clockTicks / 6;
    else {
      const bpm = session2.global ? session2.global.tempo : 120;
      sixteenths = input.playMs / 1e3 / 60 * bpm * 4;
    }
    step = Math.floor(sixteenths / Math.max(1, length) % Math.max(1, count));
  }
  for (let back = 0; back < count; back++) {
    const s = ((step - back) % count + count) % count;
    const notes = bank.notes(p, 11, s);
    if (notes.length > 0) return notes.map((n) => n.pitch);
  }
  return [];
}
function drawFilterCurve(ctx, r, S, dialBrush2) {
  const f = S(SOUND_PARAM.Filter), q = S(SOUND_PARAM.Resonance) / 255;
  const lowPass = f < 128;
  const amount = Math.abs(f - 128) / 128;
  const cutoff = lowPass ? 4.3 - amount * 2.8 : 1.3 + amount * 2.8;
  ctx.save();
  ctx.strokeStyle = OpbTheme.Rule;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + r.h * 0.45);
  ctx.lineTo(r.x + r.w, r.y + r.h * 0.45);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = dialBrush2(0, 2);
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const lf = 1.3 + 3 * i / 120;
    const d = (lf - cutoff) * 3;
    let gain = amount < 0.02 ? 0 : lowPass ? -Math.max(0, d) * 12 : -Math.max(0, -d) * 12;
    gain += amount < 0.02 ? 0 : q * 9 * Math.exp(-d * d * 4);
    let y = r.y + r.h * 0.45 - gain / 36 * r.h;
    y = Math.max(r.y, Math.min(r.y + r.h, y));
    const x = r.x + r.w * i / 120;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const ticks = ["20", "200", "2K", "20K"];
  for (let i = 0; i < 4; i++) {
    label(ctx, ticks[i], r.x + r.w * i / 3, r.y + r.h + 22, 22, OpbTheme.Mid, i === 0 ? "left" : i === 3 ? "right" : "center");
  }
  label(ctx, amount < 0.02 ? "FILTER OFF" : lowPass ? "LOW PASS" : "HIGH PASS", r.x + r.w, r.y - 20, 24, OpbTheme.Mid, "right");
}
function drawDrive(ctx, r, S, dialBrush2) {
  const drive = S(SOUND_PARAM.P2) / 255, chorus = S(SOUND_PARAM.P1) / 255;
  const wave = (phase, clip) => {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80 * Math.PI * 4 + phase;
      const v = Math.tanh(Math.sin(t) * (1 + clip * 6)) / Math.tanh(1 + clip * 6);
      pts.push([r.x + r.w * i / 80, r.y + r.h / 2 - v * r.h * 0.4]);
    }
    return pts;
  };
  const strokeWave = (pts, brush) => {
    ctx.strokeStyle = brush;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.stroke();
  };
  if (chorus > 0.02) strokeWave(wave(chorus * 1.2, drive), dialBrush2(0, 0));
  strokeWave(wave(0, drive), dialBrush2(0, 1));
}
function drawKeyboard(ctx, r, lit) {
  const w = r.w / 7, bw = w * 0.62, bh = r.h * 0.58;
  for (let i = 0; i < 7; i++) {
    const k = { x: r.x + i * w, y: r.y, w, h: r.h };
    const on = lit.has(KeyWhite[i]);
    ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Background;
    ctx.fillRect(k.x, k.y, k.w, k.h);
    frame(ctx, k, OpbTheme.Rule, 2);
    label(ctx, NoteClasses[KeyWhite[i]], k.x + w / 2, k.y + k.h - 22, 22, OpbTheme.Mid, "center");
  }
  for (const [note, after] of KeyBlack) {
    const on = lit.has(note);
    ctx.fillStyle = on ? OpbTheme.Yellow : OpbTheme.Ink;
    ctx.fillRect(r.x + (after + 1) * w - bw / 2, r.y, bw, bh);
  }
}

// src/render/screens/module.ts
var Row08 = 82;
var RowB2 = 342;
var ColLabel4 = 216;
var CellW2 = 130;
var CellH2 = 130;
var PanelLeft = 736;
var RightEnd3 = 1426;
var PageNames = ["SOUND", "ENVELOPE", "LFO", "MIX"];
var Pages = [
  [[SOUND_PARAM.P1, "P1"], [SOUND_PARAM.P2, "P2"], [SOUND_PARAM.Filter, "FILTER"], [SOUND_PARAM.Resonance, "RES"]],
  [[SOUND_PARAM.Attack, "ATTACK"], [SOUND_PARAM.Decay, "DECAY"], [SOUND_PARAM.Sustain, "SUSTAIN"], [SOUND_PARAM.Release, "RELEASE"]],
  [[SOUND_PARAM.LfoDepth, "DEPTH"], [SOUND_PARAM.LfoSpeed, "RATE"], [SOUND_PARAM.LfoDest, "DEST"], [SOUND_PARAM.LfoShape, "SHAPE"]],
  [[SOUND_PARAM.Fx1Send, "FX 1"], [SOUND_PARAM.Fx2Send, "FX 2"], [SOUND_PARAM.Pan, "PAN"], [SOUND_PARAM.Level, "LEVEL"]]
];
function renderModule(ctx, input) {
  const session2 = input.session;
  const track = 13;
  const S = (p) => session2.currentSound[track][p] & 255;
  const dialBrush2 = (page, dial) => session2.ui.page === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const mod = session2.module;
  controlTrackChrome(ctx, input, "MODULE");
  vLine(ctx, ColLabel4, Row08, RowB2);
  vLine(ctx, PanelLeft, Row08, RowB2);
  hLine(ctx, PanelLeft, RightEnd3, RowB2);
  const midi = session2.midiConfig;
  for (let page = 0; page < 4; page++) {
    const y = Row08 + page * CellH2;
    if (page > 0) hLine(ctx, input.left, PanelLeft, y);
    label(ctx, PageNames[page], 18, y + 42, 30, session2.ui.page === page ? OpbTheme.Ink : OpbTheme.Mid);
    label(ctx, `PAGE ${page + 1}`, 18, y + 80, 22, OpbTheme.Mid);
    for (let dial = 0; dial < 4; dial++) {
      const x = ColLabel4 + dial * CellW2;
      if (dial > 0) vLine(ctx, x, y, y + CellH2);
      const [param, text] = Pages[page][dial];
      const index = page * 4 + dial;
      const cc = midi ? `CC ${midi.parameterCc(track, index)}` : "";
      cell2(ctx, x, y, text, { value: S(param), text: String(Math.round(S(param) / 2)) }, page, dial, cc, dialBrush2);
    }
  }
  drawModule(ctx, { x: PanelLeft, y: Row08, w: RightEnd3 - PanelLeft, h: RowB2 - Row08 }, mod, session2, track);
  drawInput(ctx, { x: PanelLeft, y: RowB2, w: RightEnd3 - PanelLeft, h: 602 - RowB2 }, session2);
  controlTrackSequencer(ctx, input, track);
}
function cell2(ctx, x, y, labelText, param, _page, dial, caption, dialBrush2) {
  const rect = { x, y, w: CellW2, h: CellH2 };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, "left");
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush2(_page, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
  if (caption) label(ctx, caption, x + CellW2 - 6, y + 109, 18, OpbTheme.Mid, "right");
}
function section2(ctx, title, x, y) {
  label(ctx, title, x + 18, y + 42, 30, OpbTheme.Mid, "left");
}
function drawModule(ctx, r, mod, session2, track) {
  section2(ctx, "MODULE", r.x, r.y);
  const name = mod.connected && mod.name.trim() ? mod.name.trim().toLowerCase() : "";
  const kind = name === "oplab" ? "OPLAB" : name === "line" || name === "in-out" ? "LINE" : name === "rumble" ? "RUMBLE" : name === "" ? "NONE" : name.toUpperCase();
  label(ctx, kind, r.x + 18, r.y + 110, 56, mod.connected ? OpbTheme.Ink : OpbTheme.Mid, "left", "normal");
  label(ctx, mod.connected ? "CONNECTED" : "NO EXPANSION MODULE", r.x + 18, r.y + 160, 24, mod.connected ? OpbTheme.Green : OpbTheme.Mid);
  const cx = r.x + 330, y = r.y + 70;
  const status = mod.status;
  if (kind === "OPLAB" || kind === "LINE") {
    const output = (status >> 24 & 3) === 1 ? "MIDI" : (status >> 24 & 3) === 2 ? "TRIGGER" : (status >> 24 & 3) === 3 ? "PO SYNC" : "\u2014";
    const inputSw = (status >> 27 & 1) === 0 ? "MIDI" : "TRIGGER";
    row(ctx, cx, y, "OUT SWITCH", output);
    row(ctx, cx, y + 44, "IN SWITCH", inputSw);
    if (kind === "LINE") {
      const lineOut = (status >> 20 & 1) === 0 ? "\u2014" : (status >> 21 & 1) !== 0 ? "MONO" : "STEREO";
      const lineIn = (status >> 22 & 1) === 0 ? "\u2014" : (status >> 23 & 1) !== 0 ? "MONO" : "STEREO";
      row(ctx, cx, y + 88, "LINE OUT", lineOut);
      row(ctx, cx, y + 132, "LINE IN", lineIn);
    }
  } else if (kind === "RUMBLE") {
    const level = Math.min(4, status & 15);
    label(ctx, "LEVEL", cx, y, 24, OpbTheme.Mid);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < level ? OpbTheme.Ink : OpbTheme.Rule;
      ctx.fillRect(cx + 120 + i * 40, y + 20 - (i + 1) * 14, 28, (i + 1) * 14);
    }
  } else {
    label(ctx, "WITHOUT A MODULE THE TRACK", cx, y + 10, 24, OpbTheme.Mid);
    label(ctx, "SENDS ITS 16 VALUES AS MIDI CC", cx, y + 44, 24, OpbTheme.Mid);
    label(ctx, "AND ITS NOTES ON CHANNEL " + ((session2.midiConfig?.channel(track) ?? track) + 1), cx, y + 78, 24, OpbTheme.Mid);
  }
}
function drawInput(ctx, r, session2) {
  section2(ctx, "INPUT", r.x, r.y);
  const level = session2.level;
  const sources = [["MIC", 1], ["HEADSET", 2], ["MODULE", 4], ["USB", 8]];
  for (let i = 0; i < sources.length; i++) {
    const chip = { x: r.x + 18 + i * 162, y: r.y + 70, w: 150, h: 56 };
    const on = (level.inputSelector & sources[i][1]) !== 0;
    if (on) {
      ctx.fillStyle = OpbTheme.Ink;
      ctx.fillRect(chip.x, chip.y, chip.w, chip.h);
    } else {
      frame(ctx, chip, OpbTheme.Mid, 2);
    }
    label(ctx, sources[i][0], chip.x + chip.w / 2, chip.y + chip.h / 2, 24, on ? OpbTheme.White : OpbTheme.Mid, "center", "normal");
  }
  const y = r.y + 160;
  label(ctx, "MIC LEVEL", r.x + 18, y, 24, OpbTheme.Mid);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i < level.micLevel ? OpbTheme.Ink : OpbTheme.Rule;
    ctx.fillRect(r.x + 160 + i * 14, y - 12, 10, 24);
  }
  row(ctx, r.x + 420, y, "MIC FX", MIC_FX[Math.max(0, Math.min(3, level.micFx))]);
  row(ctx, r.x + 18, y + 54, "MONITOR", level.monitor ? "ON" : "OFF", 142);
  row(ctx, r.x + 420, y + 54, "MIC MODE", level.micMode ? "ON" : "OFF");
}
function row(ctx, x, y, labelText, value, valueOffset = 150) {
  label(ctx, labelText, x, y, 24, OpbTheme.Mid);
  label(ctx, value, x + valueOffset, y, 26, OpbTheme.Ink, "left", "normal");
}

// src/render/screens/lights.ts
var Row09 = 82;
var RowB3 = 342;
var CellW3 = 130;
var CellH3 = 130;
var KnobLeft = 736;
var RightEnd4 = 1426;
var PatternNames = ["SOLID", "ALTERNATE", "CHASE", "PULSE", "SPLIT", "SPARKLE", "WAVE", "STROBE", "BOUNCE", "RAINBOW"];
function renderLights(ctx, input) {
  const session2 = input.session;
  const track = 14;
  const S = (p) => session2.currentSound[track][p] & 255;
  const dialBrush2 = (page, dial) => session2.ui.page === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const snd = (p, l, fmt) => paramInfo(S(p), l, fmt);
  const hue = (v) => `${Math.round(v / 255 * 360)}\xB0`;
  controlTrackChrome(ctx, input, "LIGHTS");
  vLine(ctx, KnobLeft, Row09, 602);
  hLine(ctx, input.left, RightEnd4, RowB3);
  hLine(ctx, KnobLeft, RightEnd4, Row09 + CellH3);
  for (let i = 1; i < 4; i++) vLine(ctx, KnobLeft + i * CellW3, Row09, RowB3);
  vLine(ctx, KnobLeft + 4 * CellW3, Row09, RowB3);
  drawFixtures(ctx, { x: 0, y: Row09, w: KnobLeft, h: RowB3 - Row09 }, S, input);
  cell3(ctx, KnobLeft, Row09, "COLOR", snd(SOUND_PARAM.P1, "COLOR", hue), 0, 0, dialBrush2);
  cell3(ctx, KnobLeft + CellW3, Row09, "ALT COL", snd(SOUND_PARAM.P2, "ALT COLOR", hue), 0, 1, dialBrush2);
  cell3(ctx, KnobLeft + 2 * CellW3, Row09, "SPEED", snd(SOUND_PARAM.Filter, "SPEED"), 0, 2, dialBrush2);
  cell3(ctx, KnobLeft + 3 * CellW3, Row09, "INTENS", snd(SOUND_PARAM.Resonance, "INTENSITY"), 0, 3, dialBrush2);
  const knobs = [SOUND_PARAM.Fx1Send, SOUND_PARAM.Fx2Send, SOUND_PARAM.Pan, SOUND_PARAM.Level];
  for (let i = 0; i < 4; i++)
    cell3(ctx, KnobLeft + i * CellW3, Row09 + CellH3, `KNOB ${i + 5}`, snd(knobs[i], `KNOB ${i + 5}`), 1, i, dialBrush2);
  const sx = KnobLeft + 4 * CellW3 + 20, sw = RightEnd4 - sx - 20;
  label(ctx, "MAIN", sx, Row09 + 30, 22, OpbTheme.Mid);
  ctx.fillStyle = hsvToCss(S(SOUND_PARAM.P1) / 255 * 360, 0.9, 0.95);
  ctx.fillRect(sx, Row09 + 48, sw, 72);
  label(ctx, "ALT", sx, Row09 + CellH3 + 30, 22, OpbTheme.Mid);
  ctx.fillStyle = hsvToCss(S(SOUND_PARAM.P2) / 255 * 360, 0.9, 0.95);
  ctx.fillRect(sx, Row09 + CellH3 + 48, sw, 72);
  section3(ctx, "PATTERN", 0, RowB3);
  for (let i = 0; i < 10; i++) {
    const r = { x: 18 + i % 5 * 140, y: RowB3 + 70 + Math.floor(i / 5) * 92, w: 128, h: 80 };
    frame(ctx, r, OpbTheme.Mid, 2);
    label(ctx, String(i + 1), r.x + 14, r.y + 24, 28, OpbTheme.Ink, "left", "normal");
    label(ctx, PatternNames[i], r.x + 14, r.y + 58, 18, OpbTheme.Mid);
  }
  section3(ctx, "ANIMATIONS (HOLD)", KnobLeft, RowB3);
  for (let i = 0; i < 14; i++) {
    const r = { x: KnobLeft + 18 + i % 7 * 94, y: RowB3 + 70 + Math.floor(i / 7) * 92, w: 84, h: 80 };
    frame(ctx, r, OpbTheme.Mid, 2);
    label(ctx, i === 13 ? "FOG" : String(i + 1), r.x + r.w / 2, r.y + r.h / 2, 28, OpbTheme.Ink, "center", "normal");
  }
  controlTrackSequencer(ctx, input, track);
}
function cell3(ctx, x, y, labelText, param, _page, dial, dialBrush2) {
  const rect = { x, y, w: CellW3, h: CellH3 };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, "left");
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush2(_page, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
}
function section3(ctx, title, x, y) {
  label(ctx, title, x + 18, y + 42, 30, OpbTheme.Mid, "left");
}
function drawFixtures(ctx, r, S, input) {
  section3(ctx, "FIXTURES", r.x, r.y);
  label(ctx, "PREVIEW", r.x + r.w - 18, r.y + 42, 22, OpbTheme.Mid, "right");
  const t = input.nowMs / 1e3;
  const speed = 0.3 + S(SOUND_PARAM.Filter) / 255 * 4;
  const intensity = S(SOUND_PARAM.Resonance) / 255;
  const main = S(SOUND_PARAM.P1) / 255 * 360;
  const alt = S(SOUND_PARAM.P2) / 255 * 360;
  const phase = t * speed;
  const step = Math.floor(phase * 4);
  for (let i = 0; i < 16; i++) {
    let hue = main, level = 1;
    const sat = 0.9;
    const [rr, gg, bb] = hsvToRgb(hue, sat, Math.max(0, Math.min(1, level * (0.15 + 0.85 * intensity))));
    const cx = r.x + 70 + i % 8 * 84, cy = r.y + 110 + Math.floor(i / 8) * 86;
    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 32, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OpbTheme.Ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    const lum = rr * 0.3 + gg * 0.59 + bb * 0.11;
    label(ctx, String(i + 1), cx, cy, 20, lum > 140 ? OpbTheme.Ink : OpbTheme.White, "center", "normal");
  }
}

// src/render/screens/motiontrack.ts
var Row010 = 82;
var RowB4 = 342;
var CellW4 = 130;
var CellH4 = 130;
var PreviewLeft = 736;
var KeysRight = 1110;
var RightEnd5 = 1426;
function renderMotionTrack(ctx, input) {
  const session2 = input.session;
  const track = 15;
  const S = (p) => session2.currentSound[track][p] & 255;
  const dialBrush2 = (page, dial) => session2.ui.page === page ? OpbTheme.Dials[dial] : OpbTheme.Mid;
  const snd = (p, l, fmt) => paramInfo(S(p), l, fmt);
  const signed = (v) => {
    const c = Math.round((v - 128) / 128 * 50);
    return c > 0 ? `+${c}` : String(c);
  };
  controlTrackChrome(ctx, input, "MOTION TRACK");
  vLine(ctx, 216, Row010, RowB4);
  vLine(ctx, PreviewLeft, Row010, RowB4);
  hLine(ctx, input.left, RightEnd5, RowB4);
  hLine(ctx, input.left, PreviewLeft, Row010 + CellH4);
  for (let i = 1; i < 4; i++) vLine(ctx, 216 + i * CellW4, Row010, RowB4);
  vLine(ctx, KeysRight, RowB4, 602);
  section4(ctx, "COLOR", 0, Row010);
  cell4(ctx, 216, Row010, "HUE", snd(SOUND_PARAM.P1, "HUE", signed), 0, 0, dialBrush2);
  cell4(ctx, 216 + CellW4, Row010, "SAT", snd(SOUND_PARAM.P2, "SATURATION", signed), 0, 1, dialBrush2);
  cell4(ctx, 216 + 2 * CellW4, Row010, "BRIGHT", snd(SOUND_PARAM.Filter, "BRIGHTNESS", signed), 0, 2, dialBrush2);
  cell4(ctx, 216 + 3 * CellW4, Row010, "CONTR", snd(SOUND_PARAM.Resonance, "CONTRAST", signed), 0, 3, dialBrush2);
  section4(ctx, "SHIFT", 0, Row010 + CellH4);
  cell4(ctx, 216, Row010 + CellH4, "XFADE", snd(SOUND_PARAM.Attack, "CROSSFADE"), 1, 0, dialBrush2);
  cell4(ctx, 216 + CellW4, Row010 + CellH4, "ZOOM", snd(SOUND_PARAM.Decay, "ZOOM"), 1, 1, dialBrush2);
  cell4(ctx, 216 + 2 * CellW4, Row010 + CellH4, "DOUBLE", snd(SOUND_PARAM.Sustain, "DOUBLE"), 1, 2, dialBrush2);
  cell4(ctx, 216 + 3 * CellW4, Row010 + CellH4, "WOOZY", snd(SOUND_PARAM.Release, "WOOZY"), 1, 3, dialBrush2);
  drawPreview(ctx, { x: PreviewLeft + 30, y: Row010 + 54, w: RightEnd5 - PreviewLeft - 60, h: RowB4 - Row010 - 84 }, S);
  drawKeys(ctx, { x: 18, y: RowB4 + 60, w: KeysRight - 36, h: 602 - RowB4 - 80 }, S);
  section4(ctx, "OPEN", KeysRight, RowB4);
  const pages = [["PHOTOMATIC"], ["MOTION"]];
  for (let i = 0; i < pages.length; i++) {
    const r = { x: KeysRight + 18, y: RowB4 + 70 + i * 92, w: RightEnd5 - KeysRight - 36, h: 78 };
    ctx.fillStyle = OpbTheme.Ink;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    label(ctx, pages[i][0], r.x + r.w / 2, r.y + r.h / 2, 28, OpbTheme.White, "center", "normal");
  }
  controlTrackSequencer(ctx, input, track);
}
function cell4(ctx, x, y, labelText, param, _page, dial, dialBrush2) {
  const rect = { x, y, w: CellW4, h: CellH4 };
  label(ctx, labelText, x + 8, y + 20, 30, OpbTheme.Mid, "left");
  knob(ctx, x + 65, y + 65, param.value / 255, dialBrush2(_page, dial));
  label(ctx, param.text, x + 65, y + 107, 32, OpbTheme.Ink, "center", "normal");
}
function section4(ctx, title, x, y) {
  label(ctx, title, x + 18, y + 42, 30, OpbTheme.Mid, "left");
}
function drawPreview(ctx, r, S) {
  label(ctx, "PREVIEW", r.x - 12, Row010 + 30, 22, OpbTheme.Mid);
  const hueShift = (S(SOUND_PARAM.P1) - 128) / 128 * 180, sat = S(SOUND_PARAM.P2) / 128;
  const bright = (S(SOUND_PARAM.Filter) - 128) / 128, contrast = S(SOUND_PARAM.Resonance) / 128;
  const apply = (hue, s, v) => {
    const [cr, cg, cb] = hsvToRgb(hue + hueShift, Math.max(0, Math.min(1, s * sat)), 1);
    const ch = (x) => Math.max(0, Math.min(1, (x / 255 * v - 0.5) * contrast + 0.5 + bright * 0.5));
    return `rgb(${Math.round(ch(cr) * 255)},${Math.round(ch(cg) * 255)},${Math.round(ch(cb) * 255)})`;
  };
  const bars = 12, bw = r.w / bars, top = r.h * 0.62;
  for (let i = 0; i < bars; i++) {
    ctx.fillStyle = apply(i * 30, 0.85, 0.95);
    ctx.fillRect(r.x + i * bw, r.y, bw + 0.5, top);
    ctx.fillStyle = apply(0, 0, i / (bars - 1));
    ctx.fillRect(r.x + i * bw, r.y + top, bw + 0.5, r.h - top);
  }
  frame(ctx, r, OpbTheme.Ink, 2);
}
function drawKeys(ctx, r, _S) {
  section4(ctx, "KEYS \u2192 PHOTOMATIC SLOTS", 0, RowB4);
  const white = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23];
  const black = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22];
  const w = r.w / 14, bw = w * 0.62, bh = r.h * 0.58;
  for (let i = 0; i < white.length; i++) {
    const k = { x: r.x + i * w, y: r.y, w, h: r.h };
    frame(ctx, k, OpbTheme.Rule, 2);
    label(ctx, String(white[i] + 1), k.x + w / 2, k.y + k.h - 22, 22, OpbTheme.Mid, "center");
  }
  for (const key of black) {
    let after = 0;
    for (let j = 0; j < white.length; j++) if (white[j] < key) after = j;
    const k = { x: r.x + (after + 1) * w - bw / 2, y: r.y, w: bw, h: bh };
    ctx.fillStyle = OpbTheme.Ink;
    ctx.fillRect(k.x, k.y, k.w, k.h);
    label(ctx, String(key + 1), k.x + bw / 2, k.y + bh - 20, 18, OpbTheme.Mid, "center");
  }
}

// src/render/screens/steps.ts
var TitleY7 = 40;
var Row011 = 82;
var NodeX = 190;
var NodeY = 440;
var NodeR = 46;
var CompBus = 400;
var CompX = 470;
var CompW = 400;
var LockBus = 990;
var LockX = 1060;
var LockW = 470;
var AreaTop = 160;
var AreaBottom = 740;
var BottomWire = 776;
var ComponentNames = [
  "PULSE",
  "PARAM SPARK",
  "JUMP",
  "VELOCITY",
  "RAMP UP",
  "RAMP DOWN",
  "RANDOM",
  "GLIDE",
  "MULTIPLY",
  "SWEEP",
  "PULSE HOLD",
  "TONALITY",
  "TRIGGER SPARK",
  "COMP SPARK",
  "BIT 14",
  "BIT 15"
];
var Jumps = ["TO START", "TO 2/4", "TO 3/4", "TO 4/4", "FORWARD", "BACK", "RANDOM", "STAY", "ALIGN GLOBAL", "GATE STEP"];
var Sweeps = ["FILTER UP", "FILTER DOWN", "SYNTH UP", "SYNTH DOWN", "PAN", "FILTER UP L", "FILTER DN L", "SYNTH UP L", "SYNTH DN L", "PAN L"];
var Tonalities = ["IGNORE CHORDS", "TRANSPOSE", "OCTAVE", "FIFTH", "THIRD", "CHROM UP", "CHROM DOWN", "QUANTIZE 1", "QUANTIZE 2", "QUANTIZE 3"];
var Velocities = [4, 8, 16, 32, 64, 100, 112, 127];
function renderSteps(ctx, input) {
  const session2 = input.session;
  const track = session2.activeTrack;
  const pattern = session2.activePattern;
  const step = session2.ui.heldKey >= 0 ? session2.ui.heldKey : 0;
  const drum = trackKind(track) === "Drum";
  label(ctx, `STEP ${step + 1}`, input.right / 2, TitleY7, 56, OpbTheme.Ink, "center", "normal");
  label(ctx, TRACK_NAMES[track] ?? `TRACK ${track}`, 20, TitleY7, 30, OpbTheme.Mid);
  hLine(ctx, input.left, input.right, Row011);
  label(ctx, "COMPONENTS", CompX, Row011 + 42, 30, OpbTheme.Mid);
  label(ctx, "PARAMETER LOCKS", LockX, Row011 + 42, 30, OpbTheme.Mid);
  const bank = session2.bank;
  const components = [];
  const locks = [];
  let notes = [];
  if (bank) {
    const mask = bank.componentMask(pattern, track, step);
    for (let c = 0; c < 16; c++)
      if ((mask & 1 << c) !== 0) components.push([ComponentNames[c], componentText(c, bank.componentValue(pattern, track, step, c))]);
    for (let p = 0; p < BANK_PARAM_COUNT; p++)
      if (bank.isLocked(pattern, track, step, p)) locks.push([lockName(p, drum), lockText(p, bank.lockValue(pattern, track, step, p), drum)]);
    notes = bank.notes(pattern, track, step);
  }
  const compYs = rows(components.length);
  if (components.length > 0) {
    stroke(ctx, OpbTheme.Green, 3, true, [P(NodeX + NodeR, NodeY), P(CompBus, NodeY), P(CompBus, compYs[0]), P(CompBus, compYs[compYs.length - 1])]);
  } else label(ctx, "NONE", CompX, NodeY, 30, OpbTheme.Rule);
  for (let i = 0; i < components.length; i++)
    drawBox(ctx, OpbTheme.Green, CompBus, CompX, CompW, compYs[i], components[i][0], components[i][1], boxHeight(components.length));
  const lockYs = rows(locks.length);
  if (locks.length > 0) {
    const pts = [P(NodeX, NodeY + NodeR), P(NodeX, BottomWire), P(LockBus, BottomWire), P(LockBus, lockYs[0])];
    stroke(ctx, OpbTheme.Red, 3, true, pts);
  } else label(ctx, "NONE", LockX, NodeY, 30, OpbTheme.Rule);
  for (let i = 0; i < locks.length; i++)
    drawBox(ctx, OpbTheme.Red, LockBus, LockX, LockW, lockYs[i], locks[i][0], locks[i][1], boxHeight(locks.length));
  const trig = notes.length > 0;
  ctx.fillStyle = trig ? OpbTheme.Ink : OpbTheme.Mid;
  ctx.beginPath();
  ctx.arc(NodeX, NodeY, NodeR, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, String(step + 1), NodeX, NodeY, 44, OpbTheme.Background, "center", "normal");
  const noteText = trig ? notes.map((n) => trackKind(track) === "Drum" ? `NOTE ${n.pitch}` : noteName3(n.pitch)).join(" ") : "NO TRIG";
  label(ctx, noteText, NodeX, NodeY - NodeR - 70, 28, OpbTheme.Mid, "center");
  if (trig) label(ctx, `VEL ${notes[0].velocity}`, NodeX, NodeY - NodeR - 34, 28, OpbTheme.Mid, "center");
  if (input.write) {
    writeEditorOverlay(ctx, input.write, {
      subtitle: "STEP COMPONENTS \xB7 PARAMETER LOCKS \xB7 BANK_PARAM ORDER (NOT LIVE SOUND_PARAM)",
      footnote: "SET LOCK = VALUE BYTE + ENABLE 0xFF \xB7 CLEAR = ENABLE 0 ONLY, KEEP LAST VALUE \xB7 EXACT ROLLBACK"
    });
  }
}
var P = (x, y) => ({ x, y });
function stroke(ctx, color, width, round, pts) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (round) ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
}
function boxHeight(count) {
  return Math.min(56, (AreaBottom - AreaTop) / Math.max(1, count) - 8);
}
function rows(count) {
  if (count === 0) return [];
  const pitch = Math.min(72, (AreaBottom - AreaTop) / count);
  const top = Math.max(AreaTop + pitch / 2, Math.min(AreaBottom - pitch * 0.5, NodeY - pitch * (count - 1) / 2));
  return Array.from({ length: count }, (_, i) => top + i * pitch);
}
function drawBox(ctx, color, bus, x, w, y, name, value, h) {
  stroke(ctx, color, 3, true, [P(bus, y), P(x, y)]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bus, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(x, y - h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y - h / 2, w, h);
  const size = Math.min(30, h * 0.6);
  label(ctx, name, x + 14, y, size, OpbTheme.Mid);
  label(ctx, value, x + w - 14, y, size, OpbTheme.Ink, "right", "normal");
}
function componentText(component, raw) {
  const k = raw & 15;
  if (k < 1 || k > 10) return String(raw);
  switch (component) {
    case 0:
    case 10:
      return k === 10 ? "RANDOM" : `COUNT ${k}`;
    case 1:
    case 12:
    case 13:
      return k <= 8 ? `PASS ${k}` : k === 9 ? "RANDOM" : "RESET";
    case 2:
      return Jumps[k - 1];
    case 3:
      return k <= 8 ? `VEL ${Velocities[k - 1]}` : k === 9 ? "MUTE" : "RANDOM";
    case 4:
    case 5:
    case 6:
      return `${(k - 1) % 5 + 2} / ${k <= 5 ? 1 : 3} OCT`;
    case 7:
      return k <= 8 ? `GLIDE ${k}` : k === 9 ? "DIRECT" : "RANDOM";
    case 8:
      return k <= 8 ? `X${k}` : String(raw);
    case 9:
      return Sweeps[k - 1];
    case 11:
      return Tonalities[k - 1];
    default:
      return String(raw);
  }
}
function lockName(p, drum) {
  switch (p) {
    case BANK_PARAM.Attack:
      return drum ? "START" : "ATTACK";
    case BANK_PARAM.Decay:
      return drum ? "ATTACK" : "DECAY";
    case BANK_PARAM.Sustain:
      return drum ? "HOLD" : "SUSTAIN";
    case BANK_PARAM.Release:
      return drum ? "DECAY" : "RELEASE";
    case BANK_PARAM.Resonance:
      return "RES";
    default:
      return BANK_PARAM_NAMES[p] ?? `P${p}`;
  }
}
function lockText(p, v, drum) {
  if (p === BANK_PARAM.Pan) {
    if (v === 128) return "C";
    if (v < 128) return `L${percent((128 - v) * 2 - 1 & 255)}`;
    return `R${percent((v - 128) * 2 + 1 & 255)}`;
  }
  if (p === BANK_PARAM.LfoDest) return band(v, LFO_DESTINATIONS);
  if (p === BANK_PARAM.LfoShape) return band(v, LFO_SHAPES);
  if (p === BANK_PARAM.NoteStyle) return band(v, drum ? DRUM_NOTE_STYLES : SYNTH_NOTE_STYLES);
  return `${percent(v)}`;
}
function noteName3(midiNote) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[(midiNote % 12 + 12) % 12]}${Math.floor(midiNote / 12) - 1}`;
}

// src/render/screens/configurator.ts
var TitleY8 = 40;
var Row012 = 82;
var FILE_IDS = [
  { path: "settings/slotconfiguration.json", id: 0 },
  { path: "settings/plugs.json", id: 1 },
  { path: "syncjob.json", id: 2 }
];
function renderConfigurator(ctx, input) {
  label(ctx, "CONFIGURATOR", input.right / 2, TitleY8, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row012);
  hatch(ctx, { x: input.left, y: Row012 + 1, w: input.right - input.left, h: input.bottom - Row012 - 1 }, OpbTheme.Rule, OpbTheme.Background);
  if (input.write) {
    drawFileServiceSheet(ctx, input);
    writeEditorOverlay(ctx, input.write, {
      subtitle: "FILE SERVICE \xB7 $51/$34/$52/$35/$53/$33/$55 \xB7 <=200 B PER ZLIB PART",
      footnote: "$52 SYNC-ACTIVE=0 BEFORE FIRST $35 \xB7 ALL isLast PARTS BEFORE status 127 \xB7 PLAN ONLY, NO LIVE PUSH"
    });
    return;
  }
  const title = "OP-Z NOT CONNECTED";
  const body = "CONNECT THE OP-Z TO ASSIGN PLUGS TO ITS SLOTS. THE CONFIGURATOR READS AND WRITES THE PLUG SETTINGS STORED ON THE DEVICE. THIS WEB PORT DOES NOT YET IMPLEMENT THE OP-Z FILE SERVICE, SO USE THE OFFICIAL APP TO EDIT PLUG SLOTS.";
  const w = 900, textW = w - 96;
  const lines = wrapText(ctx, body, textW, 28);
  const h = 130 + lines.length * 38;
  const panel = { x: (input.right - w) / 2, y: Row012 + (input.bottom - Row012 - h) / 2, w, h };
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  let y = panel.y + 64;
  label(ctx, title, panel.x + 48, y, 44, OpbTheme.Ink, "left", "normal");
  y += 66;
  for (const line of lines) {
    label(ctx, line, panel.x + 48, y, 28, OpbTheme.Mid);
    y += 38;
  }
}
function drawFileServiceSheet(ctx, input) {
  const x = 80, w = 1440, top = 116;
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(x, top, w, 600);
  label(ctx, "RESERVED FILE IDS", x + 36, top + 44, 30, OpbTheme.Mid);
  hLine(ctx, x + 36, x + w - 36, top + 66, OpbTheme.Rule, 2);
  for (let i = 0; i < FILE_IDS.length; i++) {
    const e = FILE_IDS[i];
    const y = top + 104 + i * 40;
    label(ctx, String(e.id), x + 44, y, 28, OpbTheme.Green, "left", "normal");
    label(ctx, e.path, x + 96, y, 26, OpbTheme.Ink);
  }
  const y0 = top + 104 + FILE_IDS.length * 40 + 24;
  label(ctx, "OTHER PATHS", x + 36, y0, 30, OpbTheme.Mid);
  label(ctx, "crc32(utf8(lowercase(relativePath)))", x + 96, y0 + 40, 26, OpbTheme.Ink);
  label(ctx, "DEVICE-PROVEN CHECK", x + 36, y0 + 104, 30, OpbTheme.Mid);
  label(ctx, "settings/slotconfiguration.json -> 2873598156 / 0xAB47A0CC", x + 96, y0 + 144, 26, OpbTheme.Blue);
  label(ctx, "mixed case yields 4127267068 \u2014 ALWAYS LOWERCASE FIRST", x + 96, y0 + 180, 24, OpbTheme.Mid);
  label(ctx, "SYNCJOB.JSON MANIFEST", x + 36, y0 + 244, 30, OpbTheme.Mid);
  label(
    ctx,
    "fileId / path / crc / size \xB7 each $53 part is independently zlib-compressed",
    x + 96,
    y0 + 284,
    24,
    OpbTheme.Ink
  );
  label(
    ctx,
    `DESIGN SPACE ${input.left}..${input.right} \xD7 ${input.top}..${input.bottom}`,
    x + 36,
    top + 566,
    20,
    OpbTheme.Mid
  );
}

// src/render/screens/photomatic.ts
function renderPhotomatic(ctx, input) {
  label(ctx, "PHOTOMATIC", input.right / 2, 120, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, 82);
  const text = "THE PHOTOMATIC SCREEN IS NOT PART OF THIS LINUX USB-MIDI MVP YET. IT NEEDS THE WINDOWS VIDEO SUBSYSTEM, WHICH HAS NO LINUX COUNTERPART. CONNECT A USB OP-Z TO USE EVERYTHING ELSE.";
  const lines = wrapText(ctx, text, input.right - input.left - 80, 26);
  let y = 180;
  for (const line of lines) {
    label(ctx, line, input.left + 40, y, 26, OpbTheme.Mid);
    y += 36;
  }
}

// src/render/screens/motion.ts
function renderMotion(ctx, input) {
  label(ctx, "MOTION", input.right / 2, 40, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, 82);
  label(ctx, "(screen not ported yet \u2014 the Motion track content", input.right / 2, 200, 30, OpbTheme.Mid, "center");
  label(ctx, "lives in the MOTION TRACK screen)", input.right / 2, 244, 30, OpbTheme.Mid, "center");
  label(ctx, "OPEN \u2192 MOTION TRACK to see the color / transition dials", input.right / 2, 320, 24, OpbTheme.Mid, "center");
}

// src/render/screens/midisetup.ts
var TitleY9 = 40;
var Row013 = 82;
var ListRight = 520;
var HeaderBottom = 132;
var RowH = (812 - HeaderBottom) / 16;
var GridLabel = 520;
var GridX = 736;
var RightEnd6 = 1426;
var CellW5 = (RightEnd6 - GridX) / 4;
var CellH5 = 130;
var GlobalTop = Row013 + 4 * CellH5;
var GlobalH = (812 - GlobalTop) / 2;
var OnX = 316;
var MinusX = 384;
var ChannelX = 434;
var PlusX = 484;
var ParamLabels = [
  ["P1", "P2", "FILTER", "RES"],
  ["ATTACK", "DECAY", "SUSTAIN", "RELEASE"],
  ["LFO DEPTH", "LFO RATE", "LFO DEST", "LFO SHAPE"],
  ["FX1", "FX2", "PAN", "LEVEL"]
];
var PageNames2 = ["SOUND", "ENVELOPE", "LFO", "MIX"];
var Flags = [
  [MidiFlag.ChannelOneToActive, "CHANNEL 1", "TO ACTIVE"],
  [MidiFlag.IncomingMidi, "INCOMING", "MIDI"],
  [MidiFlag.OutgoingMidi, "OUTGOING", "MIDI"],
  [MidiFlag.ClockIn, "CLOCK IN", ""],
  [MidiFlag.ClockOut, "CLOCK OUT", ""],
  [MidiFlag.AltProgramChange, "ALT PROGRAM", "CHANGE"],
  [MidiFlag.MidiEcho, "MIDI ECHO", ""],
  [MidiFlag.ProgramChange, "PROGRAM", "CHANGE"]
];
function renderMidiSetup(ctx, input) {
  const session2 = input.session;
  const m = session2.midiConfig;
  label(ctx, "MIDI SETUP", RightEnd6 / 2, TitleY9, 56, OpbTheme.Ink, "center", "normal");
  label(ctx, "TOUCH PAD", RightEnd6 + 14, TitleY9, 30, OpbTheme.Mid);
  hLine(ctx, input.left, input.right, Row013);
  vLine(ctx, RightEnd6, 0, input.bottom);
  vLine(ctx, ListRight, Row013, input.bottom);
  hatch(ctx, { x: RightEnd6 + 1, y: Row013 + 1, w: input.right - RightEnd6 - 1, h: input.bottom - Row013 - 1 }, OpbTheme.Rule, OpbTheme.Background);
  if (!m) {
    hatch(ctx, { x: input.left, y: Row013 + 1, w: RightEnd6 - input.left - 1, h: input.bottom - Row013 - 1 }, OpbTheme.Rule, OpbTheme.Background);
    const panel = { x: RightEnd6 / 2 - 360, y: 330, w: 720, h: 150 };
    ctx.fillStyle = OpbTheme.Background;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    label(ctx, session2.isConnected ? "WAITING FOR THE MIDI SETUP" : "OP-Z NOT CONNECTED", panel.x + panel.w / 2, panel.y + 52, 40, OpbTheme.Ink, "center", "normal");
    label(ctx, session2.isConnected ? "REQUESTED FROM THE OP-Z" : "CONNECT THE OP-Z TO EDIT ITS MIDI SETTINGS", panel.x + panel.w / 2, panel.y + 104, 26, OpbTheme.Mid, "center");
  } else {
    drawTracks(ctx, session2, m);
    drawParameters(ctx, session2, m);
    drawGlobals(ctx, m);
  }
  if (input.write) {
    writeEditorOverlay(ctx, input.write, {
      subtitle: "MIDI SETUP \xB7 $0F REQUEST / $10 WRITE \xB7 292 B \xB7 RESERVED 289..291 PRESERVED",
      footnote: `FRESH $0F READBACK AFTER WRITE \xB7 BASELINE ${input.write.baselineBytes} B \xB7 EXACT ROLLBACK ON MISMATCH`
    });
  }
}
function drawTracks(ctx, session2, m) {
  const selectedTrack = session2.activeTrack;
  label(ctx, "TRACK", 20, Row013 + 25, 26, OpbTheme.Mid);
  label(ctx, "ON", OnX, Row013 + 25, 26, OpbTheme.Mid, "center");
  label(ctx, "CHANNEL", ChannelX, Row013 + 25, 26, OpbTheme.Mid, "center");
  hLine(ctx, 0, ListRight, HeaderBottom);
  for (let t = 0; t < 16; t++) {
    const y = HeaderBottom + t * RowH, cy = y + RowH / 2;
    const selected = t === selectedTrack, on = m.trackEnabled(t);
    if (selected) {
      ctx.fillStyle = OpbTheme.Rule;
      ctx.fillRect(0, y + 1, ListRight, RowH - 1);
    }
    if (t === selectedTrack) {
      ctx.fillStyle = OpbTheme.Yellow;
      ctx.fillRect(6, cy - 9, 5, 18);
    }
    label(ctx, String(t + 1), 22, cy, 24, OpbTheme.Mid);
    label(ctx, TRACK_NAMES[t] ?? `TRACK ${t}`, 64, cy, 28, on ? OpbTheme.Ink : OpbTheme.Mid, "left", selected ? "normal" : "light");
    toggle(ctx, OnX, cy, on, true, 24);
    stepper(ctx, MinusX, cy, false, m.channel(t) > 0, 14);
    label(ctx, String(m.channel(t) + 1), ChannelX, cy, 28, on ? OpbTheme.Ink : OpbTheme.Mid, "center", "normal");
    stepper(ctx, PlusX, cy, true, m.channel(t) < 15, 14);
    if (t % 4 === 3 && t < 15) hLine(ctx, 0, ListRight, y + RowH);
  }
}
function drawParameters(ctx, session2, m) {
  const track = session2.activeTrack;
  const on = m.trackEnabled(track);
  for (let page = 0; page < 4; page++) {
    const y = Row013 + page * CellH5;
    if (page === 0) {
      label(ctx, TRACK_NAMES[track] ?? `TRACK ${track}`, GridLabel + 20, y + 40, 34, on ? OpbTheme.Ink : OpbTheme.Mid, "left", "normal");
      label(ctx, on ? `CHANNEL ${m.channel(track) + 1}` : "MIDI OFF", GridLabel + 20, y + 80, 24, on ? OpbTheme.Mid : OpbTheme.Red);
      label(ctx, "OUTGOING CC", GridLabel + 20, y + 110, 22, OpbTheme.Mid);
    } else {
      label(ctx, PageNames2[page], GridLabel + 20, y + 42, 30, OpbTheme.Mid);
    }
    ctx.fillStyle = OpbTheme.Pages[page];
    ctx.fillRect(GridX - 14, y + 26, 6, CellH5 - 52);
    for (let dial = 0; dial < 4; dial++) {
      const param = page * 4 + dial;
      const x = GridX + dial * CellW5;
      const cc = m.parameterCc(track, param);
      label(ctx, ParamLabels[page][dial], x + 10, y + 20, 26, OpbTheme.Mid);
      knob(ctx, x + CellW5 / 2, y + 64, cc / 127, on ? OpbTheme.Dials[dial] : OpbTheme.Mid, 20);
      label(ctx, "CC", x + CellW5 / 2 - 6, y + 107, 22, OpbTheme.Mid, "right");
      label(ctx, String(cc), x + CellW5 / 2, y + 107, 32, OpbTheme.Ink, "left", "normal");
      if (dial > 0) vLine(ctx, x, y, y + CellH5);
    }
    hLine(ctx, GridLabel, RightEnd6, y + CellH5);
  }
  vLine(ctx, GridX, Row013, GlobalTop);
  frame(ctx, { x: GridX, y: Row013, w: CellW5, h: CellH5 }, OpbTheme.Red, 4);
}
function drawGlobals(ctx, m) {
  label(ctx, "GLOBAL", GridLabel + 20, GlobalTop + 42, 30, OpbTheme.Mid);
  label(ctx, "IN SYNC", GridLabel + 20, GlobalTop + 82, 22, OpbTheme.Mid);
  vLine(ctx, GridX, GlobalTop, 812);
  for (let i = 0; i < Flags.length; i++) {
    const [flag, line1, line2] = Flags[i];
    const x = GridX + i % 4 * CellW5, y = GlobalTop + Math.floor(i / 4) * GlobalH, cy = y + GlobalH / 2;
    const on = m.flag(flag);
    toggle(ctx, x + 24, cy, on, true, 24);
    const brush = on ? OpbTheme.Ink : OpbTheme.Mid;
    const weight = on ? "normal" : "light";
    if (!line2) label(ctx, line1, x + 48, cy, 22, brush, "left", weight);
    else {
      label(ctx, fitText(ctx, line1, CellW5 - 52, 22, weight), x + 48, cy - 13, 22, brush, "left", weight);
      label(ctx, fitText(ctx, line2, CellW5 - 52, 22, weight), x + 48, cy + 14, 22, brush, "left", weight);
    }
    if (i % 4 > 0) vLine(ctx, x, y, Math.floor(i / 4) === 1 ? 812 : y + GlobalH);
  }
  hLine(ctx, GridLabel, RightEnd6, GlobalTop + GlobalH);
}

// src/model/firmware.ts
var FILE_SERVICE_VERSION = [1, 2, 45];
var DOWNLOAD_URL = "teenage.engineering/downloads/op-z";
function parseFirmware(firmware) {
  if (firmware == null) return null;
  const trimmed = firmware.trim();
  if (!trimmed) return null;
  let s = "";
  for (const ch of trimmed) {
    if (ch >= "0" && ch <= "9" || ch === ".") s += ch;
    else break;
  }
  s = s.replace(/^\.+|\.+$/g, "");
  const parts = s.split(".").filter((p) => p !== "");
  if (parts.length === 0 || parts.length > 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return null;
  return nums;
}
function supportsFileService(firmware) {
  const v = parseFirmware(firmware);
  if (!v) return null;
  const target = FILE_SERVICE_VERSION;
  const len = Math.max(v.length, target.length);
  for (let i = 0; i < len; i++) {
    const a = v[i] ?? 0;
    const b = target[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

// src/render/screens/devices.ts
var TitleY10 = 40;
var Row014 = 82;
var ListRight2 = 560;
var InfoX = 600;
var InfoW = 960;
var TableTop = 222;
var TableRow = 74;
var PortRows = 3;
var BluetoothTop = Row014 + 84 + PortRows * TableRow + 24;
function renderDevices(ctx, input) {
  const session2 = input.session;
  label(ctx, "DEVICES", input.right / 2, TitleY10, 56, OpbTheme.Ink, "center", "normal");
  hLine(ctx, input.left, input.right, Row014);
  vLine(ctx, ListRight2, Row014, input.bottom);
  drawPorts(ctx, session2);
  drawBluetooth(ctx, input);
  drawDevice(ctx, session2, input);
}
function drawPorts(ctx, session2) {
  label(ctx, "MIDI PORTS", 24, Row014 + 42, 30, OpbTheme.Mid);
  hLine(ctx, 0, ListRight2, Row014 + 84);
  let y = Row014 + 84;
  const port = session2.portName;
  if (!port) {
    label(ctx, "NO MIDI PORTS FOUND", 24, y + 40, 30, OpbTheme.Mid);
    return;
  }
  const name = port.toUpperCase();
  const opz = /OP-Z/i.test(port);
  const active = session2.isConnected;
  ctx.fillStyle = active ? OpbTheme.Green : opz ? OpbTheme.Ink : OpbTheme.Rule;
  ctx.beginPath();
  ctx.arc(40, y + 37, 9, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, fitText(ctx, name, ListRight2 - 90, 30, opz ? "normal" : "light"), 66, y + 30, 30, opz ? OpbTheme.Ink : OpbTheme.Mid, "left", opz ? "normal" : "light");
  label(ctx, active ? "IN USE BY OP-B" : "IN", 66, y + 58, 20, active ? OpbTheme.Green : OpbTheme.Mid);
  y += TableRow;
  hLine(ctx, 0, ListRight2, y);
}
function drawBluetooth(ctx, input) {
  const top = BluetoothTop;
  hLine(ctx, input.left, ListRight2, top);
  label(ctx, "BLUETOOTH", 24, top + 42, 30, OpbTheme.Mid);
  label(ctx, "NOT AVAILABLE", ListRight2 - 24, top + 42, 20, OpbTheme.Red, "right");
  const text = "BLUETOOTH LE-MIDI IS NOT PART OF THIS LINUX USB-MIDI BUILD. CONNECT THE OP-Z WITH A USB CABLE; OP-B USES IT AUTOMATICALLY WHEN PLUGGED IN.";
  let y = top + 84;
  for (const line of wrapText(ctx, text, ListRight2 - 48, 22)) {
    label(ctx, line, 24, y, 22, OpbTheme.Mid);
    y += 30;
  }
}
function drawDevice(ctx, session2, input) {
  const connected = session2.isConnected;
  const device = session2.device;
  const known = !!device.serial;
  const state = connected ? "CONNECTED" : "NOT CONNECTED";
  const stateColor = connected ? OpbTheme.Green : OpbTheme.Red;
  label(ctx, "OP-Z", InfoX, Row014 + 66, 72, connected ? OpbTheme.Ink : OpbTheme.Mid, "left", "normal");
  const titleW = ctx.measureText("OP-Z").width;
  const dotX = InfoX + Math.max(120, titleW) + 36;
  ctx.fillStyle = stateColor;
  ctx.beginPath();
  ctx.arc(dotX, Row014 + 70, 10, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, state, dotX + 22, Row014 + 70, 32, stateColor, "left", "normal");
  const battery = connected ? `${session2.level.battery} %` : "-";
  const port = session2.portName?.toUpperCase() ?? (connected ? "OFFLINE PREVIEW" : "-");
  const module = session2.module.connected && session2.module.name.trim() ? session2.module.name.toUpperCase() : "NONE";
  const sampler = !connected ? "-" : session2.sampler.active ? `SAMPLING (${session2.sampler.packProgress} %)` : "IDLE";
  const left = [["SERIAL", known ? device.serial : "-"], ["FIRMWARE", known ? device.firmware : "-"], ["MODULE", module]];
  const right = [["BATTERY", battery], ["PORT", port], ["SAMPLER", sampler]];
  const colW = InfoW / 2;
  hLine(ctx, ListRight2, input.right, TableTop);
  for (let i = 0; i < 3; i++) {
    const y = TableTop + i * TableRow;
    label(ctx, left[i][0], InfoX, y + TableRow / 2, 30, OpbTheme.Mid);
    label(ctx, fitText(ctx, left[i][1], colW - 220, 34, "normal"), InfoX + 190, y + TableRow / 2, 34, OpbTheme.Ink, "left", "normal");
    label(ctx, right[i][0], InfoX + colW, y + TableRow / 2, 30, OpbTheme.Mid);
    label(ctx, fitText(ctx, right[i][1], colW - 170, 34, "normal"), InfoX + colW + 150, y + TableRow / 2, 34, OpbTheme.Ink, "left", "normal");
    hLine(ctx, ListRight2, input.right, y + TableRow);
  }
  vLine(ctx, InfoX + colW - 24, TableTop, TableTop + 3 * TableRow);
  const boxTop = TableTop + 3 * TableRow + 30;
  const box = { x: InfoX, y: boxTop, w: InfoW, h: 200 };
  const supported = known ? supportsFileService(device.firmware) : null;
  const fv = FILE_SERVICE_VERSION.join(".");
  if (supported === false) {
    frame(ctx, box, OpbTheme.Yellow, 4);
    label(ctx, "FIRMWARE UPDATE NEEDED", box.x + 28, box.y + 40, 34, OpbTheme.Ink, "left", "normal");
    const text = `THIS OP-Z RUNS ${device.firmware}. THE CONFIGURATOR AND FILE TRANSFER NEED FIRMWARE ${fv} OR NEWER. EVERYTHING ELSE WORKS AS IT IS.`;
    let y = box.y + 86;
    for (const line of wrapText(ctx, text, box.w - 56, 26)) {
      label(ctx, line, box.x + 28, y, 26, OpbTheme.Mid);
      y += 32;
    }
    label(ctx, "UPDATE AT " + DOWNLOAD_URL.toUpperCase(), box.x + 28, box.y + 160, 28, OpbTheme.Ink, "left", "normal");
  } else if (supported === true) {
    frame(ctx, { x: box.x, y: box.y, w: box.w, h: 96 }, OpbTheme.Green, 4);
    label(ctx, "FIRMWARE UP TO DATE", box.x + 28, box.y + 32, 30, OpbTheme.Green, "left", "normal");
    label(ctx, "ALL FEATURES, INCLUDING THE CONFIGURATOR, ARE AVAILABLE", box.x + 28, box.y + 66, 24, OpbTheme.Mid);
  } else if (!connected) {
    const text = "CONNECT THE OP-Z WITH A USB CABLE AND TURN IT ON. OP-B CONNECTS BY ITSELF AND PREFERS USB WHEN BOTH ARE THERE.";
    let y = boxTop + 24;
    for (const line of wrapText(ctx, text, InfoW, 28)) {
      label(ctx, line, InfoX, y, 28, OpbTheme.Mid);
      y += 34;
    }
  }
  const reconnect = { x: InfoX, y: input.bottom - 112, w: 300, h: 80 };
  button(ctx, reconnect, "RECONNECT");
  const hint = connected ? "CLOSES AND REOPENS THE MIDI PORT" : "LOOKS FOR THE OP-Z AGAIN";
  label(ctx, fitText(ctx, hint, input.right - (reconnect.x + reconnect.w + 28) - 24, 24), reconnect.x + reconnect.w + 28, reconnect.y + reconnect.h / 2, 24, OpbTheme.Mid);
}

// src/render/screens/index.ts
var SCREENS = {
  track: { title: "Track", render: renderTrack },
  mixer: { title: "Mixer", render: renderMixer },
  tempo: { title: "Tempo", render: renderTempo },
  project: { title: "Project", render: renderProject },
  tape: { title: "Tape", render: renderTape },
  perform: { title: "Perform", render: renderPerform },
  master: { title: "Master", render: renderMaster },
  module: { title: "Module", render: renderModule },
  lights: { title: "Lights", render: renderLights },
  motiontrack: { title: "Motion Track", render: renderMotionTrack },
  steps: { title: "Step Components", render: renderSteps },
  configurator: { title: "Configurator", render: renderConfigurator },
  photomatic: { title: "Photomatic", render: renderPhotomatic },
  motion: { title: "Motion", render: renderMotion },
  midisetup: { title: "MIDI Setup", render: renderMidiSetup },
  devices: { title: "Devices", render: renderDevices }
};
var SCREEN_ORDER = [
  "track",
  "mixer",
  "tempo",
  "project",
  "tape",
  "perform",
  "master",
  "module",
  "lights",
  "motiontrack",
  "steps",
  "configurator",
  "photomatic",
  "motion",
  "midisetup",
  "devices"
];
function routeFor(session2) {
  const ui = session2.ui;
  if (ui.mixer && SCREENS.mixer) return "mixer";
  if (ui.tempo && SCREENS.tempo) return "tempo";
  if (ui.project && SCREENS.project) return "project";
  const t = session2.activeTrack;
  if (ui.shift && ui.heldKey >= 0 && t <= 7) return "steps";
  switch (t) {
    case 10:
      return "tape";
    case 11:
      return "master";
    case 12:
      return "perform";
    case 13:
      return "module";
    case 14:
      return "lights";
    case 15:
      return "motiontrack";
    default:
      return "track";
  }
}

// src/app/canvasView.ts
var WRITE_EDITOR_SCREENS = /* @__PURE__ */ new Set([
  "midisetup",
  "steps",
  "configurator"
]);
function fitTransform(cssWidth, cssHeight) {
  if (cssWidth <= 0 || cssHeight <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(cssWidth / DESIGN_WIDTH, cssHeight / DESIGN_HEIGHT);
  const offsetX = (cssWidth - DESIGN_WIDTH * scale) / 2;
  const offsetY = (cssHeight - DESIGN_HEIGHT * scale) / 2;
  return { scale, offsetX, offsetY };
}
var CanvasView = class {
  canvas;
  ctx;
  session;
  screen = "track";
  transform = { scale: 1, offsetX: 0, offsetY: 0 };
  raf = 0;
  running = false;
  dpr = 1;
  selected = null;
  /** Stage 6: null keeps every screen in its read-only layout. Set by the write controller. */
  writeState = null;
  /** When true, each frame follows routeFor(session), like the device's held buttons + active track. */
  autoRoute = false;
  onScreenChange = null;
  onPlayingChange = null;
  onAutoRouteChange = null;
  /** Stage 5: called once per rAF frame so the SysEx timeline can advance. */
  onTick = null;
  // Animation clock.
  playAccumMs = 0;
  playStartMs = 0;
  fakePlaying = false;
  lastFrameMs = 0;
  // Meter pulses: seconds-since-last-note and 0..1 velocity per track (0..7).
  meterAt = new Array(8).fill(-10);
  meterVel = new Array(8).fill(0);
  // Last pointer position in design coordinates (for hover/hit-testing).
  pointer = { x: -1, y: -1, inside: false };
  constructor(canvas2, session2) {
    const ctx = canvas2.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.canvas = canvas2;
    this.ctx = ctx;
    this.session = session2;
    session2.onNote = (track, _note, velocity) => {
      if (track >= 0 && track < 8) {
        this.meterAt[track] = performance.now() / 1e3;
        this.meterVel[track] = Math.max(0, Math.min(1, velocity / 127));
      }
    };
  }
  get currentScreen() {
    return this.screen;
  }
  isPlaying() {
    return this.session.clockRunning || this.session.play.playing || this.fakePlaying;
  }
  setScreen(name) {
    if (name === this.screen) return;
    this.screen = name;
    this.onScreenChange?.(name);
  }
  /** Manual navigation turns auto-route off so a click sticks (mirrors the device). */
  navigateTo(name) {
    this.setAutoRoute(false);
    this.setScreen(name);
  }
  setAutoRoute(on) {
    if (this.autoRoute === on) return;
    this.autoRoute = on;
    this.onAutoRouteChange?.(on);
    if (on) this.setScreen(routeFor(this.session));
  }
  /** Re-evaluate the device-following route (called each frame while autoRoute is on). */
  followRoute() {
    this.setScreen(routeFor(this.session));
  }
  nextScreen() {
    this.setAutoRoute(false);
    const i = SCREEN_ORDER.indexOf(this.screen);
    this.setScreen(SCREEN_ORDER[(i + 1) % SCREEN_ORDER.length]);
  }
  prevScreen() {
    this.setAutoRoute(false);
    const i = SCREEN_ORDER.indexOf(this.screen);
    this.setScreen(SCREEN_ORDER[(i - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length]);
  }
  togglePlay() {
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
  start() {
    if (this.running) return;
    this.running = true;
    this.measure();
    window.addEventListener("resize", this.onResize);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.lastFrameMs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }
  resize = () => this.measure();
  onResize = this.resize;
  measure() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.transform = fitTransform(rect.width, rect.height);
  }
  toDesign(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.transform.offsetX) / this.transform.scale;
    const y = (clientY - rect.top - this.transform.offsetY) / this.transform.scale;
    return { x, y };
  }
  onPointerMove = (e) => {
    const p = this.toDesign(e.clientX, e.clientY);
    this.pointer = { x: p.x, y: p.y, inside: true };
  };
  onPointerLeave = () => {
    this.pointer = { x: -1, y: -1, inside: false };
  };
  onPointerDown = (e) => {
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
  handleClick(x, y) {
    if (this.screen === "mixer") {
      const X02 = 107, ColW4 = 173.5;
      if (y > 214 && y < 726 && x >= X02 && x <= X02 + 8 * ColW4) {
        const t = Math.floor((x - X02) / ColW4);
        if (t >= 0 && t < 8) this.session.setTrackMute(t, !this.isMixerMuted(t));
      }
      return;
    }
    if (this.screen === "track") {
      const track = this.session.play.track;
      const sel = this.trackHitTest(x, y, track);
      this.selected = sel;
      return;
    }
    if (this.screen === "tempo") this.togglePlay();
  }
  isMixerMuted(t) {
    return this.session.hasMixer ? (this.session.mixer.muteMask & 1 << t) !== 0 : this.session.bank?.isMuted(this.session.activePattern, t) ?? false;
  }
  trackHitTest(x, y, track) {
    const ColLabel5 = 216, ColW4 = 130, FxRight2 = 952, RightEnd7 = 1426;
    const Row015 = 82, Row13 = 212, Row33 = 472, Row42 = 602;
    const cell5 = (cx, cy0, cy1, p) => {
      if (x >= cx && x <= cx + ColW4 && y >= cy0 && y <= cy1) return { track, param: p };
      return null;
    };
    const SOUND = [0, 1, 9, 10];
    const LFO = [13, 14, 15, 16];
    const SETTINGS = [17, 6];
    for (let i = 0; i < 4; i++) {
      const cx = ColLabel5 + i * ColW4;
      let hit = cell5(cx, Row015, Row13, SOUND[i]);
      if (!hit && this.session.ui.page === 2) hit = cell5(cx, Row33, Row42, LFO[i]);
      if (hit) return hit;
    }
    const fxHit = (cx, p) => cell5(cx, Row015, Row13, p);
    const s1 = fxHit(FxRight2, 7);
    if (s1) return s1;
    const s2 = fxHit(FxRight2 + ColW4, 8);
    if (s2) return s2;
    const ns = cell5(RightEnd7 + 18, Row015, Row13, 17);
    if (ns) return ns;
    return null;
  }
  // ---- render loop ----
  frame = (now) => {
    if (!this.running) return;
    const dt = now - this.lastFrameMs;
    this.lastFrameMs = now;
    const playing = this.isPlaying();
    if (playing) this.playAccumMs += dt;
    if (this.autoRoute) this.followRoute();
    this.onTick?.(now);
    const tempo = this.session.global ? this.session.global.tempo : 120;
    const beats = this.playAccumMs / 1e3 / 60 * tempo;
    const { scale, offsetX, offsetY } = this.transform;
    const input = {
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
      write: this.writeState
    };
    this.paint(input);
    this.raf = requestAnimationFrame(this.frame);
  };
  /** Paints one frame; exposed for testing the render pipeline without rAF. */
  paint(input) {
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
    if (input.write && !WRITE_EDITOR_SCREENS.has(this.screen)) {
      writeStatusBadge(ctx, input.write);
    }
    ctx.restore();
  }
};

// src/midi/midiTransport.ts
async function openWebMidi(namePattern = /op[\s_-]?z/i) {
  const nav = navigator;
  if (typeof nav.requestMIDIAccess !== "function") {
    throw new Error("Web MIDI API unavailable. Use Chrome / Edge / Chromium on https or localhost.");
  }
  const access = await nav.requestMIDIAccess({ sysex: true });
  if (!access.sysexEnabled) {
    throw new Error("SysEx permission was denied. OP-Z state frames are all SysEx.");
  }
  const choose = (ports) => {
    return Array.from(ports.values()).find((port) => port.state !== "disconnected" && `${port.name ?? ""} ${port.manufacturer ?? ""}`.search(namePattern) !== -1);
  };
  const inPort = choose(access.inputs);
  const outPort = choose(access.outputs);
  if (!inPort || !outPort) {
    throw new Error("No OP-Z MIDI input/output pair. Check the USB data cable and whether the browser lists OP-Z.");
  }
  await inPort.open();
  await outPort.open();
  const transport = {
    sysexEnabled: access.sysexEnabled,
    inputName: inPort.name,
    outputName: outPort.name,
    onSysex: null,
    onShort: null,
    onStateChange: null,
    listPorts: () => ({
      inputs: Array.from(access.inputs.values()).map((p) => p.name ?? ""),
      outputs: Array.from(access.outputs.values()).map((p) => p.name ?? "")
    }),
    sendSysex: (message) => outPort.send(Array.from(message)),
    sendShort: (status, data1 = 0, data2 = 0) => outPort.send([status, data1, data2]),
    close: async () => {
      inPort.onmidimessage = null;
      access.onstatechange = null;
      await inPort.close();
      await outPort.close();
    }
  };
  inPort.onmidimessage = (event) => {
    const data = event.data;
    if (!data || data.length === 0) return;
    if (data[0] === 240) transport.onSysex?.(Uint8Array.from(data));
    else transport.onShort?.(data[0], data[1] ?? 0, data[2] ?? 0);
  };
  access.onstatechange = () => {
    transport.onStateChange?.();
  };
  return transport;
}

// src/midi/deckMidi.ts
async function openDeckMidi() {
  const outgoing = [];
  const client = crypto.randomUUID();
  let closed = false;
  const exchange = async (start = false) => {
    const response = await fetch("/deck-midi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OPB-Client": client,
        "X-OPB-Start": start ? "1" : "0"
      },
      body: JSON.stringify(outgoing.splice(0)),
      signal: AbortSignal.timeout(3e3)
    });
    if (!response.ok) throw new Error(`Deck MIDI bridge unavailable (${response.status})`);
    return response.json();
  };
  const first = await exchange(true);
  const transport = {
    sysexEnabled: true,
    inputName: "OP-Z Deck bridge",
    outputName: "OP-Z Deck bridge (read-only)",
    onSysex: null,
    onShort: null,
    onStateChange: null,
    listPorts: () => ({ inputs: ["OP-Z Deck bridge"], outputs: ["OP-Z Deck bridge (read-only)"] }),
    sendSysex: (message) => {
      outgoing.push(Array.from(message, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    },
    sendShort: () => {
    },
    close: async () => {
      closed = true;
    }
  };
  async function poll(frames) {
    try {
      while (!closed) {
        for (const frame3 of frames) {
          const data = Uint8Array.from(frame3.match(/../g) ?? [], (byte) => parseInt(byte, 16));
          if (data[0] === 240) transport.onSysex?.(data);
          else if (data.length) transport.onShort?.(data[0], data[1] ?? 0, data[2] ?? 0);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (!closed) frames = await exchange();
      }
    } catch {
      if (!closed) transport.onStateChange?.();
      closed = true;
    }
  }
  setTimeout(() => {
    void poll(first);
  }, 0);
  return transport;
}

// src/midi/bleMidiCodec.ts
var BLE_MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
var BLE_MIDI_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";
var BLE_MIDI_MAX_WRITE = 20;
var BLE_MIDI_MIN_PACKET = 5;
var BLE_TIMESTAMP_MASK = 8191;
function messageLength(status) {
  if (status < 128) return 0;
  if (status < 192) return 3;
  if (status < 224) return 2;
  if (status < 240) return 3;
  if (status === 241 || status === 243) return 2;
  if (status === 242) return 3;
  return 1;
}
function headerByte(timestamp) {
  return 128 | timestamp >> 7 & 63;
}
function stampByte(timestamp) {
  return 128 | timestamp & 127;
}
function encodeShort(status, data1 = 0, data2 = 0, timestamp = 0) {
  const length = messageLength(status);
  const packet = new Uint8Array(2 + length);
  packet[0] = headerByte(timestamp);
  packet[1] = stampByte(timestamp);
  packet[2] = status & 255;
  if (length > 1) packet[3] = data1 & 127;
  if (length > 2) packet[4] = data2 & 127;
  return packet;
}
function encodeSysex(message, maxPacket = BLE_MIDI_MAX_WRITE, timestamp = 0) {
  const src = message instanceof Uint8Array ? message : Uint8Array.from(message);
  if (src.length < 2 || src[0] !== 240 || src[src.length - 1] !== 247) {
    throw new Error("Not a complete SysEx message (expected F0 ... F7)");
  }
  const limit = Math.max(maxPacket, BLE_MIDI_MIN_PACKET);
  const packets = [];
  let packet = [headerByte(timestamp), stampByte(timestamp), 240];
  const last = src.length - 1;
  for (let i = 1; i < last; i++) {
    if (packet.length === limit) {
      packets.push(Uint8Array.from(packet));
      packet = [headerByte(timestamp)];
    }
    packet.push(src[i]);
  }
  if (packet.length + 2 > limit) {
    packets.push(Uint8Array.from(packet));
    packet = [headerByte(timestamp)];
  }
  packet.push(stampByte(timestamp));
  packet.push(247);
  packets.push(Uint8Array.from(packet));
  return packets;
}
var BleMidiDecoder = class {
  onSysex = null;
  onShort = null;
  sysex = [];
  inSysex = false;
  running = 0;
  constructor(handlers = {}) {
    this.onSysex = handlers.onSysex ?? null;
    this.onShort = handlers.onShort ?? null;
  }
  /** True while a SysEx is being reassembled across packets. Exposed for diagnostics/tests. */
  get reassembling() {
    return this.inSysex;
  }
  /** Discard any partial SysEx and running status (call on link loss / reconnect). */
  reset() {
    this.sysex = [];
    this.inSysex = false;
    this.running = 0;
  }
  feed(packet) {
    const p = packet instanceof Uint8Array ? packet : Uint8Array.from(packet);
    if (p.length < 2 || (p[0] & 128) === 0) return;
    let i = 1;
    while (i < p.length) {
      let b = p[i];
      if (this.inSysex) {
        if (b < 128) {
          this.sysex.push(b);
          i++;
          continue;
        }
        if (i + 1 >= p.length) {
          if (b === 247) this.endSysex();
          return;
        }
        const next = p[i + 1];
        if (next === 247) {
          this.endSysex();
          i += 2;
          continue;
        }
        if (next >= 248) {
          this.onShort?.(next, 0, 0);
          i += 2;
          continue;
        }
        this.inSysex = false;
        this.sysex = [];
      }
      if (b >= 128) {
        if (++i >= p.length) return;
        b = p[i];
      }
      if (b < 128) {
        if (this.running === 0) {
          i++;
          continue;
        }
        i = this.readMessage(p, i, this.running);
        continue;
      }
      if (b === 240) {
        this.inSysex = true;
        this.sysex = [240];
        i++;
        continue;
      }
      if (b >= 248) {
        this.onShort?.(b, 0, 0);
        i++;
        continue;
      }
      this.running = b < 240 ? b : 0;
      i = this.readMessage(p, i + 1, b);
    }
  }
  /** Reads the data bytes of a message starting at `i`; returns the next index. */
  readMessage(packet, i, status) {
    const dataBytes = messageLength(status) - 1;
    let d1 = 0;
    let d2 = 0;
    let cursor = i;
    if (dataBytes >= 1) {
      if (cursor >= packet.length || packet[cursor] >= 128) return cursor;
      d1 = packet[cursor++];
    }
    if (dataBytes >= 2) {
      if (cursor >= packet.length || packet[cursor] >= 128) return cursor;
      d2 = packet[cursor++];
    }
    this.onShort?.(status, d1, d2);
    return cursor;
  }
  endSysex() {
    this.sysex.push(247);
    this.inSysex = false;
    const message = Uint8Array.from(this.sysex);
    this.sysex = [];
    this.onSysex?.(message);
  }
};
function webBluetoothAvailable(nav = globalThis.navigator) {
  const candidate = nav;
  return typeof candidate?.bluetooth?.requestDevice === "function";
}

// src/midi/bleMidiTransport.ts
async function openBleMidi(options = {}) {
  const nav = globalThis.navigator;
  const bluetooth = options.bluetooth ?? nav?.bluetooth ?? null;
  if (!bluetooth || typeof bluetooth.requestDevice !== "function") {
    throw new Error("Web Bluetooth unavailable. Use Chromium with BlueZ on https/localhost; USB Web MIDI and offline replay still work.");
  }
  const now = options.now ?? (() => Date.now());
  const maxPacket = Math.min(options.maxPacket ?? BLE_MIDI_MAX_WRITE, BLE_MIDI_MAX_WRITE);
  const log = options.onLog ?? (() => void 0);
  const requestOptions = options.acceptAllDevices ? { acceptAllDevices: true, optionalServices: [BLE_MIDI_SERVICE_UUID] } : {
    filters: [{ services: [BLE_MIDI_SERVICE_UUID] }],
    optionalServices: [BLE_MIDI_SERVICE_UUID]
  };
  const device = await bluetooth.requestDevice(requestOptions);
  const gatt = device.gatt;
  if (!gatt) throw new Error("Selected device has no GATT server");
  await gatt.connect();
  let service;
  let characteristic;
  try {
    service = await gatt.getPrimaryService(BLE_MIDI_SERVICE_UUID);
    characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC_UUID);
  } catch (err) {
    gatt.disconnect();
    throw new Error(`No BLE-MIDI service/characteristic on ${device.name ?? "device"}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await characteristic.readValue?.();
  } catch {
  }
  const deviceName = device.name || "OP-Z";
  const label2 = `${deviceName} (Bluetooth)`;
  const decoder = new BleMidiDecoder();
  let closed = false;
  let connected = true;
  let lastError = null;
  let pending = 0;
  let chain = Promise.resolve();
  const transport = {
    sysexEnabled: true,
    inputName: label2,
    outputName: label2,
    onSysex: null,
    onShort: null,
    onStateChange: null,
    listPorts: () => ({ inputs: [label2], outputs: [label2] }),
    sendSysex: (message) => {
      if (closed || !connected) throw new Error("BLE link is not connected");
      const packets = encodeSysex(message, maxPacket, now() & BLE_TIMESTAMP_MASK);
      enqueue(packets);
    },
    sendShort: (status, data1 = 0, data2 = 0) => {
      if (closed || !connected) throw new Error("BLE link is not connected");
      enqueue([encodeShort(status, data1, data2, now() & BLE_TIMESTAMP_MASK)]);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      onValueChanged && characteristic.removeEventListener("characteristicvaluechanged", onValueChanged);
      device.removeEventListener("gattserverdisconnected", onDisconnected);
      await chain.catch(() => void 0);
      try {
        await characteristic.stopNotifications();
      } catch {
      }
      decoder.reset();
      connected = false;
      gatt.disconnect();
    },
    flush: async () => {
      await chain;
    },
    get queued() {
      return pending;
    },
    get connected() {
      return connected && !closed;
    },
    get lastError() {
      return lastError;
    },
    get deviceName() {
      return label2;
    }
  };
  function writePacket(packet) {
    if (packet.length > maxPacket) {
      throw new Error(`BLE-MIDI packet ${packet.length} B exceeds the ${maxPacket} B OP-Z limit`);
    }
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      return characteristic.writeValueWithoutResponse(packet);
    }
    if (characteristic.writeValueWithResponse) {
      return characteristic.writeValueWithResponse(packet);
    }
    throw new Error("BLE-MIDI characteristic exposes no write method");
  }
  function enqueue(packets) {
    for (const packet of packets) {
      pending++;
      chain = chain.then(async () => {
        try {
          if (!closed && connected) await writePacket(packet);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          log(`BLE write failed \xB7 ${lastError}`);
          transport.onStateChange?.();
        } finally {
          pending--;
        }
      });
    }
  }
  const onValueChanged = (event) => {
    const view2 = event.target?.value ?? event.currentTarget?.value ?? characteristic.value ?? null;
    if (!view2) return;
    const bytes = new Uint8Array(view2.buffer, view2.byteOffset, view2.byteLength);
    decoder.feed(bytes);
  };
  const onDisconnected = () => {
    connected = false;
    decoder.reset();
    log("BLE link lost \xB7 switch back to USB Web MIDI or offline replay");
    transport.onStateChange?.();
  };
  decoder.onSysex = (message) => transport.onSysex?.(message);
  decoder.onShort = (status, d1, d2) => transport.onShort?.(status, d1, d2);
  characteristic.addEventListener("characteristicvaluechanged", onValueChanged);
  device.addEventListener("gattserverdisconnected", onDisconnected);
  await characteristic.startNotifications();
  log(`BLE \xB7 ${label2} \xB7 MTU ${maxPacket} B \xB7 notifications on`);
  return transport;
}
function bleCapability() {
  const supported = webBluetoothAvailable();
  return {
    supported,
    reason: supported ? "navigator.bluetooth present \xB7 still requires a real Deck/BlueZ check" : "Web Bluetooth unavailable (Chromium + BlueZ + secure context required). USB Web MIDI and offline replay still work."
  };
}

// src/midi/transportEvidence.ts
var STAGE7_EVIDENCE = {
  usbWebMidi: {
    grade: "device-proven",
    claim: "navigator.requestMIDIAccess({sysex:true}) received a complete 31-frame / 989-byte OP-Z state burst over USB.",
    source: "tools/webmidi-probe.html + web/captures/webmidi-20261105.txt, 2026-11-05"
  },
  bleMidiPacketFormat: {
    grade: "decoded",
    claim: "BLE-MIDI 1.0 packets: header + timestamp, cross-packet SysEx continuation, running status and interleaved realtime. TS port reproduces every C# test vector.",
    source: "OPB.Core/Midi/BleMidiCodec.cs + OP-Z-Windows/tests/OPB.Core.Tests/BleMidiTests.cs"
  },
  bleMidiUuids: {
    grade: "decoded",
    claim: "Service 03B80E5A-... and I/O characteristic 7772E5DB-... identify BLE-MIDI.",
    source: "BleMidiCodec.ServiceUuid / CharacteristicUuid (BLE-MIDI 1.0 spec)"
  },
  opzWriteCeiling: {
    grade: "device-proven",
    claim: "The OP-Z drops the BLE link when a single write exceeds 20 bytes (a 31-byte sound edit reproduced it); it may still SEND larger packets on a negotiated MTU.",
    source: "BleMidiConnection.MaxWrite comment + Windows BLE hardware observation"
  },
  browserWebBluetooth: {
    grade: "unknown",
    claim: "Whether the host Chromium exposes navigator.bluetooth with a working GATT/BlueZ stack is probed at runtime. The app never assumes it; USB / offline replay remain.",
    source: "Stage 7 safety policy \u2014 no Deck verification yet"
  },
  steamOsBleHost: {
    grade: "unknown",
    claim: "SteamOS Gaming Mode Chromium + BlueZ pairing/bonding for an OP-Z is unverified. No experimental launch flags are invented in gaming-mode.sh.",
    source: "Stage 7 safety policy \u2014 requires a real Steam Deck"
  },
  gamepadMapping: {
    grade: "decoded",
    claim: "Standard Gamepad API button indices and edge-triggered polling are implemented exactly as specified; all mapping logic is Node-testable.",
    source: "W3C Gamepad API standard mapping + src/app/gamepadNav.ts"
  },
  steamInputInGamingMode: {
    grade: "inferred",
    claim: "Steam Input is expected to expose Deck controls as a standard gamepad to the browser in Gaming Mode; this has not been checked on hardware.",
    source: "Steam Deck controller conventions \u2014 needs Deck verification"
  },
  gamingModeLauncher: {
    grade: "inferred",
    claim: "A 127.0.0.1 secure-context static server + Chromium --app/--start-fullscreen window + $HOME profile works on SteamOS (root FS is read-only).",
    source: "Chromium standard flags + SteamOS filesystem conventions \u2014 needs Deck verification"
  }
};
function stage7EvidenceLabel(key) {
  const grade = STAGE7_EVIDENCE[key]?.grade ?? "unknown";
  return grade.toUpperCase();
}

// src/app/gamepadNav.ts
var GAMEPAD_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16
};
var GAMEPAD_BINDINGS = {
  [GAMEPAD_BUTTON.DPAD_RIGHT]: "next-screen",
  [GAMEPAD_BUTTON.RB]: "next-screen",
  [GAMEPAD_BUTTON.DPAD_LEFT]: "prev-screen",
  [GAMEPAD_BUTTON.LB]: "prev-screen",
  [GAMEPAD_BUTTON.A]: "toggle-play",
  [GAMEPAD_BUTTON.B]: "toggle-auto",
  [GAMEPAD_BUTTON.X]: "timeline-play",
  [GAMEPAD_BUTTON.Y]: "toggle-loop",
  [GAMEPAD_BUTTON.LT]: "timeline-step-back",
  [GAMEPAD_BUTTON.RT]: "timeline-step-forward",
  // 'toggle-write-editor' only OPENS/CLOSES the default DRY RUN editor. It can never arm it.
  [GAMEPAD_BUTTON.START]: "toggle-write-editor"
};
var DEFAULT_DEADZONE = 0.65;
var STICK_X_AXIS = 0;
function copyPad(pad) {
  if (!pad || pad.connected === false) return null;
  return {
    id: pad.id ?? "gamepad",
    connected: true,
    pressed: Array.from(pad.buttons ?? [], (b) => Boolean(b?.pressed)),
    axes: Array.from(pad.axes ?? [], (a) => Number(a) || 0)
  };
}
function axisDirection(pad, deadzone) {
  const value = pad?.axes[STICK_X_AXIS] ?? 0;
  if (value > deadzone) return 1;
  if (value < -deadzone) return -1;
  return 0;
}
function planGamepadActions(prev, cur, deadzone = DEFAULT_DEADZONE) {
  if (!cur || !cur.connected) return [];
  if (!prev || prev.id !== cur.id) return [];
  const actions = [];
  for (const [indexText, action] of Object.entries(GAMEPAD_BINDINGS)) {
    const i = Number(indexText);
    if (cur.pressed[i] && !prev.pressed[i]) actions.push(action);
  }
  const before = axisDirection(prev, deadzone);
  const after = axisDirection(cur, deadzone);
  if (after !== 0 && before === 0) {
    actions.push(after > 0 ? "next-screen" : "prev-screen");
  }
  return actions;
}
var GamepadNavigator = class {
  getPads;
  onAction;
  onStatus;
  deadzone;
  prev = null;
  lastConnected = false;
  enabled;
  constructor(options) {
    this.getPads = options.getPads ?? defaultGetPads;
    this.onAction = options.onAction;
    this.onStatus = options.onStatus ?? null;
    this.deadzone = options.deadzone ?? DEFAULT_DEADZONE;
    this.enabled = options.enabled ?? true;
  }
  get connected() {
    return this.lastConnected;
  }
  /** Call once per animation frame. Returns the actions emitted this frame. */
  poll() {
    if (!this.enabled) return [];
    let pads = [];
    try {
      pads = this.getPads() ?? [];
    } catch {
      pads = [];
    }
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
  reset() {
    this.prev = null;
  }
};
function defaultGetPads() {
  const nav = globalThis.navigator;
  if (typeof nav?.getGamepads !== "function") return [];
  return Array.from(nav.getGamepads());
}

// src/app/timeline.ts
var DEFAULT_FRAME_GAP_MS = 120;
var TAIL_MS = 400;
function hexOf(data) {
  let out = "";
  for (const b of data) out += b.toString(16).padStart(2, "0").toUpperCase();
  return out;
}
function frameIdLabel(data) {
  if (data.length < 6 || data[0] !== 240) return "--";
  if (data[1] === 126) return "ID";
  return `$${data[5].toString(16).padStart(2, "0")}`;
}
function byteCount(frames) {
  return frames.reduce((n, f) => n + f.data.length, 0);
}
function durationMs(frames) {
  return frames.length ? frames[frames.length - 1].tMs + TAIL_MS : 0;
}
function parseTimedCapture(text, source = "capture") {
  const frames = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let comment = "";
    const hash = line.indexOf("#");
    if (hash >= 0) {
      comment = line.slice(hash + 1);
      line = line.slice(0, hash).trim();
    }
    const colon = line.indexOf(":");
    if (colon >= 0 && colon < 4) line = line.slice(colon + 1).trim();
    if (!line || line.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(line)) continue;
    const data = Uint8Array.from(line.match(/../g).map((h) => parseInt(h, 16)));
    const match = /(?:^|\s)t=(\d+)(?:\s|$)/.exec(comment);
    frames.push({ data, tMs: match ? Number(match[1]) : -1 });
  }
  const hasExplicit = frames.some((f) => f.tMs >= 0);
  let prev = -DEFAULT_FRAME_GAP_MS;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.tMs < 0) f.tMs = hasExplicit ? prev + DEFAULT_FRAME_GAP_MS : i * DEFAULT_FRAME_GAP_MS;
    if (f.tMs < prev) f.tMs = prev;
    prev = f.tMs;
  }
  return { frames, source };
}
function safeSource(source) {
  return source.replace(/[\r\n#]/g, " ").slice(0, 120);
}
function toReplayText(capture2) {
  const { frames } = capture2;
  const header = [
    "# OP-B Web SysEx timeline capture; one frame per line as hex.",
    "# Compatible with: ./OP-B --replay <this file>",
    `# source: ${safeSource(capture2.source)}`,
    `# ${frames.length} frames, ${byteCount(frames)} bytes, ${durationMs(frames)} ms`,
    '# The inline "# t=<ms>" comment carries replay timing; --replay ignores it.'
  ];
  const lines = frames.map((f) => `${hexOf(f.data)} # t=${Math.round(f.tMs)}`);
  return header.concat(lines).join("\n") + "\n";
}
function toTimelineJson(capture2) {
  const { frames } = capture2;
  return {
    format: "opb-web-timeline/1",
    source: capture2.source,
    frameCount: frames.length,
    byteCount: byteCount(frames),
    durationMs: durationMs(frames),
    frames: frames.map((f) => ({
      tMs: Math.round(f.tMs),
      id: frameIdLabel(f.data),
      hex: hexOf(f.data)
    }))
  };
}
function parseTimelineJson(text, source = "json") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed;
  if (obj.format !== "opb-web-timeline/1" || !Array.isArray(obj.frames)) return null;
  const frames = [];
  for (const entry of obj.frames) {
    if (!entry || typeof entry !== "object") continue;
    const row2 = entry;
    const hex2 = typeof row2.hex === "string" ? row2.hex.replace(/[^0-9A-Fa-f]/g, "") : "";
    if (!hex2 || hex2.length % 2 !== 0) continue;
    const t = typeof row2.tMs === "number" && Number.isFinite(row2.tMs) ? row2.tMs : -1;
    frames.push({
      data: Uint8Array.from(hex2.match(/../g).map((h) => parseInt(h, 16))),
      tMs: t >= 0 ? Math.round(t) : -1
    });
  }
  let prev = -DEFAULT_FRAME_GAP_MS;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].tMs < 0) frames[i].tMs = i * DEFAULT_FRAME_GAP_MS;
    if (frames[i].tMs < prev) frames[i].tMs = prev;
    prev = frames[i].tMs;
  }
  return { frames, source: typeof obj.source === "string" ? obj.source : source };
}
function loadTimelineText(text, source = "import") {
  return parseTimelineJson(text, source) ?? parseTimedCapture(text, source);
}
var Recorder = class {
  clock;
  frames = [];
  startedAt = 0;
  recording = false;
  constructor(clock = () => performance.now()) {
    this.clock = clock;
  }
  start() {
    this.frames = [];
    this.startedAt = this.clock();
    this.recording = true;
  }
  record(data) {
    if (!this.recording) return;
    this.frames.push({
      data: Uint8Array.from(data),
      tMs: Math.max(0, Math.round(this.clock() - this.startedAt))
    });
  }
  stop() {
    this.recording = false;
    return this.frames.slice();
  }
  get count() {
    return this.frames.length;
  }
  get elapsedMs() {
    return this.recording ? Math.max(0, Math.round(this.clock() - this.startedAt)) : 0;
  }
};
var TimelinePlayer = class {
  frames;
  inject;
  rebuild;
  clock;
  onUpdate;
  onEnd;
  playingFlag = false;
  cursorIndex = 0;
  baseMs = 0;
  startedAt = 0;
  speedValue = 1;
  loopFlag = false;
  pumping = false;
  /** Invalidates in-flight async injections when a seek rebuilds the session. */
  token = 0;
  constructor(options) {
    this.frames = options.frames.slice();
    this.inject = options.inject;
    this.rebuild = options.rebuild;
    this.clock = options.clock ?? (() => performance.now());
    this.onUpdate = options.onUpdate;
    this.onEnd = options.onEnd;
  }
  get durationMs() {
    return durationMs(this.frames);
  }
  get cursor() {
    return this.cursorIndex;
  }
  get playing() {
    return this.playingFlag;
  }
  get loop() {
    return this.loopFlag;
  }
  get speed() {
    return this.speedValue;
  }
  get state() {
    return {
      playing: this.playingFlag,
      cursor: this.cursorIndex,
      positionMs: this.positionMs(),
      durationMs: this.durationMs,
      speed: this.speedValue,
      loop: this.loopFlag,
      frameCount: this.frames.length
    };
  }
  positionMs() {
    if (!this.playingFlag) return Math.min(this.baseMs, this.durationMs);
    const elapsed = Math.max(0, this.clock() - this.startedAt) * this.speedValue;
    return Math.min(this.durationMs, this.baseMs + elapsed);
  }
  play() {
    if (this.playingFlag || !this.frames.length) return;
    if (this.cursorIndex >= this.frames.length) return;
    this.playingFlag = true;
    this.baseMs = this.frames[this.cursorIndex].tMs;
    this.startedAt = this.clock();
    this.notify();
  }
  pause() {
    if (!this.playingFlag) return;
    this.baseMs = this.positionMs();
    this.playingFlag = false;
    this.notify();
  }
  setLoop(on) {
    this.loopFlag = on;
    this.notify();
  }
  setSpeed(value) {
    const position = this.positionMs();
    this.speedValue = Math.max(0.1, Math.min(8, value));
    this.baseMs = position;
    this.startedAt = this.clock();
    this.notify();
  }
  /** Rebuilds the session up to `index`, which is how seeking backwards works. */
  async seek(index) {
    const target = Math.max(0, Math.min(this.frames.length, Math.round(index)));
    this.playingFlag = false;
    this.token++;
    this.pumping = false;
    this.cursorIndex = target;
    this.baseMs = target < this.frames.length ? this.frames[target].tMs : this.durationMs;
    await this.rebuild(target);
    this.notify();
  }
  async step(delta) {
    await this.seek(this.cursorIndex + delta);
  }
  /** Called from the rAF loop. Never awaits; injections are serialized by `pumping`. */
  tick() {
    if (!this.playingFlag) return;
    const position = this.positionMs();
    if (!this.pumping) {
      const batch = [];
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
  async pump(batch, token) {
    this.pumping = true;
    try {
      for (const frame3 of batch) {
        if (token !== this.token) return;
        await this.inject(frame3.data);
      }
    } finally {
      if (token === this.token) this.pumping = false;
      this.notify();
    }
  }
  notify() {
    this.onUpdate?.(this.state);
  }
};

// src/write/crc32.ts
var TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  TABLE[i] = c >>> 0;
}
function crc32(data, seed = 0) {
  let c = (seed ^ 4294967295) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = (TABLE[(c ^ data[i]) & 255] ^ c >>> 8) >>> 0;
  }
  return (c ^ 4294967295) >>> 0;
}
function crc32Text(text, seed = 0) {
  return crc32(new TextEncoder().encode(text), seed);
}
function crc32Hex(data) {
  return `0x${crc32(data).toString(16).padStart(8, "0")}`;
}
var RESERVED_FILES = [
  { path: "settings/slotconfiguration.json", id: 0 },
  { path: "settings/plugs.json", id: 1 },
  { path: "syncjob.json", id: 2 }
];
var SYNC_JOB_FILE_ID = 2;
function fileIdForPath(path) {
  const lower = path.toLowerCase();
  const reserved = RESERVED_FILES.find((e) => e.path === lower);
  return reserved ? reserved.id : crc32Text(lower);
}

// src/write/transaction.ts
var MAX_DIFF_OFFSETS = 512;
var MAX_HEX_SAMPLE = 4;
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function byteDiff(before, after) {
  const offsets = [];
  const ba = [];
  const aa = [];
  const n = Math.min(before.length, after.length);
  let truncated = false;
  for (let i = 0; i < n; i++) {
    if (before[i] === after[i]) continue;
    if (offsets.length >= MAX_DIFF_OFFSETS) {
      truncated = true;
      break;
    }
    offsets.push(i);
    ba.push(before[i]);
    aa.push(after[i]);
  }
  if (before.length !== after.length) truncated = true;
  return { count: offsets.length, offsets, before: ba, after: aa, truncated };
}
function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s.toUpperCase();
}
var WriteTransaction = class {
  kind;
  evidence;
  baseline;
  staged;
  opts;
  entries = [];
  _phase = "idle";
  _armed = false;
  _frames = [];
  _framesSent = 0;
  _readbackMatched = null;
  constructor(opts) {
    this.opts = opts;
    this.kind = opts.kind;
    this.evidence = opts.evidence;
    this.baseline = opts.baseline.slice();
    this.staged = opts.baseline.slice();
    this.log("idle", `fresh baseline: ${this.baseline.length} bytes ${crc32Hex(this.baseline)}`);
    this._phase = "staging";
  }
  get phase() {
    return this._phase;
  }
  get armed() {
    return this._armed;
  }
  get dryRun() {
    return !this._armed;
  }
  get framesSent() {
    return this._framesSent;
  }
  get readbackMatched() {
    return this._readbackMatched;
  }
  get baselineBytes() {
    return this.baseline.slice();
  }
  get stagedBytes() {
    return this.staged.slice();
  }
  get frames() {
    return this._frames.map((f) => f.slice());
  }
  get entriesView() {
    return this.entries;
  }
  /** Apply an edit to the write-copy. Never touches the captured baseline or the device. */
  stage(edit) {
    if (this._phase === "committed" || this._phase === "rolled-back") {
      throw new Error(`cannot stage a ${this._phase} transaction`);
    }
    edit(this.staged);
    const d = this.diff();
    this.log(
      "staging",
      `staged edit: ${d.count} byte(s) changed${d.truncated ? " (diff truncated)" : ""}`,
      void 0,
      crc32Hex(this.staged)
    );
    return d;
  }
  reset() {
    this.staged = this.baseline.slice();
    this._frames = [];
    this._phase = this._armed ? "armed" : "staging";
    this.log(this._phase, "staged edits discarded, write-copy reset to baseline");
  }
  diff() {
    return byteDiff(this.baseline, this.staged);
  }
  /** Encode the current write-copy into frames WITHOUT sending anything. */
  async preview() {
    this._frames = (await this.opts.encode(this.staged)).map((f) => f.slice());
    this.log(this._phase, `encoded ${this._frames.length} frame(s), 0 sent`, this._frames.length);
    return this.frames;
  }
  /** First gate: explicitly unlock real sends. */
  arm() {
    this._armed = true;
    this._phase = "armed";
    this.log("armed", "device writes unlocked (second confirmation still required at commit)");
  }
  disarm() {
    this._armed = false;
    if (this._phase === "armed") this._phase = "staging";
    this.log(this._phase, "device writes locked again");
  }
  /**
   * Second gate is `confirmed`. Unarmed commits are a pure preview; armed but unconfirmed
   * commits abort without touching the device.
   */
  async commit(options = {}) {
    if (this._phase === "committed" || this._phase === "rolled-back") {
      return {
        outcome: this._phase,
        phase: this._phase,
        framesSent: this._framesSent,
        readbackMatched: this._readbackMatched
      };
    }
    const frames = await this.preview();
    if (!this._armed) {
      this.log("staging", `DRY RUN: ${frames.length} frame(s) prepared, 0 sent`, frames.length);
      return { outcome: "dry-run", phase: this._phase, framesSent: 0, readbackMatched: null };
    }
    if (!options.confirmed) {
      return this.abort("explicit confirmation required before writing to the device");
    }
    if (this.opts.port.freshBaseline) {
      const fresh = await this.opts.port.freshBaseline();
      if (!fresh || !bytesEqual(fresh, this.baseline)) {
        return this.abort("baseline changed since the editor opened; refusing to overwrite concurrent edits");
      }
      this.log("armed", "fresh baseline matches the captured snapshot");
    }
    this._phase = "writing";
    for (const frame3 of frames) {
      await this.opts.port.send(frame3);
      this._framesSent++;
    }
    this.log("writing", `sent ${frames.length} frame(s)`, frames.length);
    this._phase = "verifying";
    const rb = await this.opts.port.readback();
    const verify = this.opts.verify ?? bytesEqual;
    const ok = rb !== null && verify(rb, this.staged);
    this._readbackMatched = ok;
    if (ok) {
      this._phase = "committed";
      this.log("committed", "full fresh readback matches the staged bytes", void 0, crc32Hex(rb));
      return { outcome: "committed", phase: this._phase, framesSent: this._framesSent, readbackMatched: true };
    }
    const why = rb === null ? "no readback response" : "readback does not match the staged bytes";
    return this.rollback(why);
  }
  /** Restore the exact captured baseline and require a second readback proving it. */
  async rollback(reason) {
    const frames = await this.opts.encode(this.baseline);
    for (const frame3 of frames) {
      await this.opts.port.send(frame3);
      this._framesSent++;
    }
    this.log("rolled-back", `restoring ${this.baseline.length} baseline bytes (${reason})`, frames.length);
    const rb = await this.opts.port.readback();
    const restored = rb !== null && bytesEqual(rb, this.baseline);
    this._readbackMatched = restored;
    this._phase = "rolled-back";
    this.log("rolled-back", `baseline restoration ${restored ? "VERIFIED" : "UNVERIFIED \u2014 keep the backup"}`);
    return {
      outcome: "rolled-back",
      phase: this._phase,
      reason,
      framesSent: this._framesSent,
      readbackMatched: restored
    };
  }
  abort(reason) {
    this._phase = "aborted";
    this.log("aborted", reason);
    return {
      outcome: "aborted",
      phase: this._phase,
      reason,
      framesSent: this._framesSent,
      readbackMatched: null
    };
  }
  audit() {
    const frameBytes = this._frames.reduce((n, f) => n + f.length, 0);
    const joined = new Uint8Array(frameBytes);
    let o = 0;
    for (const f of this._frames) {
      joined.set(f, o);
      o += f.length;
    }
    return {
      kind: this.kind,
      evidence: this.evidence,
      baselineBytes: this.baseline.length,
      baselineCrc32: crc32Hex(this.baseline),
      stagedBytes: this.staged.length,
      stagedCrc32: crc32Hex(this.staged),
      diff: this.diff(),
      dryRun: this.dryRun,
      frameCount: this._frames.length,
      frameBytes,
      frameCrc32: crc32Hex(joined),
      frameHexSample: this._frames.slice(0, MAX_HEX_SAMPLE).map(hex),
      entries: this.entries.slice()
    };
  }
  auditJson() {
    return JSON.stringify(this.audit(), null, 2);
  }
  log(phase, message, frames, crc) {
    this.entries.push({ atMs: this.opts.port.now(), phase, message, frames, crc32: crc });
  }
};

// src/write/evidence.ts
var WRITE_EVIDENCE = {
  midiConfigRead: {
    grade: "device-proven",
    claim: "Empty $0F requests the 292-byte MIDI config; $10 carries a zlib stream.",
    source: "kmorrill/op-z-sysex docs/midi-configuration-sysex.md, fw 1.2.45+"
  },
  midiConfigWrite: {
    grade: "device-proven",
    claim: "A compressed 292-byte $10 replaces the config; device reports it back, an explicit $0F gives an independent fresh read. Reversible one-byte CC proof with exact rollback.",
    source: "kmorrill/op-z-sysex docs/midi-configuration-sysex.md"
  },
  midiConfigReserved: {
    grade: "decoded",
    claim: "Bytes 289..291 are padding/reserved and must be preserved from the fresh baseline.",
    source: "OPZ.MidiConfig StructLayout(Pack=1) + official app importer"
  },
  patternLayout: {
    grade: "device-proven",
    claim: "16 x 21392-byte patterns; 54-byte step records; BANK_PARAM order for locks/sound.",
    source: "kmorrill/op-z-sysex docs/typed-pattern-editing.md, 336 typed mutations, exact readback"
  },
  patternUpload: {
    grade: "observed",
    claim: "This project uses $09 chunks + $0A final chunk with per-packet $0B acks; the reference calls out $0B flow control whose upload-side semantics we have not proven.",
    source: "OPB.Core/OpzSession.cs port + kmorrill/op-z-sysex typed-pattern-editing.md"
  },
  bankUploadFlowControl: {
    grade: "unknown",
    claim: "Upload-side $0B flow control is not implemented. Pattern writes therefore stay DRY-RUN by default and must be hardware-verified before arming.",
    source: "kmorrill/op-z-sysex docs/typed-pattern-editing.md"
  },
  fileTransport: {
    grade: "device-proven",
    claim: "$51/$34/$52/$35/$53/$33/$55 session, <=200 uncompressed bytes per zlib part, crc32(lowercase(path)) file IDs, syncjob.json manifest, fresh pull after push.",
    source: "kmorrill/op-z-sysex docs/clean-room-file-transport.md, fw 1.2.45+"
  },
  fileTransportSessionOrder: {
    grade: "device-proven",
    claim: "After the OP-Z replies with $34, send $52 with sync-active=0 BEFORE the first $35.",
    source: 'kmorrill/op-z-sysex clean-room-file-transport.md "Transport integration"'
  },
  liveSoundMirror: {
    grade: "observed",
    claim: "The pre-Stage-6 $0E <-> $0A sound mirror assumes an identity byte order. Kept for read-only rendering only; Stage 6 writes remap explicitly via model/bankParams.ts.",
    source: "This project, 31-frame Web MIDI capture"
  },
  hostWritePermission: {
    grade: "unknown",
    claim: "Whether a browser Web MIDI host may safely write MIDI config / bank / files on any given firmware is not proven here. All writes require explicit arming and confirmation.",
    source: "Stage 6 safety policy"
  }
};
function evidenceLabel(grade) {
  return grade.toUpperCase();
}

// src/write/midiConfigWrite.ts
var MIDI_CONFIG_REQUEST_ID = 15;
var MIDI_CONFIG_DATA_ID = 16;
var MIDI_CONFIG_RESERVED_OFFSET = 289;
var MIDI_CONFIG_REQUEST = build(MIDI_CONFIG_REQUEST_ID);
function requireTrack(track) {
  if (!Number.isInteger(track) || track < 0 || track > 15) throw new RangeError(`track must be 0..15 (got ${track})`);
}
function applyMidiConfigEdit(data, edit) {
  if (data.length !== MIDI_CONFIG_SIZE) throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes`);
  switch (edit.type) {
    case "track-enable":
      requireTrack(edit.track);
      data[edit.track] = edit.value ? 1 : 0;
      return;
    case "channel":
      requireTrack(edit.track);
      if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 15) {
        throw new RangeError(`channel must be 0..15 (got ${edit.value})`);
      }
      data[16 + edit.track] = edit.value;
      return;
    case "cc":
      requireTrack(edit.track);
      if (!Number.isInteger(edit.parameter) || edit.parameter < 0 || edit.parameter > 15) {
        throw new RangeError(`parameter must be 0..15 (got ${edit.parameter})`);
      }
      if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 127) {
        throw new RangeError(`CC must be 0..127 (got ${edit.value})`);
      }
      data[32 + edit.track * 16 + edit.parameter] = edit.value;
      return;
    case "flag":
      if (!Number.isInteger(edit.flag) || edit.flag < 0 || edit.flag > 7) {
        throw new RangeError(`flag must be 0..7 (got ${edit.flag})`);
      }
      data[288] = edit.value ? data[288] | 1 << edit.flag : data[288] & ~(1 << edit.flag);
      return;
  }
}
function describeMidiEdit(edit) {
  switch (edit.type) {
    case "track-enable":
      return `TRACK ${edit.track + 1} MIDI ${edit.value ? "ON" : "OFF"}`;
    case "channel":
      return `TRACK ${edit.track + 1} CHANNEL ${edit.value + 1}`;
    case "cc":
      return `TRACK ${edit.track + 1} PARAM ${edit.parameter + 1} -> CC ${edit.value}`;
    case "flag":
      return `FLAG ${edit.flag} ${edit.value ? "ON" : "OFF"}`;
  }
}
async function buildMidiConfigFrame(config) {
  if (config.length !== MIDI_CONFIG_SIZE) {
    throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes (got ${config.length})`);
  }
  return build(MIDI_CONFIG_DATA_ID, await deflateZlib(config));
}
async function parseMidiConfigFrame(data) {
  const frame3 = tryParse(data);
  if (!frame3 || frame3.messageId !== MIDI_CONFIG_DATA_ID) return null;
  try {
    const raw = await inflateZlib(frame3.payload, MIDI_CONFIG_SIZE);
    return raw.length === MIDI_CONFIG_SIZE ? raw : null;
  } catch {
    return null;
  }
}
function reservedBytesPreserved(baseline, staged) {
  for (let i = MIDI_CONFIG_RESERVED_OFFSET; i < MIDI_CONFIG_SIZE; i++) {
    if (baseline[i] !== staged[i]) return false;
  }
  return true;
}
async function encodeMidiConfig(payload) {
  return [await buildMidiConfigFrame(payload)];
}
var MidiConfigWriteSession = class {
  tx;
  edits = [];
  constructor(baseline, port) {
    if (baseline.length !== MIDI_CONFIG_SIZE) {
      throw new Error(`MIDI config must be ${MIDI_CONFIG_SIZE} bytes (got ${baseline.length})`);
    }
    this.tx = new WriteTransaction({
      kind: "midi-config",
      evidence: WRITE_EVIDENCE.midiConfigWrite.grade,
      baseline,
      encode: encodeMidiConfig,
      port,
      // The reference compares the COMPLETE 292-byte structure, not just the edited field.
      verify: (device, expected) => device.length === MIDI_CONFIG_SIZE && bytesEqual(device, expected)
    });
  }
  get editsView() {
    return this.edits;
  }
  get baselineView() {
    return new MidiConfig(this.tx.baselineBytes);
  }
  get current() {
    return new MidiConfig(this.tx.stagedBytes);
  }
  stage(edit) {
    applyMidiConfigEdit(this.tx.stagedBytes, edit);
    const d = this.tx.stage((draft) => applyMidiConfigEdit(draft, edit));
    this.edits.push(edit);
    return d;
  }
  stageMany(edits) {
    for (const e of edits) applyMidiConfigEdit(this.tx.stagedBytes, e);
    const d = this.tx.stage((draft) => {
      for (const e of edits) applyMidiConfigEdit(draft, e);
    });
    this.edits.push(...edits);
    return d;
  }
  /** Defensive invariant: an editor must never synthesize the three reserved bytes. */
  get reservedIntact() {
    return reservedBytesPreserved(this.tx.baselineBytes, this.tx.stagedBytes);
  }
  preview() {
    return this.tx.preview();
  }
  arm() {
    this.tx.arm();
  }
  disarm() {
    this.tx.disarm();
  }
  commit(confirmed = false) {
    return this.tx.commit({ confirmed });
  }
  rollback() {
    return this.tx.rollback("manual rollback");
  }
  auditJson() {
    return this.tx.auditJson();
  }
};

// src/write/webMidiPort.ts
function createWebMidiWritePort(transport, options) {
  const timeoutMs = options.timeoutMs ?? 4e3;
  const clock = options.now ?? (() => Date.now());
  const log = options.onLog ?? (() => void 0);
  const confirmReads = Math.max(1, Math.floor(options.confirmReads ?? 2));
  const previous = transport.onSysex;
  let disposed = false;
  let activeTap = null;
  function oneMidiConfigRead() {
    return new Promise((resolve) => {
      let done = false;
      let timer;
      let tapped;
      function finish(value) {
        if (done) return;
        done = true;
        if (timer !== void 0) clearTimeout(timer);
        if (transport.onSysex === tapped) transport.onSysex = previous;
        activeTap = null;
        resolve(value);
      }
      tapped = (data) => {
        previous?.(data);
        if (done) return;
        const frame3 = tryParse(data);
        if (!frame3 || frame3.messageId !== MIDI_CONFIG_DATA_ID || frame3.payload.length === 0) return;
        void parseMidiConfigFrame(data).then((raw) => {
          if (raw) finish(raw);
        }).catch(() => void 0);
      };
      transport.onSysex = tapped;
      activeTap = tapped;
      timer = setTimeout(() => {
        log(`fresh $0F readback timed out after ${timeoutMs} ms`);
        finish(null);
      }, timeoutMs);
      transport.sendSysex(MIDI_CONFIG_REQUEST);
    });
  }
  async function midiConfigRead() {
    let first = null;
    for (let i = 0; i < confirmReads; i++) {
      const raw = await oneMidiConfigRead();
      if (!raw) {
        log(`fresh $0F read ${i + 1}/${confirmReads} failed; readback refused`);
        return null;
      }
      if (first === null) first = raw;
      else if (!bytesEqual(first, raw)) {
        log(`fresh $0F reads disagree (read ${i + 1}/${confirmReads}); readback refused`);
        return null;
      }
    }
    log(`fresh $0F readback confirmed by ${confirmReads} identical independent read(s)`);
    return first;
  }
  const read = options.readCurrent ?? (options.kind === "midi-config" ? midiConfigRead : async () => null);
  return {
    send: async (frame3) => {
      if (disposed) throw new Error("write port is disposed");
      transport.sendSysex(frame3);
      if (options.kind === "pattern-bank") {
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
    },
    readback: read,
    freshBaseline: read,
    now: clock,
    dispose: () => {
      disposed = true;
      if (activeTap && transport.onSysex === activeTap) transport.onSysex = previous;
      activeTap = null;
      log("write port disposed");
    }
  };
}

// src/write/viewModel.ts
function projectWriteUi(options) {
  const audit = options.audit;
  const details = [];
  if (options.note) details.push(options.note);
  if (audit) {
    details.push(`BASELINE CRC ${audit.baselineCrc32} (${audit.baselineBytes} B)`);
    details.push(`STAGED CRC ${audit.stagedCrc32}`);
    details.push(`FRAME CRC ${audit.frameCrc32} \xB7 ${audit.frameCount} frame(s) / ${audit.frameBytes} B`);
    details.push(`EVIDENCE ${evidenceLabel(options.evidence)} \xB7 DRY RUN ${audit.dryRun ? "ON" : "OFF"}`);
    for (const entry of audit.entries.slice(-4)) {
      details.push(`[${entry.phase}] ${entry.message}`);
    }
  }
  for (const line of options.details ?? []) details.push(line);
  if (options.result) {
    const rb = options.result.readbackMatched === null ? "N/A" : options.result.readbackMatched ? "MATCH" : "MISMATCH";
    details.push(`RESULT ${options.result.outcome.toUpperCase()} \xB7 SENT ${options.result.framesSent} \xB7 READBACK ${rb}`);
    if (options.result.reason) details.push(`REASON ${options.result.reason}`);
  }
  return {
    kind: options.kind,
    evidence: evidenceLabel(options.evidence),
    phase: options.phase,
    dryRun: audit ? audit.dryRun : true,
    diffCount: options.diffCount ?? (audit ? audit.diff.count : 0),
    frameCount: options.frameCount ?? (audit ? audit.frameCount : 0),
    baselineBytes: options.baselineBytes ?? (audit ? audit.baselineBytes : 0),
    edits: options.edits.slice(0, 24),
    details: details.slice(0, 24)
  };
}

// src/write/patternWrite.ts
var PATTERN_BANK_REQUEST_ID = 8;
var PATTERN_CHUNK_ID = 9;
var PATTERN_FINAL_CHUNK_ID = 10;
var PATTERN_CHUNK_SIZE = 178;
var PATTERN_HEADER_SIZE = 6;
var PATTERN_BANK_REQUEST = build(PATTERN_BANK_REQUEST_ID);
function check(value, min, max, what) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be ${min}..${max} (got ${value})`);
  }
}
function applyPatternMutation(bank, m) {
  check(m.pattern, 0, PATTERN_COUNT - 1, "pattern");
  check(m.track, 0, 15, "track");
  switch (m.type) {
    case "notes":
      check(m.step, 0, 15, "step");
      bank.setNotes(m.pattern, m.track, m.step, m.notes);
      return;
    case "component":
      check(m.step, 0, 15, "step");
      check(m.component, 0, 15, "component");
      bank.setComponent(m.pattern, m.track, m.step, m.component, m.value);
      return;
    case "lock":
      check(m.step, 0, 15, "step");
      check(m.param, 0, 17, "lock param (BANK_PARAM)");
      if (m.value === null) bank.clearLock(m.pattern, m.track, m.step, m.param);
      else {
        check(m.value, 0, 255, "lock value");
        bank.setLock(m.pattern, m.track, m.step, m.param, m.value);
      }
      return;
    case "sound": {
      check(m.param, 0, 17, "sound param");
      check(m.value, 0, 255, "sound value");
      const p = m.space === "live" ? liveToBankParam(m.param) : m.param;
      bank.setSound(m.pattern, m.track, p, m.value);
      return;
    }
    case "step-count":
      bank.setStepCount(m.pattern, m.track, m.count);
      return;
    case "step-length":
      bank.setStepLength(m.pattern, m.track, m.length);
      return;
    case "quantize":
      bank.setQuantize(m.pattern, m.track, m.value);
      return;
    case "note-length":
      bank.setNoteLength(m.pattern, m.track, m.value);
      return;
    case "routing":
      bank.setRouted(m.pattern, m.master, m.track, m.on);
      return;
  }
}
function describePatternMutation(m) {
  const where = `P${m.pattern + 1}/T${m.track + 1}`;
  switch (m.type) {
    case "notes":
      return `${where} STEP ${m.step + 1}: ${m.notes.length} note(s)`;
    case "component":
      return `${where} STEP ${m.step + 1} COMP ${m.component}: ${m.value ?? "OFF"}`;
    case "lock":
      return `${where} STEP ${m.step + 1} LOCK ${m.param}: ${m.value ?? "CLEAR"}`;
    case "sound":
      return `${where} SOUND ${m.param}: ${m.value}`;
    case "step-count":
      return `${where} STEP COUNT ${m.count}`;
    case "step-length":
      return `${where} STEP LENGTH ${m.length}`;
    case "quantize":
      return `${where} QUANTIZE ${m.value}`;
    case "note-length":
      return `${where} NOTE LENGTH ${m.value}`;
    case "routing":
      return `${where} ${m.master ? "MASTER" : "TAPE"} ROUTING ${m.on ? "ON" : "OFF"}`;
  }
}
async function encodePatternBankFrames(bank, target) {
  if (bank.length !== PATTERN_BANK_SIZE) {
    throw new Error(`pattern bank must be ${PATTERN_BANK_SIZE} bytes (got ${bank.length})`);
  }
  const compressed = await deflateZlib(bank);
  const count = Math.max(1, Math.ceil(compressed.length / PATTERN_CHUNK_SIZE));
  const address = target.address & 240;
  const frames = [];
  for (let index = 0; index < count; index++) {
    const chunk = compressed.subarray(
      index * PATTERN_CHUNK_SIZE,
      Math.min(compressed.length, (index + 1) * PATTERN_CHUNK_SIZE)
    );
    const payload = new Uint8Array(PATTERN_HEADER_SIZE + chunk.length);
    payload[0] = address;
    payload[2] = target.transferId & 255;
    payload[3] = target.transferId >> 8 & 255;
    payload[4] = index & 255;
    payload[5] = index >> 8 & 255;
    payload.set(chunk, PATTERN_HEADER_SIZE);
    const last = index === count - 1;
    frames.push(build(last ? PATTERN_FINAL_CHUNK_ID : PATTERN_CHUNK_ID, payload));
  }
  return frames;
}
var PatternWriteSession = class {
  tx;
  mutations = [];
  target;
  constructor(baseline, port, target) {
    this.target = target;
    this.tx = new WriteTransaction({
      kind: "pattern-bank",
      evidence: WRITE_EVIDENCE.patternUpload.grade,
      baseline,
      encode: (payload) => encodePatternBankFrames(payload, target),
      port,
      verify: (device, expected) => device.length === PATTERN_BANK_SIZE && bytesEqual(device, expected)
    });
  }
  get mutationsView() {
    return this.mutations;
  }
  stage(mutation) {
    applyPatternMutation(new PatternBank(this.tx.stagedBytes), mutation);
    const d = this.tx.stage((draft) => applyPatternMutation(new PatternBank(draft), mutation));
    this.mutations.push(mutation);
    return d;
  }
  stageMany(mutations) {
    for (const m of mutations) applyPatternMutation(new PatternBank(this.tx.stagedBytes), m);
    const d = this.tx.stage((draft) => {
      const bank = new PatternBank(draft);
      for (const m of mutations) applyPatternMutation(bank, m);
    });
    this.mutations.push(...mutations);
    return d;
  }
  preview() {
    return this.tx.preview();
  }
  arm() {
    this.tx.arm();
  }
  disarm() {
    this.tx.disarm();
  }
  commit(confirmed = false) {
    return this.tx.commit({ confirmed });
  }
  rollback() {
    return this.tx.rollback("manual rollback");
  }
  auditJson() {
    return this.tx.auditJson();
  }
};

// src/write/fileService.ts
var MAX_PART_BYTES = 200;
var SLOT_MAP_PATH = "settings/slotConfiguration.json";
var PLUGS_PATH = "settings/plugs.json";
async function makeFileParts(fileId, content) {
  const count = Math.max(1, Math.ceil(content.length / MAX_PART_BYTES));
  const parts = [];
  for (let i = 0; i < count; i++) {
    const data = content.subarray(i * MAX_PART_BYTES, Math.min(content.length, (i + 1) * MAX_PART_BYTES));
    parts.push({
      fileId,
      index: i,
      last: i === count - 1,
      data: data.slice(),
      compressed: await deflateZlib(data)
    });
  }
  return parts;
}
function buildSyncJob(targets) {
  return {
    files: targets.map((t) => ({
      fileId: fileIdForPath(t.path),
      path: t.path,
      crc: crc32(t.content),
      size: t.content.length
    }))
  };
}
function syncJobBytes(job) {
  return new TextEncoder().encode(JSON.stringify(job));
}
async function buildFileServicePlan(options) {
  const job = buildSyncJob([{ path: options.targetPath, content: options.targetContent }]);
  const jobBytes = syncJobBytes(job);
  const jobParts = await makeFileParts(SYNC_JOB_FILE_ID, jobBytes);
  const targetParts = await makeFileParts(fileIdForPath(options.targetPath), options.targetContent);
  const slotCrc = crc32Hex(options.slotMap);
  const targetCrc = crc32Hex(options.targetContent);
  return {
    evidence: WRITE_EVIDENCE.fileTransport.grade,
    targetPath: options.targetPath,
    targetFileId: fileIdForPath(options.targetPath),
    slotMapCrc: slotCrc,
    targetCrc,
    job,
    jobFileId: SYNC_JOB_FILE_ID,
    jobParts: jobParts.length,
    targetParts: targetParts.length,
    steps: [
      { order: 1, kind: "backup", detail: `fresh pull of ${SLOT_MAP_PATH}; journal CRC ${slotCrc}`, crc: slotCrc },
      { order: 2, kind: "backup", detail: `fresh pull of ${PLUGS_PATH}; journal CRC` },
      {
        order: 3,
        kind: "write",
        detail: "upload syncjob.json manifest, then every target part",
        parts: jobParts.length + targetParts.length
      },
      {
        order: 4,
        kind: "readback",
        detail: `reconnect and fresh pull ${options.targetPath}; require CRC ${targetCrc}`,
        crc: targetCrc
      },
      { order: 5, kind: "verify", detail: "second independent pull of the slot map; require the requested assignment" },
      { order: 6, kind: "rollback", detail: `on ANY mismatch restore the original slot map (CRC ${slotCrc}) and require another clean readback`, crc: slotCrc }
    ]
  };
}

// src/app/writeController.ts
var WRITE_EDITORS = [
  "midi-config",
  "pattern-bank",
  "file-service"
];
var WRITE_EDITOR_LABEL = {
  "midi-config": "MIDI CONFIG",
  "pattern-bank": "PATTERN BANK",
  "file-service": "FILE SERVICE"
};
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function nullPort(now) {
  return {
    send: () => {
      throw new Error("OFFLINE: device writes are disabled");
    },
    readback: async () => null,
    freshBaseline: async () => null,
    now,
    dispose: () => void 0
  };
}
var WriteController = class {
  editor = "midi-config";
  opened = false;
  baseline = null;
  tx = null;
  port = null;
  plan = null;
  edits = [];
  extraDetails = [];
  result = null;
  phase = "staging";
  busy = false;
  lastUi = null;
  deps;
  // Written out instead of a TS parameter property: Node's strip-only mode does not support
  // parameter properties, and the whole src/ tree is imported directly by the test runner.
  constructor(deps) {
    this.deps = deps;
  }
  get isOpen() {
    return this.opened;
  }
  get currentEditor() {
    return this.editor;
  }
  get baselineOrigin() {
    return this.baseline?.origin ?? null;
  }
  get ui() {
    return this.lastUi;
  }
  /** ARM needs a real transport AND a device-proven baseline AND a real transaction. */
  get canArm() {
    return this.opened && this.deps.isLive() && this.baseline?.origin === "device" && this.editor !== "file-service" && this.tx !== null && !this.busy;
  }
  get canCommit() {
    return this.canArm && this.tx !== null && this.tx.tx.armed && this.phase !== "committed" && this.phase !== "rolled-back";
  }
  get canRollback() {
    return this.opened && this.deps.isLive() && this.baseline?.origin === "device" && this.editor !== "file-service" && this.tx !== null && !this.busy;
  }
  /** Publish the initial OFF state so the shell can disable every write button at boot. */
  sync() {
    this.publish();
  }
  // ---- lifecycle ----
  async setOpen(on) {
    if (on === this.opened) {
      if (on) this.deps.onNavigate(this.editor);
      return;
    }
    if (!on) {
      this.teardown();
      this.opened = false;
      this.baseline = null;
      this.edits = [];
      this.extraDetails = [];
      this.result = null;
      this.phase = "staging";
      this.publish();
      this.deps.onLog("WRITE EDITOR OFF \xB7 all 16 screens back to read-only");
      return;
    }
    this.opened = true;
    await this.rebuild();
    this.deps.onNavigate(this.editor);
  }
  async selectEditor(kind) {
    if (!WRITE_EDITORS.includes(kind)) return;
    this.editor = kind;
    if (!this.opened) {
      this.deps.onLog(`WRITE EDITOR \xB7 ${WRITE_EDITOR_LABEL[kind]} (open the editor to inspect)`);
      this.publish();
      return;
    }
    await this.rebuild();
    this.deps.onNavigate(kind);
  }
  /** Re-read a fresh baseline, discard every staged edit and build a new DRY-RUN session. */
  async refresh() {
    if (!this.opened) return;
    await this.rebuild();
    this.deps.onLog(`WRITE EDITOR \xB7 fresh baseline re-read (${this.baseline?.origin})`);
  }
  teardown() {
    try {
      this.port?.dispose();
    } catch {
    }
    this.port = null;
    this.tx = null;
    this.plan = null;
  }
  async rebuild() {
    this.teardown();
    this.edits = [];
    this.result = null;
    this.phase = "staging";
    this.extraDetails = [];
    const baseline = await this.deps.readBaseline(this.editor);
    this.baseline = baseline;
    const synthetic = baseline.origin === "synthetic";
    const protocol = this.editor === "file-service" ? WRITE_EVIDENCE.fileTransport.grade : this.editor === "midi-config" ? WRITE_EVIDENCE.midiConfigWrite.grade : WRITE_EVIDENCE.patternUpload.grade;
    this.extraDetails.push(`PROTOCOL ${evidenceLabel(protocol)} \xB7 BASELINE ${baseline.origin.toUpperCase()} \xB7 ${baseline.label}`);
    if (this.editor === "file-service") {
      const input = this.deps.filePlanInput();
      this.plan = await buildFileServicePlan(input);
      this.extraDetails.push(
        `TARGET ${this.plan.targetPath} \xB7 fileId ${this.plan.targetFileId} \xB7 CRC ${this.plan.targetCrc}`,
        `MANIFEST syncjob.json \xB7 fileId ${this.plan.jobFileId} \xB7 ${this.plan.jobParts} part(s)`,
        `TARGET PARTS ${this.plan.targetParts} \xB7 <=200 UNCOMPRESSED BYTES PER $53`
      );
      for (const step of this.plan.steps) {
        this.extraDetails.push(`${step.order}. ${step.kind.toUpperCase()} \xB7 ${step.detail}`);
      }
      this.extraDetails.push("NO LIVE PUSH \xB7 host write permission is UNKNOWN in this project");
    } else {
      this.port = this.deps.isLive() ? this.deps.createPort(this.editor) : nullPort(this.deps.now);
      if (this.editor === "midi-config") {
        this.tx = new MidiConfigWriteSession(baseline.bytes, this.port);
      } else {
        this.tx = new PatternWriteSession(baseline.bytes, this.port, this.deps.bankTarget());
      }
      await this.tx.preview();
      this.extraDetails.push(
        `BACKUP READY \xB7 ${baseline.bytes.length} B \xB7 CRC ${crc32Hex(baseline.bytes)}`,
        synthetic ? "SYNTHETIC DATA \u2014 this capture contains no $10 config and no $0A final bank packet" : "FRESH BASELINE GUARD AT COMMIT \xB7 FULL READBACK \xB7 EXACT ROLLBACK"
      );
    }
    this.publish();
    this.deps.onLog(
      `WRITE EDITOR \xB7 ${WRITE_EDITOR_LABEL[this.editor]} \xB7 baseline ${baseline.bytes.length} B (${baseline.origin}) \xB7 DRY RUN \xB7 0 frames sent`
    );
  }
  // ---- edit staging ----
  /**
   * Stage one small, proven-safe typed edit so the diff / frame preview is visible without a
   * full production editor:
   *   MIDI CONFIG   -> TRACK 6 PARAM 9 CC (one byte at 32 + 5*16 + 8)
   *   PATTERN BANK  -> P1/T6 step-1 filter parameter lock (device-proven 11578 / 11596)
   * The value comes from the toolbar's VALUE input.
   */
  async stageSample(rawValue) {
    if (!this.opened || this.busy) return;
    if (this.editor === "file-service") {
      this.deps.onLog("FILE SERVICE is PLAN-ONLY \u2014 no bytes are staged or sent");
      return;
    }
    const tx = this.tx;
    if (!tx) return;
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value)) {
      this.deps.onLog("STAGE refused \xB7 VALUE must be an integer");
      return;
    }
    try {
      let description;
      let changed;
      if (this.editor === "midi-config") {
        const edit = { type: "cc", track: 5, parameter: 8, value: clamp(value, 0, 127) };
        changed = tx.stage(edit).count;
        description = describeMidiEdit(edit);
      } else {
        const mutation = {
          type: "lock",
          pattern: 0,
          track: 5,
          step: 0,
          param: BANK_PARAM.Filter,
          value: clamp(value, 0, 255)
        };
        changed = tx.stage(mutation).count;
        description = describePatternMutation(mutation);
      }
      this.edits.push(description);
      this.result = null;
      this.phase = tx.tx.phase;
      await tx.preview();
      this.publish();
      this.deps.onLog(`STAGED ${description} \xB7 ${changed} byte(s) changed \xB7 0 frames sent`);
    } catch (err) {
      this.deps.onLog(`STAGE refused \xB7 ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async reset() {
    if (!this.tx || this.busy) return;
    this.tx.tx.reset();
    this.edits = [];
    this.result = null;
    this.phase = this.tx.tx.phase;
    await this.tx.preview();
    this.publish();
    this.deps.onLog("STAGED EDITS DISCARDED \xB7 write-copy restored to the exact baseline");
  }
  // ---- safety gates ----
  arm() {
    if (!this.canArm || !this.tx) {
      this.deps.onLog(this.armRefusal());
      return;
    }
    this.tx.arm();
    this.phase = this.tx.tx.phase;
    this.publish();
    this.deps.onLog("ARMED \xB7 real sends unlocked, but COMMIT still requires explicit confirmation");
  }
  disarm() {
    if (!this.tx) return;
    this.tx.disarm();
    this.phase = this.tx.tx.phase;
    this.publish();
    this.deps.onLog("DISARMED \xB7 DRY RUN restored, no frames can be sent");
  }
  async commit() {
    if (!this.canCommit || !this.tx) {
      this.deps.onLog("COMMIT refused \xB7 open a live editor, capture a device baseline, stage an edit, ARM, then confirm");
      return;
    }
    this.busy = true;
    this.phase = "writing";
    this.publish();
    try {
      this.result = await this.tx.commit(true);
      this.phase = this.result.phase;
      this.publish();
      const rb = this.result.readbackMatched === null ? "N/A" : this.result.readbackMatched ? "MATCH" : "MISMATCH";
      this.deps.onLog(
        `COMMIT ${this.result.outcome.toUpperCase()} \xB7 ${this.result.framesSent} frame(s) sent \xB7 readback ${rb}` + (this.result.reason ? ` \xB7 ${this.result.reason}` : "")
      );
    } catch (err) {
      this.phase = "aborted";
      this.deps.onLog(`COMMIT ERROR \xB7 ${err instanceof Error ? err.message : String(err)}`);
      this.publish();
    } finally {
      this.busy = false;
      this.publish();
    }
  }
  async rollback() {
    if (!this.canRollback || !this.tx) {
      this.deps.onLog("ROLLBACK refused \xB7 requires a live editor with a device baseline");
      return;
    }
    this.busy = true;
    try {
      this.result = await this.tx.rollback();
      this.phase = this.result.phase;
      this.publish();
      this.deps.onLog(
        `ROLLBACK ${this.result.readbackMatched ? "VERIFIED" : "UNVERIFIED \u2014 KEEP THE BACKUP"} \xB7 exact ${this.baseline?.bytes.length ?? 0} B restored`
      );
    } finally {
      this.busy = false;
      this.publish();
    }
  }
  // ---- exports ----
  /** Exact baseline bytes + CRC: the backup the user must keep before arming. */
  backupJson() {
    if (!this.baseline) return "";
    return JSON.stringify({
      kind: WRITE_EDITOR_LABEL[this.editor],
      origin: this.baseline.origin,
      provenance: this.baseline.label,
      bytes: this.baseline.bytes.length,
      crc32: crc32Hex(this.baseline.bytes),
      atMs: this.deps.now(),
      hex: hex(this.baseline.bytes)
    }, null, 2) + "\n";
  }
  /** Structured audit trail (diff, CRCs, frames, phase history, result) or the plan JSON. */
  auditJson() {
    const body = this.tx ? { ...this.tx.tx.audit(), stagedEdits: this.edits, commitResult: this.result } : this.plan ?? {};
    return JSON.stringify(body, null, 2) + "\n";
  }
  dispose() {
    this.teardown();
    this.opened = false;
    this.publish();
  }
  // ---- projection ----
  armRefusal() {
    if (!this.deps.isLive()) return "ARM refused \xB7 OFFLINE: no Web MIDI transport; connect a device first";
    if (this.editor === "file-service") return "ARM refused \xB7 FILE SERVICE is PLAN-ONLY (no live push)";
    if (this.baseline?.origin !== "device") return "ARM refused \xB7 SYNTHETIC baseline; only a fresh device snapshot may be written";
    return "ARM refused \xB7 editor is not ready";
  }
  note() {
    if (this.editor === "file-service") {
      return "PLAN ONLY \u2014 NO LIVE PUSH \xB7 HOST WRITE PERMISSION UNKNOWN";
    }
    if (this.baseline?.origin === "synthetic") {
      return "SYNTHETIC BASELINE \u2014 NOT FROM A DEVICE \xB7 ARM / COMMIT DISABLED";
    }
    return "FRESH DEVICE BASELINE \xB7 BACKUP FIRST \xB7 EXACT ROLLBACK ON MISMATCH";
  }
  evidence() {
    if (this.baseline?.origin === "synthetic") return "unknown";
    if (this.editor === "file-service") return WRITE_EVIDENCE.fileTransport.grade;
    return this.editor === "midi-config" ? WRITE_EVIDENCE.midiConfigWrite.grade : WRITE_EVIDENCE.patternUpload.grade;
  }
  buildUi() {
    if (this.editor === "file-service") {
      const plan = this.plan;
      return projectWriteUi({
        kind: WRITE_EDITOR_LABEL[this.editor],
        evidence: this.evidence(),
        phase: "staging",
        audit: null,
        edits: plan ? plan.steps.map((s) => `${s.order}. ${s.kind.toUpperCase()} \xB7 ${s.detail}`) : [],
        details: this.extraDetails,
        note: this.note(),
        diffCount: 0,
        frameCount: plan ? plan.jobParts + plan.targetParts : 0,
        baselineBytes: this.baseline?.bytes.length ?? 0
      });
    }
    return projectWriteUi({
      kind: WRITE_EDITOR_LABEL[this.editor],
      evidence: this.evidence(),
      phase: this.phase,
      audit: this.tx ? this.tx.tx.audit() : null,
      edits: this.edits,
      details: this.extraDetails,
      result: this.result,
      note: this.note()
    });
  }
  status() {
    let message;
    if (!this.opened) message = "editor OFF \xB7 read-only";
    else if (this.busy) message = "transaction in progress";
    else if (this.editor === "file-service") message = "PLAN-ONLY \xB7 no device writes";
    else if (this.baseline?.origin === "synthetic") message = "SYNTHETIC baseline \xB7 ARM disabled";
    else if (this.result) message = `${this.result.outcome.toUpperCase()} \xB7 ${this.result.framesSent} frame(s)`;
    else if (this.tx?.tx.armed) message = "ARMED \xB7 confirm COMMIT to send";
    else message = "DRY RUN \xB7 stage an edit to preview the diff";
    return {
      open: this.opened,
      editor: this.editor,
      live: this.deps.isLive(),
      baselineOrigin: this.baselineOrigin,
      canArm: this.canArm,
      canCommit: this.canCommit,
      canRollback: this.canRollback,
      dryRun: this.tx ? this.tx.tx.dryRun : true,
      message
    };
  }
  publish() {
    const ui = this.opened ? this.buildUi() : null;
    this.lastUi = ui;
    this.deps.onChange(ui, this.status());
  }
};

// src/app/main.ts
var canvas = document.getElementById("screen");
var sourceEl = document.getElementById("source");
var statusEl = document.getElementById("status");
var playBtn = document.getElementById("play");
var autoBtn = document.getElementById("auto");
var liveConnectBtn = document.getElementById("live-connect");
var screenBtns = Array.from(document.querySelectorAll("[data-screen]"));
var captureUrl = "./captures/demo.txt";
var tlPlayBtn = document.getElementById("tl-play");
var tlLoopBtn = document.getElementById("tl-loop");
var tlRecBtn = document.getElementById("tl-rec");
var tlLiveBtn = document.getElementById("tl-live");
var tlSeek = document.getElementById("tl-seek");
var tlSpeed = document.getElementById("tl-speed");
var tlInfo = document.getElementById("tl-info");
var tlFile = document.getElementById("tl-file");
var wrToggle = document.getElementById("wr-toggle");
var wrEditor = document.getElementById("wr-editor");
var wrMode = document.getElementById("wr-mode");
var wrEvidence = document.getElementById("wr-evidence");
var wrValue = document.getElementById("wr-value");
var wrStage = document.getElementById("wr-stage");
var wrReset = document.getElementById("wr-reset");
var wrRefresh = document.getElementById("wr-refresh");
var wrArm = document.getElementById("wr-arm");
var wrCommit = document.getElementById("wr-commit");
var wrRollback = document.getElementById("wr-rollback");
var wrBackup = document.getElementById("wr-backup");
var wrAudit = document.getElementById("wr-audit");
var wrInfo = document.getElementById("wr-info");
var bleBtn = document.getElementById("ble-connect");
var bleStatus = document.getElementById("ble-status");
var padStatus = document.getElementById("pad-status");
if (!canvas) throw new Error("#screen canvas not found");
var session = new OpzSession();
var view = null;
var liveSession = null;
var liveConnecting = false;
var capture = null;
var player = null;
var writeUi = null;
var lastWriteStatus = null;
var lastWriteEditor = null;
var recorder = new Recorder();
var usbSession = null;
var bleTransport = null;
var bleBusy = false;
var gamepadTick = null;
var batteryLabel = document.getElementById("device-battery");
var transportLabel = document.getElementById("device-transport");
var immersiveToggle = document.getElementById("immersive-toggle");
var deviceMenu = document.getElementById("device-menu");
var deviceMenuToggle = document.getElementById("device-menu-toggle");
var immersive = false;
var squareHeld = false;
var menuOpen = false;
function updateDeviceBar() {
  const connected = liveSession === session && session.isConnected;
  const battery = connected ? session.messageCounts.has(4) ? `\u25A3 ${session.level.battery}%` : "\u25A3 \u2014%" : "OP-Z NOT CONNECTED";
  const transport = `${view?.isPlaying() ? "\u25B6" : "\u25A0"} ${session.activePattern + 1}`;
  if (batteryLabel && batteryLabel.textContent !== battery) batteryLabel.textContent = battery;
  if (transportLabel && transportLabel.textContent !== transport) transportLabel.textContent = transport;
  const held = connected && Boolean(view?.autoRoute) && session.ui.screen;
  if (held !== squareHeld) {
    squareHeld = held;
    setDeviceMenu(held);
  }
}
function setDeviceMenu(open) {
  menuOpen = open;
  if (deviceMenu) deviceMenu.hidden = !open;
  deviceMenuToggle?.setAttribute("aria-expanded", String(open));
}
function setImmersive(on) {
  immersive = on;
  document.body.classList.toggle("immersive", on);
  view?.resize();
  if (immersiveToggle) immersiveToggle.textContent = on ? "SHOW DEBUG" : "FULL SCREEN";
  immersiveToggle?.setAttribute("aria-pressed", String(on));
  if (on) view?.setAutoRoute(true);
}
immersiveToggle?.addEventListener("click", () => {
  setImmersive(!immersive);
  if (immersive) void document.documentElement.requestFullscreen?.().catch(() => {
  });
  else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {
  });
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && immersive) setImmersive(false);
});
deviceMenuToggle?.addEventListener("click", () => setDeviceMenu(!menuOpen));
for (const button6 of document.querySelectorAll("[data-device-page]")) {
  button6.addEventListener("click", () => {
    const page = button6.dataset.devicePage;
    if (page === "follow") view?.setAutoRoute(true);
    else if (page && SCREEN_ORDER.includes(page)) view?.navigateTo(page);
    setDeviceMenu(false);
  });
}
function attach(next) {
  const auto = view?.autoRoute ?? false;
  view?.stop();
  session = next;
  view = new CanvasView(canvas, session);
  view.writeState = writeUi;
  view.onScreenChange = updateScreenButtons;
  view.onPlayingChange = updatePlayLabel;
  view.onAutoRouteChange = updateAutoButton;
  view.onTick = () => {
    player?.tick();
    gamepadTick?.();
    updateDeviceBar();
  };
  view.setAutoRoute(auto);
  view.start();
  updateScreenButtons(view.currentScreen);
  updatePlayLabel(view.isPlaying());
  updateAutoButton(view.autoRoute);
}
function updateScreenButtons(name) {
  for (const b of screenBtns) b.classList.toggle("active", b.dataset.screen === name);
}
function updatePlayLabel(playing) {
  if (playBtn) playBtn.textContent = playing ? "\u25A0 Stop" : "\u25B6 Play";
  if (statusEl) statusEl.textContent = playing ? "playing" : "stopped";
}
function updateAutoButton(on) {
  if (autoBtn) autoBtn.classList.toggle("active", on);
}
function setSource(text) {
  if (sourceEl) sourceEl.textContent = text;
}
function updateTimelineUi(state) {
  if (!tlInfo) return;
  if (!state || !capture) {
    tlInfo.textContent = capture ? `${capture.frames.length} frames` : "no capture";
    return;
  }
  if (tlSeek) {
    tlSeek.max = String(state.frameCount);
    tlSeek.value = String(state.cursor);
  }
  if (tlPlayBtn) {
    tlPlayBtn.textContent = state.playing ? "\u275A\u275A \u6682\u505C" : "\u25B6 \u56DE\u653E";
    tlPlayBtn.classList.toggle("active", state.playing);
  }
  tlLoopBtn?.classList.toggle("active", state.loop);
  const index = state.frameCount ? Math.min(state.cursor, state.frameCount) - 1 : -1;
  const label2 = index >= 0 && capture.frames[index] ? frameIdLabel(capture.frames[index].data) : "--";
  tlInfo.textContent = `${state.cursor}/${state.frameCount} \xB7 ${Math.round(state.positionMs)}/${Math.round(state.durationMs)} ms \xB7 ${label2}`;
}
function updateRecUi() {
  if (!tlRecBtn) return;
  tlRecBtn.classList.toggle("active", recorder.recording);
  tlRecBtn.textContent = recorder.recording ? "\u25A0 \u505C\u6B62" : "\u25CF \u5F55\u5236";
}
function updateLiveButton() {
  if (tlLiveBtn) tlLiveBtn.disabled = liveSession == null;
  updateLiveConnectButton();
}
async function midiPermissionState() {
  try {
    const perms = navigator.permissions;
    if (typeof perms?.query !== "function") return "unknown";
    const result = await perms.query({ name: "midi", sysex: true });
    const state = result?.state;
    return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
  } catch {
    return "unknown";
  }
}
function updateLiveConnectButton() {
  if (!liveConnectBtn) return;
  const connected = liveSession !== null;
  liveConnectBtn.disabled = liveConnecting || connected;
  liveConnectBtn.textContent = liveConnecting ? "CONNECTING\u2026" : connected ? "USB LIVE" : "CONNECT OP-Z";
  liveConnectBtn.classList.toggle("active", connected);
}
async function connectLive() {
  if (liveSession || liveConnecting) return;
  liveConnecting = true;
  updateLiveConnectButton();
  setSource("CONNECTING \xB7 \u8BF7\u5728\u6D4F\u89C8\u5668\u5F39\u7A97\u91CC\u5141\u8BB8 MIDI / SysEx\u2026");
  try {
    const deckBridge = new URLSearchParams(location.search).get("deck-midi") === "1";
    const transport = await (deckBridge ? openDeckMidi() : openWebMidi());
    player?.pause();
    const live = new OpzSession({ transport });
    const upstream = transport.onSysex;
    transport.onSysex = (data) => {
      recorder.record(data);
      upstream?.(data);
    };
    liveSession = live;
    usbSession = live;
    if (deckBridge) transport.onStateChange = () => {
      live.dispose();
      if (usbSession === live) usbSession = null;
      if (liveSession !== live) return;
      liveSession = null;
      updateLiveConnectButton();
      setSource("OFFLINE \xB7 Deck MIDI bridge disconnected \xB7 click CONNECT OP-Z to retry");
    };
    attach(live);
    view?.setAutoRoute(true);
    updateLiveButton();
    setSource(`LIVE \xB7 ${transport.inputName} \u2192 ${transport.outputName}`);
    live.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSource(`OFFLINE \xB7 ${msg}${capture ? ` \xB7 ${capture.frames.length} \u5E27\u65F6\u95F4\u8F74\u4ECD\u53EF\u56DE\u653E` : ""}`);
    if (liveConnectBtn) {
      liveConnectBtn.title = "\u6743\u9650\u88AB\u62D2\uFF1A\u5730\u5740\u680F\u9501\u5F62\u56FE\u6807 \u2192 \u7F51\u7AD9\u8BBE\u7F6E \u2192 MIDI \u8BBE\u5907 \u2192 \u5141\u8BB8\uFF0C\u7136\u540E\u5237\u65B0\u9875\u9762\u518D\u70B9 CONNECT OP-Z";
    }
  } finally {
    liveConnecting = false;
    updateLiveConnectButton();
  }
}
if (playBtn) playBtn.addEventListener("click", () => view?.togglePlay());
function toggleAutoRoute() {
  if (view) view.setAutoRoute(!view.autoRoute);
}
if (autoBtn) autoBtn.addEventListener("click", toggleAutoRoute);
liveConnectBtn?.addEventListener("click", () => {
  void connectLive();
});
for (const b of screenBtns) {
  b.addEventListener("click", () => {
    const name = b.dataset.screen;
    view?.navigateTo(name);
  });
}
async function installTimeline(cap, upTo) {
  capture = cap;
  player = new TimelinePlayer({
    frames: cap.frames,
    inject: (data) => session.injectSysex(data),
    rebuild: async (n) => {
      const rebuilt = new OpzSession();
      for (let i = 0; i < n; i++) await rebuilt.injectSysex(cap.frames[i].data);
      attach(rebuilt);
    },
    onUpdate: updateTimelineUi,
    onEnd: () => setSource(`TIMELINE \xB7 \u56DE\u653E\u7ED3\u675F (${cap.frames.length} \u5E27 \xB7 ${cap.source})`)
  });
  await player.seek(Math.min(upTo, cap.frames.length));
  updateTimelineUi(player.state);
}
async function loadCaptureText(text, source) {
  const cap = loadTimelineText(text, source);
  if (!cap.frames.length) {
    setSource(`OFFLINE \xB7 \u6355\u83B7\u6587\u4EF6\u65E0\u6709\u6548\u5E27 (${source})`);
    return;
  }
  await installTimeline(cap, cap.frames.length);
  setSource(`OFFLINE \xB7 ${cap.frames.length} \u5E27\u65F6\u95F4\u8F74 (${source}) \xB7 \u70B9 \u25B6 \u56DE\u653E`);
}
async function toggleReplay() {
  if (!player || !capture || !capture.frames.length) return;
  if (player.playing) {
    player.pause();
    return;
  }
  if (player.cursor >= capture.frames.length) await player.seek(0);
  player.play();
  setSource(`TIMELINE \xB7 \u56DE\u653E\u4E2D ${capture.source}`);
}
async function stepFrame(delta) {
  if (!player) return;
  await player.step(delta);
  setSource(`TIMELINE \xB7 \u5355\u6B65 ${player.cursor}/${capture?.frames.length ?? 0}`);
}
function toggleRecording() {
  if (recorder.recording) {
    const frames = recorder.stop();
    updateRecUi();
    if (!frames.length) {
      setSource("REC \xB7 \u6CA1\u6709\u5F55\u5230 SysEx \u5E27\uFF08\u9700 LIVE \u8FDE\u63A5\uFF09");
      return;
    }
    const cap = { frames, source: `REC ${frames.length} frames` };
    void installTimeline(cap, frames.length).then(() => {
      setSource(`REC \xB7 ${frames.length} \u5E27 / ${frames[frames.length - 1].tMs} ms \u2014 \u53EF\u56DE\u653E\u6216\u5BFC\u51FA`);
    });
  } else {
    recorder.start();
    updateRecUi();
    setSource("REC \xB7 \u6B63\u5728\u5F55\u5236\u5B9E\u65F6 SysEx \u5E27\u2026");
  }
}
function returnToLive() {
  player?.pause();
  if (!liveSession) return;
  attach(liveSession);
  setSource(`LIVE \xB7 ${liveSession.portName ?? "OP-Z"}`);
}
function stamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
function download(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  } catch (err) {
    setSource(`EXPORT unavailable here \xB7 ${err instanceof Error ? err.message : String(err)}`);
  }
}
function exportText() {
  if (!capture) return;
  download(`opb-frames-${stamp()}.txt`, toReplayText(capture), "text/plain;charset=utf-8");
  setSource(`EXPORT \xB7 ${capture.frames.length} \u5E27 \u2192 --replay \u517C\u5BB9\u6587\u672C`);
}
function exportJson() {
  if (!capture) return;
  download(
    `opb-timeline-${stamp()}.json`,
    JSON.stringify(toTimelineJson(capture), null, 2) + "\n",
    "application/json;charset=utf-8"
  );
  setSource(`EXPORT \xB7 ${capture.frames.length} \u5E27 \u2192 \u65F6\u95F4\u8F74 JSON`);
}
async function importFile(file) {
  await loadCaptureText(await file.text(), file.name);
}
document.getElementById("tl-rewind")?.addEventListener("click", () => {
  void player?.seek(0);
});
document.getElementById("tl-step-back")?.addEventListener("click", () => {
  void stepFrame(-1);
});
tlPlayBtn?.addEventListener("click", () => {
  void toggleReplay();
});
document.getElementById("tl-step")?.addEventListener("click", () => {
  void stepFrame(1);
});
tlLoopBtn?.addEventListener("click", () => {
  if (player) player.setLoop(!player.loop);
});
tlRecBtn?.addEventListener("click", toggleRecording);
tlLiveBtn?.addEventListener("click", returnToLive);
document.getElementById("tl-export")?.addEventListener("click", exportText);
document.getElementById("tl-export-json")?.addEventListener("click", exportJson);
document.getElementById("tl-import")?.addEventListener("click", () => tlFile?.click());
tlFile?.addEventListener("change", () => {
  const file = tlFile.files?.[0];
  if (file) void importFile(file);
});
tlSeek?.addEventListener("change", () => {
  void player?.seek(Number(tlSeek.value));
});
tlSpeed?.addEventListener("change", () => {
  player?.setSpeed(Number(tlSpeed.value) || 1);
});
var WRITE_EDITOR_SCREEN = {
  "midi-config": "midisetup",
  "pattern-bank": "steps",
  "file-service": "configurator"
};
var SYNTH_NOTE = "offline capture: no $10 config / no $0A final bank packet";
function syntheticMidiConfig() {
  const b = new Uint8Array(MIDI_CONFIG_SIZE);
  for (let t = 0; t < 16; t++) {
    b[t] = 1;
    b[16 + t] = t & 15;
    for (let p = 0; p < 16; p++) b[32 + t * 16 + p] = t * 16 + p & 127;
  }
  b[288] = 6;
  return b;
}
function syntheticBaseline(editor) {
  const bytes = editor === "pattern-bank" ? new Uint8Array(PATTERN_BANK_SIZE) : editor === "file-service" ? new TextEncoder().encode('{"version":1,"slots":[]}') : syntheticMidiConfig();
  return { bytes, origin: "synthetic", label: SYNTH_NOTE };
}
async function readWriteBaseline(editor) {
  const live = liveSession;
  if (!live?.transport) return syntheticBaseline(editor);
  if (editor === "midi-config") {
    const probe = createWebMidiWritePort(live.transport, {
      kind: "midi-config",
      timeoutMs: 2500,
      onLog: setSource
    });
    let raw = null;
    try {
      raw = await probe.readback();
    } finally {
      probe.dispose();
    }
    if (raw && raw.length === MIDI_CONFIG_SIZE) {
      return { bytes: raw.slice(), origin: "device", label: "fresh $0F \u2192 $10 (2 identical reads)" };
    }
    if (live.midiConfig) {
      return {
        bytes: live.midiConfig.data.slice(),
        origin: "device",
        label: "session $10 mirror (fresh baseline guard re-checks at commit)"
      };
    }
    return syntheticBaseline(editor);
  }
  if (editor === "pattern-bank") {
    if (!live.bank) await live.refreshBankAsync(4e3);
    if (live.bank) {
      return {
        bytes: live.bank.data.slice(),
        origin: "device",
        label: "$08 \u2192 $09/$0A full 342272 B snapshot"
      };
    }
    return syntheticBaseline(editor);
  }
  return syntheticBaseline(editor);
}
function createWritePort(editor) {
  const live = liveSession;
  if (!live?.transport) throw new Error("no live Web MIDI transport");
  if (editor === "midi-config") {
    return createWebMidiWritePort(live.transport, {
      kind: "midi-config",
      timeoutMs: 4e3,
      onLog: setSource
    });
  }
  return createWebMidiWritePort(live.transport, {
    kind: "pattern-bank",
    timeoutMs: 6e3,
    onLog: setSource,
    readCurrent: async () => {
      const ok = await live.refreshBankAsync(5e3);
      return ok && live.bank ? live.bank.data.slice() : null;
    }
  });
}
var writeController = new WriteController({
  isLive: () => liveSession?.transport != null,
  now: () => Date.now(),
  onLog: setSource,
  onChange: (ui, status) => {
    writeUi = ui;
    lastWriteStatus = status;
    if (view) view.writeState = ui;
    applyWriteStatus(ui, status);
  },
  onNavigate: (editor) => view?.navigateTo(WRITE_EDITOR_SCREEN[editor]),
  readBaseline: readWriteBaseline,
  createPort: createWritePort,
  bankTarget: () => ({
    address: liveSession?.bankAddress ?? 0,
    transferId: liveSession?.bankTransferId ?? 0
  }),
  filePlanInput: () => ({
    slotMap: new TextEncoder().encode('{"version":1,"slots":[]}'),
    targetPath: "settings/plugs.json",
    targetContent: new TextEncoder().encode('{"plugs":[]}')
  })
});
writeController.sync();
function refreshBleUi() {
  const cap = bleCapability();
  const connected = bleTransport?.connected ?? false;
  if (bleBtn) {
    bleBtn.textContent = connected ? "BLE DISCONNECT" : "BLE CONNECT";
    bleBtn.disabled = bleBusy || !cap.supported && !connected;
    bleBtn.classList.toggle("active", connected);
  }
  if (bleStatus) {
    bleStatus.textContent = connected ? "BLE: LIVE" : cap.supported ? `BLE: READY \xB7 HOST ${stage7EvidenceLabel("browserWebBluetooth")}` : "BLE: UNAVAILABLE";
    bleStatus.classList.toggle("on", connected);
    bleStatus.classList.toggle("warn", !connected && cap.supported);
  }
}
async function disconnectBle() {
  const transport = bleTransport;
  bleTransport = null;
  if (transport) {
    try {
      await transport.close();
    } catch {
    }
  }
  refreshBleUi();
  if (usbSession) {
    liveSession = usbSession;
    attach(usbSession);
    updateLiveButton();
    setSource("LIVE \xB7 USB Web MIDI restored after BLE disconnect");
    return;
  }
  liveSession = null;
  updateLiveButton();
  await loadOffline();
  setSource("BLE \xB7 disconnected \xB7 31-frame offline replay");
}
async function toggleBle() {
  if (bleBusy) return;
  if (bleTransport?.connected) {
    await disconnectBle();
    return;
  }
  const cap = bleCapability();
  if (!cap.supported) {
    setSource(`BLE \xB7 ${cap.reason}`);
    return;
  }
  if (lastWriteStatus?.open) {
    setSource("BLE \xB7 close the write editor before switching transport (Stage 6 safety gate)");
    return;
  }
  bleBusy = true;
  refreshBleUi();
  try {
    const transport = await openBleMidi({ onLog: setSource, now: () => Date.now() });
    const live = new OpzSession({ transport });
    const upstream = transport.onSysex;
    transport.onSysex = (data) => {
      recorder.record(data);
      upstream?.(data);
    };
    transport.onStateChange = () => {
      refreshBleUi();
      if (!transport.connected) {
        setSource("BLE \xB7 link lost \xB7 USB Web MIDI / offline replay still available");
      }
    };
    bleTransport = transport;
    liveSession = live;
    attach(live);
    updateLiveButton();
    setSource(`LIVE \xB7 BLE-MIDI ${transport.inputName} \xB7 20 B MTU`);
    live.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSource(`BLE \xB7 ${msg} \xB7 staying on USB / offline replay`);
  } finally {
    bleBusy = false;
    refreshBleUi();
  }
}
bleBtn?.addEventListener("click", () => {
  void toggleBle();
});
function handleGamepadAction(action) {
  switch (action) {
    case "next-screen":
      view?.nextScreen();
      break;
    case "prev-screen":
      view?.prevScreen();
      break;
    case "toggle-auto":
      toggleAutoRoute();
      break;
    case "toggle-play":
      view?.togglePlay();
      break;
    case "timeline-play":
      void toggleReplay();
      break;
    case "timeline-step-back":
      void stepFrame(-1);
      break;
    case "timeline-step-forward":
      void stepFrame(1);
      break;
    case "toggle-loop":
      if (player) player.setLoop(!player.loop);
      break;
    case "toggle-write-editor":
      void writeController.setOpen(!(lastWriteStatus?.open ?? false));
      break;
  }
}
function applyPadStatus(connected, id) {
  if (!padStatus) return;
  padStatus.textContent = connected ? `PAD: ${(id ?? "ON").slice(0, 18)}` : "PAD: --";
  padStatus.classList.toggle("on", connected);
}
var gamepad = new GamepadNavigator({
  onAction: handleGamepadAction,
  onStatus: applyPadStatus
});
gamepadTick = () => {
  gamepad.poll();
};
applyPadStatus(false, null);
function applyWriteStatus(ui, s) {
  if (wrToggle) {
    wrToggle.textContent = s.open ? "WRITE: ON" : "WRITE: OFF";
    wrToggle.classList.toggle("active", s.open);
  }
  if (wrMode) {
    wrMode.textContent = s.dryRun ? "DRY RUN" : "ARMED";
    wrMode.classList.toggle("wr-dry", s.dryRun);
    wrMode.classList.toggle("wr-armed", !s.dryRun);
  }
  if (wrEvidence) wrEvidence.textContent = ui?.evidence ?? "UNKNOWN";
  if (wrArm) {
    wrArm.textContent = s.dryRun ? "ARM \u26A0" : "DISARM";
    wrArm.disabled = s.dryRun ? !s.canArm : false;
    wrArm.classList.toggle("active", !s.dryRun);
  }
  if (wrCommit) wrCommit.disabled = !s.canCommit;
  if (wrRollback) wrRollback.disabled = !s.canRollback;
  const editable = s.open && s.editor !== "file-service";
  if (wrStage) wrStage.disabled = !editable;
  if (wrReset) wrReset.disabled = !editable;
  if (wrRefresh) wrRefresh.disabled = !s.open;
  if (wrBackup) wrBackup.disabled = !s.open;
  if (wrAudit) wrAudit.disabled = !s.open;
  if (wrValue) {
    wrValue.disabled = !editable;
    if (lastWriteEditor !== s.editor) {
      wrValue.value = s.editor === "pattern-bank" ? "123" : s.editor === "file-service" ? "0" : "74";
    }
  }
  lastWriteEditor = s.editor;
  if (wrInfo) {
    wrInfo.textContent = ui ? `${ui.diffCount} diff \xB7 ${ui.frameCount} frames \xB7 ${ui.baselineBytes} B \xB7 ${s.message}` : `0 diff \xB7 0 frames \xB7 ${s.message}`;
  }
}
wrToggle?.addEventListener("click", () => {
  void writeController.setOpen(!(lastWriteStatus?.open ?? false));
});
wrEditor?.addEventListener("change", () => {
  const kind = wrEditor.value;
  if (WRITE_EDITORS.includes(kind)) void writeController.selectEditor(kind);
});
wrStage?.addEventListener("click", () => {
  void writeController.stageSample(wrValue?.value ?? "74");
});
wrReset?.addEventListener("click", () => {
  void writeController.reset();
});
wrRefresh?.addEventListener("click", () => {
  void writeController.refresh();
});
wrArm?.addEventListener("click", () => {
  if (!lastWriteStatus) return;
  if (lastWriteStatus.dryRun) writeController.arm();
  else writeController.disarm();
});
wrCommit?.addEventListener("click", () => {
  const prompt = "Send the staged SysEx frames to the OP-Z now?\n\nKeep the exported baseline backup. A failed readback restores the exact original bytes.";
  if (typeof window.confirm === "function" && !window.confirm(prompt)) {
    setSource("COMMIT cancelled by user \xB7 0 frames sent");
    return;
  }
  void writeController.commit();
});
wrRollback?.addEventListener("click", () => {
  void writeController.rollback();
});
wrBackup?.addEventListener("click", () => {
  const json = writeController.backupJson();
  if (!json) return;
  download(`opb-baseline-${stamp()}.json`, json, "application/json;charset=utf-8");
  setSource(`BACKUP \xB7 exact baseline exported (${writeController.baselineOrigin}) \xB7 keep this file`);
});
wrAudit?.addEventListener("click", () => {
  download(`opb-write-audit-${stamp()}.json`, writeController.auditJson(), "application/json;charset=utf-8");
  setSource("AUDIT \xB7 transaction diff / frames / phase history exported");
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && immersive && !document.fullscreenElement) {
    setImmersive(false);
    return;
  }
  if (immersive) return;
  if (e.key === "ArrowRight" || e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    view?.nextScreen();
  } else if (e.key === "ArrowLeft" || e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
    view?.prevScreen();
  } else if (e.code === "Space") {
    e.preventDefault();
    view?.togglePlay();
  } else if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    toggleAutoRoute();
  } else if (e.key >= "1" && e.key <= "9") {
    view?.navigateTo(SCREEN_ORDER[Number(e.key) - 1]);
  } else if (e.key === "0") {
    view?.navigateTo(SCREEN_ORDER[9]);
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    void toggleReplay();
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    toggleRecording();
  } else if (e.key === "l" || e.key === "L") {
    e.preventDefault();
    if (player) player.setLoop(!player.loop);
  } else if (e.key === "[") {
    void stepFrame(-1);
  } else if (e.key === "]") {
    void stepFrame(1);
  } else if (e.key === "w" || e.key === "W") {
    e.preventDefault();
    void writeController.setOpen(!(lastWriteStatus?.open ?? false));
  } else if (e.key === "e" || e.key === "E") {
    e.preventDefault();
    const i = WRITE_EDITORS.indexOf(lastWriteStatus?.editor ?? "midi-config");
    void writeController.selectEditor(WRITE_EDITORS[(i + 1) % WRITE_EDITORS.length]);
  }
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => {
      console.warn("service worker registration failed", err);
    });
  });
}
async function boot() {
  attach(new OpzSession());
  updateTimelineUi(null);
  updateLiveButton();
  const permission = await midiPermissionState();
  if (permission === "granted") {
    await connectLive();
    if (liveSession) return;
  }
  if (permission === "denied" && liveConnectBtn) {
    liveConnectBtn.title = "MIDI \u6743\u9650\u5DF2\u88AB\u62D2\u7EDD\uFF1A\u5730\u5740\u680F\u9501\u5F62\u56FE\u6807 \u2192 \u7F51\u7AD9\u8BBE\u7F6E \u2192 MIDI \u8BBE\u5907 \u2192 \u5141\u8BB8\uFF0C\u7136\u540E\u5237\u65B0\u9875\u9762";
  }
  await loadOffline();
}
async function loadOffline() {
  try {
    const res = await fetch(captureUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadCaptureText(await res.text(), captureUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSource(`OFFLINE \xB7 \u56DE\u653E\u5931\u8D25 ${msg}`);
  }
}
refreshBleUi();
void boot();
