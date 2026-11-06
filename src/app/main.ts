/**
 * Application entry point: builds the session, connects Web MIDI (or falls back to an
 * offline capture replay), and binds the control bar + keyboard to the CanvasView.
 *
 * Stage 5 adds a SysEx timeline: the offline capture becomes a scrubbable/replayable
 * frame sequence, live SysEx can be recorded, and either source can be exported as
 * `./OP-B --replay` text or structured JSON. Replay uses its own session so the live
 * device stream is never mutated; "LIVE" returns to it.
 *
 * Stage 6 adds the guarded write editor (MIDI config / pattern bank / file service).
 * It stays OFF and DRY RUN by default. ARM + COMMIT are two explicit gates, both refused
 * in offline mode or when the baseline is synthetic (the shipped 31-frame capture has no
 * $10 config and no $0A final bank packet). Every real write goes through WriteTransaction:
 * fresh baseline guard, complete readback, exact rollback, structured audit.
 *
 * Stage 7 adds a second LIVE transport: BLE-MIDI over Web Bluetooth. Web Bluetooth's
 * requestDevice() requires a user gesture, so BLE is a manual BLE CONNECT button and never
 * part of boot(). A GamepadNavigator makes the 16 screens usable in SteamOS Gaming Mode
 * with no keyboard — deliberately with NO binding for ARM / COMMIT / ROLLBACK.
 *
 * Stage 8.1 fixes a real Steam Deck blocker: Chrome records a Web MIDI SysEx denial per
 * origin, so a gesture-less requestMIDIAccess({sysex:true}) at boot permanently pins the
 * site to "denied" and there was no button to recover. boot() now only auto-connects when
 * the permission is already 'granted' (the desktop PC case); on 'prompt' / 'denied' /
 * 'unknown' it loads the offline timeline and waits for the real user gesture on the
 * CONNECT OP-Z button. Offline replay remains the last resort.
 *
 * Run from a static server rooted at the `web/` folder (so `./captures/...` resolves):
 *   npm run serve     # esbuild --servedir=. --serve=8080
 *   npx serve .       # or: python3 -m http.server 8080
 * then open the page on https/localhost in Chrome/Edge (Web MIDI needs a secure context).
 * The app is installable as a PWA (manifest.webmanifest + service-worker.js) and works offline.
 */
import { OpzSession } from '../session/opzSession.ts';
import { CanvasView } from './canvasView.ts';
import { openWebMidi } from '../midi/midiTransport.ts';
import { openDeckMidi } from '../midi/deckMidi.ts';
import { openBleMidi, bleCapability, type BleMidiTransport } from '../midi/bleMidiTransport.ts';
import { stage7EvidenceLabel } from '../midi/transportEvidence.ts';
import { GamepadNavigator, type GamepadAction } from './gamepadNav.ts';
import { SCREEN_ORDER, type ScreenName } from '../render/screens/index.ts';
import {
  Recorder, TimelinePlayer, loadTimelineText, toReplayText, toTimelineJson, frameIdLabel,
  type TimelineCapture, type PlayerState,
} from './timeline.ts';
import { MIDI_CONFIG_SIZE } from '../model/globalData.ts';
import { PATTERN_BANK_SIZE } from '../model/patternBank.ts';
import type { WriteUiState } from '../render/writeUi.ts';
import { createWebMidiWritePort, type WebMidiWritePort } from '../write/webMidiPort.ts';
import {
  WriteController, WRITE_EDITORS,
  type WriteEditorKind, type WriteBaseline, type WriteStatus,
} from './writeController.ts';

const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
const sourceEl = document.getElementById('source');
const statusEl = document.getElementById('status');
const playBtn = document.getElementById('play') as HTMLButtonElement | null;
const autoBtn = document.getElementById('auto') as HTMLButtonElement | null;
// Stage 8.1: the explicit user gesture for USB Web MIDI SysEx.
const liveConnectBtn = document.getElementById('live-connect') as HTMLButtonElement | null;
const screenBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-screen]'));
const captureUrl = './captures/demo.txt';

