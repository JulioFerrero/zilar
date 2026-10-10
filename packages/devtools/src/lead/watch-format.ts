// Pure helpers for the Ink `lead watch` app (`watch-app.tsx`). No Ink or
// Node runtime imports here so the mapping rules stay easy to test.

import type { WatchEntry } from './watch.js';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Widths below this drop the tracker bars, the sparkline and file names. */
export const COMPACT_WIDTH = 50;

/** From this width on the cards lay out in two columns, each at least 50 wide. */
export const TWO_COLUMN_MIN_WIDTH = 100;

export type TrackerStep = 1 | 2 | 3 | 4;

// The dashboard's four steps are Coding, Review fixes, Pre-review, Lead.
// Blocked, idle and quota keep the step they had; the view does not carry
// history, so they fall back to step 1 (the current dot turns red there).
export function trackerStep(phaseId: string): TrackerStep {
  if (phaseId === 'coding') {
    return 1;
  }
  if (phaseId === 'fixing') {
    return 2;
  }
  if (phaseId === 'starting-prereview' || phaseId === 'prereview') {
    return 3;
  }
  if (phaseId === 'waiting-lead') {
    return 4;
  }
  return 1;
}

export type PhaseColorName = 'cyan' | 'magenta' | 'yellow' | 'red';

// Border and tracker colour by phase: coding and fixing cyan, pre-review
// magenta, waiting for the lead yellow, everything stuck red.
export function phaseColorName(phaseId: string): PhaseColorName {
  if (phaseId === 'coding' || phaseId === 'fixing') {
    return 'cyan';
  }
  if (phaseId === 'prereview' || phaseId === 'starting-prereview') {
    return 'magenta';
  }
  if (phaseId === 'waiting-lead') {
    return 'yellow';
  }
  return 'red';
}

export interface ModelBadge {
  name: string;
  effort: string | undefined;
  free: boolean;
  color: 'magenta' | '#f2a65e' | '#7aa2f7' | undefined;
}

// Claude badge colour: a light blue that reads on a dark terminal and differs
// from Muse (magenta) and MiniMax (orange).
const CLAUDE_BADGE_COLOR = '#7aa2f7';

