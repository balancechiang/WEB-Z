/**
 * Web Bluetooth (BLE-MIDI) → MidiTransport adapter.
 *
 * Stage 7 gives the shell a second LIVE path: USB Web MIDI (device-proven, 31 frames) stays the
 * default at boot; BLE is explicitly user-triggered because `requestDevice()` REQUIRES a user
 * gesture. Once connected, the resulting object satisfies the very same MidiTransport contract,
 * so OpzSession, the timeline recorder and the Stage 6 write port need no changes.
 *
 * EVIDENCE: the BLE-MIDI wire format is `decoded` from the local C# reference; whether
 * Chromium on SteamOS actually exposes navigator.bluetooth with a working BlueZ stack is
 * `unknown` and MUST be probed at runtime. See src/midi/transportEvidence.ts.
 */
import type { MidiTransport } from './midiTransport.ts';
import {
  BLE_MIDI_SERVICE_UUID, BLE_MIDI_CHARACTERISTIC_UUID, BLE_MIDI_MAX_WRITE,
  BLE_TIMESTAMP_MASK, BleMidiDecoder, encodeShort, encodeSysex, webBluetoothAvailable,
} from './bleMidiCodec.ts';

/* Minimal local Web Bluetooth types: lib.dom.d.ts does not declare the Web Bluetooth API. */
export interface BleValueChangedEvent {
  target?: { value?: DataView | null } | null;
  currentTarget?: { value?: DataView | null } | null;
}

export interface BleCharacteristicLike {
  readonly properties: { writeWithoutResponse: boolean };
  value?: DataView | null;
  addEventListener(type: string, listener: (event: BleValueChangedEvent) => void): void;
  removeEventListener(type: string, listener: (event: BleValueChangedEvent) => void): void;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  readValue?(): Promise<unknown>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
  writeValueWithResponse?(data: Uint8Array): Promise<void>;
}

export interface BleServiceLike {
  getCharacteristic(uuid: string): Promise<BleCharacteristicLike>;
}

export interface BleGattLike {
  connect(): Promise<unknown>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleServiceLike>;
}

export interface BleDeviceLike {
  readonly name?: string | null;
  readonly id?: string;
  readonly gatt?: BleGattLike | null;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface BleRequestOptions {
  filters?: { services: string[] }[];
  acceptAllDevices?: boolean;
  optionalServices: string[];
}

export interface BluetoothLike {
  requestDevice(options: BleRequestOptions): Promise<BleDeviceLike>;
}

export interface OpenBleMidiOptions {
  /** Injected for Node tests; defaults to navigator.bluetooth. */
  bluetooth?: BluetoothLike | null;
  /** Injected clock, 13-bit millisecond timestamp. */
  now?: () => number;
  /** ATT MTU minus 3. The OP-Z drops writes > 20 B; never raise this without hardware proof. */
  maxPacket?: number;
  onLog?: (message: string) => void;
  /** Set when a device does not advertise the BLE-MIDI service UUID. */
  acceptAllDevices?: boolean;
}

export interface BleMidiTransport extends MidiTransport {
  /** Await all queued writes (used by tests and by close()). */
  flush(): Promise<void>;
  readonly queued: number;
  readonly connected: boolean;
  readonly lastError: string | null;
  readonly deviceName: string;
}

/**
 * Connect to a BLE-MIDI peripheral and return a MidiTransport.
 *
 * Must be called from a user gesture (click / keydown). Throws a readable error when the host
 * has no Web Bluetooth, the chooser is cancelled, or the GATT service is missing — the shell
 * then stays on USB / offline replay instead of pretending it is live.
 */
export async function openBleMidi(options: OpenBleMidiOptions = {}): Promise<BleMidiTransport> {
  const nav = globalThis.navigator as (Navigator & { bluetooth?: BluetoothLike }) | undefined;
  const bluetooth = options.bluetooth ?? nav?.bluetooth ?? null;
  if (!bluetooth || typeof bluetooth.requestDevice !== 'function') {
    throw new Error('Web Bluetooth unavailable. Use Chromium with BlueZ on https/localhost; '
      + 'USB Web MIDI and offline replay still work.');
  }

  const now = options.now ?? (() => Date.now());
  const maxPacket = Math.min(options.maxPacket ?? BLE_MIDI_MAX_WRITE, BLE_MIDI_MAX_WRITE);
  const log = options.onLog ?? (() => undefined);
  // Web Bluetooth requires either a non-empty `filters` array or `acceptAllDevices: true`.
  // The latter is only for peripherals that do not advertise the BLE-MIDI service UUID.
  const requestOptions: BleRequestOptions = options.acceptAllDevices
    ? { acceptAllDevices: true, optionalServices: [BLE_MIDI_SERVICE_UUID] }
    : {
      filters: [{ services: [BLE_MIDI_SERVICE_UUID] }],
      optionalServices: [BLE_MIDI_SERVICE_UUID],
    };

  const device = await bluetooth.requestDevice(requestOptions);
  const gatt = device.gatt;
  if (!gatt) throw new Error('Selected device has no GATT server');

  await gatt.connect();
  let service: BleServiceLike;
  let characteristic: BleCharacteristicLike;
  try {
    service = await gatt.getPrimaryService(BLE_MIDI_SERVICE_UUID);
    characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC_UUID);
  } catch (err) {
    gatt.disconnect();
    throw new Error(`No BLE-MIDI service/characteristic on ${device.name ?? 'device'}: `
      + `${err instanceof Error ? err.message : String(err)}`);
  }