// Stage 5 timeline controls.
const tlPlayBtn = document.getElementById('tl-play') as HTMLButtonElement | null;
const tlLoopBtn = document.getElementById('tl-loop') as HTMLButtonElement | null;
const tlRecBtn = document.getElementById('tl-rec') as HTMLButtonElement | null;
const tlLiveBtn = document.getElementById('tl-live') as HTMLButtonElement | null;
const tlSeek = document.getElementById('tl-seek') as HTMLInputElement | null;
const tlSpeed = document.getElementById('tl-speed') as HTMLSelectElement | null;
const tlInfo = document.getElementById('tl-info');
const tlFile = document.getElementById('tl-file') as HTMLInputElement | null;

// Stage 6 write editor controls.
const wrToggle = document.getElementById('wr-toggle') as HTMLButtonElement | null;
const wrEditor = document.getElementById('wr-editor') as HTMLSelectElement | null;
const wrMode = document.getElementById('wr-mode');
const wrEvidence = document.getElementById('wr-evidence');
const wrValue = document.getElementById('wr-value') as HTMLInputElement | null;
const wrStage = document.getElementById('wr-stage') as HTMLButtonElement | null;
const wrReset = document.getElementById('wr-reset') as HTMLButtonElement | null;
const wrRefresh = document.getElementById('wr-refresh') as HTMLButtonElement | null;
const wrArm = document.getElementById('wr-arm') as HTMLButtonElement | null;
const wrCommit = document.getElementById('wr-commit') as HTMLButtonElement | null;
const wrRollback = document.getElementById('wr-rollback') as HTMLButtonElement | null;
const wrBackup = document.getElementById('wr-backup') as HTMLButtonElement | null;
const wrAudit = document.getElementById('wr-audit') as HTMLButtonElement | null;
const wrInfo = document.getElementById('wr-info');

// Stage 7: BLE-MIDI / Gaming Mode controls.
const bleBtn = document.getElementById('ble-connect') as HTMLButtonElement | null;
const bleStatus = document.getElementById('ble-status');
const padStatus = document.getElementById('pad-status');

if (!canvas) throw new Error('#screen canvas not found');

let session = new OpzSession();
let view: CanvasView | null = null;
let liveSession: OpzSession | null = null;
let liveConnecting = false;
let capture: TimelineCapture | null = null;
let player: TimelinePlayer | null = null;
let writeUi: WriteUiState | null = null;
let lastWriteStatus: WriteStatus | null = null;
let lastWriteEditor: WriteEditorKind | null = null;
const recorder = new Recorder();

// Stage 7 state. `usbSession` lets a BLE disconnect restore the USB live session instead of
// silently dropping to the offline capture. `bleTransport` is null unless BLE is connected.
let usbSession: OpzSession | null = null;
let bleTransport: BleMidiTransport | null = null;
let bleBusy = false;
/** Assigned once the write controller exists; attach() runs before that. */
let gamepadTick: (() => void) | null = null;
const batteryLabel = document.getElementById('device-battery');
const transportLabel = document.getElementById('device-transport');
const immersiveToggle = document.getElementById('immersive-toggle');
const deviceMenu = document.getElementById('device-menu');
const deviceMenuToggle = document.getElementById('device-menu-toggle');
let immersive = false;
let squareHeld = false;
let menuOpen = false;
function updateDeviceBar(): void {
  const connected = liveSession === session && session.isConnected;
  const battery = connected
    ? session.messageCounts.has(0x04) ? `▣ ${session.level.battery}%` : '▣ —%'
    : 'OP-Z NOT CONNECTED';
  const transport = `${view?.isPlaying() ? '▶' : '■'} ${session.activePattern + 1}`;
  if (batteryLabel && batteryLabel.textContent !== battery) batteryLabel.textContent = battery;
  if (transportLabel && transportLabel.textContent !== transport) transportLabel.textContent = transport;
  const held = connected && Boolean(view?.autoRoute) && session.ui.screen;
  if (held !== squareHeld) {
    squareHeld = held;
    setDeviceMenu(held);
  }
}

function setDeviceMenu(open: boolean): void {
  menuOpen = open;
  if (deviceMenu) deviceMenu.hidden = !open;
  deviceMenuToggle?.setAttribute('aria-expanded', String(open));
}

function setImmersive(on: boolean): void {
  immersive = on;
  document.body.classList.toggle('immersive', on);
  view?.resize();
  if (immersiveToggle) immersiveToggle.textContent = on ? 'SHOW DEBUG' : 'FULL SCREEN';
  immersiveToggle?.setAttribute('aria-pressed', String(on));
}

