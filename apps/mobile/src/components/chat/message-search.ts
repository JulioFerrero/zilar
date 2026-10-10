import { Effect, Fiber } from 'effect';

import { SearchApiError, type SearchApi } from '../../lib/search-api';

import {
  activeQuery,
  MESSAGE_SEARCH_DEBOUNCE_MS,
  MESSAGE_SEARCH_LIMIT,
  MESSAGE_SEARCH_MIN_LENGTH,
  groupSearchByChat,
  nearEnd,
  searchResultTitle,
  snippetParts,
} from './message-search-format';
import type {
  DebouncedQuery,
  MessageSearchStatus,
  SearchGroup,
  SnippetPart,
} from './message-search-format';
import { settleSearch } from './message-search-scheduler';
import type { SearchScheduler } from './message-search-scheduler';

export {
  MESSAGE_SEARCH_DEBOUNCE_MS,
  MESSAGE_SEARCH_LIMIT,
  MESSAGE_SEARCH_MIN_LENGTH,
  activeQuery,
  groupSearchByChat,
  nearEnd,
  searchResultTitle,
  snippetParts,
};
export type { DebouncedQuery, MessageSearchStatus, SearchGroup, SnippetPart, SearchScheduler };

/**
 * The plain logic behind mobile message search (T-0138), kept pure and next
 * to the component so it can be unit-tested in Node: the debounced search
 * hook (`use-message-search.ts`) only wires timers and the API to this.
 *
 * The controller mirrors the web `useMessageSearch` state machine, plus
 * cursor paging: the hook owns the debounce timer and the React state, the
 * controller owns requests, cancellation and pages. Tests drive it with a
 * fake clock, like `SmoothTextReveal`.
 *
 * Split into `message-search-format` and `message-search-scheduler` (T-1031);
 * this barrel keeps the original path and exports every name unchanged.
 *
 * `defaultScheduler` stays here, not in `message-search-scheduler`: the barrel
 * is the only module that uses it, and its `Effect`/`Fiber` import keeps the
 * barrel's Effect kind (a plain scheduler module cannot).
 */

// Each debounce is a fiber that sleeps; clearing it interrupts the fiber.
const defaultScheduler: SearchScheduler = {
  setTimeout: (callback, ms) =>
    Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(callback)))),
  clearTimeout: (handle) => {
    Effect.runFork(Fiber.interrupt(handle as Fiber.Fiber<void>));
  },
};

export interface MessageSearchControllerOptions {
  api: SearchApi;
  onChange: () => void;
  frames?: SearchScheduler;
}

/**
 * The request state machine behind `useMessageSearch`. `setQuery` + `setChat`
 * restart the debounce; `state` is what the hook renders (`loadMore` and
 * `retry` call back in). Superseded requests are cancelled with
 * `AbortController`; a late answer after a newer request is ignored by its
 * request id. The query text travels only to the search endpoint and is
 * never logged.
 */
export class MessageSearchController {
  private readonly api: SearchApi;
  private readonly onChange: () => void;
  private readonly frames: SearchScheduler;
  private query = '';
  private chat: string | undefined;
  private debounced: DebouncedQuery = null;
  private attempt = 0;
  private timer: unknown = null;
  private requestId = 0;
  private pageRequest = 0;
  private paging = false;
  /** The in-flight page request: a newer `loadMore` aborts it. */
  private pageController: AbortController | null = null;
  private inflight: AbortController | null = null;
  private disposed = false;
  private current: MessageSearchStatus = { status: 'idle' };

  constructor(options: MessageSearchControllerOptions) {
    this.api = options.api;
    this.onChange = options.onChange;
    this.frames = options.frames ?? defaultScheduler;
  }

  get state(): MessageSearchStatus {
    return this.current;
  }

  /** The debounced query the hook renders from (`idle` below 2 chars). */
  get view(): MessageSearchStatus {
    const active = activeQuery(this.query);
    if (active === null) {
      return { status: 'idle' };
    }
    if (
      this.debounced !== active ||
      (this.current.status !== 'ready' && this.current.status !== 'error')
    ) {
      if (this.current.status === 'unavailable') {
        return this.current;
      }
      return { status: 'loading' };
    }
    return this.current;
  }

  setQuery(query: string): void {
    if (this.disposed || query === this.query) {
      return;
    }
    this.query = query;
    this.arm();
  }

  setChat(chat: string | undefined): void {
    const scope = chat === undefined || chat === '' ? undefined : chat;
    if (this.disposed || scope === this.chat) {
      return;
    }
    this.chat = scope;
    this.arm();
  }

  /** Re-fires the current query (the error state's Retry). */
  retry(): void {
    if (this.disposed || this.debounced === null) {
      return;
    }
    this.attempt += 1;
    this.fetch(this.debounced);
  }

