import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { InviteSheet, InviteSheetBody } from './invite-sheet';

// The hook-free body is called as a plain function with `react-native`
// stubbed (same pattern as `invite-links-sheet.test.tsx`): Node only, no
// simulator, no new dependency. The stateful wrapper's effects never run
// under `react-dom/server`, so its initial loading render is asserted there
// and every later state through the body.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark' as const,
}));

vi.mock('@/lib/colors', () => ({
  ACCENT_FOREGROUND: { dark: '#0a0a0a', light: '#0a0a0a' },
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

// No `@/lib/depth` mock: `InviteSheetBody` no longer reads it (the icon
// color comes from `@/lib/colors`), and mocking only part of what the real
// kit `Button` needs would break the transitive `Button` import.

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Copy: 'Copy',
  Share2: 'Share2',
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; onPress?: () => void; [key: string]: unknown };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

const URL = 'https://chat.zilar.app/invite/abc123';

function body(overrides: Partial<Parameters<typeof InviteSheetBody>[0]> = {}) {
  return InviteSheetBody({
    url: undefined,
    failed: false,
    copied: false,
    onCopy: () => {},
    onShare: () => {},
    onRetry: () => {},
    onClose: () => {},
    ...overrides,
  });
}

function press(elements: TestElement[], label: string): void {
  const button = elements.find((element) => element.props.accessibilityLabel === label);
  expect(button).toBeDefined();
  const onPress = (button as TestElement).props.onPress;
  expect(typeof onPress).toBe('function');
  (onPress as () => void)();
}

describe('InviteSheetBody', () => {
  it('shows Creating link… while the link loads', () => {
    const all = textOf(collect(body()));
    expect(all).toContain('Invite a friend');
    expect(all).toContain('They join Zilar already connected to you.');
    expect(all).toContain('Creating link…');
  });

  it('shows the link once created', () => {
    const all = textOf(collect(body({ url: URL })));
    expect(all).toContain(URL);
    expect(all).not.toContain('Creating link…');
  });

  it('Copy calls onCopy and Copied renders with the check icon', () => {
    const calls: string[] = [];
    const before = collect(body({ url: URL, onCopy: () => calls.push('copy') }));
    expect(textOf(before)).toContain('Copy');
    expect(before.filter((element) => element.type === 'Copy')).toHaveLength(1);
    expect(before.filter((element) => element.type === 'Check')).toHaveLength(0);
    press(before, 'Copy invite link');
    expect(calls).toEqual(['copy']);

    const after = collect(body({ url: URL, copied: true }));
    expect(textOf(after)).toContain('Copied');
    expect(after.filter((element) => element.type === 'Check')).toHaveLength(1);
    expect(after.filter((element) => element.type === 'Copy')).toHaveLength(0);
  });

  it('Share calls onShare', () => {
    const calls: string[] = [];
    press(collect(body({ url: URL, onShare: () => calls.push('share') })), 'Share invite link');
    expect(calls).toEqual(['share']);
  });

  it('shows the failure sentence with Try again and Close, and no link row', () => {
    const calls: string[] = [];
    const elements = collect(
      body({
        failed: true,
        onRetry: () => calls.push('retry'),
        onClose: () => calls.push('close'),
      }),
    );
    const all = textOf(elements);
    expect(all).toContain('Could not create an invite link. Try again.');
    expect(all).not.toContain('Creating link…');
    press(elements, 'Try again');
    press(elements, 'Close');
    expect(calls).toEqual(['retry', 'close']);
  });

  it('Close dismisses the loaded box', () => {
    const calls: string[] = [];
    press(collect(body({ url: URL, onClose: () => calls.push('close') })), 'Close');
    expect(calls).toEqual(['close']);
  });

  it('never renders raw error text', () => {
    const all = textOf(collect(body({ failed: true })));
    expect(all).not.toMatch(/Bearer|Error: /i);
  });
});

describe('InviteSheet', () => {
  it('renders the invite box in its loading state', () => {
    const html = renderToStaticMarkup(
      createElement(InviteSheet, {
        api: { createInvite: async () => ({ code: 'x', url: URL }) },
        copyText: async () => {},
        shareText: async () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('Invite a friend');
    expect(html).toContain('Creating link');
  });
});
