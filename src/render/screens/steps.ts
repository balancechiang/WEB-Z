/**
 * Step Components screen — OPB.App/Screens/StepComponentsScreen.cs → Canvas 2D.
 * Shown while shift + a step is held: the step node wired to a box per step component (with the
 * value-key meaning) and to its parameter locks. Pure render port; layout matches the C# original.
 *
 * Stage 6 correction: parameter locks live in the PATTERN BANK, so they are indexed with
 * BANK_PARAM, not with the live SOUND_PARAM order used by currentSound. Mixing the two used to
 * shift FX1/FX2/Filter/Resonance/Pan/Level/Portamento by one byte.
 */
import type { ScreenInput } from './index.ts';
import type { OpzSession } from '../../session/opzSession.ts';
import { OpbTheme } from '../theme.ts';
import { label, hLine, writeEditorOverlay } from '../draw.ts';
import { percent, band, trackKind, LFO_DESTINATIONS, LFO_SHAPES, DRUM_NOTE_STYLES, SYNTH_NOTE_STYLES } from '../displays.ts';
import { BANK_PARAM, BANK_PARAM_COUNT, BANK_PARAM_NAMES } from '../../model/bankParams.ts';
import { TRACK_NAMES } from '../../model/tracks.ts';

interface R { x: number; y: number; w: number; h: number; }
const TitleY = 40, Row0 = 82, NodeX = 190, NodeY = 440, NodeR = 46;
const CompBus = 400, CompX = 470, CompW = 400, LockBus = 990, LockX = 1060, LockW = 470;
const AreaTop = 160, AreaBottom = 740, BottomWire = 776;

const ComponentNames = [
  'PULSE', 'PARAM SPARK', 'JUMP', 'VELOCITY', 'RAMP UP', 'RAMP DOWN', 'RANDOM', 'GLIDE',
  'MULTIPLY', 'SWEEP', 'PULSE HOLD', 'TONALITY', 'TRIGGER SPARK', 'COMP SPARK', 'BIT 14', 'BIT 15',
];
const Jumps = ['TO START', 'TO 2/4', 'TO 3/4', 'TO 4/4', 'FORWARD', 'BACK', 'RANDOM', 'STAY', 'ALIGN GLOBAL', 'GATE STEP'];
const Sweeps = ['FILTER UP', 'FILTER DOWN', 'SYNTH UP', 'SYNTH DOWN', 'PAN', 'FILTER UP L', 'FILTER DN L', 'SYNTH UP L', 'SYNTH DN L', 'PAN L'];
const Tonalities = ['IGNORE CHORDS', 'TRANSPOSE', 'OCTAVE', 'FIFTH', 'THIRD', 'CHROM UP', 'CHROM DOWN', 'QUANTIZE 1', 'QUANTIZE 2', 'QUANTIZE 3'];
const Velocities = [4, 8, 16, 32, 64, 100, 112, 127];

export function renderSteps(ctx: CanvasRenderingContext2D, input: ScreenInput): void {
  const session: OpzSession = input.session;
  const track = session.activeTrack;
  const pattern = session.activePattern;
  const step = session.ui.heldKey >= 0 ? session.ui.heldKey : 0;
  const drum = trackKind(track) === 'Drum';

  label(ctx, `STEP ${step + 1}`, input.right / 2, TitleY, 56, OpbTheme.Ink, 'center', 'normal');
  label(ctx, TRACK_NAMES[track] ?? `TRACK ${track}`, 20, TitleY, 30, OpbTheme.Mid);
  hLine(ctx, input.left, input.right, Row0);
  label(ctx, 'COMPONENTS', CompX, Row0 + 42, 30, OpbTheme.Mid);
  label(ctx, 'PARAMETER LOCKS', LockX, Row0 + 42, 30, OpbTheme.Mid);

  const bank = session.bank;
  const components: [string, string][] = [];
  const locks: [string, string][] = [];
  let notes: { pitch: number; velocity: number }[] = [];
  if (bank) {
    const mask = bank.componentMask(pattern, track, step);
    for (let c = 0; c < 16; c++)
      if ((mask & (1 << c)) !== 0) components.push([ComponentNames[c], componentText(c, bank.componentValue(pattern, track, step, c))]);
    // 54-byte step record = [mask 2][component values 16][lock values 18][lock enables 18],
    // all in BANK_PARAM order (typed-pattern-editing.md, device-proven on fw 1.2.45+).
    for (let p = 0; p < BANK_PARAM_COUNT; p++)
      if (bank.isLocked(pattern, track, step, p)) locks.push([lockName(p, drum), lockText(p, bank.lockValue(pattern, track, step, p), drum)]);
    notes = bank.notes(pattern, track, step);
  }

  const compYs = rows(components.length);
  if (components.length > 0) {
    stroke(ctx, OpbTheme.Green, 3, true, [P(NodeX + NodeR, NodeY), P(CompBus, NodeY), P(CompBus, compYs[0]), P(CompBus, compYs[compYs.length - 1])]);
  } else label(ctx, 'NONE', CompX, NodeY, 30, OpbTheme.Rule);
  for (let i = 0; i < components.length; i++)
    drawBox(ctx, OpbTheme.Green, CompBus, CompX, CompW, compYs[i], components[i][0], components[i][1], boxHeight(components.length));

  const lockYs = rows(locks.length);
  if (locks.length > 0) {
    const pts = [P(NodeX, NodeY + NodeR), P(NodeX, BottomWire), P(LockBus, BottomWire), P(LockBus, lockYs[0])];
    stroke(ctx, OpbTheme.Red, 3, true, pts);
  } else label(ctx, 'NONE', LockX, NodeY, 30, OpbTheme.Rule);
  for (let i = 0; i < locks.length; i++)
    drawBox(ctx, OpbTheme.Red, LockBus, LockX, LockW, lockYs[i], locks[i][0], locks[i][1], boxHeight(locks.length));

  const trig = notes.length > 0;
  ctx.fillStyle = trig ? OpbTheme.Ink : OpbTheme.Mid;
  ctx.beginPath(); ctx.arc(NodeX, NodeY, NodeR, 0, Math.PI * 2); ctx.fill();
  label(ctx, String(step + 1), NodeX, NodeY, 44, OpbTheme.Background, 'center', 'normal');
  const noteText = trig ? notes.map((n) => trackKind(track) === 'Drum' ? `NOTE ${n.pitch}` : noteName(n.pitch)).join(' ') : 'NO TRIG';
  label(ctx, noteText, NodeX, NodeY - NodeR - 70, 28, OpbTheme.Mid, 'center');
  if (trig) label(ctx, `VEL ${notes[0].velocity}`, NodeX, NodeY - NodeR - 34, 28, OpbTheme.Mid, 'center');

  // Stage 6: staged parameter-lock mutations are shown in a DRY-RUN transaction overlay.
  // Read-only mode is untouched (and therefore still matches the C# screen 1:1).
  if (input.write) {
    writeEditorOverlay(ctx, input.write, {
      subtitle: 'STEP COMPONENTS · PARAMETER LOCKS · BANK_PARAM ORDER (NOT LIVE SOUND_PARAM)',
      footnote: 'SET LOCK = VALUE BYTE + ENABLE 0xFF · CLEAR = ENABLE 0 ONLY, KEEP LAST VALUE · EXACT ROLLBACK',
    });
  }
}

