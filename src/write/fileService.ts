/**
 * Stage 6, part 3: OP-Z normal-mode file transport (framing + session state machine).
 *
 * Reference: kmorrill/op-z-sysex docs/clean-room-file-transport.md (device-proven fw 1.2.45+).
 * Every message is F0 00 20 76 01 <id> <7-bit-packed payload> F7; multibyte fields are LE.
 * This Web edition acts as the SERVER / SENDER; the OP-Z is the client / requester.
 *
 *   $51 server -> client  serverId u16                          (advertise)
 *   $34 client -> server  clientId u16, clientStateCrc u32      (hello)
 *   $52 server -> client  serverId u16, syncActive u8           (MUST be 0 before the first $35)
 *   $35 req    -> sender  requesterId u16, fileId u32, part u16 (seed / resume cursor)
 *   $53 sender -> req     senderId u16, fileId u32, part u16, last u8, zlib part
 *   $33 client -> server  clientId u16, status u8, value u32    (progress; 127 = complete)
 *   $55 server -> client  serverId u16                          (close)
 *
 * Each $53 carries at most 200 UNCOMPRESSED file bytes, individually zlib-compressed.
 * The firmware times out a stale server after ~6 s, so heartbeats are ~1 s apart.
 *
 * Scope: framing, part assembly, manifest and the bounded session state machine are fully
 * implemented and offline-testable. Live pull/push orchestration is exposed as a PLAN (backup ->
 * write -> fresh readback -> rollback), not as an automatic device write: all Stage 6 writes are
 * DRY-RUN by default and require explicit arming + confirmation.
 */
import { build, tryParse, inflateZlib, deflateZlib } from '../protocol/opzFrame.ts';
import { u16le, u32le, w16le, w32le } from '../model/bytes.ts';
import { crc32, crc32Hex, fileIdForPath, SYNC_JOB_FILE_ID } from './crc32.ts';
import { WRITE_EVIDENCE } from './evidence.ts';

export const FILE_MSG = {
  PROGRESS: 0x33,
  CLIENT_HELLO: 0x34,
  FILE_REQUEST: 0x35,
  SERVER_ADVERTISE: 0x51,
  SYNC_STATE: 0x52,
  FILE_PART: 0x53,
  CLOSE: 0x55,
} as const;

export const MAX_PART_BYTES = 200;
export const SESSION_TIMEOUT_MS = 6000;
export const HEARTBEAT_MS = 1000;

export const SLOT_MAP_PATH = 'settings/slotConfiguration.json';
export const PLUGS_PATH = 'settings/plugs.json';
export const SYNC_JOB_PATH = 'syncjob.json';

// ---------------------------------------------------------------- frame builders / parsers

export function buildServerAdvertise(serverId: number): Uint8Array {
  const p = new Uint8Array(2); w16le(p, 0, serverId);
  return build(FILE_MSG.SERVER_ADVERTISE, p);
}

export function buildSyncState(serverId: number, syncActive: 0 | 1): Uint8Array {
  const p = new Uint8Array(3); w16le(p, 0, serverId); p[2] = syncActive;
  return build(FILE_MSG.SYNC_STATE, p);
}

export function buildClose(serverId: number): Uint8Array {
  const p = new Uint8Array(2); w16le(p, 0, serverId);
  return build(FILE_MSG.CLOSE, p);
}

export function buildClientHello(clientId: number, stateCrc: number): Uint8Array {
  const p = new Uint8Array(6); w16le(p, 0, clientId); w32le(p, 2, stateCrc);
  return build(FILE_MSG.CLIENT_HELLO, p);
}

export function parseClientHello(data: Uint8Array): { clientId: number; stateCrc: number } | null {
  const f = tryParse(data);
  if (!f || f.messageId !== FILE_MSG.CLIENT_HELLO || f.payload.length < 6) return null;
  return { clientId: u16le(f.payload, 0), stateCrc: u32le(f.payload, 2) };
}

export function buildProgress(clientId: number, status: number, value: number): Uint8Array {
  const p = new Uint8Array(7);
  w16le(p, 0, clientId); p[2] = status & 0xff; w32le(p, 3, value);
  return build(FILE_MSG.PROGRESS, p);
}

export interface ProgressInfo { clientId: number; status: number; value: number }

export function parseProgress(data: Uint8Array): ProgressInfo | null {
  const f = tryParse(data);
  if (!f || f.messageId !== FILE_MSG.PROGRESS || f.payload.length < 7) return null;
  return { clientId: u16le(f.payload, 0), status: f.payload[2], value: u32le(f.payload, 3) };
}

export function buildFileRequest(requesterId: number, fileId: number, partIndex: number): Uint8Array {
  const p = new Uint8Array(8);
  w16le(p, 0, requesterId); w32le(p, 2, fileId); w16le(p, 6, partIndex);
  return build(FILE_MSG.FILE_REQUEST, p);
}