immersiveToggle?.addEventListener('click', () => {
  setImmersive(!immersive);
  if (immersive) void document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && immersive) setImmersive(false);
});
deviceMenuToggle?.addEventListener('click', () => setDeviceMenu(!menuOpen));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-device-page]')) {
  button.addEventListener('click', () => {
    const page = button.dataset.devicePage;
    if (page === 'follow') view?.setAutoRoute(true);
    else if (page && SCREEN_ORDER.includes(page as ScreenName)) view?.navigateTo(page as ScreenName);
    setDeviceMenu(false);
  });
}

function attach(next: OpzSession): void {
  const auto = view?.autoRoute ?? false;
  view?.stop();
  session = next;
  view = new CanvasView(canvas!, session);
  // Stage 6: attach() is called on every timeline seek, so restore the write editor state.
  view.writeState = writeUi;
  view.onScreenChange = updateScreenButtons;
  view.onPlayingChange = updatePlayLabel;
  view.onAutoRouteChange = updateAutoButton;
  view.onTick = () => { player?.tick(); gamepadTick?.(); updateDeviceBar(); };
  view.setAutoRoute(auto);
  view.start();
  updateScreenButtons(view.currentScreen);
  updatePlayLabel(view.isPlaying());
  updateAutoButton(view.autoRoute);
}

function updateScreenButtons(name: ScreenName): void {
  for (const b of screenBtns) b.classList.toggle('active', b.dataset.screen === name);
}
function updatePlayLabel(playing: boolean): void {
  if (playBtn) playBtn.textContent = playing ? '■ Stop' : '▶ Play';
  if (statusEl) statusEl.textContent = playing ? 'playing' : 'stopped';
}
function updateAutoButton(on: boolean): void {
  if (autoBtn) autoBtn.classList.toggle('active', on);
}
function setSource(text: string): void { if (sourceEl) sourceEl.textContent = text; }

function updateTimelineUi(state: PlayerState | null): void {
  if (!tlInfo) return;
  if (!state || !capture) {
    tlInfo.textContent = capture ? `${capture.frames.length} frames` : 'no capture';
    return;
  }
  if (tlSeek) {
    tlSeek.max = String(state.frameCount);
    tlSeek.value = String(state.cursor);
  }
  if (tlPlayBtn) {
    tlPlayBtn.textContent = state.playing ? '❚❚ 暂停' : '▶ 回放';
    tlPlayBtn.classList.toggle('active', state.playing);
  }
  tlLoopBtn?.classList.toggle('active', state.loop);
  const index = state.frameCount ? Math.min(state.cursor, state.frameCount) - 1 : -1;
  const label = index >= 0 && capture.frames[index] ? frameIdLabel(capture.frames[index].data) : '--';
  tlInfo.textContent =
    `${state.cursor}/${state.frameCount} · ${Math.round(state.positionMs)}/${Math.round(state.durationMs)} ms · ${label}`;
}

function updateRecUi(): void {
  if (!tlRecBtn) return;
  tlRecBtn.classList.toggle('active', recorder.recording);
  tlRecBtn.textContent = recorder.recording ? '■ 停止' : '● 录制';
}

function updateLiveButton(): void {
  if (tlLiveBtn) tlLiveBtn.disabled = liveSession == null;
  updateLiveConnectButton();
}

/**
 * Chrome persists a Web MIDI SysEx denial per origin. Query without requesting:
 * a speculative requestMIDIAccess() at boot would pin the site to "denied" and
 * there would be no way back except site settings.
 */
