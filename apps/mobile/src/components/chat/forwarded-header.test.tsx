import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ForwardOrigin } from '@zilar/protocol';

import { ForwardedHeader } from './forwarded-header';

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  const styled =
    (tag: string) =>
    (props: Record<string, unknown>): unknown => {
      const { children, ...rest } = props;
      return h(tag, rest, children as never);
    };
  return { View: styled('View') };
});

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  Forward: 'Forward',
}));

vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/lib/color-scheme', () => ({ asColorScheme: () => 'dark' }));
vi.mock('@/lib/colors', () => ({ MUTED_FOREGROUND: { dark: '#888' } }));

function origin(overrides: Partial<ForwardOrigin> = {}): ForwardOrigin {
  return {
    sender_id: 'luis@zilar.test',
    sender_name: 'Luis',
    original_at: '2026-08-30T18:00:00.000Z',
    ...overrides,
  };
}

describe('ForwardedHeader', () => {
  it('labels the sender when the origin has no source chat', () => {
    const html = renderToStaticMarkup(createElement(ForwardedHeader, { origin: origin() }));
    expect(html).toContain('Forwarded from Luis');
    expect(html).not.toContain(' in ');
  });

  it('adds the source chat when the origin is public', () => {
    const html = renderToStaticMarkup(
      createElement(ForwardedHeader, {
        origin: origin({ chat_id: 'viernes@conference.zilar.test', chat_name: 'Friday plans' }),
      }),
    );
    expect(html).toContain('Forwarded from Luis in Friday plans');
  });
});
