import { describe, expect, it } from 'vitest';

import { depth, palette, platformDifferences, radius } from './index';

const HEX = /^#[0-9a-f]{6}$/;

describe('palette', () => {
  it('holds every D24 value as a 6-digit lowercase hex', () => {
    const entries = Object.entries(palette);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(value, name).toMatch(HEX);
    }
  });

  it('covers the bubble and icon colors', () => {
    expect(palette.bubbleIn).toBe('#161616');
    expect(palette.bubbleOut).toBe('#dedede');
    expect(palette.bubbleInMeta).toBe('#8a8a8a');
    expect(palette.bubbleOutMeta).toBe('#525252');
    expect(palette.iconColor).toBe('#d4d4d4');
    expect(palette.destructiveForeground).toBe('#ffffff');
  });
});

describe('radius', () => {
  it('keeps the 0.75rem base and the web sm/md/lg/xl formulas', () => {
    expect(radius.base).toBe('0.75rem');
    expect(radius.sm).toBe('calc(var(--radius) - 4px)');
    expect(radius.md).toBe('calc(var(--radius) - 2px)');
    expect(radius.lg).toBe('var(--radius)');
    expect(radius.xl).toBe('calc(var(--radius) + 4px)');
  });
});

describe('depth', () => {
  it('holds non-empty gradient and shadow strings', () => {
    const entries = Object.entries(depth);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(value.length, name).toBeGreaterThan(0);
    }
  });
});

describe('platformDifferences', () => {
  it('records each known difference with a web value, a mobile value and a note', () => {
    expect(platformDifferences.length).toBeGreaterThan(0);
    for (const difference of platformDifferences) {
      expect(difference.name.length).toBeGreaterThan(0);
      expect(difference.web.length).toBeGreaterThan(0);
      expect(difference.mobile.length).toBeGreaterThan(0);
      expect(difference.note.length).toBeGreaterThan(0);
    }
  });
});
