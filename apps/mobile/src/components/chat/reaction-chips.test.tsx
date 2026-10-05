import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiReaction } from '@zilar/chat-core';

import { ReactionChips } from './reaction-chips';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

vi.mock('@/lib/depth', () => ({
  raisedPill: { borderWidth: 1 },
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; style?: unknown };
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

describe('ReactionChips', () => {
  const reactions: UiReaction[] = [
    { emoji: '👍', count: 3, mine: true, reactors: ['You', 'Ana', 'Luis'] },
    { emoji: '❤️', count: 1, mine: false, reactors: ['Marta'] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one chip per reaction with its count and accessible label', () => {
    const elements = collect(ReactionChips({ reactions, outgoing: false }));
    const allText = textOf(elements);
    expect(allText).toContain('👍');
    expect(allText).toContain('❤️');
    expect(allText).toContain('3');
    expect(allText).toContain('1');

    const chips = elements.filter((element) => element.type === 'Pressable');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.props).toMatchObject({
      accessibilityLabel: '👍 3, including you',
      accessibilityState: { selected: true },
    });
    expect(chips[1]?.props).toMatchObject({
      accessibilityLabel: '❤️ 1',
      accessibilityState: { selected: false },
    });
  });

  it('marks my reactions as selected and the others not', () => {
    const elements = collect(ReactionChips({ reactions, outgoing: true }));
    const chips = elements.filter((element) => element.type === 'Pressable');
    expect(chips[0]?.props).toMatchObject({
      accessibilityState: { selected: true },
    });
    expect(chips[1]?.props).toMatchObject({
      accessibilityState: { selected: false },
    });
  });

  it('renders nothing without reactions', () => {
    expect(collect(ReactionChips({ reactions: [], outgoing: false }))).toEqual([]);
  });

  it('does nothing on press without onToggle, and calls it otherwise', () => {
    const toggled: string[] = [];
    const disabled = collect(ReactionChips({ reactions, outgoing: false }));
    const disabledChips = disabled.filter((element) => element.type === 'Pressable');
    expect(disabledChips).toHaveLength(2);
    expect(
      disabledChips.every((chip) => (chip.props as { disabled?: boolean }).disabled === true),
    ).toBe(true);
    expect(
      disabledChips.every((chip) => (chip.props as { onPress?: () => void }).onPress === undefined),
    ).toBe(true);

    const enabled = collect(
      ReactionChips({ reactions, outgoing: false, onToggle: (emoji) => toggled.push(emoji) }),
    );
    const enabledChips = enabled.filter((element) => element.type === 'Pressable');
    expect(enabledChips).toHaveLength(2);
    expect(
      enabledChips.every((chip) => (chip.props as { disabled?: boolean }).disabled === false),
    ).toBe(true);
    const firstChip = enabledChips[0];
    expect(firstChip).toBeDefined();
    const props = firstChip?.props as { onPress?: () => void };
    const onPress = props?.onPress;
    expect(onPress).toBeDefined();
    onPress?.();
    expect(toggled).toEqual(['👍']);
  });
});
