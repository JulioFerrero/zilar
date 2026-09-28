import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Linking } from 'react-native';

import { MarkdownText } from './markdown-text';

// The mobile app has no React Native testing library, so the component is
// rendered to a plain element tree with `react-native` stubbed. This keeps the
// test in Node (no simulator, no new dependency) while still exercising the
// real component function and its styles.
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  ScrollView: 'ScrollView',
  Linking: { openURL: vi.fn() },
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; style?: unknown; onPress?: () => void };
}

/**
 * Resolves the component tree the way React would: a function element is called
 * with its props, a host element (the stubbed `View` / `Text` / `ScrollView`) is
 * kept and its children resolved.
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

function render(text: string): TestElement[] {
  return collect(MarkdownText.type({ text, color: '#ededed' }));
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

function findStyle(elements: TestElement[], key: string, value: unknown): TestElement[] {
  return elements.filter((element) => styleOf(element)[key] === value);
}

describe('MarkdownText', () => {
  beforeEach(() => {
    vi.mocked(Linking.openURL).mockClear();
  });

  it('renders a paragraph with bold, italic, strike and inline code', () => {
    const elements = render('plain **bold** *italic* ~~gone~~ `code`');
    expect(findStyle(elements, 'fontFamily', 'Geist_600SemiBold')).toHaveLength(1);
    expect(findStyle(elements, 'fontStyle', 'italic')).toHaveLength(1);
    expect(findStyle(elements, 'textDecorationLine', 'line-through')).toHaveLength(1);
    const code = findStyle(elements, 'fontFamily', 'GeistMono_400Regular');
    expect(code.some((element) => textOf(element.props.children) === 'code')).toBe(true);
    expect(textOf(elements[0]?.props.children)).toContain('plain ');
  });

  it('renders headings no larger than 20 px', () => {
    const h1 = findStyle(render('# One'), 'fontSize', 20);
    expect(h1).toHaveLength(1);
    expect(textOf(h1[0]?.props.children)).toBe('One');
    const h6 = findStyle(render('###### Six'), 'fontSize', 16);
    expect(h6).toHaveLength(1);
    expect(textOf(h6[0]?.props.children)).toBe('Six');
  });

  it('renders a fenced code block in a horizontal well', () => {
    const elements = render('```ts\nconst x = 1;\n```');
    expect(elements.some((element) => element.type === 'ScrollView')).toBe(true);
    const code = findStyle(elements, 'fontFamily', 'GeistMono_400Regular');
    expect(code.some((element) => textOf(element.props.children) === 'const x = 1;')).toBe(true);
  });

  it('aligns bullet and numbered list markers', () => {
    const bullets = render('- one\n- two');
    expect(bullets.filter((element) => textOf(element.props.children) === '•')).toHaveLength(2);
    const ordered = render('3. third');
    expect(ordered.some((element) => textOf(element.props.children) === '3.')).toBe(true);
  });

  it('draws a quote with a left bar', () => {
    const quote = findStyle(render('> quoted'), 'borderLeftColor', '#333');
    expect(quote).toHaveLength(1);
    expect(textOf(quote[0]?.props.children)).toContain('quoted');
  });

  it('opens safe links and renders unsafe links as plain text', () => {
    const safe = render('[docs](https://x.com/a)');
    const link = findStyle(safe, 'textDecorationLine', 'underline')[0];
    expect(link).toBeDefined();
    link?.props.onPress?.();
    expect(Linking.openURL).toHaveBeenCalledWith('https://x.com/a');

    const unsafe = render('[click](javascript:alert(1))');
    expect(findStyle(unsafe, 'textDecorationLine', 'underline')).toHaveLength(0);
    expect(textOf(unsafe[0]?.props.children)).toContain('click');
  });

  it('renders an image as its alt text and raw HTML as text', () => {
    expect(textOf(render('![a diagram](https://evil.test/s.png)')[0]?.props.children)).toBe(
      'a diagram',
    );
    expect(textOf(render('<b>hi</b>')[0]?.props.children)).toBe('<b>hi</b>');
  });

  it('renders nothing for an empty string', () => {
    expect(render('')).toEqual([]);
  });

  it('does not throw on partial Markdown', () => {
    expect(() => render('**bold\n\n```ts\nconst x = 1;')).not.toThrow();
    expect(() => render('> [a](javascript:\n\n|')).not.toThrow();
  });
});
