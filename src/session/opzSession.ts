/**
 * OPB.Core/OpzSession.cs → TypeScript state machine (Web edition, Stage 2).
 *
 * Mirrors the C# StateSync session: keeps the connection alive, mirrors every
 * state message the OP-Z sends, and exposes the writable state messages. The C#
 * version marshals all changes onto the UI thread through a SynchronizationContext;
 * in the browser/Node single thread we serialize frame processing through a promise
 * chain instead. C# Zlib.Decompress is synchronous, but the Web DecompressionStream
 * is async, so handleSysex/handle here are async.
 */
import type { OpzFrame } from '../protocol/opzFrame.ts';
import {
  tryParse, isIdentityReply, inflateZlib, deflateZlib, build, hello,
  IDENTITY_INQUIRY, ALL_NOTES_OFF,
} from '../protocol/opzFrame.ts';
import { GlobalData, GLOBAL_SIZE, MidiConfig, MIDI_CONFIG_SIZE } from '../model/globalData.ts';
import { PatternBank, PATTERN_BANK_SIZE, PATTERN_SIZE } from '../model/patternBank.ts';
import { liveToBankParam, remapBankSoundToLive, remapLiveSoundToBank } from '../model/bankParams.ts';
import { TRACK_COUNT } from '../model/tracks.ts';
import type { DeviceInfo, MixerState } from '../model/liveState.ts';
import {
  decodePlayState, decodeLevelState, decodeUiState, decodeChainState,
  decodeMixerState, decodePatternState, decodeModuleInfo, decodeSamplerUiState,
  deviceInfoFrom11, encodeMixerState, encodeChainState, encodePlayState,
} from '../model/liveState.ts';
import type { MidiTransport } from '../midi/midiTransport.ts';

export const Changes = {
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
  Transport: 1 << 15,
} as const;
export type ChangeFlag = number;

const nowMs = (): number => Date.now();

export interface OpzSessionOptions {
  transport?: MidiTransport | null;
  /** After the first ack, request the full bank/midi config if they don't arrive. Default: transport != null. */
  autoRequest?: boolean;
}

interface AckController {
  resolve: (v: number) => void;
  reject: (e: unknown) => void;
}
interface BankController {
  resolve: (v: boolean) => void;
}

export class OpzSession {
  // ---- connection ----
  isConnected = false;
  portName: string | null = null;
  clockRunning = false;
  clockTicks = 0;

  // ---- mirrored state ----
  device: DeviceInfo = { serial: '', firmware: '' };
  play = decodePlayState(new Uint8Array(0));
  level = decodeLevelState(new Uint8Array(0));
  ui = decodeUiState(new Uint8Array(0));
  chain = decodeChainState(new Uint8Array(0));
  bank: PatternBank | null = null;
  bankAddress = 0;
  bankTransferId = 0;
  global: GlobalData | null = null;
  midiConfig: MidiConfig | null = null;
  mixer: MixerState = decodeMixerState(new Uint8Array(0));
  hasMixer = false;
  patternState = decodePatternState(new Uint8Array(0));
  module = decodeModuleInfo(new Uint8Array(0));
  sampler = decodeSamplerUiState(new Uint8Array(0));
  audioVis = 0;
  currentSound: Uint8Array[] = Array.from({ length: TRACK_COUNT }, () => new Uint8Array(18));

  // ---- events ----
  onChanged: ((changes: number) => void) | null = null;
  onNote: ((track: number, note: number, velocity: number) => void) | null = null;
  onControlChange: ((track: number, cc: number, value: number) => void) | null = null;
  onLog: ((message: string) => void) | null = null;
  onRawSysex: ((data: Uint8Array) => void) | null = null;

  // ---- diagnostics ----
  receivedFrames = 0;
  messageCounts = new Map<number, number>();
  parseErrors: string[] = [];

