import { describe, expect, it } from 'vitest';
import {
  WATCH_ICONS,
  contextColorName,
  iconsEnabled,
  iconText,
  liveStepIcon,
  modelBadge,
  type WatchIconName,
} from './watch-format';

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
