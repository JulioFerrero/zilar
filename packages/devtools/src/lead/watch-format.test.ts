import { describe, expect, it } from 'vitest';
import type { WatchEntry } from './watch';
import {
  WATCH_ICONS,
  TWO_COLUMN_MIN_WIDTH,
  cardHeight,
  columnWidths,
  contextColorName,
  iconsEnabled,
  iconText,
  layoutColumns,
  liveStepIcon,
  modelBadge,
  visibleSlice,
  type WatchIconName,
} from './watch-format';

function entry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    id: 'T-0001',
    title: 'A task',
    modelLabel: 'acme/model',
    model: 'acme/model',
    effort: undefined,
    totalAge: '1 m',
    autoFixRounds: 0,
    phaseId: 'coding',
    phaseLabel: 'Coding',
    needsLead: false,
    running: true,
    step: 'editing a.ts',
    files: [],
    speed: null,
    ...overrides,
  };
}

const NAMES: WatchIconName[] = [
  'brand',
  'clock',
  'working',
  'needsYou',
  'merged',
  'branch',
  'thinking',
  'reading',
  'editing',
  'tests',
  'gate',
  'commit',
  'context',
  'added',
  'modified',
  'removed',
  'idle',
];

function codepoint(text: string): string {
  return (text.codePointAt(0) ?? 0).toString(16).toUpperCase();
}

describe('WATCH_ICONS', () => {
  it('has every icon name with a non-empty single-column glyph', () => {
    for (const name of NAMES) {
      const entry = WATCH_ICONS[name];
      expect(entry, name).toBeDefined();
      expect(entry.glyph.length, name).toBeGreaterThan(0);
      expect(Array.from(entry.glyph), name).toHaveLength(1);
    }
  });

  it('uses the exact Nerd Font codepoints from the brief', () => {
    const expected: Record<WatchIconName, string> = {
      brand: 'F01E7',
      clock: 'F43A',
      working: 'F0E7',
      needsYou: 'F0F3',
      merged: 'F058',
      branch: 'F418',
      thinking: 'F09D1',
      reading: 'F441',
      editing: 'F448',
      tests: 'F0C3',
      gate: 'F0565',
      commit: 'F417',
      context: 'F1C0',
      added: 'F457',
      modified: 'F459',
      removed: 'F458',
      idle: 'F28B',
    };
    for (const name of NAMES) {
      expect(codepoint(WATCH_ICONS[name].glyph), name).toBe(expected[name]);
    }
  });

  it('uses the brief fallbacks', () => {
    const expected: Record<WatchIconName, string> = {
      brand: '25C6',
      clock: '',
      working: '25CF',
      needsYou: '25C6',
      merged: '2713',
      branch: '',
      thinking: '',
      reading: '',
      editing: '',
      tests: '',
      gate: '',
      commit: '',
      context: 'ctx',
      added: '2B',
      modified: '7E',
      removed: '2212',
      idle: '',
    };
    for (const name of NAMES) {
      const fallback = WATCH_ICONS[name].fallback;
      if (expected[name] === '') {
        expect(fallback, name).toBe('');
      } else if (fallback.length > 1) {
        expect(fallback, name).toBe('ctx');
      } else {
        expect(codepoint(fallback), name).toBe(expected[name]);
      }
    }
  });
});

describe('modelBadge', () => {
  it('is magenta for Muse and orange for MiniMax', () => {
    expect(modelBadge('meta/muse-spark-1.3-contributor-free', 'low')).toEqual({
      name: 'Muse',
      effort: 'low',
      free: true,
      color: 'magenta',
    });
    expect(modelBadge('minimax/MiniMax-M2.1', 'medium')).toEqual({
      name: 'MiniMax',
      effort: 'medium',
      free: false,
      color: '#f2a65e',
    });
  });

  it('marks models ending in -free and keeps the bare id otherwise', () => {
    expect(modelBadge('acme/some-model', undefined)).toEqual({
      name: 'some-model',
      effort: undefined,
      free: false,
      color: undefined,
    });
    expect(modelBadge('acme/other-free', 'high').free).toBe(true);
  });
});

describe('iconText', () => {
  it('renders the glyph plus one space with icons on', () => {
    expect(iconText('working', true)).toBe(`${WATCH_ICONS.working.glyph} `);
  });

  it('renders the fallback plus one space with icons off', () => {
    expect(iconText('working', false)).toBe(`${WATCH_ICONS.working.fallback} `);
  });

  it('renders nothing when the fallback is none and icons are off', () => {
    expect(iconText('clock', false)).toBe('');
    expect(iconText('thinking', false)).toBe('');
  });
});

