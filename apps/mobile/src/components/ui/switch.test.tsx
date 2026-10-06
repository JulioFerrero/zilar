import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './switch';

// The kit is hook- and native-free enough to render with `react-native`
// stubbed (same pattern as `kit.test.tsx`): Node only, no simulator.
vi.mock('react-native', () => ({
  Switch: 'Switch',
  View: 'View',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

const noop = (): void => undefined;

describe('Switch', () => {
  it('renders the label and names the control with it', () => {
    const html = renderToStaticMarkup(
      createElement(Switch, { label: 'Muted chats', value: false, onValueChange: noop }),
    );
    expect(html).toContain('Muted chats');
    expect(html).toContain('accessibilityLabel="Muted chats"');
  });

  it('hides the visible label but keeps the accessibility name', () => {
    const html = renderToStaticMarkup(
      createElement(Switch, {
        label: 'Read chats',
        value: false,
        onValueChange: noop,
        hideLabel: true,
      }),
    );
    expect(html).not.toContain('>Read chats<');
    expect(html).toContain('accessibilityLabel="Read chats"');
  });

  it('passes value through to the native switch', () => {
    const on = renderToStaticMarkup(
      createElement(Switch, { label: 'Muted chats', value: true, onValueChange: noop }),
    );
    expect(on).toContain('value="true"');
    const off = renderToStaticMarkup(
      createElement(Switch, { label: 'Muted chats', value: false, onValueChange: noop }),
    );
    expect(off).toContain('value="false"');
  });
});
