import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Linking } from 'react-native';
import type { UiMention } from '@zilar/chat-core';

import { LinkText } from './link-text';

// Same render style as the other chat component tests: the mobile app has no
// React Native testing library, so the component is rendered to a plain
// element tree with `react-native` stubbed.
vi.mock('react-native', () => ({
  Text: 'Text',
  Linking: { openURL: vi.fn() },
}));

vi.mock('@/lib/links', () => ({
  safeLinkTarget: (href: string) => href,
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; style?: unknown; onPress?: () => void };
}

/**
 * Resolves the component tree the way React would: a function element is
 * called with its props, a host element (the stubbed `Text`) is kept and its
 * children resolved.
 */
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

function styleOf(element: TestElement): Record<string, unknown> {
  const raw = element.props.style;
  const merged: Record<string, unknown> = {};
  for (const item of Array.isArray(raw) ? raw : [raw]) {
    if (item !== null && typeof item === 'object') {
      Object.assign(merged, item);
    }
  }
  return merged;
}

function textOf(node: unknown): string {
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (node !== null && typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

function render(
  text: string,
  options?: { mentions?: UiMention[]; meJid?: string; outgoing?: boolean },
): TestElement[] {
  return collect(
    LinkText({
      text,
      color: '#ededed',
      mentions: options?.mentions,
      meJid: options?.meJid,
      outgoing: options?.outgoing,
    }),
  );
}

const BOB: UiMention = { jid: 'bob@example.com', name: 'Bob', begin: 6, end: 10 };

describe('LinkText mentions', () => {
  beforeEach(() => {
    vi.mocked(Linking.openURL).mockClear();
  });

  it('renders text without mentions as before, links included', () => {
    const elements = render('see https://example.com now');
    const underlined = elements.filter(
      (element) => styleOf(element).textDecorationLine === 'underline',
    );
    expect(underlined).toHaveLength(1);
    expect(textOf(underlined[0]?.props.children)).toBe('https://example.com');
    expect(elements.every((element) => styleOf(element).backgroundColor === undefined)).toBe(true);
  });

  it('renders a mention as its own span with the chip style', () => {
    const elements = render('hello @Bob!', { mentions: [BOB] });
    const chips = elements.filter(
      (element) => styleOf(element).backgroundColor === 'rgba(255,255,255,0.08)',
    );
    expect(chips).toHaveLength(1);
    expect(textOf(chips[0]?.props.children)).toBe('@Bob');
    expect(styleOf(chips[0] as TestElement).fontFamily).toBe('Geist_600SemiBold');
    expect(chips[0]?.props.onPress).toBeUndefined();
  });

  it('gives a mention of me the stronger background', () => {
    const elements = render('hello @Bob!', {
      mentions: [BOB],
      meJid: 'bob@example.com',
    });
    const mine = elements.filter(
      (element) => styleOf(element).backgroundColor === 'rgba(255,255,255,0.18)',
    );
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]?.props.children)).toBe('@Bob');
    expect(styleOf(mine[0] as TestElement).color).toBe('#ededed');
  });

  it('uses the dark chip in an outgoing bubble, even for a mention of me', () => {
    const elements = render('hello @Bob!', {
      mentions: [BOB],
      meJid: 'bob@example.com',
      outgoing: true,
    });
    const chips = elements.filter(
      (element) => styleOf(element).backgroundColor === 'rgba(0,0,0,0.08)',
    );
    expect(chips).toHaveLength(1);
    expect(textOf(chips[0]?.props.children)).toBe('@Bob');
    expect(
      elements.some((element) => styleOf(element).backgroundColor === 'rgba(255,255,255,0.18)'),
    ).toBe(false);
  });

  it('keeps a link after a mention pressable', () => {
    const elements = render('hi @Bob see https://example.com', {
      mentions: [BOB],
    });
    const chips = elements.filter(
      (element) => styleOf(element).backgroundColor === 'rgba(255,255,255,0.08)',
    );
    expect(chips).toHaveLength(1);
    const link = elements.find(
      (element) =>
        styleOf(element).textDecorationLine === 'underline' &&
        typeof element.props.onPress === 'function',
    );
    expect(link).toBeDefined();
    expect(textOf(link?.props.children)).toBe('https://example.com');
    link?.props.onPress?.();
    expect(vi.mocked(Linking.openURL)).toHaveBeenCalledWith('https://example.com');
  });
});
