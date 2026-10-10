import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { EMOJI_GRID_COLUMNS, EmojiTab } from './emoji-tab';

vi.mock('lucide-react-native', () => ({
  Clock: 'Clock',
  Hand: 'Hand',
  Hash: 'Hash',
  Heart: 'Heart',
  Lightbulb: 'Lightbulb',
  PawPrint: 'PawPrint',
  Pizza: 'Pizza',
  Plane: 'Plane',
  Smile: 'Smile',
  Trophy: 'Trophy',
}));

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#fff',
}));

function tab(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(EmojiTab, {
      open: true,
      recents: ['😀', '❤️'],
      activeCategory: undefined,
      onSelectCategory: () => {},
      onPick: () => {},
      ...overrides,
    }),
  );
}

describe('EmojiTab (T-0175)', () => {
  it('shows the recent row first and the category strip', () => {
    const html = tab();
    expect(html).toContain('Recent emoji');
    expect(html).toContain('Smileys emoji');
    expect(html).toContain('Animals emoji');
    expect(html).toContain('Symbols emoji');
  });

  it('shows recents first, then the selected category grid', () => {
    expect(tab()).toContain('Insert 😀');
    expect(tab({ recents: [] })).toContain('Insert 😂');
    expect(tab({ activeCategory: 'hearts' })).toContain('Insert ❤️');
  });

  it('renders the grid at eight columns', () => {
    expect(EMOJI_GRID_COLUMNS).toBe(8);
  });

  it('explains an empty recent row instead of showing nothing', () => {
    const html = tab({ recents: [], activeCategory: 'recent' });
    expect(html).toContain('Tap an emoji below to keep it here.');
  });

  it('renders nothing when closed', () => {
    expect(tab({ open: false })).toBe('');
  });
});