describe('iconsEnabled', () => {
  it('is false with --no-icons', () => {
    expect(iconsEnabled(true, {})).toBe(false);
  });

  it('is true by default', () => {
    expect(iconsEnabled(false, {})).toBe(true);
  });

  it('is false with ZILAR_WATCH_ICONS=0', () => {
    expect(iconsEnabled(false, { ZILAR_WATCH_ICONS: '0' })).toBe(false);
  });
});

describe('liveStepIcon', () => {
  it('maps each step kind to its icon', () => {
    expect(liveStepIcon('thinking')).toBe('thinking');
    expect(liveStepIcon('reading watch.ts')).toBe('reading');
    expect(liveStepIcon('reading...')).toBe('reading');
    expect(liveStepIcon('editing sticker-pack.tsx')).toBe('editing');
    expect(liveStepIcon('editing...')).toBe('editing');
    expect(liveStepIcon('running tests')).toBe('tests');
    expect(liveStepIcon('running the gate')).toBe('gate');
    expect(liveStepIcon('committing')).toBe('commit');
  });

  it('returns null for steps without an icon', () => {
    expect(liveStepIcon('writing a reply')).toBeNull();
    expect(liveStepIcon('running a shell command')).toBeNull();
    expect(liveStepIcon('using search')).toBeNull();
  });
});

describe('contextColorName', () => {
  it('is green under 150k, yellow from 150k, red from 200k', () => {
    expect(contextColorName(42_000)).toBe('green');
    expect(contextColorName(149_999)).toBe('green');
    expect(contextColorName(150_000)).toBe('yellow');
    expect(contextColorName(163_000)).toBe('yellow');
    expect(contextColorName(199_999)).toBe('yellow');
    expect(contextColorName(200_000)).toBe('red');
  });
});

describe('cardHeight', () => {
  it('counts the five base lines of a plain card', () => {
    expect(cardHeight(entry({ running: false, step: null }))).toBe(5);
  });

  it('adds the live step line for a running card', () => {
    expect(cardHeight(entry({ running: true, step: 'editing a.ts' }))).toBe(6);
  });

  it('adds the waiting line for a card that needs the lead', () => {
    expect(cardHeight(entry({ needsLead: true, running: false, step: null }))).toBe(6);
  });

  it('adds the files line when files changed', () => {
    expect(
      cardHeight(
        entry({ running: false, step: null, files: [{ path: 'a.ts', kind: 'modified' }] }),
      ),
    ).toBe(6);
    expect(cardHeight(entry({ files: [{ path: 'a.ts', kind: 'modified' }] }))).toBe(7);
  });
});

describe('layoutColumns', () => {
  it('is one column below 100 and two columns from 100', () => {
    expect(TWO_COLUMN_MIN_WIDTH).toBe(100);
    expect(layoutColumns(99)).toBe(1);
    expect(layoutColumns(100)).toBe(2);
    expect(layoutColumns(140)).toBe(2);
  });
});

describe('columnWidths', () => {
  it('gives the single column the full width', () => {
    expect(columnWidths(64, 1)).toEqual([64]);
  });

  it('splits two columns with a one-column gap and the rest to the second', () => {
    expect(columnWidths(100, 2)).toEqual([49, 50]);
    expect(columnWidths(101, 2)).toEqual([50, 50]);
    expect(columnWidths(120, 2)).toEqual([59, 60]);
    expect(columnWidths(140, 2)).toEqual([69, 70]);
  });
});

describe('visibleSlice', () => {
  it('shows as many whole rows as fit', () => {
    expect(visibleSlice([6, 6, 6, 6, 6], 0, 24)).toEqual({
      start: 0,
      end: 4,
      hiddenAbove: 0,
      hiddenBelow: 1,
    });
  });

  it('reports what is hidden above and below after a scroll', () => {
    expect(visibleSlice([6, 6, 6, 6, 6], 1, 24)).toEqual({
      start: 1,
      end: 5,
      hiddenAbove: 1,
      hiddenBelow: 0,
    });
  });

  it('always shows at least one row, even with no space', () => {
    expect(visibleSlice([6, 6, 6], 0, 0)).toEqual({
      start: 0,
      end: 1,
      hiddenAbove: 0,
      hiddenBelow: 2,
    });
  });

  it('clamps an offset past the end to the last row', () => {
    expect(visibleSlice([6, 6, 6], 99, 24)).toEqual({
      start: 2,
      end: 3,
      hiddenAbove: 2,
      hiddenBelow: 0,
    });
  });

  it('returns nothing for no rows', () => {
    expect(visibleSlice([], 0, 24)).toEqual({
      start: 0,
      end: 0,
      hiddenAbove: 0,
      hiddenBelow: 0,
    });
  });
});