interface P { x: number; y: number; }
const P = (x: number, y: number): P => ({ x, y });

function stroke(ctx: CanvasRenderingContext2D, color: string, width: number, round: boolean, pts: P[]): void {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  if (round) ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
}

function boxHeight(count: number): number { return Math.min(56, (AreaBottom - AreaTop) / Math.max(1, count) - 8); }

function rows(count: number): number[] {
  if (count === 0) return [];
  const pitch = Math.min(72, (AreaBottom - AreaTop) / count);
  const top = Math.max(AreaTop + pitch / 2, Math.min(AreaBottom - pitch * 0.5, NodeY - pitch * (count - 1) / 2));
  return Array.from({ length: count }, (_, i) => top + i * pitch);
}

function drawBox(ctx: CanvasRenderingContext2D, color: string, bus: number, x: number, w: number, y: number, name: string, value: string, h: number): void {
  stroke(ctx, color, 3, true, [P(bus, y), P(x, y)]);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(bus, y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = OpbTheme.Background;
  ctx.fillRect(x, y - h / 2, w, h);
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.strokeRect(x, y - h / 2, w, h);
  const size = Math.min(30, h * 0.6);
  label(ctx, name, x + 14, y, size, OpbTheme.Mid);
  label(ctx, value, x + w - 14, y, size, OpbTheme.Ink, 'right', 'normal');
}

/** The meaning of a component value (raw 1..10 are value keys 1..9; 0 with sparks keeps a mode in the high nibble). */
function componentText(component: number, raw: number): string {
  const k = raw & 0x0f;
  if (k < 1 || k > 10) return String(raw);
  switch (component) {
    case 0: case 10: return k === 10 ? 'RANDOM' : `COUNT ${k}`;
    case 1: case 12: case 13: return k <= 8 ? `PASS ${k}` : k === 9 ? 'RANDOM' : 'RESET';
    case 2: return Jumps[k - 1];
    case 3: return k <= 8 ? `VEL ${Velocities[k - 1]}` : k === 9 ? 'MUTE' : 'RANDOM';
    case 4: case 5: case 6: return `${(k - 1) % 5 + 2} / ${k <= 5 ? 1 : 3} OCT`;
    case 7: return k <= 8 ? `GLIDE ${k}` : k === 9 ? 'DIRECT' : 'RANDOM';
    case 8: return k <= 8 ? `X${k}` : String(raw);
    case 9: return Sweeps[k - 1];
    case 11: return Tonalities[k - 1];
    default: return String(raw);
  }
}

/** `p` is a BANK_PARAM index. Drum tracks rename the envelope stages. */
function lockName(p: number, drum: boolean): string {
  switch (p) {
    case BANK_PARAM.Attack: return drum ? 'START' : 'ATTACK';
    case BANK_PARAM.Decay: return drum ? 'ATTACK' : 'DECAY';
    case BANK_PARAM.Sustain: return drum ? 'HOLD' : 'SUSTAIN';
    case BANK_PARAM.Release: return drum ? 'DECAY' : 'RELEASE';
    case BANK_PARAM.Resonance: return 'RES';
    default: return BANK_PARAM_NAMES[p] ?? `P${p}`;
  }
}

function lockText(p: number, v: number, drum: boolean): string {
  if (p === BANK_PARAM.Pan) {
    if (v === 128) return 'C';
    if (v < 128) return `L${percent(((128 - v) * 2 - 1) & 0xff)}`;
    return `R${percent(((v - 128) * 2 + 1) & 0xff)}`;
  }
  if (p === BANK_PARAM.LfoDest) return band(v, LFO_DESTINATIONS);
  if (p === BANK_PARAM.LfoShape) return band(v, LFO_SHAPES);
  if (p === BANK_PARAM.NoteStyle) return band(v, drum ? DRUM_NOTE_STYLES : SYNTH_NOTE_STYLES);
  return `${percent(v)}`;
}

function noteName(midiNote: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midiNote % 12) + 12) % 12]}${Math.floor(midiNote / 12) - 1}`;
}
