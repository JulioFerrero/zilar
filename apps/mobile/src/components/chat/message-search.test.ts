import { describe, expect, it } from 'vitest';

import {
  activeQuery,
  groupSearchByChat,
  nearEnd,
  searchResultTitle,
  snippetParts,
} from './message-search';

describe('activeQuery', () => {
  it('needs at least 2 characters, like the server', () => {
    expect(activeQuery('')).toBeNull();
    expect(activeQuery('x')).toBeNull();
    expect(activeQuery('  ')).toBeNull();
    expect(activeQuery('te')).toBe('te');
    expect(activeQuery('  terrace ')).toBe('terrace');
  });
});

describe('nearEnd', () => {
  it('pages before the list runs out', () => {
    expect(nearEnd(500, 1000, 600)).toBe(true);
    expect(nearEnd(0, 2000, 600)).toBe(false);
  });
});

describe('snippetParts', () => {
  it('highlights the marked ranges as text parts', () => {
    expect(snippetParts('hello terrace world', [[6, 13]])).toEqual([
      { text: 'hello ', mark: false },
      { text: 'terrace', mark: true },
      { text: ' world', mark: false },
    ]);
  });

  it('drops out-of-range, empty and overlapping marks', () => {
    expect(snippetParts('hi', [[-2, 99]])).toEqual([{ text: 'hi', mark: false }]);
    expect(snippetParts('hi', [[1, 1]])).toEqual([{ text: 'hi', mark: false }]);
    expect(
      snippetParts('hello world', [
        [0, 5],
        [3, 8],
      ]),
    ).toEqual([
      { text: 'hello', mark: true },
      { text: ' world', mark: false },
    ]);
  });

  it('counts characters, not UTF-16 units, for multi-byte text', () => {
    // "🌿" is one character but two UTF-16 units; server marks are
    // characters, so [2, 9] covers "terrace" after "a ".
    expect(snippetParts('a 🌿 terrace', [[4, 11]])).toEqual([
      { text: 'a 🌿 ', mark: false },
      { text: 'terrace', mark: true },
    ]);
  });

  it('renders a hostile snippet as plain text without markup', () => {
    const parts = snippetParts('<img src=x onerror=alert(1)>hi', [[28, 30]]);
    expect(parts.map((part) => part.text).join('')).toBe('<img src=x onerror=alert(1)>hi');
    expect(parts.filter((part) => part.mark)).toEqual([{ text: 'hi', mark: true }]);
  });

  it('keeps an empty snippet empty', () => {
    expect(snippetParts('', [])).toEqual([]);
  });
});

describe('groupSearchByChat', () => {
  it('groups in newest-first order with store titles', () => {
    const groups = groupSearchByChat(
      [
        {
          chatJid: 'ana',
          messageId: 'ana-2',
          senderName: 'Ana',
          at: '2026-09-28T12:00:00Z',
          snippet: 'two',
          marks: [],
        },
        {
          chatJid: 'viernes',
          messageId: 'viernes-1',
          senderName: 'Luis',
          at: '2026-09-28T11:00:00Z',
          snippet: 'one',
          marks: [],
        },
        {
          chatJid: 'ana',
          messageId: 'ana-1',
          senderName: 'Ana',
          at: '2026-09-28T10:00:00Z',
          snippet: 'one',
          marks: [],
        },
      ],
      new Map([['ana', 'Ana']]),
    );
    expect(groups.map((group) => group.chatJid)).toEqual(['ana', 'viernes']);
    expect(groups[0]?.title).toBe('Ana');
    expect(groups[0]?.items.map((item) => item.messageId)).toEqual(['ana-2', 'ana-1']);
    // A chat the store has not loaded falls back to its JID, never a guess.
    expect(groups[1]?.title).toBe('viernes');
  });
});

describe('searchResultTitle', () => {
  it('shows Group › Topic for topics, the plain title otherwise', () => {
    expect(searchResultTitle('Dev team', 'General')).toBe('Dev team › General');
    expect(searchResultTitle('Ana')).toBe('Ana');
  });
});
