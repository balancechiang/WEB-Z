import type { MidiTransport } from './midiTransport.ts';

export async function openDeckMidi(): Promise<MidiTransport> {
  const outgoing: string[] = [];
  const client = crypto.randomUUID();
  let closed = false;
  const exchange = async (start = false): Promise<string[]> => {
    const response = await fetch('/deck-midi', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OPB-Client': client,
        'X-OPB-Start': start ? '1' : '0',
      },
      body: JSON.stringify(outgoing.splice(0)),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Deck MIDI bridge unavailable (${response.status})`);
    return response.json();
  };

  const first = await exchange(true);
  const transport: MidiTransport = {
    sysexEnabled: true,
    inputName: 'OP-Z Deck bridge',
    outputName: 'OP-Z Deck bridge (read-only)',
    onSysex: null,
    onShort: null,
    onStateChange: null,
    listPorts: () => ({ inputs: ['OP-Z Deck bridge'], outputs: ['OP-Z Deck bridge (read-only)'] }),
    sendSysex: (message) => {
      outgoing.push(Array.from(message, (byte) => byte.toString(16).padStart(2, '0')).join(''));
    },
    sendShort: () => {},
    close: async () => { closed = true; },
  };

  async function poll(frames: string[]): Promise<void> {
    try {
      while (!closed) {
        for (const frame of frames) {
          const data = Uint8Array.from(frame.match(/../g) ?? [], (byte) => parseInt(byte, 16));
          if (data[0] === 0xf0) transport.onSysex?.(data);
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
  setTimeout(() => { void poll(first); }, 0);
  return transport;
}