async function midiPermissionState(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  try {
    const perms = (navigator as unknown as {
      permissions?: { query?: (descriptor: unknown) => Promise<{ state: string }> };
    }).permissions;
    if (typeof perms?.query !== 'function') return 'unknown';
    const result = await perms.query({ name: 'midi', sysex: true });
    const state = result?.state;
    return state === 'granted' || state === 'prompt' || state === 'denied' ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

function updateLiveConnectButton(): void {
  if (!liveConnectBtn) return;
  const connected = liveSession !== null;
  liveConnectBtn.disabled = liveConnecting || connected;
  liveConnectBtn.textContent = liveConnecting
    ? 'CONNECTING…'
    : connected ? 'USB LIVE' : 'CONNECT OP-Z';
  liveConnectBtn.classList.toggle('active', connected);
}

/**
 * USB LIVE entry point. Called only from a trusted user gesture, or from boot()
 * when the permission is already 'granted'. It is NEVER called speculatively.
 */
async function connectLive(): Promise<void> {
  if (liveSession || liveConnecting) return;
  liveConnecting = true;
  updateLiveConnectButton();
  setSource('CONNECTING · 请在浏览器弹窗里允许 MIDI / SysEx…');
  try {
    const deckBridge = new URLSearchParams(location.search).get('deck-midi') === '1';
    const transport = await (deckBridge ? openDeckMidi() : openWebMidi());
    // A boot-time offline replay may still be ticking; stop it before attaching LIVE.
    player?.pause();
    const live = new OpzSession({ transport });
    // Tap the live SysEx stream for recording without changing session behaviour.
    const upstream = transport.onSysex;
    transport.onSysex = (data) => {
      recorder.record(data);
      upstream?.(data);
    };
    liveSession = live;
    usbSession = live; // Stage 7: restore this session if a BLE link is later disconnected.
    if (deckBridge) transport.onStateChange = () => {
      live.dispose();
      if (usbSession === live) usbSession = null;
      if (liveSession !== live) return;
      liveSession = null;
      updateLiveConnectButton();
      setSource('OFFLINE · Deck MIDI bridge disconnected · click CONNECT OP-Z to retry');
    };
    attach(live);
    view?.setAutoRoute(true);
    updateLiveButton();
    setSource(`LIVE · ${transport.inputName} → ${transport.outputName}`);
    live.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSource(`OFFLINE · ${msg}${capture ? ` · ${capture.frames.length} 帧时间轴仍可回放` : ''}`);
    if (liveConnectBtn) {
      liveConnectBtn.title = '权限被拒：地址栏锁形图标 → 网站设置 → MIDI 设备 → 允许，然后刷新页面再点 CONNECT OP-Z';
    }
  } finally {
    liveConnecting = false;
    updateLiveConnectButton();
  }
}

// ---- control bar ----
if (playBtn) playBtn.addEventListener('click', () => view?.togglePlay());
function toggleAutoRoute(): void {
  if (view) view.setAutoRoute(!view.autoRoute);
}
if (autoBtn) autoBtn.addEventListener('click', toggleAutoRoute);
liveConnectBtn?.addEventListener('click', () => { void connectLive(); });
for (const b of screenBtns) {
  b.addEventListener('click', () => {
    const name = b.dataset.screen as ScreenName;
    view?.navigateTo(name);
  });
}

// ---- Stage 5: timeline ----

/**
 * Installs a capture as the active timeline. Seeking (including the initial jump
 * to the last frame) rebuilds a fresh OpzSession and replays frames [0, upTo),
 * because the state machine cannot be rewound in place.
 */
async function installTimeline(cap: TimelineCapture, upTo: number): Promise<void> {
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
    onEnd: () => setSource(`TIMELINE · 回放结束 (${cap.frames.length} 帧 · ${cap.source})`),
  });
  await player.seek(Math.min(upTo, cap.frames.length));
  updateTimelineUi(player.state);
}

async function loadCaptureText(text: string, source: string): Promise<void> {
  const cap = loadTimelineText(text, source);
  if (!cap.frames.length) {
    setSource(`OFFLINE · 捕获文件无有效帧 (${source})`);
    return;
  }
  await installTimeline(cap, cap.frames.length);
  setSource(`OFFLINE · ${cap.frames.length} 帧时间轴 (${source}) · 点 ▶ 回放`);
}

async function toggleReplay(): Promise<void> {
  if (!player || !capture || !capture.frames.length) return;
  if (player.playing) {
    player.pause();
    return;
  }
  if (player.cursor >= capture.frames.length) await player.seek(0);
  player.play();
  setSource(`TIMELINE · 回放中 ${capture.source}`);
}

async function stepFrame(delta: number): Promise<void> {
  if (!player) return;
  await player.step(delta);
  setSource(`TIMELINE · 单步 ${player.cursor}/${capture?.frames.length ?? 0}`);
}

function toggleRecording(): void {
  if (recorder.recording) {
    const frames = recorder.stop();
    updateRecUi();
    if (!frames.length) {
      setSource('REC · 没有录到 SysEx 帧（需 LIVE 连接）');
      return;
    }
    const cap: TimelineCapture = { frames, source: `REC ${frames.length} frames` };
    void installTimeline(cap, frames.length).then(() => {
      setSource(`REC · ${frames.length} 帧 / ${frames[frames.length - 1].tMs} ms — 可回放或导出`);
    });
  } else {
    recorder.start();
    updateRecUi();
    setSource('REC · 正在录制实时 SysEx 帧…');
  }
}

