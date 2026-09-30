import { describe, expect, it, vi } from 'vitest';

import { SearchHitLine, SearchSnippet } from './search-snippet';

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
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

function renderSnippet(snippet: string, marks: Array<[number, number]>): TestElement[] {
  return collect(SearchSnippet({ snippet, marks }));
}

describe('SearchSnippet', () => {
  it('renders every slice as text, never HTML', () => {
    const elements = renderSnippet('<img src=x onerror=alert(1)>hi', [[28, 30]]);

    expect(textOf(elements[0]?.props.children)).toBe('<img src=x onerror=alert(1)>hi');
    // Only host `Text` nodes: no link, no HTML element anywhere.
    for (const element of elements) {
      expect(element.type).toBe('Text');
    }
  });

  it('highlights the marked range and ignores bad offsets', () => {
    const elements = renderSnippet('hello terrace world', [
      [6, 13],
      [-5, 99],
      [7, 7],
    ]);

    const marked = elements.filter((element) => {
      const style = element.props.style;
      const merged: Record<string, unknown> = {};
      for (const item of Array.isArray(style) ? style : [style]) {
        if (item !== null && typeof item === 'object') {
          Object.assign(merged, item);
        }
      }
      return merged['backgroundColor'] === '#2a2a2a';
    });
    expect(marked).toHaveLength(1);
    expect(textOf(marked[0]?.props.children)).toBe('terrace');
  });

  it('renders multi-byte text without splitting the emoji', () => {
    const elements = renderSnippet('a 🌿 terrace', [[4, 11]]);
    expect(textOf(elements[0]?.props.children)).toBe('a 🌿 terrace');
  });
});

describe('SearchHitLine', () => {
  it('shows the sender name and the snippet as text', () => {
    const elements = collect(
      SearchHitLine({
        item: {
          chatJid: 'ana',
          messageId: 'ana-12',
          senderName: 'Ana',
          at: '2026-09-28T12:30:00.000Z',
          snippet: 'that other place with the terrace',
          marks: [[24, 31]],
        },
      }),
    );
    expect(textOf(elements)).toContain('Ana');
    expect(textOf(elements)).toContain('that other place with the terrace');
  });
});
