import { describe, expect, it } from 'vitest';

import {
  BUBBLE_IN_SHADOW,
  BUBBLE_OUT_SHADOW,
  KEY_ICON_PRESSED_SHADOW,
  KEY_ICON_SHADOW,
  KEY_PRIMARY_PRESSED_SHADOW,
  KEY_PRIMARY_SHADOW,
  PILL_SHADOW,
  SEGMENT_SHADOW,
  SENDER_COLORS,
  WELL_SHADOW,
  avatarShade,
  bubbleStyle,
  iconKey,
  primaryKey,
  raisedPill,
  segment,
  senderColor,
  well,
} from './depth';

describe('depth recipes (ui-style.md §4)', () => {
  it('implements the primary key with the exact shadow and a pressed variant', () => {
    expect(KEY_PRIMARY_SHADOW).toBe(
      'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -2px 0 rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.12), 0 1px 0 rgba(0,0,0,0.95), 0 2px 3px rgba(0,0,0,0.7), 0 10px 18px -8px rgba(0,0,0,0.95)',
    );
    expect(KEY_PRIMARY_PRESSED_SHADOW).toBe(
      'inset 0 2px 5px rgba(0,0,0,0.35), 0 1px 0 rgba(0,0,0,0.95)',
    );
    expect(primaryKey.boxShadow).toBe(KEY_PRIMARY_SHADOW);
    expect(primaryKey.backgroundColor).toBe('#ededed');
    expect(String(primaryKey.experimental_backgroundImage)).toContain('linear-gradient(180deg');
  });

  it('implements the icon key with the exact shadow, a pressed variant and 12 px radius use', () => {
    expect(KEY_ICON_SHADOW).toBe(
      'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.65), 0 1px 0 rgba(0,0,0,0.95), 0 3px 6px -1px rgba(0,0,0,0.75)',
    );
    expect(KEY_ICON_PRESSED_SHADOW).toBe('inset 0 2px 5px rgba(0,0,0,0.9)');
    expect(iconKey.boxShadow).toBe(KEY_ICON_SHADOW);
    expect(iconKey.borderColor).toBe('#050505');
  });

  it('implements the well with the exact shadow', () => {
    expect(WELL_SHADOW).toBe(
      'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 1px 1px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.06)',
    );
    expect(well.boxShadow).toBe(WELL_SHADOW);
    expect(well.backgroundColor).toBe('#0c0c0c');
  });

  it('implements the raised segment and the raised pill with the exact shadows', () => {
    expect(SEGMENT_SHADOW).toBe(
      'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7)',
    );
    expect(segment.boxShadow).toBe(SEGMENT_SHADOW);
    expect(PILL_SHADOW).toBe(
      'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 0 rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.6)',
    );
    expect(raisedPill.boxShadow).toBe(PILL_SHADOW);
  });
});

describe('bubbleStyle (§5)', () => {
  it('uses the glossy white outgoing look', () => {
    expect(BUBBLE_OUT_SHADOW).toBe(
      'inset 0 1px 0 #ffffff, inset 0 -3px 6px rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.95), 0 4px 10px -3px rgba(0,0,0,0.85)',
    );
    expect(bubbleStyle('outgoing', false).boxShadow).toBe(BUBBLE_OUT_SHADOW);
  });

  it('uses the dark incoming card look', () => {
    expect(BUBBLE_IN_SHADOW).toBe(
      'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.95), 0 4px 10px -3px rgba(0,0,0,0.85)',
    );
    expect(bubbleStyle('incoming', false).boxShadow).toBe(BUBBLE_IN_SHADOW);
    expect(bubbleStyle('incoming', false).borderColor).toBe('#050505');
  });

  it('recesses the generating look with the well background', () => {
    const style = bubbleStyle('generating', false);
    expect(style.backgroundColor).toBe('#0c0c0c');
    expect(style.borderColor).toBe('#1a1a1a');
  });

  it('pins the 4 px tail corner on the last bubble only', () => {
    expect(bubbleStyle('outgoing', true).borderBottomRightRadius).toBe(4);
    expect(bubbleStyle('outgoing', true).borderBottomLeftRadius).toBeUndefined();
    expect(bubbleStyle('incoming', true).borderBottomLeftRadius).toBe(4);
    expect(bubbleStyle('incoming', true).borderBottomRightRadius).toBeUndefined();
    expect(bubbleStyle('outgoing', false).borderBottomRightRadius).toBeUndefined();
  });
});

describe('senderColor and avatarShade', () => {
  it('returns a stable color from the monochrome palette', () => {
    const first = senderColor('deep@test');
    expect(SENDER_COLORS).toContain(first);
    expect(senderColor('deep@test')).toBe(first);
  });

  it('gives AIs the light shade and people a monochrome one', () => {
    expect(avatarShade('ai-1', true).background).toBe('#ededed');
    expect(avatarShade('ai-1', true).color).toBe('#0a0a0a');
    const person = avatarShade('person-1');
    expect(['#262626', '#1a1a1a']).toContain(person.background);
    expect(avatarShade('person-1')).toEqual(person);
  });
});
