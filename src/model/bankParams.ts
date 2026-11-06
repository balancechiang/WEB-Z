/**
 * Two DIFFERENT 18-byte parameter orders exist in OP-Z state.
 *
 * Mixing them silently corrupts pattern writes: a "portamento" edit would land on the FX1 send
 * byte, a "filter" lock would land on resonance, and so on. Keep the two address spaces separate.
 *
 *   1. LIVE order  -> `SOUND_PARAM` in ../render/displays.ts.
 *      Used by `session.currentSound[track]`, which is what every
 *      Track/Mixer/Steps screen renders. Portamento is byte 6, FX1 send is 7, filter is 9.
 *      This is the existing Web view order, normalized at the session boundary.
 *
 *   2. BANK order  -> `BANK_PARAM` below.
 *      Used by $0E, the persistent 18 sound bytes at 21056 + track*18, and the parameter-lock
 *      value/enable arrays in each 54-byte step record. Portamento is byte 12, FX1 send is 6,
 *      filter is 8. Evidence: device-proven in kmorrill/op-z-sysex
 *      `docs/typed-pattern-editing.md` (firmware 1.2.45+): a physical Lead step-1 filter-lock
 *      diff puts the record at 11552, filter value byte 8 at 11578 and its enable byte at 11596.
 *
 * This module has NO dependency on the render layer so the model stays usable from Node tests
 * and from the write-transaction layer.
 */
export const BANK_PARAM = {
  P1: 0, P2: 1, Attack: 2, Decay: 3, Sustain: 4, Release: 5,
  Fx1Send: 6, Fx2Send: 7, Filter: 8, Resonance: 9, Pan: 10, Level: 11,
  Portamento: 12, LfoDepth: 13, LfoSpeed: 14, LfoDest: 15, LfoShape: 16, NoteStyle: 17,
} as const;
export type BankParamName = keyof typeof BANK_PARAM;

export const BANK_PARAM_COUNT = 18;

/** UI labels in BANK order. Drum-specific aliases (START/HOLD/DECAY) are applied by the screen. */
export const BANK_PARAM_NAMES: readonly string[] = [
  'P1', 'P2', 'ATTACK', 'DECAY', 'SUSTAIN', 'RELEASE',
  'FX 1', 'FX 2', 'FILTER', 'RES', 'PAN', 'LEVEL',
  'PORTAMENTO', 'LFO DEPTH', 'LFO RATE', 'LFO DEST', 'LFO SHAPE', 'NOTE STYLE',
];

/**
 * live index -> bank index. Both are permutations of 0..17; only bytes 6..12 differ.
 * Derived from the two tables above, listed explicitly so a future edit cannot drift.
 */
export const LIVE_TO_BANK: readonly number[] = [
  0, 1, 2, 3, 4, 5, 12, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17,
];

/** bank index -> live index (exact inverse of LIVE_TO_BANK). */
export const BANK_TO_LIVE: readonly number[] = Array.from(
  { length: BANK_PARAM_COUNT },
  (_, bank) => LIVE_TO_BANK.indexOf(bank),
);

export function liveToBankParam(live: number): number {
  return LIVE_TO_BANK[live] ?? live;
}

export function bankToLiveParam(bank: number): number {
  return BANK_TO_LIVE[bank] ?? bank;
}

/** Reorder an 18-byte live sound record into persistent bank order. */
export function remapLiveSoundToBank(live: Uint8Array): Uint8Array {
  const out = new Uint8Array(BANK_PARAM_COUNT);
  for (let i = 0; i < BANK_PARAM_COUNT; i++) out[LIVE_TO_BANK[i]] = live[i] ?? 0;
  return out;
}

/** Reorder an 18-byte persistent bank record into live order. */
export function remapBankSoundToLive(bank: Uint8Array): Uint8Array {
  const out = new Uint8Array(BANK_PARAM_COUNT);
  for (let i = 0; i < BANK_PARAM_COUNT; i++) out[BANK_TO_LIVE[i]] = bank[i] ?? 0;
  return out;
}

/**
 * Evidence grades used across Stage 6. `device-proven` means a reversible hardware experiment;
 * `decoded` means static analysis of vendor code; `observed` means a real capture without a write
 * proof; `inferred` means a reasoned guess; `unknown` means deliberately not implemented.
 */
export type EvidenceGrade = 'device-proven' | 'decoded' | 'observed' | 'inferred' | 'unknown';

export const BANK_PARAM_EVIDENCE: Record<string, { grade: EvidenceGrade; note: string }> = {
  liveOrder: {
    grade: 'device-proven',
    note: '31-frame Web MIDI capture + TrackScreen.cs; SOUND_PARAM in render/displays.ts',
  },
  bankOrder: {
    grade: 'device-proven',
    note: 'kmorrill/op-z-sysex typed-pattern-editing.md, fw 1.2.45+ Lead step-1 filter-lock diff',
  },
  legacyMirror: {
    grade: 'observed',
    note: 'The pre-Stage-6 $0E <-> $0A sound mirror assumes an identity mapping. Kept unchanged '
      + 'because it is proven only for read-only rendering; needs a reversible hardware re-check '
      + 'before it is used for writes. Stage 6 write paths always remap explicitly.',
  },
  bankUploadFlowControl: {
    grade: 'unknown',
    note: 'The reference mentions $0B flow control for uploads. This project acknowledges $0B '
      + 'on receive and uses $09/$0A with per-packet $0B acks; the exact upload-side flow control '
      + 'semantics are not implemented and must not be guessed.',
  },
};
