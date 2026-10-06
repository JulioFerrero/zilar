import { Bell } from 'lucide-react-native';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActionSheet, ActionSheetItem } from './action-sheet';
import { Card, SectionLabel } from './card';
import { ConfirmDialog } from './confirm-dialog';
import { CountBadge } from './count-badge';
import { ListRow } from './list-row';

// The kit is hook- and native-free enough to render with `react-native`
// stubbed (same pattern as `settings-ui.test.tsx`): Node only, no simulator.
vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  Bell: 'Bell',
  ChevronRight: 'ChevronRight',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
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

describe('SectionLabel', () => {
  it('renders as a header for screen readers', () => {
    const html = renderToStaticMarkup(createElement(SectionLabel, null, 'Account'));
    expect(html).toContain('Account');
    expect(html).toContain('accessibilityRole="header"');
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

const noop = (): void => undefined;

describe('ActionSheet / ActionSheetItem', () => {
  it('renders the item labels and the backdrop close label', () => {
    const html = renderToStaticMarkup(
      createElement(
        ActionSheet,
        { visible: true, onClose: noop, closeLabel: 'Close actions' },
        createElement(ActionSheetItem, { key: 'pin', label: 'Pin', onPress: noop }),
        createElement(ActionSheetItem, { key: 'mute', label: 'Mute', onPress: noop }),
      ),
    );
    expect(html).toContain('Pin');
    expect(html).toContain('Mute');
    expect(html).toContain('Close actions');
  });

  it('passes disabled through and renders a destructive label in the danger colour', () => {
    const html = renderToStaticMarkup(
      createElement(ActionSheetItem, {
        label: 'Delete',
        destructive: true,
        disabled: true,
        onPress: noop,
      }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('text-danger');
  });

  it('draws an icon at 18 px', () => {
    const html = renderToStaticMarkup(
      createElement(ActionSheetItem, { label: 'Notifications', icon: Bell, onPress: noop }),
    );
    expect(html).toContain('<Bell');
    expect(html).toContain('size="18"');
  });

  it('puts a divider between items and none after the last one', () => {
    const html = renderToStaticMarkup(
      createElement(
        ActionSheet,
        { visible: true, onClose: noop, closeLabel: 'Close actions' },
        createElement(ActionSheetItem, { key: 'one', label: 'One', onPress: noop }),
        createElement(ActionSheetItem, { key: 'two', label: 'Two', onPress: noop }),
        createElement(ActionSheetItem, { key: 'three', label: 'Three', onPress: noop }),
      ),
    );
    expect(html.split('border-b border-divider')).toHaveLength(3);
  });
});

describe('ConfirmDialog', () => {
  it('renders the title and the message', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        visible: true,
        title: 'Delete this AI?',
        message: 'This removes the chat account.',
        confirmLabel: 'Remove',
        busyLabel: 'Removing…',
        busy: false,
        onCancel: noop,
        onConfirm: noop,
      }),
    );
    expect(html).toContain('Delete this AI?');
    expect(html).toContain('This removes the chat account.');
  });

  it('renders the error as an alert', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        visible: true,
        title: 'Delete this AI?',
        message: 'This removes the chat account.',
        error: 'Could not delete the AI.',
        confirmLabel: 'Remove',
        busyLabel: 'Removing…',
        busy: false,
        onCancel: noop,
        onConfirm: noop,
      }),
    );
    expect(html).toContain('accessibilityRole="alert"');
    expect(html).toContain('Could not delete the AI.');
  });

  it('disables both buttons and shows the busy label while busy', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        visible: true,
        title: 'Delete this AI?',
        message: 'This removes the chat account.',
        confirmLabel: 'Remove',
        busyLabel: 'Removing…',
        busy: true,
        onCancel: noop,
        onConfirm: noop,
      }),
    );
    expect(html).toContain('Removing…');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