// `Claude Haiku 5.5` for `haiku-5.5` or `claude-haiku-5-5`; `Claude` alone when
// no family name is in the id.
function claudeName(lower: string): string {
  const match = /(haiku|sonnet|opus)[-_. ]?(\d+)?(?:[-_.](\d+))?/.exec(lower);
  if (match === null) {
    return 'Claude';
  }
  const family = match[1] ?? '';
  const major = match[2];
  const minor = match[3];
  const version = major === undefined ? '' : ` ${major}${minor === undefined ? '' : `.${minor}`}`;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)}${version}`;
}

// `Muse` for any model id containing `muse`, `MiniMax` for `minimax`,
// `Claude <family> <version>` for Claude ids (haiku, sonnet, opus, claude),
// otherwise the bare model id. `free` is true when the id ends in `-free`.
export function modelBadge(model: string, effort: string | undefined): ModelBadge {
  const lower = model.toLowerCase();
  const stripped = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
  const free = lower.endsWith('-free');
  if (lower.includes('muse')) {
    return { name: 'Muse', effort, free, color: 'magenta' };
  }
  if (lower.includes('minimax')) {
    return { name: 'MiniMax', effort, free, color: '#f2a65e' };
  }
  if (/haiku|sonnet|opus|claude/.test(lower)) {
    return { name: claudeName(lower), effort, free, color: CLAUDE_BADGE_COLOR };
  }
  return { name: stripped, effort, free, color: undefined };
}

export type WatchIconName =
  | 'brand'
  | 'clock'
  | 'working'
  | 'needsYou'
  | 'merged'
  | 'branch'
  | 'thinking'
  | 'reading'
  | 'editing'
  | 'tests'
  | 'gate'
  | 'commit'
  | 'context'
  | 'added'
  | 'modified'
  | 'removed'
  | 'idle';

// Nerd Font glyphs (Nerd Fonts v3) with plain fallbacks. `fallback: ''`
// means no icon in `--no-icons` mode. Every rendered icon is followed by
// one space (see `iconText`).
export const WATCH_ICONS: Record<WatchIconName, { glyph: string; fallback: string }> = {
  brand: { glyph: '\u{F01E7}', fallback: '\u{25C6}' },
  clock: { glyph: '\u{F43A}', fallback: '' },
  working: { glyph: '\u{F0E7}', fallback: '\u{25CF}' },
  needsYou: { glyph: '\u{F0F3}', fallback: '\u{25C6}' },
  merged: { glyph: '\u{F058}', fallback: '\u{2713}' },
  branch: { glyph: '\u{F418}', fallback: '' },
  thinking: { glyph: '\u{F09D1}', fallback: '' },
  reading: { glyph: '\u{F441}', fallback: '' },
  editing: { glyph: '\u{F448}', fallback: '' },
  tests: { glyph: '\u{F0C3}', fallback: '' },
  gate: { glyph: '\u{F0565}', fallback: '' },
  commit: { glyph: '\u{F417}', fallback: '' },
  context: { glyph: '\u{F1C0}', fallback: 'ctx' },
  added: { glyph: '\u{F457}', fallback: '+' },
  modified: { glyph: '\u{F459}', fallback: '~' },
  removed: { glyph: '\u{F458}', fallback: '\u{2212}' },
  idle: { glyph: '\u{F28B}', fallback: '' },
};

// Glyph (icons on) or fallback (icons off), followed by one space.
// Empty when the fallback is none and icons are off.
export function iconText(name: WatchIconName, icons: boolean): string {
  const entry = WATCH_ICONS[name];
  const char = icons ? entry.glyph : entry.fallback;
  return char === '' ? '' : `${char} `;
}

// `lead watch --no-icons` or `ZILAR_WATCH_ICONS=0` renders the fallbacks.
export function iconsEnabled(noIconsFlag: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (noIconsFlag) {
    return false;
  }
  return env['ZILAR_WATCH_ICONS'] !== '0';
}

// The live-step icon follows the step: thinking, reading, editing, running
// tests, running the gate, committing; other steps get no icon.
export function liveStepIcon(step: string): WatchIconName | null {
  const lower = step.toLowerCase();
  if (lower === 'thinking') {
    return 'thinking';
  }
  if (lower.startsWith('reading')) {
    return 'reading';
  }
  if (lower.startsWith('editing')) {
    return 'editing';
  }
  if (lower === 'running tests') {
    return 'tests';
  }
  if (lower === 'running the gate') {
    return 'gate';
  }
  if (lower === 'committing') {
    return 'commit';
  }
  return null;
}

// `ctx` value colour: green under 150k, yellow from 150k, red from 200k.
export function contextColorName(context: number): 'green' | 'yellow' | 'red' {
  if (context >= 200_000) {
    return 'red';
  }
  if (context >= 150_000) {
    return 'yellow';
  }
  return 'green';
}

// Cut to `width` visible characters with `…`. Nerd Font glyphs count as one
// column each: measure with `Array.from` (code points), never `length`.
export function truncate(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  const chars = Array.from(text);
  if (chars.length <= width) {
    return text;
  }
  if (width === 1) {
    return '…';
  }
  return `${chars.slice(0, width - 1).join('')}…`;
}

// The exact number of lines a `TaskCard` renders: the two borders, the title,
// the tracker and the idle/speed line, plus the live or waiting line and the
// files line when they are shown.
export function cardHeight(entry: WatchEntry): number {
  let height = 5;
  if ((entry.running && entry.step !== null) || entry.needsLead) {
    height += 1;
  }
  if (entry.files.length > 0) {
    height += 1;
  }
  return height;
}

export function layoutColumns(width: number): number {
  return width >= TWO_COLUMN_MIN_WIDTH ? 2 : 1;
}

// The widths of `count` cards side by side within `width`: a one-column gap
// sits between them, so the first is `floor((width - 1) / 2)` and the second
// takes the rest.
export function columnWidths(width: number, count: number): number[] {
  if (count <= 1) {
    return [width];
  }
  const first = Math.floor((width - 1) / 2);
  return [first, width - 1 - first];
}

export interface VisibleSlice {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

// Shows as many whole rows as fit from `offset` and always at least one row,
// so a tiny terminal still shows something.
export function visibleSlice(
  rowHeights: number[],
  offset: number,
  availableRows: number,
): VisibleSlice {
  const total = rowHeights.length;
  if (total === 0) {
    return { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const start = Math.min(Math.max(0, offset), total - 1);
  let used = 0;
  let end = start;
  while (end < total) {
    const height = rowHeights[end] ?? 0;
    if (end > start && used + height > availableRows) {
      break;
    }
    used += height;
    end += 1;
  }
  return { start, end, hiddenAbove: start, hiddenBelow: total - end };
}
