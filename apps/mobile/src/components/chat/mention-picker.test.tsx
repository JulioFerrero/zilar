import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { MentionPicker } from './mention-picker';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/chat/ai-badge', () => ({
  AiBadge: 'AiBadge',
}));

const members = [
  { jid: 'ana@zilar.test', name: 'Ana', handle: 'ana' },
  { jid: 'luis@zilar.test', name: 'Luis' },
  { jid: 'ai-dev-ai@zilar.test', name: 'Dev AI' },
];

describe('MentionPicker (T-0227)', () => {
  function picker(): string {
    return renderToStaticMarkup(createElement(MentionPicker, { members, onSelect: () => {} }));
  }

  it('renders one row per member', () => {
    const html = picker();
    expect(html).toContain('Ana');
    expect(html).toContain('Luis');
    expect(html).toContain('Dev AI');
    expect(html.match(/<Pressable/g)?.length ?? 0).toBe(3);
  });

  it('shows the handle muted next to the name when the member has one', () => {
    const html = picker();
    expect(html).toContain('@ana');
  });

  it('marks AI rows with the AI badge', () => {
    const html = picker();
    expect(html).toContain('AiBadge');
    // One open tag plus its closing tag per AI row.
    expect(html.match(/<AiBadge/g)?.length ?? 0).toBe(1);
  });

  it('labels rows for assistive tech, with the handle when present', () => {
    const html = picker();
    expect(html).toContain('Mention Ana @ana');
    expect(html).toContain('Mention Luis');
  });

  it('calls onSelect with the tapped member through the row Pressable', () => {
    const calls: unknown[] = [];
    // Render the component function directly (no RN test renderer in this
    // repo): the output tree holds one `Pressable` per member whose `onPress`
    // must call `onSelect` with that member. Calling `onSelect` itself would
    // pass even with a broken row (no `onPress`, or `onPress={onSelect}`
    // receiving the press event instead of the member).
    const tree = MentionPicker({
      members,
      onSelect: (member) => {
        calls.push(member);
      },
    });
    const children = tree.props.children;
    const rows = (Array.isArray(children) ? children : [children]).filter(
      (child): child is { props: { onPress?: () => void } } =>
        typeof child === 'object' && child !== null && 'props' in child,
    );
    expect(rows.length).toBe(members.length);
    rows.forEach((row) => expect(row.props.onPress).toBeDefined());
    rows[0]?.props.onPress?.();
    expect(calls).toEqual([members[0]]);
  });
});