function returnToLive(): void {
  player?.pause();
  if (!liveSession) return;
  attach(liveSession);
  setSource(`LIVE · ${liveSession.portName ?? 'OP-Z'}`);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function download(filename: string, text: string, mime: string): void {
  // Guarded so a non-browser host (e.g. the Node DOM-stub smoke test) cannot crash the app.
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    setSource(`EXPORT unavailable here · ${err instanceof Error ? err.message : String(err)}`);
  }
}

function exportText(): void {
  if (!capture) return;
  download(`opb-frames-${stamp()}.txt`, toReplayText(capture), 'text/plain;charset=utf-8');
  setSource(`EXPORT · ${capture.frames.length} 帧 → --replay 兼容文本`);
}

function exportJson(): void {
  if (!capture) return;
  download(`opb-timeline-${stamp()}.json`, JSON.stringify(toTimelineJson(capture), null, 2) + '\n',
    'application/json;charset=utf-8');
  setSource(`EXPORT · ${capture.frames.length} 帧 → 时间轴 JSON`);
}

async function importFile(file: File): Promise<void> {
  await loadCaptureText(await file.text(), file.name);
}

document.getElementById('tl-rewind')?.addEventListener('click', () => { void player?.seek(0); });
document.getElementById('tl-step-back')?.addEventListener('click', () => { void stepFrame(-1); });
tlPlayBtn?.addEventListener('click', () => { void toggleReplay(); });
document.getElementById('tl-step')?.addEventListener('click', () => { void stepFrame(1); });
tlLoopBtn?.addEventListener('click', () => { if (player) player.setLoop(!player.loop); });
tlRecBtn?.addEventListener('click', toggleRecording);
tlLiveBtn?.addEventListener('click', returnToLive);
document.getElementById('tl-export')?.addEventListener('click', exportText);
document.getElementById('tl-export-json')?.addEventListener('click', exportJson);
document.getElementById('tl-import')?.addEventListener('click', () => tlFile?.click());
tlFile?.addEventListener('change', () => {
  const file = tlFile.files?.[0];
  if (file) void importFile(file);
});
tlSeek?.addEventListener('change', () => { void player?.seek(Number(tlSeek.value)); });
tlSpeed?.addEventListener('change', () => { player?.setSpeed(Number(tlSpeed.value) || 1); });

// ---- Stage 6: guarded write editor ----

/** Screen whose renderer draws the full write overlay for each editor. */
const WRITE_EDITOR_SCREEN: Record<WriteEditorKind, ScreenName> = {
  'midi-config': 'midisetup',
  'pattern-bank': 'steps',
  'file-service': 'configurator',
};

/**
 * The shipped 31-frame offline capture contains NO $10 MIDI config and NO $0A final pattern
 * packet (confirmed: bank.present=false, pendingPatternBytes=178, midiConfig=null). So offline
 * baselines are SYNTHETIC, deterministic and clearly labelled; ARM / COMMIT stay disabled.
 */
const SYNTH_NOTE = 'offline capture: no $10 config / no $0A final bank packet';

function syntheticMidiConfig(): Uint8Array {
  const b = new Uint8Array(MIDI_CONFIG_SIZE);
  for (let t = 0; t < 16; t++) {
    b[t] = 1;
    b[16 + t] = t & 0x0f;
    for (let p = 0; p < 16; p++) b[32 + t * 16 + p] = (t * 16 + p) & 0x7f;
  }
  b[288] = 0x06;              // clock in + clock out
  // 289..291 are reserved padding and MUST stay untouched.
  return b;
}

function syntheticBaseline(editor: WriteEditorKind): WriteBaseline {
  const bytes = editor === 'pattern-bank'
    ? new Uint8Array(PATTERN_BANK_SIZE)
    : editor === 'file-service'
      ? new TextEncoder().encode('{"version":1,"slots":[]}')
      : syntheticMidiConfig();
  return { bytes, origin: 'synthetic', label: SYNTH_NOTE };
}

