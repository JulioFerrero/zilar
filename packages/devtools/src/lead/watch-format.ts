// Pure helpers for the Ink `lead watch` app (`watch-app.tsx`). No Ink or
// Node imports here so the mapping rules stay easy to test.

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Widths below this drop the tracker bars, the sparkline and file names. */
export const COMPACT_WIDTH = 50;

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
  color: 'magenta' | '#f2a65e' | undefined;
}

// `Muse` for any model id containing `muse`, `MiniMax` for `minimax`,
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
  return { name: stripped, effort, free, color: undefined };
}

export function badgeText(badge: ModelBadge): string {
  const base = badge.effort !== undefined ? `${badge.name} · ${badge.effort}` : badge.name;
  return badge.free ? `${base} free` : base;
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
