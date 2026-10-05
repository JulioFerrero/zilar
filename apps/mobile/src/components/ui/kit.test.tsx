import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './card';
import { CountBadge } from './count-badge';
import { ListRow } from './list-row';

// The kit is hook- and native-free enough to render with `react-native`
// stubbed (same pattern as `settings-ui.test.tsx`): Node only, no simulator.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  ChevronRight: 'ChevronRight',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

describe('ListRow', () => {
  it('renders the title and the subtitle', () => {
    const html = renderToStaticMarkup(
      createElement(ListRow, { title: 'Notifications', subtitle: 'Sounds and vibrations' }),
    );
    expect(html).toContain('Notifications');
    expect(html).toContain('Sounds and vibrations');
  });

  it('renders a count at or above 1 and no count at 0', () => {
    expect(renderToStaticMarkup(createElement(ListRow, { title: 'Requests', count: 3 }))).toContain(
      '>3<',
    );
    expect(
      renderToStaticMarkup(createElement(ListRow, { title: 'Requests', count: 0 })),
    ).not.toContain('>0<');
  });

  it('renders the chevron by default and hides it when told to', () => {
    expect(renderToStaticMarkup(createElement(ListRow, { title: 'With chevron' }))).toContain(
      'ChevronRight',
    );
    expect(
      renderToStaticMarkup(createElement(ListRow, { title: 'No chevron', chevron: false })),
    ).not.toContain('ChevronRight');
  });
});

describe('Card', () => {
  it('puts a divider only between children', () => {
    const html = renderToStaticMarkup(
      createElement(
        Card,
        null,
        createElement('Text', { key: 'one' }, 'One'),
        createElement('Text', { key: 'two' }, 'Two'),
        createElement('Text', { key: 'three' }, 'Three'),
      ),
    );
    expect(html.split('border-t border-divider')).toHaveLength(3);
  });
});

describe('CountBadge', () => {
  it('renders nothing at zero or below', () => {
    expect(renderToStaticMarkup(createElement(CountBadge, { count: 0 }))).toBe('');
    expect(renderToStaticMarkup(createElement(CountBadge, { count: -2 }))).toBe('');
  });

  it('renders the count otherwise', () => {
    expect(renderToStaticMarkup(createElement(CountBadge, { count: 5 }))).toContain('>5<');
  });
});
