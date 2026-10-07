import { describe, expect, it } from 'vitest';

import {
  CHAT_BACKGROUND_PRESET_IDS,
  DEFAULT_CHAT_BACKGROUND_PRESET,
  chatBackgroundPresets,
  chatGrid,
  depth,
  palette,
  platformDifferences,
  radius,
} from './index';

const HEX = /^#[0-9a-f]{6}$/;

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

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

describe('chatBackgroundPresets', () => {
  it('lists unique ids that match the preset keys', () => {
    expect(new Set(CHAT_BACKGROUND_PRESET_IDS).size).toBe(CHAT_BACKGROUND_PRESET_IDS.length);
    expect(Object.keys(chatBackgroundPresets).sort()).toEqual(
      [...CHAT_BACKGROUND_PRESET_IDS].sort(),
    );
  });

  it('defaults to slate and keeps the slate look from chatGrid', () => {
    expect(DEFAULT_CHAT_BACKGROUND_PRESET).toBe('slate');
    expect(chatBackgroundPresets.slate.ground).toBe(chatGrid.background);
    expect(chatBackgroundPresets.slate.dot).toBe(chatGrid.dot);
  });

  it('holds every ground and dot as a 7-character #rrggbb', () => {
    for (const id of CHAT_BACKGROUND_PRESET_IDS) {
      const preset = chatBackgroundPresets[id];
      expect(preset.ground, `${id}.ground`).toMatch(HEX);
      expect(preset.dot, `${id}.dot`).toMatch(HEX);
      expect(preset.ground.length).toBe(7);
      expect(preset.dot.length).toBe(7);
    }
  });

  it('keeps every ground darker than the incoming bubble in luminance', () => {
    const bubbleLuminance = luminance(palette.bubbleIn);
    for (const id of CHAT_BACKGROUND_PRESET_IDS) {
      expect(luminance(chatBackgroundPresets[id].ground), id).toBeLessThan(bubbleLuminance);
    }
  });
});
