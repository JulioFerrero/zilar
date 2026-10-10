// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GifItem } from '@/lib/gifs';
import type { GifPage, GifsApi } from '@/lib/gifs-api';
import { GifPanel } from './gif-panel';

// The GIF panel is mounted for real with a fake API client; the primitives
// are DOM stand-ins and the ScrollView hands its `onScroll` to the test, so
// scroll events fire the way the list would fire them.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type ScrollEvent = {
  nativeEvent: {
    contentOffset: { y: number };
    contentSize: { height: number };
    layoutMeasurement: { height: number };
  };
};

const captured: { onScroll?: (event: ScrollEvent) => void } = {};

// A scroll position at the very end of the list: the pager must ask for more.
const AT_BOTTOM: ScrollEvent = {
  nativeEvent: {
    contentOffset: { y: 900 },
    contentSize: { height: 1000 },
    layoutMeasurement: { height: 100 },
  },
};

type Kids = { children?: ReactNode };

vi.mock('expo-image', () => ({ Image: () => null }));

vi.mock('react-native', () => ({
  Modal: ({ children }: Kids) => createElement('div', null, children),
  Pressable: ({ children }: Kids) => createElement('button', { type: 'button' }, children),
  ScrollView: (props: Kids & { onScroll: (event: ScrollEvent) => void }) => {
    captured.onScroll = props.onScroll;
    return createElement('div', null, props.children);
  },
  View: ({ children }: Kids) => createElement('div', null, children),
}));

vi.mock('@/components/ui/search-field', () => ({
  SearchField: (props: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel?: string;
  }) =>
    createElement('input', {
      value: props.value,
      'aria-label': props.accessibilityLabel,
      onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
    }),
}));

vi.mock('@/components/ui/state-message', () => ({
  StateMessage: ({ title }: { title: string }) => createElement('span', null, title),
}));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: Kids) => createElement('span', null, children),
}));

vi.mock('@/lib/auth', () => ({ API_URL: 'http://127.0.0.1:3188' }));
vi.mock('@/lib/session-token', () => ({ getSessionToken: async () => 'tok' }));

function gif(id: string): GifItem {
  return {
    id,
    title: id,
    url: `http://127.0.0.1:3188/api/gifs/media/${id}`,
    kind: 'image',
    width: 200,
    height: 150,
  };
}

function deferred(): { promise: Promise<GifPage>; resolve: (page: GifPage) => void } {
  let resolve: (page: GifPage) => void = () => {};
  const promise = new Promise<GifPage>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.useRealTimers();
  captured.onScroll = undefined;
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

const settle = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });

async function mountPanel(api: GifsApi): Promise<Element> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(GifPanel, { open: true, api, onPick: () => {} }));
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await settle(20);
  return container;
}

describe('gif panel infinite scroll', () => {
  it('fires one page load when scroll events arrive while a page is in flight', async () => {
    const pending = deferred();
    const trendingGifs = vi
      .fn<GifsApi['trendingGifs']>()
      .mockResolvedValueOnce({ items: [gif('a')], nextPos: 'p2' })
      .mockReturnValueOnce(pending.promise);
    await mountPanel({ searchGifs: vi.fn(), trendingGifs });
    expect(trendingGifs).toHaveBeenCalledTimes(1);
    act(() => {
      captured.onScroll?.(AT_BOTTOM);
      captured.onScroll?.(AT_BOTTOM);
      captured.onScroll?.(AT_BOTTOM);
    });
    expect(trendingGifs).toHaveBeenCalledTimes(2);
    expect(trendingGifs).toHaveBeenLastCalledWith('p2', expect.any(AbortSignal));
    await act(async () => pending.resolve({ items: [gif('b')] }));
  });

  it('keeps paging after a new search aborted an append that was in flight', async () => {
    const lateAppend = deferred();
    const trendingGifs = vi
      .fn<GifsApi['trendingGifs']>()
      .mockResolvedValueOnce({ items: [gif('a')], nextPos: 'p2' })
      .mockReturnValueOnce(lateAppend.promise);
    const searchGifs = vi
      .fn<GifsApi['searchGifs']>()
      .mockResolvedValueOnce({ items: [gif('cat-1')], nextPos: 'p3' })
      .mockResolvedValue({ items: [gif('cat-2')] });
    const container = await mountPanel({ searchGifs, trendingGifs });
    act(() => captured.onScroll?.(AT_BOTTOM));
    expect(trendingGifs).toHaveBeenCalledTimes(2);

    // A fresh query supersedes the append; the append's late answer is dropped.
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search GIFs"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    // Fake timers only around the debounce: the 300 ms wait is advanced, not slept.
    vi.useFakeTimers();
    act(() => {
      setter?.call(input, 'cat');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();
    await settle(20);
    expect(searchGifs).toHaveBeenCalledTimes(1);
    await act(async () => lateAppend.resolve({ items: [gif('late')] }));

    // Infinite scroll still fires on the new list.
    act(() => captured.onScroll?.(AT_BOTTOM));
    expect(searchGifs).toHaveBeenCalledTimes(2);
    expect(searchGifs).toHaveBeenLastCalledWith('cat', 'p3', expect.any(AbortSignal));
    await settle(20);
  });
});
