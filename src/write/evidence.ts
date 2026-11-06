/**
 * Evidence grades for every Stage 6 write path.
 *
 * Following kmorrill/op-z-sysex docs/coverage.md, we never present a guess as a hardware fact:
 *   device-proven > decoded > observed > inferred > unknown.
 * `unknown` means deliberately NOT implemented — the code must not guess a frame format.
 */
import type { EvidenceGrade } from '../model/bankParams.ts';
export type { EvidenceGrade } from '../model/bankParams.ts';

export interface EvidenceRecord {
  grade: EvidenceGrade;
  claim: string;
  source: string;
}

export const WRITE_EVIDENCE: Record<string, EvidenceRecord> = {
  midiConfigRead: {
    grade: 'device-proven',
    claim: 'Empty $0F requests the 292-byte MIDI config; $10 carries a zlib stream.',
    source: 'kmorrill/op-z-sysex docs/midi-configuration-sysex.md, fw 1.2.45+',
  },
  midiConfigWrite: {
    grade: 'device-proven',
    claim: 'A compressed 292-byte $10 replaces the config; device reports it back, an explicit '
      + '$0F gives an independent fresh read. Reversible one-byte CC proof with exact rollback.',
    source: 'kmorrill/op-z-sysex docs/midi-configuration-sysex.md',
  },
  midiConfigReserved: {
    grade: 'decoded',
    claim: 'Bytes 289..291 are padding/reserved and must be preserved from the fresh baseline.',
    source: 'OPZ.MidiConfig StructLayout(Pack=1) + official app importer',
  },
  patternLayout: {
    grade: 'device-proven',
    claim: '16 x 21392-byte patterns; 54-byte step records; BANK_PARAM order for locks/sound.',
    source: 'kmorrill/op-z-sysex docs/typed-pattern-editing.md, 336 typed mutations, exact readback',
  },
  patternUpload: {
    grade: 'observed',
    claim: 'This project uses $09 chunks + $0A final chunk with per-packet $0B acks; the '
      + 'reference calls out $0B flow control whose upload-side semantics we have not proven.',
    source: 'OPB.Core/OpzSession.cs port + kmorrill/op-z-sysex typed-pattern-editing.md',
  },
  bankUploadFlowControl: {
    grade: 'unknown',
    claim: 'Upload-side $0B flow control is not implemented. Pattern writes therefore stay '
      + 'DRY-RUN by default and must be hardware-verified before arming.',
    source: 'kmorrill/op-z-sysex docs/typed-pattern-editing.md',
  },
  fileTransport: {
    grade: 'device-proven',
    claim: '$51/$34/$52/$35/$53/$33/$55 session, <=200 uncompressed bytes per zlib part, '
      + 'crc32(lowercase(path)) file IDs, syncjob.json manifest, fresh pull after push.',
    source: 'kmorrill/op-z-sysex docs/clean-room-file-transport.md, fw 1.2.45+',
  },
  fileTransportSessionOrder: {
    grade: 'device-proven',
    claim: 'After the OP-Z replies with $34, send $52 with sync-active=0 BEFORE the first $35.',
    source: 'kmorrill/op-z-sysex clean-room-file-transport.md "Transport integration"',
  },
  liveSoundMirror: {
    grade: 'observed',
    claim: 'The pre-Stage-6 $0E <-> $0A sound mirror assumes an identity byte order. Kept for '
      + 'read-only rendering only; Stage 6 writes remap explicitly via model/bankParams.ts.',
    source: 'This project, 31-frame Web MIDI capture',
  },
  hostWritePermission: {
    grade: 'unknown',
    claim: 'Whether a browser Web MIDI host may safely write MIDI config / bank / files on any '
      + 'given firmware is not proven here. All writes require explicit arming and confirmation.',
    source: 'Stage 6 safety policy',
  },
};

export function evidenceLabel(grade: EvidenceGrade): string {
  return grade.toUpperCase();
}
