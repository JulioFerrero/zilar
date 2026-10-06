import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './checkbox';

// Node-only pattern from `bottom-sheet.test.tsx`: stub `react-native` and
// `nativewind`, mock the lucide `Check` as a host tag so the render output
// shows whether the icon is present.
vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

vi.mock('@/lib/colors', () => ({
  ACCENT_FOREGROUND: { dark: '#0a0a0a', light: '#0a0a0a' },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

describe('Checkbox', () => {
  it('renders the Check icon when checked', () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { checked: true }));
    expect(html).toContain('Check');
    expect(html).toContain('border-accent bg-accent');
  });

  it('renders no Check icon when unchecked', () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { checked: false }));
    expect(html).not.toContain('Check');
    expect(html).toContain('border-border-strong');
  });

  it('applies the disabled class', () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { checked: true, disabled: true }));
    expect(html).toContain('opacity-50');
  });
});