/** Fresh baseline from the device when possible; otherwise a labelled synthetic snapshot. */
async function readWriteBaseline(editor: WriteEditorKind): Promise<WriteBaseline> {
  const live = liveSession;
  if (!live?.transport) return syntheticBaseline(editor);

  if (editor === 'midi-config') {
    // Independent read: two $0F requests whose $10 answers must agree (drains the echo).
    const probe = createWebMidiWritePort(live.transport, {
      kind: 'midi-config', timeoutMs: 2500, onLog: setSource,
    });
    let raw: Uint8Array | null = null;
    try { raw = await probe.readback(); } finally { probe.dispose(); }
    if (raw && raw.length === MIDI_CONFIG_SIZE) {
      return { bytes: raw.slice(), origin: 'device', label: 'fresh $0F → $10 (2 identical reads)' };
    }
    if (live.midiConfig) {
      return {
        bytes: live.midiConfig.data.slice(), origin: 'device',
        label: 'session $10 mirror (fresh baseline guard re-checks at commit)',
      };
    }
    return syntheticBaseline(editor);
  }

  if (editor === 'pattern-bank') {
    if (!live.bank) await live.refreshBankAsync(4000);
    if (live.bank) {
      return {
        bytes: live.bank.data.slice(), origin: 'device',
        label: '$08 → $09/$0A full 342272 B snapshot',
      };
    }
    return syntheticBaseline(editor);
  }

  // File service is PLAN-ONLY here: no live pull/push orchestration is implemented.
  return syntheticBaseline(editor);
}

/** Real device port. Only constructed in LIVE mode; the controller uses a null port offline. */
function createWritePort(editor: WriteEditorKind): WebMidiWritePort {
  const live = liveSession;
  if (!live?.transport) throw new Error('no live Web MIDI transport');
  if (editor === 'midi-config') {
    return createWebMidiWritePort(live.transport, {
      kind: 'midi-config', timeoutMs: 4000, onLog: setSource,
    });
  }
  return createWebMidiWritePort(live.transport, {
    kind: 'pattern-bank', timeoutMs: 6000, onLog: setSource,
    readCurrent: async () => {
      const ok = await live.refreshBankAsync(5000);
      return ok && live.bank ? live.bank.data.slice() : null;
    },
  });
}

const writeController = new WriteController({
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
    transferId: liveSession?.bankTransferId ?? 0,
  }),
  filePlanInput: () => ({
    slotMap: new TextEncoder().encode('{"version":1,"slots":[]}'),
    targetPath: 'settings/plugs.json',
    targetContent: new TextEncoder().encode('{"plugs":[]}'),
  }),
});
writeController.sync();

// ---- Stage 7: BLE-MIDI (user gesture) + Gamepad navigation ----

/**
 * Web Bluetooth is NOT assumed: the button is disabled unless navigator.bluetooth exists,
 * and the evidence grade for the browser host is deliberately `unknown` until a real Deck
 * is checked. USB Web MIDI / 31-frame offline replay stay available at all times.
 */
function refreshBleUi(): void {
  const cap = bleCapability();
  const connected = bleTransport?.connected ?? false;
  if (bleBtn) {
    bleBtn.textContent = connected ? 'BLE DISCONNECT' : 'BLE CONNECT';
    bleBtn.disabled = bleBusy || (!cap.supported && !connected);
    bleBtn.classList.toggle('active', connected);
  }
  if (bleStatus) {
    bleStatus.textContent = connected
      ? 'BLE: LIVE'
      : cap.supported
        ? `BLE: READY · HOST ${stage7EvidenceLabel('browserWebBluetooth')}`
        : 'BLE: UNAVAILABLE';
    bleStatus.classList.toggle('on', connected);
    bleStatus.classList.toggle('warn', !connected && cap.supported);
  }
}

async function disconnectBle(): Promise<void> {
  const transport = bleTransport;
  bleTransport = null;
  if (transport) {
    try { await transport.close(); } catch { /* link already gone */ }
  }
  refreshBleUi();
  if (usbSession) {
    liveSession = usbSession;
    attach(usbSession);
    updateLiveButton();
    setSource('LIVE · USB Web MIDI restored after BLE disconnect');
    return;
  }
  liveSession = null;
  updateLiveButton();
  await loadOffline();
  setSource('BLE · disconnected · 31-frame offline replay');
}