  readonly transport: MidiTransport | null;
  private autoRequest: boolean;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastAckTicks = 0;
  private patternPackets: number[] = [];
  private pendingAck: AckController | null = null;
  private pendingAckPacket = -1;
  private pendingBank: BankController | null = null;
  /** Serializes frame processing so async zlib work never interleaves. */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: OpzSessionOptions = {}) {
    this.transport = options.transport ?? null;
    this.autoRequest = options.autoRequest ?? this.transport != null;
    if (this.transport) {
      this.transport.onSysex = (data) => { void this.injectSysex(data); };
      this.transport.onShort = (s, d1, d2) => { void this.injectShort(s, d1, d2); };
    }
  }

  get activePattern(): number { return this.chain.pattern; }
  get activeTrack(): number { return this.play.track; }
  /** Bytes accumulated from incomplete pattern packets (no $0A terminator yet). */
  get patternPacketsLength(): number { return this.patternPackets.length; }

  private emit(message: string): void { this.onLog?.(message); }
  private changed(flags: number): void { this.onChanged?.(flags); }

  // ---------------------------------------------------------------- receive

  async injectSysex(data: Uint8Array): Promise<void> {
    const run = this.queue.then(() => this.processSysex(data));
    this.queue = run.catch(() => { /* errors already surfaced via parseErrors */ });
    await run;
  }

  async injectShort(status: number, data1 = 0, data2 = 0): Promise<void> {
    const run = this.queue.then(() => this.processShort(status, data1, data2));
    this.queue = run.catch(() => {});
    await run;
  }

  private async processSysex(data: Uint8Array): Promise<void> {
    this.receivedFrames++;
    if (isIdentityReply(data)) {
      this.processIdentity(data);
      return;
    }
    const frame = tryParse(data);
    if (!frame) return;
    this.messageCounts.set(frame.messageId, (this.messageCounts.get(frame.messageId) ?? 0) + 1);
    this.onRawSysex?.(data);
    try {
      await this.handle(frame);
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : String(ex);
      this.parseErrors.push(`$${frame.messageId.toString(16)}: ${msg}`);
      this.emit(`Error handling $${frame.messageId.toString(16)}: ${msg}`);
    }
  }

  private processIdentity(data: Uint8Array): void {
    let body = new TextDecoder('ascii').decode(data.subarray(9, data.length - 1));
    body = body.replace(/[\0\x06]+$/, '');
    const nul = body.indexOf('\0');
    if (nul >= 0) body = body.slice(0, nul);
    if (body.length > 8 && this.device.serial === '') {
      this.device = { serial: body.slice(0, 8), firmware: body.slice(8) };
      this.changed(Changes.Device);
    }
  }

  private processShort(status: number, d1: number, d2: number): void {
    switch (status) {
      case 0xf8: this.clockTicks++; return;
      case 0xfa: this.clockTicks = 0; this.clockRunning = true; this.changed(Changes.Transport); return;
      case 0xfb: this.clockRunning = true; this.changed(Changes.Transport); return;
      case 0xfc: this.clockRunning = false; this.changed(Changes.Transport); return;
    }
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (kind === 0x90 || kind === 0x80 || kind === 0xb0) {
      const track = this.trackForChannel(channel);
      if (track < 0) return;
      if (kind === 0xb0) this.onControlChange?.(track, d1, d2);
      else this.onNote?.(track, d1, kind === 0x80 ? 0 : d2);
    }
  }

  private trackForChannel(channel: number): number {
    if (!this.midiConfig) return channel;
    for (let t = 0; t < TRACK_COUNT; t++) if (this.midiConfig.channel(t) === channel) return t;
    return -1;
  }

  private async handle(frame: OpzFrame): Promise<void> {
    const p = frame.payload;
    switch (frame.messageId) {
      case 0x01:
        this.lastAckTicks = nowMs();
        if (!this.isConnected) {
          this.setConnected(true);
          if (this.autoRequest && this.transport) this.scheduleAutoRequest();
        }
        break;
      case 0x02: this.applyPatternDelta(p); break;
      case 0x03: this.play = decodePlayState(p); this.changed(Changes.Play); break;
      case 0x04: this.level = decodeLevelState(p); this.changed(Changes.Level); break;
      case 0x06: this.ui = decodeUiState(p); this.changed(Changes.Ui); break;
      case 0x07: {
        const previous = this.chain.pattern;
        this.chain = decodeChainState(p);
        if (this.bank && previous !== this.chain.pattern) this.loadSoundFromBank();
        this.changed(Changes.Chain | Changes.Sound);
        break;
      }
      case 0x08:
        if (p.length >= 4 && p[0] === 0xff && p[1] === 0xff) {
          this.emit('OP-Z rejected a pattern upload');
          this.pendingAck?.reject(new Error('upload rejected'));
        }
        break;
      case 0x09:
      case 0x0a:
        await this.receivePatternPacket(frame.messageId, p);
        break;
      case 0x0b:
        if (p.length >= 8 && this.pendingAck) {
          const packet = (p[6] | (p[7] << 8)) & 0xffff;
          if (packet === this.pendingAckPacket) this.pendingAck.resolve(packet);
        }
        break;
      case 0x0c:
        this.global = new GlobalData(await inflateZlib(p, GLOBAL_SIZE));
        this.changed(Changes.Global);
        break;
      case 0x0e:
        if (p.length >= 19) {
          const track = p[0] & 0x0f;
          const sound = p.subarray(1, 19);
          this.currentSound[track] = remapBankSoundToLive(sound);
          this.bank?.setSoundRecord(this.activePattern, track, sound);
          this.changed(Changes.Sound);
        }
        break;
      case 0x10:
        this.midiConfig = new MidiConfig(await inflateZlib(p, MIDI_CONFIG_SIZE));
        this.changed(Changes.MidiConfig);
        break;
      case 0x11:
        this.device = deviceInfoFrom11(p);
        this.changed(Changes.Device);
        break;
      case 0x12:
        this.mixer = decodeMixerState(p);
        this.hasMixer = true;
        this.changed(Changes.Mixer);
        break;
      case 0x13: this.patternState = decodePatternState(p); this.changed(Changes.PatternState); break;
      case 0x14: this.module = decodeModuleInfo(p); this.changed(Changes.Module); break;
      case 0x1a: this.sampler = decodeSamplerUiState(p); this.changed(Changes.Sampler); break;
      case 0x1b: if (p.length > 0) { this.audioVis = p[0]; this.changed(Changes.AudioVis); } break;
    }
  }

  private async receivePatternPacket(id: number, p: Uint8Array): Promise<void> {
    if (p.length < 6) return;
    const packet = (p[4] | (p[5] << 8)) & 0xffff;
    if (packet === 0) this.patternPackets = [];
    for (let i = 6; i < p.length; i++) this.patternPackets.push(p[i]);
    this.bankAddress = p[0];
    this.bankTransferId = (p[2] | (p[3] << 8)) & 0xffff;
    if (id === 0x09) {
      // Acknowledge every non-final packet or the OP-Z stops sending.
      const ack = Uint8Array.of(0x09, 0, 0, 0, p[2], p[3], p[4], p[5]);
      this.send(build(0x0b, ack));
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

  private loadSoundFromBank(): void {
    if (!this.bank) return;
    for (let t = 0; t < TRACK_COUNT; t++) {
      this.currentSound[t] = remapBankSoundToLive(this.bank.soundRecord(this.activePattern, t));
    }
  }

  private applyPatternDelta(p: Uint8Array): void {
    let needsRefresh = false;
    let i = 0;
    while (this.bank && i + 7 <= p.length) {
      const offset = p[i + 2] | (p[i + 3] << 8);
      const pattern = p[i + 4] & 0x0f;
      const length = p[i + 5];
      const type = p[i + 6];
      if (i + 7 + length > p.length) break;
      if (type === 0x04 || type === 0x05) needsRefresh = true;
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

  private scheduleBankRefresh(): void {
    // C# uses a 350ms timer; only meaningful with a live transport.
    if (this.transport) this.requestBank();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (!this.transport || this.heartbeat !== undefined) return;
    const sessionId = 1 + Math.floor(Math.random() * 0x7fff);
    const greeting = hello(sessionId);
    this.send(IDENTITY_INQUIRY);
    this.send(greeting);
    this.heartbeat = setInterval(() => this.send(greeting), 900);
  }

  private scheduleAutoRequest(): void {
    setTimeout(() => {
      if (!this.bank) this.requestBank();
      if (!this.midiConfig) this.requestMidiConfig();
    }, 1500);
  }

  private setConnected(connected: boolean): void {
    if (this.isConnected === connected) return;
    this.isConnected = connected;
    if (!connected) {
      this.hasMixer = false;
      this.clockRunning = false;
    }
    this.emit(connected ? 'Connected to OP-Z' : 'Disconnected');
    this.changed(Changes.Connection);
  }

  // ---------------------------------------------------------------- send

  private send(message: Uint8Array): void {
    try { this.transport?.sendSysex(message); }
    catch (ex) { this.emit(`Send failed: ${String(ex)}`); }
  }

  sendShort(status: number, d1 = 0, d2 = 0): void {
    try { this.transport?.sendShort(status, d1, d2); }
    catch (ex) { this.emit(`Send failed: ${String(ex)}`); }
  }

  sendFrame(id: number, payload: Uint8Array): void { this.send(build(id, payload)); }

  private sendState(_key: number, message: Uint8Array): void { this.send(message); }

  requestBank(): void {
    if (!this.isConnected || !this.transport) return;
    this.send(build(0x08));
  }

  requestMidiConfig(): void { this.send(build(0x0f)); }

  async refreshBankAsync(timeoutMs = 3000): Promise<boolean> {
    this.pendingBank = { resolve: () => {} };
    let resolveFn!: (v: boolean) => void;
    const promise = new Promise<boolean>((res) => { resolveFn = res; });
    this.pendingBank.resolve = resolveFn;
    this.requestBank();
    const result = await Promise.race([promise, new Promise<boolean>((res) => setTimeout(() => res(false), timeoutMs))]);
    this.pendingBank = null;
    return result;
  }

  // ---- writable state (offline: no-op sends; live: dispatched to OP-Z) ----

  setSound(track: number, param: number, value: number): void {
    // `param` is a LIVE SOUND_PARAM index (that is what currentSound and the dials use).
    // The persistent bank bytes use BANK_PARAM order, so remap before mirroring the edit.
    this.currentSound[track][param] = value & 0xff;
    this.bank?.setSound(this.activePattern, track, liveToBankParam(param), value);
    const payload = new Uint8Array(19);
    payload[0] = track & 0xff;
    payload.set(remapLiveSoundToBank(this.currentSound[track]), 1);
    this.sendState(0x0e00 | track, build(0x0e, payload));
    this.changed(Changes.Sound);
  }

  selectTrack(track: number, octave?: number): void {
    this.play = { ...this.play, track, octave: octave ?? this.play.octave };
    this.send(build(0x03, encodePlayState(this.play)));
    this.changed(Changes.Play);
  }

  setOctave(octave: number): void { this.selectTrack(this.play.track, Math.max(-3, Math.min(3, octave))); }

  selectPatterns(patterns: number[]): void {
    if (patterns.length === 0) return;
    this.send(build(0x07, encodeChainState(patterns, this.chain.project)));
  }

  setMixer(state: MixerState): void {
    this.mixer = state;
    this.sendState(0x12, build(0x12, encodeMixerState(state)));
    this.changed(Changes.Mixer);
  }

  setTrackMute(track: number, muted: boolean): void {
    let mask = this.mixer.muteMask;
    mask = muted ? (mask | (1 << track)) : (mask & ~(1 << track));
    this.setMixer({ levels: this.mixer.levels, muteMask: mask });
  }

  setGlobal(global: GlobalData): void {
    this.global = global;
    void deflateZlib(global.data).then((compressed) => {
      this.sendState(0x0c, build(0x0c, compressed));
    });
    this.changed(Changes.Global);
  }

  editGlobal(edit: (g: GlobalData) => void): void {
    if (!this.global) return;
    const copy = this.global.clone();
    edit(copy);
    this.setGlobal(copy);
  }

  setMidiConfig(config: MidiConfig): void {
    this.midiConfig = config;
    void deflateZlib(config.data).then((compressed) => {
      this.sendState(0x10, build(0x10, compressed));
    });
    this.changed(Changes.MidiConfig);
  }

  transportStart(): void { this.sendShort(0xfa); }
  transportStop(): void { this.sendShort(0xfc); }

  async uploadBankAsync(bank: PatternBank): Promise<boolean> {
    if (!this.isConnected || !this.transport) return false;
    const ok = await this.sendBankPacketsAsync(bank);
    if (ok) {
      this.bank = bank;
      this.loadSoundFromBank();
      this.changed(Changes.Bank | Changes.Sound);
      await this.refreshBankAsync(3000);
      return true;
    }
    this.emit('Pattern upload failed');
    return false;
  }

  private async sendBankPacketsAsync(bank: PatternBank): Promise<boolean> {
    const compressed = await deflateZlib(bank.data);
    const chunks = Math.ceil(compressed.length / 178);
    const address = this.bankAddress & 0xf0;
    for (let index = 0; index < chunks; index++) {
      const chunk = compressed.subarray(index * 178, Math.min(compressed.length, index * 178 + 178));
      const payload = new Uint8Array(6 + chunk.length);
      payload[0] = address;
      payload[2] = this.bankTransferId & 0xff;
      payload[3] = (this.bankTransferId >> 8) & 0xff;
      payload[4] = index & 0xff;
      payload[5] = (index >> 8) & 0xff;
      payload.set(chunk, 6);
      const last = index === chunks - 1;
      if (last) {
        this.send(build(0x0a, payload));
        return true;
      }
      const ack = new Promise<number>((resolve, reject) => { this.pendingAck = { resolve, reject }; });
      this.pendingAckPacket = index;
      this.send(build(0x09, payload));
      const done = await Promise.race([ack, new Promise<number>((_, rej) => setTimeout(() => rej(new Error('ack timeout')), 1500))]);
      if (typeof done !== 'number' || done !== index) return false;
    }
    return true;
  }

  dispose(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    try { this.transport?.close(); } catch { /* already gone */ }
  }
}