export interface FileRequestInfo { requesterId: number; fileId: number; partIndex: number }

export function parseFileRequest(data: Uint8Array): FileRequestInfo | null {
  const f = tryParse(data);
  if (!f || f.messageId !== FILE_MSG.FILE_REQUEST || f.payload.length < 8) return null;
  return { requesterId: u16le(f.payload, 0), fileId: u32le(f.payload, 2), partIndex: u16le(f.payload, 6) };
}

export function buildFilePart(
  senderId: number, fileId: number, partIndex: number, last: boolean, compressed: Uint8Array,
): Uint8Array {
  const p = new Uint8Array(9 + compressed.length);
  w16le(p, 0, senderId); w32le(p, 2, fileId); w16le(p, 6, partIndex);
  p[8] = last ? 1 : 0;
  p.set(compressed, 9);
  return build(FILE_MSG.FILE_PART, p);
}

export interface FilePartInfo {
  senderId: number; fileId: number; partIndex: number; last: boolean; compressed: Uint8Array;
}

export function parseFilePart(data: Uint8Array): FilePartInfo | null {
  const f = tryParse(data);
  if (!f || f.messageId !== FILE_MSG.FILE_PART || f.payload.length < 9) return null;
  return {
    senderId: u16le(f.payload, 0),
    fileId: u32le(f.payload, 2),
    partIndex: u16le(f.payload, 6),
    last: f.payload[8] !== 0,
    compressed: f.payload.slice(9),
  };
}

// ---------------------------------------------------------------- parts and manifest

export interface FilePart {
  fileId: number;
  index: number;
  last: boolean;
  data: Uint8Array;
  compressed: Uint8Array;
}

/** Split file content into <=200-byte slices, each independently zlib-compressed. */
export async function makeFileParts(fileId: number, content: Uint8Array): Promise<FilePart[]> {
  const count = Math.max(1, Math.ceil(content.length / MAX_PART_BYTES));
  const parts: FilePart[] = [];
  for (let i = 0; i < count; i++) {
    const data = content.subarray(i * MAX_PART_BYTES, Math.min(content.length, (i + 1) * MAX_PART_BYTES));
    parts.push({
      fileId, index: i, last: i === count - 1, data: data.slice(),
      compressed: await deflateZlib(data),
    });
  }
  return parts;
}

/** Reassemble parts in index order, tolerating duplicate / out-of-order retransmissions. */
export async function reassembleFileParts(parts: readonly FilePart[]): Promise<Uint8Array> {
  const byIndex = new Map<number, FilePart>();
  for (const p of parts) if (!byIndex.has(p.index)) byIndex.set(p.index, p);
  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  for (const i of indices) {
    const part = byIndex.get(i)!;
    if (part.data.length > MAX_PART_BYTES) throw new Error(`part ${i} exceeds ${MAX_PART_BYTES} bytes`);
    chunks.push(await inflateZlib(part.compressed, MAX_PART_BYTES));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export interface SyncJobEntry {
  fileId: number;
  path: string;
  crc: number;
  size: number;
  operation?: 'write' | 'import' | 'remove';
}
export interface SyncJob { files: SyncJobEntry[] }

/** `syncjob.json`: the OP-Z skips a target whose current content CRC already matches. */
export function buildSyncJob(targets: readonly { path: string; content: Uint8Array }[]): SyncJob {
  return {
    files: targets.map((t) => ({
      fileId: fileIdForPath(t.path),
      path: t.path,
      crc: crc32(t.content),
      size: t.content.length,
    })),
  };
}

export function syncJobBytes(job: SyncJob): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(job));
}

// ---------------------------------------------------------------- bounded session

export type FileSessionPhase =
  | 'idle' | 'advertised' | 'handshaked' | 'syncing' | 'streaming' | 'complete' | 'closed';

export interface FileServiceSessionOptions {
  serverId: number;
  /** fileId -> ordered parts the host is prepared to serve. */
  files: ReadonlyMap<number, readonly FilePart[]>;
}

/**
 * Pure state machine. `receive()` returns the frames the host should send in response.
 * Two hardware-proven guards are enforced:
 *   1. $52 with sync-active=0 must be sent before the first $35 is honored.
 *   2. Progress 127 alone is NOT completion; an isLast frame must have gone out for every file.
 */
export class FileServiceSession {
  readonly serverId: number;
  private readonly files: ReadonlyMap<number, readonly FilePart[]>;
  private _phase: FileSessionPhase = 'idle';
  private _clientId: number | null = null;
  private _stateCrc = 0;
  private _syncStateSent = false;
  private _orderViolation = false;
  private _progress: ProgressInfo | null = null;
  private readonly served = new Map<number, Set<number>>();
  private readonly requestedCursors: { fileId: number; partIndex: number }[] = [];