async function toggleBle(): Promise<void> {
  if (bleBusy) return;
  if (bleTransport?.connected) {
    await disconnectBle();
    return;
  }
  const cap = bleCapability();
  if (!cap.supported) {
    setSource(`BLE · ${cap.reason}`);
    return;
  }
  // STAGE 6 SAFETY GATE: never swap the live transport while a write editor is open. A
  // baseline / readback tied to the old port would be meaningless on the new one.
  if (lastWriteStatus?.open) {
    setSource('BLE · close the write editor before switching transport (Stage 6 safety gate)');
    return;
  }

  bleBusy = true;
  refreshBleUi();
  try {
    const transport = await openBleMidi({ onLog: setSource, now: () => Date.now() });
    const live = new OpzSession({ transport });
    // Tap the BLE stream for the Stage 5 recorder without changing session behaviour.
    const upstream = transport.onSysex;
    transport.onSysex = (data) => { recorder.record(data); upstream?.(data); };
    transport.onStateChange = () => {
      refreshBleUi();
      if (!transport.connected) {
        setSource('BLE · link lost · USB Web MIDI / offline replay still available');
      }
    };
    bleTransport = transport;
    liveSession = live;
    attach(live);
    updateLiveButton();
    setSource(`LIVE · BLE-MIDI ${transport.inputName} · 20 B MTU`);
    live.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSource(`BLE · ${msg} · staying on USB / offline replay`);
  } finally {
    bleBusy = false;
    refreshBleUi();
  }
}

bleBtn?.addEventListener('click', () => { void toggleBle(); });

/** Stage 7: no binding here can arm, commit or roll back a device write. */
function handleGamepadAction(action: GamepadAction): void {
  switch (action) {
    case 'next-screen': view?.nextScreen(); break;
    case 'prev-screen': view?.prevScreen(); break;
    case 'toggle-auto': toggleAutoRoute(); break;
    case 'toggle-play': view?.togglePlay(); break;
    case 'timeline-play': void toggleReplay(); break;
    case 'timeline-step-back': void stepFrame(-1); break;
    case 'timeline-step-forward': void stepFrame(1); break;
    case 'toggle-loop': if (player) player.setLoop(!player.loop); break;
    case 'toggle-write-editor':
      void writeController.setOpen(!(lastWriteStatus?.open ?? false));
      break;
  }
}

function applyPadStatus(connected: boolean, id: string | null): void {
  if (!padStatus) return;
  padStatus.textContent = connected ? `PAD: ${(id ?? 'ON').slice(0, 18)}` : 'PAD: --';
  padStatus.classList.toggle('on', connected);
}

const gamepad = new GamepadNavigator({
  onAction: handleGamepadAction,
  onStatus: applyPadStatus,
});
gamepadTick = () => { gamepad.poll(); };
applyPadStatus(false, null);

function applyWriteStatus(ui: WriteUiState | null, s: WriteStatus): void {
  if (wrToggle) {
    wrToggle.textContent = s.open ? 'WRITE: ON' : 'WRITE: OFF';
    wrToggle.classList.toggle('active', s.open);
  }
  if (wrMode) {
    wrMode.textContent = s.dryRun ? 'DRY RUN' : 'ARMED';
    wrMode.classList.toggle('wr-dry', s.dryRun);
    wrMode.classList.toggle('wr-armed', !s.dryRun);
  }
  if (wrEvidence) wrEvidence.textContent = ui?.evidence ?? 'UNKNOWN';
  if (wrArm) {
    wrArm.textContent = s.dryRun ? 'ARM ⚠' : 'DISARM';
    wrArm.disabled = s.dryRun ? !s.canArm : false;
    wrArm.classList.toggle('active', !s.dryRun);
  }
  if (wrCommit) wrCommit.disabled = !s.canCommit;
  if (wrRollback) wrRollback.disabled = !s.canRollback;
  const editable = s.open && s.editor !== 'file-service';
  if (wrStage) wrStage.disabled = !editable;
  if (wrReset) wrReset.disabled = !editable;
  if (wrRefresh) wrRefresh.disabled = !s.open;
  if (wrBackup) wrBackup.disabled = !s.open;
  if (wrAudit) wrAudit.disabled = !s.open;
  if (wrValue) {
    wrValue.disabled = !editable;
    if (lastWriteEditor !== s.editor) {
      wrValue.value = s.editor === 'pattern-bank' ? '123'
        : s.editor === 'file-service' ? '0' : '74';
    }
  }
  lastWriteEditor = s.editor;
  if (wrInfo) {
    wrInfo.textContent = ui
      ? `${ui.diffCount} diff · ${ui.frameCount} frames · ${ui.baselineBytes} B · ${s.message}`
      : `0 diff · 0 frames · ${s.message}`;
  }
}

