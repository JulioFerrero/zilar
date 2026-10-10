import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/mock/gate', () => ({
  isMockMode: vi.fn(() => true),
  isMockApiEnabled: vi.fn(() => false),
}));

import { searchMessages } from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { groupByChat } from '@/components/MessageSearchResults';
import { SearchSnippet } from '@/components/MessageSearchResult';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useMessageSearch } from '@/lib/useMessageSearch';
import { renderHook, act as hookAct } from '@testing-library/react';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const mockEnabled = vi.mocked(isMockApiEnabled);

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('searchMessages', () => {
  it('parses a server-shaped page', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            chatJid: 'c-ana',
            messageId: 'o-1',
            senderName: 'Ana',
            at: '2026-09-28T10:00:00.000Z',
            snippet: 'concert tickets',
            marks: [[8, 15]],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const page = await searchMessages({ q: 'tickets' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.snippet).toBe('concert tickets');
    expect(fetchMock).toHaveBeenCalledOnce();
    const firstCall = fetchMock.mock.calls[0] as [unknown] | undefined;
    const url = String(firstCall?.[0] ?? '');
    expect(url).toContain('/api/search?');
    expect(url).toContain('q=tickets');
  });

  it('carries the chat filter, limit and cursor', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await searchMessages({ q: 'hi there', chat: 'c-ana', limit: 10, before: '123' });
    const secondCall = fetchMock.mock.calls[0] as [unknown] | undefined;
    const url = String(secondCall?.[0] ?? '');
    expect(url).toContain('q=hi+there');
    expect(url).toContain('chat=c-ana');
    expect(url).toContain('limit=10');
    expect(url).toContain('before=123');
  });

  it('surfaces a 501 as search_unavailable so the UI can hide itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(501, { error: { code: 'search_unavailable', message: 'no' } }),
      ),
    );
    await expect(searchMessages({ q: 'tickets' })).rejects.toMatchObject({
      status: 501,
      code: 'search_unavailable',
    });
  });

  it('aborts without a network error', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchMessages({ q: 'tickets', signal: controller.signal }),
    ).rejects.toBeInstanceOf(DOMException);
  });
});

describe('SearchSnippet', () => {
  it('highlights marks as text, never HTML', () => {
    const snippet = '<img src=x onerror=alert(1)>concert';
    const start = [...snippet].indexOf('<') === -1 ? 0 : snippet.indexOf('concert');
    const { container } = render(<SearchSnippet snippet={snippet} marks={[[start, start + 7]]} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)>concert');
    const mark = container.querySelector('[data-search-mark]');
    expect(mark?.textContent).toBe('concert');
  });

  it('clips out-of-range marks', () => {
    const { container } = render(<SearchSnippet snippet="hi" marks={[[0, 99]]} />);
    expect(container.textContent).toBe('hi');
    expect(container.querySelector('[data-search-mark]')).toBeNull();
  });
});

describe('groupByChat', () => {
  it('groups hits by chat in first-seen order', () => {
    const groups = groupByChat(
      [
        {
          chatJid: 'c-b',
          messageId: '1',
          senderName: 'B',
          at: '2026-09-28T10:00:00Z',
          snippet: 'x concert',
          marks: [],
        },
        {
          chatJid: 'c-a',
          messageId: '2',
          senderName: 'A',
          at: '2026-09-28T09:00:00Z',
          snippet: 'concert y',
          marks: [],
        },
        {
          chatJid: 'c-b',
          messageId: '3',
          senderName: 'B',
          at: '2026-09-28T08:00:00Z',
          snippet: 'concert z',
          marks: [],
        },
      ],
      [
        { id: 'c-a', title: 'A' },
        { id: 'c-b', title: 'B' },
      ],
    );
    expect(groups.map((group) => group.chatJid)).toEqual(['c-b', 'c-a']);
    expect(groups[0]?.items).toHaveLength(2);
  });
});

describe('useMessageSearch', () => {
  it('debounces 250 ms and cancels superseded requests', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const aborts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        seen.push(String(url));
        const signal = init?.signal;
        if (signal !== undefined && signal !== null) {
          signal.addEventListener('abort', () => aborts.push(String(url)));
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        return jsonResponse(200, { items: [] });
      }),
    );
    const { result, rerender } = renderHook(({ q }: { q: string }) => useMessageSearch(q), {
      initialProps: { q: 'co' },
    });
    expect(result.current.status).toBe('loading');
    hookAct(() => {
      rerender({ q: 'con' });
    });
    await hookAct(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    // Only the second query fired; the first timer was cleared before it ran.
    expect(seen.filter((url) => url.includes('q=con&') || url.endsWith('q=con'))).toHaveLength(1);
    expect(seen.some((url) => url.includes('q=co&') || url.endsWith('q=co'))).toBe(false);
    expect(aborts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('aborts an in-flight request when the query changes', async () => {
    vi.useFakeTimers();
    const aborts: string[] = [];
    let resolveFirst: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const signal = init?.signal;
        if (signal !== undefined && signal !== null) {
          signal.addEventListener('abort', () => aborts.push(String(url)));
        }
        if (String(url).includes('q=concert')) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return jsonResponse(200, { items: [] });
      }),
    );
    const { result, rerender } = renderHook(({ q }: { q: string }) => useMessageSearch(q), {
      initialProps: { q: 'concert' },
    });
    await hookAct(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.status).toBe('loading');
    hookAct(() => {
      rerender({ q: 'concerts' });
    });
    await hookAct(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // The first request was aborted when the debounced text changed.
    expect(aborts.some((url) => url.includes('q=concert&'))).toBe(true);
    resolveFirst?.(jsonResponse(200, { items: [] }));
    vi.useRealTimers();
  });

  it('stays idle under 2 characters and hides on 501', async () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useMessageSearch(q), {
      initialProps: { q: 'c' },
    });
    expect(result.current.status).toBe('idle');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(501, { error: { code: 'search_unavailable', message: 'no' } }),
      ),
    );
    rerender({ q: 'concert' });
    await vi.waitFor(() => expect(result.current.status).toBe('unavailable'));
  });
});

describe('scrollToMessage', () => {
  it('scrolls to a bubble carrying the message id', () => {
    document.body.innerHTML = '<div data-message-id="m-1">hello</div>';
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    expect(scrollToMessage('m-1')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollToMessage('missing')).toBe(false);
  });
});