  /**
   * Appends the next page with the cursor the server returned (`nextBefore`,
   * an opaque microsecond stamp — never the last item's ISO date). A late
   * page after a new query is dropped. A failed page keeps the items shown
   * and reports the failure inline, so the spinner ends instead of retrying
   * forever. A second call while a page is in flight aborts the superseded
   * request (its result is dropped); the `pageError` retry re-enters here.
   */
  loadMore(): void {
    if (this.disposed || this.debounced === null) {
      return;
    }
    if (this.current.status !== 'ready' || this.current.nextBefore === undefined) {
      return;
    }
    if (this.paging) {
      this.pageController?.abort();
      this.pageController = null;
    }
    const id = this.nextId();
    this.pageRequest = id;
    this.paging = true;
    const controller = new AbortController();
    this.pageController = controller;
    const q = this.debounced;
    const chat = this.chat;
    const before = this.current.nextBefore;
    settleSearch(
      this.api,
      {
        q,
        ...(chat === undefined ? {} : { chat }),
        limit: MESSAGE_SEARCH_LIMIT,
        before,
        signal: controller.signal,
      },
      (page) => {
        if (this.pageController === controller) {
          this.pageController = null;
        }
        if (this.disposed || this.pageRequest !== id || this.requestId !== id) {
          return;
        }
        this.paging = false;
        if (this.current.status !== 'ready') {
          return;
        }
        const known = new Set(
          this.current.items.map((item) => `${item.chatJid}:${item.messageId}`),
        );
        const fresh = page.items.filter((item) => !known.has(`${item.chatJid}:${item.messageId}`));
        this.set({
          status: 'ready',
          items: [...this.current.items, ...fresh],
          ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
        });
      },
      (error: unknown) => {
        if (this.pageController === controller) {
          this.pageController = null;
        }
        if (this.disposed || this.pageRequest !== id || this.requestId !== id) {
          return;
        }
        this.paging = false;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (this.current.status !== 'ready') {
          return;
        }
        const kept = this.current;
        this.set({
          status: 'ready',
          items: kept.items,
          ...(kept.nextBefore === undefined ? {} : { nextBefore: kept.nextBefore }),
          pageError: {
            message: "Couldn't load more messages",
            retry: () => this.loadMore(),
          },
        });
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      this.frames.clearTimeout(this.timer);
      this.timer = null;
    }
    this.inflight?.abort();
    this.inflight = null;
    this.pageController?.abort();
    this.pageController = null;
  }

  private arm(): void {
    if (this.timer !== null) {
      this.frames.clearTimeout(this.timer);
      this.timer = null;
    }
    const active = activeQuery(this.query);
    this.timer = this.frames.setTimeout(
      () => {
        this.timer = null;
        if (this.disposed) {
          return;
        }
        this.requestId += 1;
        this.debounced = active;
        this.fetch(active);
      },
      active === null ? 0 : MESSAGE_SEARCH_DEBOUNCE_MS,
    );
    this.onChange();
  }

  private nextId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private fetch(active: string | null): void {
    if (active === null) {
      return;
    }
    const id = this.nextId();
    this.pageRequest = id;
    // A fresh query owns paging from here: an older page load is dropped by
    // its id, its controller is aborted so it never even lands, and the flag
    // must not block the new query's pages.
    this.paging = false;
    this.pageController?.abort();
    this.pageController = null;
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    const attempt = this.attempt;
    settleSearch(
      this.api,
      {
        q: active,
        ...(this.chat === undefined ? {} : { chat: this.chat }),
        limit: MESSAGE_SEARCH_LIMIT,
        signal: controller.signal,
      },
      (page) => {
        if (this.disposed || this.requestId !== id || this.attempt !== attempt) {
          return;
        }
        this.inflight = null;
        this.set({
          status: 'ready',
          items: page.items,
          ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
        });
      },
      (error: unknown) => {
        if (this.disposed || this.requestId !== id || this.attempt !== attempt) {
          return;
        }
        this.inflight = null;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (error instanceof SearchApiError && error.status === 501) {
          this.set({ status: 'unavailable' });
          return;
        }
        if (error instanceof SearchApiError && error.status === 429) {
          this.set({
            status: 'error',
            message: 'Too many searches. Try again in a moment.',
            rateLimited: true,
            retry: () => this.retry(),
          });
          return;
        }
        this.set({
          status: 'error',
          message: "Couldn't search messages",
          rateLimited: false,
          retry: () => this.retry(),
        });
      },
    );
  }

  private set(next: MessageSearchStatus): void {
    this.current = next;
    this.onChange();
  }
}
