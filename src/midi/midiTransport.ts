/**
 * Device layer for the Web edition. Replaces LinuxMidiConnection.cs (ALSA P/Invoke)
 * with the browser Web MIDI API. Same contract as IMidiConnection.cs:
 * SendSysex / SendShort / SysexReceived / ShortReceived.
 *
 * The probe page (tools/webmidi-probe.html) proved this path works on real
 * hardware: 31 SysEx frames / 989 bytes with sysex:true and no native code.
 */
import { IDENTITY_INQUIRY, hello, ALL_NOTES_OFF } from '../protocol/opzFrame.ts';

interface PortBase {
  name: string | null;
  manufacturer?: string | null;
  state?: string;
  open(): Promise<unknown>;
  close(): Promise<unknown>;
}

/** Web MIDI inputs receive messages; outputs send them — the DOM types are deliberately split. */
interface InputPortLike extends PortBase {
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null;
}
interface OutputPortLike extends PortBase {
  send(data: number[]): void;
}
interface PortMapLike<T extends PortBase> {
  values(): IterableIterator<T>;
}

interface AccessLike {
  sysexEnabled: boolean;
  inputs: PortMapLike<InputPortLike>;
  outputs: PortMapLike<OutputPortLike>;
  onstatechange: (() => void) | null;
}

export interface MidiTransport {
  readonly sysexEnabled: boolean;
  readonly inputName: string | null;
  readonly outputName: string | null;
  onSysex: ((data: Uint8Array) => void) | null;
  onShort: ((status: number, data1: number, data2: number) => void) | null;
  onStateChange: (() => void) | null;
  listPorts(): { inputs: string[]; outputs: string[] };
  sendSysex(message: Uint8Array): void;
  sendShort(status: number, data1?: number, data2?: number): void;
  close(): Promise<void>;
}

/** Requires a secure context (https / localhost; Chrome also accepts file://). */
export async function openWebMidi(namePattern: RegExp = /op[\s_-]?z/i): Promise<MidiTransport> {
  const nav = navigator as Navigator & {
    requestMIDIAccess?: (options: { sysex: boolean }) => Promise<AccessLike>;
  };
  if (typeof nav.requestMIDIAccess !== 'function') {
    throw new Error('Web MIDI API unavailable. Use Chrome / Edge / Chromium on https or localhost.');
  }

  const access = await nav.requestMIDIAccess({ sysex: true }) as unknown as AccessLike;
  if (!access.sysexEnabled) {
    throw new Error('SysEx permission was denied. OP-Z state frames are all SysEx.');
  }

  const choose = <T extends PortBase>(ports: PortMapLike<T>): T | undefined => {
    return Array.from(ports.values()).find((port) =>
      port.state !== 'disconnected' &&
      `${port.name ?? ''} ${port.manufacturer ?? ''}`.search(namePattern) !== -1);
  };
  // Ports are bound once. TS cannot track assignments made inside a closure, so
  // selection returns the pair instead of writing to outer mutable variables.
  const inPort = choose(access.inputs);
  const outPort = choose(access.outputs);
  if (!inPort || !outPort) {
    throw new Error('No OP-Z MIDI input/output pair. Check the USB data cable and whether the browser lists OP-Z.');
  }
  await inPort.open();
  await outPort.open();
  const transport: MidiTransport = {
    sysexEnabled: access.sysexEnabled,
    inputName: inPort.name,
    outputName: outPort.name,
    onSysex: null,
    onShort: null,
    onStateChange: null,
    listPorts: () => ({
      inputs: Array.from(access.inputs.values()).map((p) => p.name ?? ''),
      outputs: Array.from(access.outputs.values()).map((p) => p.name ?? ''),
    }),
    sendSysex: (message) => outPort.send(Array.from(message)),
    sendShort: (status, data1 = 0, data2 = 0) => outPort.send([status, data1, data2]),
    close: async () => {
      inPort.onmidimessage = null;
      access.onstatechange = null;
      await inPort.close();
      await outPort.close();
    },
  };

  inPort.onmidimessage = (event) => {
    const data = event.data;
    if (!data || data.length === 0) return;
    if (data[0] === 0xf0) transport.onSysex?.(Uint8Array.from(data));
    else transport.onShort?.(data[0], data[1] ?? 0, data[2] ?? 0);
  };
  access.onstatechange = () => {
    // Topology changed: this transport keeps its bound pair, so the shell can
    // decide whether to rebuild it (e.g. OP-Z was unplugged / replugged).
    transport.onStateChange?.();
  };
  return transport;
}

/** Same handshake as MidiProbe.cs / webmidi-probe.html. Frame counting is left to onSysex. */
export async function handshake(
  transport: MidiTransport,
  options: {
    sessionId?: number;
    rounds?: number;
    intervalMs?: number;
    shouldStop?: () => boolean;
  } = {},
): Promise<void> {
  const { sessionId = 0x4f42, rounds = 6, intervalMs = 900, shouldStop } = options;
  for (let i = 0; i < rounds; i++) {
    transport.sendSysex(IDENTITY_INQUIRY);
    transport.sendSysex(hello(sessionId));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (shouldStop?.()) break;
  }
  transport.sendShort(ALL_NOTES_OFF[0], ALL_NOTES_OFF[1], ALL_NOTES_OFF[2]);
}