  constructor(options: FileServiceSessionOptions) {
    this.serverId = options.serverId;
    this.files = options.files;
  }

  get phase(): FileSessionPhase { return this._phase; }
  get clientId(): number | null { return this._clientId; }
  get stateCrc(): number { return this._stateCrc; }
  get syncStateSent(): boolean { return this._syncStateSent; }
  get orderViolation(): boolean { return this._orderViolation; }
  get progress(): ProgressInfo | null { return this._progress; }
  get requestedCursorsView(): readonly { fileId: number; partIndex: number }[] { return this.requestedCursors; }
  get servedPartCount(): number {
    let n = 0;
    for (const set of this.served.values()) n += set.size;
    return n;
  }

  start(): Uint8Array[] {
    this._phase = 'advertised';
    return [buildServerAdvertise(this.serverId)];
  }

  /** Handle one frame from the OP-Z and return the frames to send back. */
  receive(data: Uint8Array): Uint8Array[] {
    const hello = parseClientHello(data);
    if (hello) {
      this._clientId = hello.clientId;
      this._stateCrc = hello.stateCrc;
      this._phase = 'handshaked';
      // Hardware-proven ordering: send $52 sync-active=0 BEFORE serving any $35.
      this._syncStateSent = true;
      this._phase = 'syncing';
      return [buildSyncState(this.serverId, 0)];
    }

    const progress = parseProgress(data);
    if (progress) {
      this._progress = progress;
      if (progress.status === 127 && this.allLastPartsSent() && this._phase !== 'closed') {
        this._phase = 'complete';
      }
      return [];
    }

    const request = parseFileRequest(data);
    if (request) {
      this.requestedCursors.push({ fileId: request.fileId, partIndex: request.partIndex });
      if (!this._syncStateSent) {
        this._orderViolation = true;
        return []; // refuse to stream until the sync-active=0 frame has gone out
      }
      const parts = this.files.get(request.fileId);
      if (!parts || parts.length === 0) return [];
      this._phase = 'streaming';
      const out: Uint8Array[] = [];
      let seen = this.served.get(request.fileId);
      if (!seen) { seen = new Set<number>(); this.served.set(request.fileId, seen); }
      // A $35 is a resume cursor: accept repeated or earlier indices and replay from there.
      for (const part of parts) {
        if (part.index < request.partIndex) continue;
        out.push(buildFilePart(this.serverId, part.fileId, part.index, part.last, part.compressed));
        seen.add(part.index);
      }
      if (this.allLastPartsSent() && this._progress?.status === 127) this._phase = 'complete';
      return out;
    }
    return [];
  }

  /** A final part must have been emitted for every hosted file. */
  allLastPartsSent(): boolean {
    if (this.files.size === 0) return false;
    for (const [fileId, parts] of this.files) {
      const seen = this.served.get(fileId);
      const last = parts.find((p) => p.last);
      if (!last || !seen || !seen.has(last.index)) return false;
    }
    return true;
  }

  close(): Uint8Array[] {
    this._phase = 'closed';
    return [buildClose(this.serverId)];
  }
}

// ---------------------------------------------------------------- transaction plan

export interface FileServiceStep {
  order: number;
  kind: 'backup' | 'write' | 'readback' | 'rollback' | 'verify';
  detail: string;
  crc?: string;
  parts?: number;
}

export interface FileServicePlan {
  evidence: typeof WRITE_EVIDENCE.fileTransport.grade;
  targetPath: string;
  targetFileId: number;
  slotMapCrc: string;
  targetCrc: string;
  job: SyncJob;
  jobFileId: number;
  jobParts: number;
  targetParts: number;
  steps: FileServiceStep[];
}

/**
 * Build the reversible sequence described by clean-room-file-transport.md. It is a PLAN, not an
 * automatic device write: the shell shows it in DRY-RUN and only executes it after arming.
 */
export async function buildFileServicePlan(options: {
  slotMap: Uint8Array;
  targetPath: string;
  targetContent: Uint8Array;
}): Promise<FileServicePlan> {
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
      { order: 1, kind: 'backup', detail: `fresh pull of ${SLOT_MAP_PATH}; journal CRC ${slotCrc}`, crc: slotCrc },
      { order: 2, kind: 'backup', detail: `fresh pull of ${PLUGS_PATH}; journal CRC` },
      { order: 3, kind: 'write', detail: 'upload syncjob.json manifest, then every target part',
        parts: jobParts.length + targetParts.length },
      { order: 4, kind: 'readback', detail: `reconnect and fresh pull ${options.targetPath}; require CRC ${targetCrc}`,
        crc: targetCrc },
      { order: 5, kind: 'verify', detail: 'second independent pull of the slot map; require the requested assignment' },
      { order: 6, kind: 'rollback', detail: `on ANY mismatch restore the original slot map (CRC ${slotCrc}) `
        + 'and require another clean readback', crc: slotCrc },
    ],
  };
}