wrToggle?.addEventListener('click', () => {
  void writeController.setOpen(!(lastWriteStatus?.open ?? false));
});
wrEditor?.addEventListener('change', () => {
  const kind = wrEditor.value as WriteEditorKind;
  if (WRITE_EDITORS.includes(kind)) void writeController.selectEditor(kind);
});
wrStage?.addEventListener('click', () => { void writeController.stageSample(wrValue?.value ?? '74'); });
wrReset?.addEventListener('click', () => { void writeController.reset(); });
wrRefresh?.addEventListener('click', () => { void writeController.refresh(); });
wrArm?.addEventListener('click', () => {
  if (!lastWriteStatus) return;
  if (lastWriteStatus.dryRun) writeController.arm();
  else writeController.disarm();
});
wrCommit?.addEventListener('click', () => {
  // Human-facing final confirmation, on top of the ARM gate and commit({confirmed:true}).
  const prompt = 'Send the staged SysEx frames to the OP-Z now?\n\n'
    + 'Keep the exported baseline backup. A failed readback restores the exact original bytes.';
  if (typeof window.confirm === 'function' && !window.confirm(prompt)) {
    setSource('COMMIT cancelled by user · 0 frames sent');
    return;
  }
  void writeController.commit();
});
wrRollback?.addEventListener('click', () => { void writeController.rollback(); });
wrBackup?.addEventListener('click', () => {
  const json = writeController.backupJson();
  if (!json) return;
  download(`opb-baseline-${stamp()}.json`, json, 'application/json;charset=utf-8');
  setSource(`BACKUP · exact baseline exported (${writeController.baselineOrigin}) · keep this file`);
});
wrAudit?.addEventListener('click', () => {
  download(`opb-write-audit-${stamp()}.json`, writeController.auditJson(), 'application/json;charset=utf-8');
  setSource('AUDIT · transaction diff / frames / phase history exported');
});

// ---- keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && immersive && !document.fullscreenElement) { setImmersive(false); return; }
  if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); view?.nextScreen(); }
  else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); view?.prevScreen(); }
  else if (e.code === 'Space') { e.preventDefault(); view?.togglePlay(); }
  else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); toggleAutoRoute(); }
  else if (e.key >= '1' && e.key <= '9') { view?.navigateTo(SCREEN_ORDER[Number(e.key) - 1]); }
  else if (e.key === '0') { view?.navigateTo(SCREEN_ORDER[9]); }
  else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); void toggleReplay(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); toggleRecording(); }
  else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); if (player) player.setLoop(!player.loop); }
  else if (e.key === '[') { void stepFrame(-1); }
  else if (e.key === ']') { void stepFrame(1); }
  else if (e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    void writeController.setOpen(!(lastWriteStatus?.open ?? false));
  }
  else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    const i = WRITE_EDITORS.indexOf(lastWriteStatus?.editor ?? 'midi-config');
    void writeController.selectEditor(WRITE_EDITORS[(i + 1) % WRITE_EDITORS.length]);
  }
});

// ---- PWA: register the service worker for offline support ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('service worker registration failed', err);
    });
  });
}

// ---- boot: permission-aware LIVE, else offline capture timeline ----
async function boot(): Promise<void> {
  attach(new OpzSession());
  updateTimelineUi(null);
  updateLiveButton();

  // Stage 8.1: only auto-connect when SysEx is already granted. On a fresh Steam Deck
  // profile ('prompt') a gesture-less request here is rejected by Chrome and recorded
  // permanently as 'denied'; the user then has to fix it in site settings. Instead we
  // load the offline timeline and wait for the CONNECT OP-Z button (a real gesture).
  const permission = await midiPermissionState();
  if (permission === 'granted') {
    await connectLive();
    if (liveSession) return;
  }
  if (permission === 'denied' && liveConnectBtn) {
    liveConnectBtn.title = 'MIDI 权限已被拒绝：地址栏锁形图标 → 网站设置 → MIDI 设备 → 允许，然后刷新页面';
  }
  await loadOffline();
}

async function loadOffline(): Promise<void> {
  try {
    const res = await fetch(captureUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadCaptureText(await res.text(), captureUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSource(`OFFLINE · 回放失败 ${msg}`);
  }
}

refreshBleUi();
void boot();
