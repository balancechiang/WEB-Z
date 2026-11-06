/**
 * Stage 7 evidence grades for the LIVE transport paths.
 *
 * Same scale as src/write/evidence.ts:
 *   device-proven > decoded > observed > inferred > unknown.
 * `unknown` = deliberately NOT claimed. Stage 7 must never present a Deck-specific browser
 * capability as verified just because the code compiles and the Node tests pass.
 */
import type { EvidenceRecord } from '../write/evidence.ts';
import type { EvidenceGrade } from '../model/bankParams.ts';

export const STAGE7_EVIDENCE: Record<string, EvidenceRecord> = {
  usbWebMidi: {
    grade: 'device-proven',
    claim: 'navigator.requestMIDIAccess({sysex:true}) received a complete 31-frame / 989-byte '
      + 'OP-Z state burst over USB.',
    source: 'tools/webmidi-probe.html + web/captures/webmidi-20261105.txt, 2026-11-05',
  },
  bleMidiPacketFormat: {
    grade: 'decoded',
    claim: 'BLE-MIDI 1.0 packets: header + timestamp, cross-packet SysEx continuation, '
      + 'running status and interleaved realtime. TS port reproduces every C# test vector.',
    source: 'OPB.Core/Midi/BleMidiCodec.cs + OP-Z-Windows/tests/OPB.Core.Tests/BleMidiTests.cs',
  },
  bleMidiUuids: {
    grade: 'decoded',
    claim: 'Service 03B80E5A-... and I/O characteristic 7772E5DB-... identify BLE-MIDI.',
    source: 'BleMidiCodec.ServiceUuid / CharacteristicUuid (BLE-MIDI 1.0 spec)',
  },
  opzWriteCeiling: {
    grade: 'device-proven',
    claim: 'The OP-Z drops the BLE link when a single write exceeds 20 bytes (a 31-byte sound '
      + 'edit reproduced it); it may still SEND larger packets on a negotiated MTU.',
    source: 'BleMidiConnection.MaxWrite comment + Windows BLE hardware observation',
  },
  browserWebBluetooth: {
    grade: 'unknown',
    claim: 'Whether the host Chromium exposes navigator.bluetooth with a working GATT/BlueZ '
      + 'stack is probed at runtime. The app never assumes it; USB / offline replay remain.',
    source: 'Stage 7 safety policy — no Deck verification yet',
  },
  steamOsBleHost: {
    grade: 'unknown',
    claim: 'SteamOS Gaming Mode Chromium + BlueZ pairing/bonding for an OP-Z is unverified. '
      + 'No experimental launch flags are invented in gaming-mode.sh.',
    source: 'Stage 7 safety policy — requires a real Steam Deck',
  },
  gamepadMapping: {
    grade: 'decoded',
    claim: 'Standard Gamepad API button indices and edge-triggered polling are implemented '
      + 'exactly as specified; all mapping logic is Node-testable.',
    source: 'W3C Gamepad API standard mapping + src/app/gamepadNav.ts',
  },
  steamInputInGamingMode: {
    grade: 'inferred',
    claim: 'Steam Input is expected to expose Deck controls as a standard gamepad to the '
      + 'browser in Gaming Mode; this has not been checked on hardware.',
    source: 'Steam Deck controller conventions — needs Deck verification',
  },
  gamingModeLauncher: {
    grade: 'inferred',
    claim: 'A 127.0.0.1 secure-context static server + Chromium --app/--start-fullscreen '
      + 'window + $HOME profile works on SteamOS (root FS is read-only).',
    source: 'Chromium standard flags + SteamOS filesystem conventions — needs Deck verification',
  },
};

export function stage7EvidenceLabel(key: keyof typeof STAGE7_EVIDENCE | string): string {
  const grade: EvidenceGrade = STAGE7_EVIDENCE[key]?.grade ?? 'unknown';
  return grade.toUpperCase();
}

/** Keys whose claims must stay `unknown` until someone runs a real Deck. */
export const UNVERIFIED_STAGE7_KEYS = [
  'browserWebBluetooth', 'steamOsBleHost',
] as const;