  // BLE-MIDI centrals read the characteristic once after connecting; the answer is empty.
  // The C# connector treats this as optional, and so do we.
  try { await characteristic.readValue?.(); } catch { /* optional */ }

  const deviceName = device.name || 'OP-Z';
  const label = `${deviceName} (Bluetooth)`;
  const decoder = new BleMidiDecoder();
  let closed = false;
  let connected = true;
  let lastError: string | null = null;
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();

  const transport: BleMidiTransport = {
    sysexEnabled: true,
    inputName: label,
    outputName: label,
    onSysex: null,
    onShort: null,
    onStateChange: null,
    listPorts: () => ({ inputs: [label], outputs: [label] }),
    sendSysex: (message) => {
      if (closed || !connected) throw new Error('BLE link is not connected');
      const packets = encodeSysex(message, maxPacket, now() & BLE_TIMESTAMP_MASK);
      // One SysEx's packets must never interleave with another message's packets.
      enqueue(packets);
    },
    sendShort: (status, data1 = 0, data2 = 0) => {
      if (closed || !connected) throw new Error('BLE link is not connected');
      enqueue([encodeShort(status, data1, data2, now() & BLE_TIMESTAMP_MASK)]);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      onValueChanged && characteristic.removeEventListener('characteristicvaluechanged', onValueChanged);
      device.removeEventListener('gattserverdisconnected', onDisconnected);
      await chain.catch(() => undefined);
      try { await characteristic.stopNotifications(); } catch { /* link already gone */ }
      decoder.reset();
      connected = false;
      gatt.disconnect();
    },
    flush: async () => { await chain; },
    get queued() { return pending; },
    get connected() { return connected && !closed; },
    get lastError() { return lastError; },
    get deviceName() { return label; },
  };

  function writePacket(packet: Uint8Array): Promise<void> {
    if (packet.length > maxPacket) {
      throw new Error(`BLE-MIDI packet ${packet.length} B exceeds the ${maxPacket} B OP-Z limit`);
    }
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      return characteristic.writeValueWithoutResponse(packet);
    }
    if (characteristic.writeValueWithResponse) {
      return characteristic.writeValueWithResponse(packet);
    }
    throw new Error('BLE-MIDI characteristic exposes no write method');
  }

  function enqueue(packets: readonly Uint8Array[]): void {
    for (const packet of packets) {
      pending++;
      chain = chain.then(async () => {
        try {
          if (!closed && connected) await writePacket(packet);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          log(`BLE write failed · ${lastError}`);
          transport.onStateChange?.();
        } finally {
          pending--;
        }
      });
    }
  }

  const onValueChanged = (event: BleValueChangedEvent): void => {
    const view = event.target?.value ?? event.currentTarget?.value ?? characteristic.value ?? null;
    if (!view) return;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    decoder.feed(bytes);
  };
  const onDisconnected = (): void => {
    connected = false;
    decoder.reset();
    log('BLE link lost · switch back to USB Web MIDI or offline replay');
    transport.onStateChange?.();
  };

  decoder.onSysex = (message) => transport.onSysex?.(message);
  decoder.onShort = (status, d1, d2) => transport.onShort?.(status, d1, d2);

  characteristic.addEventListener('characteristicvaluechanged', onValueChanged);
  device.addEventListener('gattserverdisconnected', onDisconnected);
  await characteristic.startNotifications();
  log(`BLE · ${label} · MTU ${maxPacket} B · notifications on`);
  return transport;
}

/** Capability probe for the shell: never claim BLE is available just because a button exists. */
export function bleCapability(): { supported: boolean; reason: string } {
  const supported = webBluetoothAvailable();
  return {
    supported,
    reason: supported
      ? 'navigator.bluetooth present · still requires a real Deck/BlueZ check'
      : 'Web Bluetooth unavailable (Chromium + BlueZ + secure context required). '
        + 'USB Web MIDI and offline replay still work.',
  };
}
