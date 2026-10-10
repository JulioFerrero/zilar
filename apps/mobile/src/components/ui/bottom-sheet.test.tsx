import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BottomSheet } from './bottom-sheet';

// The sheet is hook- and native-free enough to render with `react-native`
// stubbed (same pattern as `kit.test.tsx`): Node only, no simulator. The
// keyboard hook's effects never run under `renderToStaticMarkup`.
vi.mock('react-native', () => ({
  Keyboard: { addListener: vi.fn(() => ({ remove: vi.fn() })) },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

const noop = (): void => undefined;

describe('BottomSheet', () => {
  it('renders the title as a header', () => {
    const html = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          visible: true,
          onClose: noop,
          closeLabel: 'Close sample',
          title: 'Sample title',
        },
        'Child content',
      ),
    );
    expect(html).toContain('Sample title');
    expect(html).toContain('accessibilityRole="header"');
  });

  it('labels the backdrop with the close label', () => {
    const html = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          visible: true,
          onClose: noop,
          closeLabel: 'Close sample',
        },
        'Child content',
      ),
    );
    expect(html).toContain('Close sample');
  });

  it('renders the children', () => {
    const html = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          visible: true,
          onClose: noop,
          closeLabel: 'Close sample',
        },
        'Child content',
      ),
    );
    expect(html).toContain('Child content');
  });

  it('defaults to max-h-[85%] and applies a custom max height class', () => {
    const fallback = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          visible: true,
          onClose: noop,
          closeLabel: 'Close sample',
        },
        'Child content',
      ),
    );
    expect(fallback).toContain('max-h-[85%]');
    const custom = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          visible: true,
          onClose: noop,
          closeLabel: 'Close sample',
          maxHeightClassName: 'max-h-[70%]',
        },
        'Child content',
      ),
    );
    expect(custom).toContain('max-h-[70%]');
    expect(custom).not.toContain('max-h-[85%]');
  });
});
