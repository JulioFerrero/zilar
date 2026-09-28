import { describe, expect, it } from 'vitest';
import { markdownToPlain, shouldRenderMarkdown } from './markdown';
import type { ChatSummary, UiMessage } from './types';

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'c-1',
    title: 'Chat',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function message(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: 'm-1',
    chatId: 'c-1',
    senderId: 'u-bea',
    senderName: 'Bea',
    text: 'hello',
    createdAt: new Date(2026, 9, 1, 12, 0),
    status: 'read',
    ...overrides,
  };
}

describe('shouldRenderMarkdown', () => {
  it('renders an incoming message in an AI chat', () => {
    expect(shouldRenderMarkdown(chat({ isAI: true }), message(), 'u-you')).toBe(true);
  });

  it('stays plain for your own message, a human DM and a group', () => {
    const own = message({ senderId: 'u-you' });
    expect(shouldRenderMarkdown(chat({ isAI: true }), own, 'u-you')).toBe(false);
    expect(shouldRenderMarkdown(chat(), message(), 'u-you')).toBe(false);
    expect(shouldRenderMarkdown(chat({ isAI: false, kind: 'group' }), message(), 'u-you')).toBe(
      false,
    );
  });
});

describe('markdownToPlain', () => {
  it('strips emphasis and strike markers', () => {
    expect(markdownToPlain('a **bold** and *italic* and ~~gone~~')).toBe(
      'a bold and italic and gone',
    );
    expect(markdownToPlain('__bold__ _italic_')).toBe('bold italic');
  });

  it('strips inline code backticks and keeps the content', () => {
    expect(markdownToPlain('use `pnpm test` now')).toBe('use pnpm test now');
    expect(markdownToPlain('run ``a `b` c``')).toBe('run a `b` c');
  });

  it('keeps link text and drops the URL', () => {
    expect(markdownToPlain('see [the docs](https://x.com/a) please')).toBe('see the docs please');
    expect(markdownToPlain('![a diagram](https://x.com/p.png)')).toBe('a diagram');
  });

  it('strips heading, list and quote markers', () => {
    expect(markdownToPlain('## Heading')).toBe('Heading');
    expect(markdownToPlain('- one\n- two')).toBe('one two');
    expect(markdownToPlain('1. one\n2. two')).toBe('one two');
    expect(markdownToPlain('> quoted\n>> nested')).toBe('quoted nested');
  });

  it('collapses a fenced code block to its content', () => {
    expect(markdownToPlain('before\n```js\nconst x = 1;\n```\nafter')).toBe(
      'before const x = 1; after',
    );
    expect(markdownToPlain('~~~\nplain *kept*\n~~~')).toBe('plain *kept*');
  });

  it('drops horizontal rules and collapses whitespace', () => {
    expect(markdownToPlain('a\n\n---\n\nb')).toBe('a b');
    expect(markdownToPlain('  spaced   out  ')).toBe('spaced out');
  });

  it('leaves text that only contains a marker character alone', () => {
    expect(markdownToPlain('2 * 3')).toBe('2 * 3');
    expect(markdownToPlain('a * b * c')).toBe('a * b * c');
    expect(markdownToPlain('snake_case_name')).toBe('snake_case_name');
  });

  it('does not throw on partial Markdown', () => {
    expect(() => markdownToPlain('**bold')).not.toThrow();
    expect(markdownToPlain('**bold')).toBe('**bold');
    expect(markdownToPlain('```js\nconst x = 1;')).toBe('const x = 1;');
    expect(markdownToPlain('a [link](https://x.com')).toBe('a [link](https://x.com');
  });

  it('returns an empty string for empty input', () => {
    expect(markdownToPlain('')).toBe('');
  });
});
