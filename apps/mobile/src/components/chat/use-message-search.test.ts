import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchApiError, type SearchApi } from '../../lib/search-api';
import {
  MESSAGE_SEARCH_DEBOUNCE_MS,
  MessageSearchController,
  type SearchScheduler,
} from './message-search';

interface ManualClock {
  frames: SearchScheduler;
  run: () => void;
  pending: () => number;
}

function manualClock(): ManualClock {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    frames: {
      setTimeout: (callback) => {
        const handle = next;
        next += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        callbacks.delete(handle as number);
      },
    },
    run: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) {
        callback();
      }
    },
    pending: () => callbacks.size,
  };
}

function hit(chatJid: string, messageId: string, at: string) {
  return {
    chatJid,
    messageId,
    senderName: 'Ana',
    at,
    snippet: 'terrace',
    marks: [[0, 7]] as Array<[number, number]>,
  };
}

function fakeApi(
  respond: (input: {
    q: string;
    chat?: string;
    before?: string;
  }) => Promise<{ items: ReturnType<typeof hit>[]; nextBefore?: string }>,
): {
  api: SearchApi;
  calls: { q: string; chat?: string; before?: string }[];
  signals: (AbortSignal | undefined)[];
} {
  const calls: { q: string; chat?: string; before?: string }[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const api: SearchApi = {
    async searchMessages(input) {
      calls.push({
        q: input.q,
        ...(input.chat === undefined ? {} : { chat: input.chat }),
        ...(input.before === undefined ? {} : { before: input.before }),
      });
      signals.push(input.signal);
      return respond({
        q: input.q,
        ...(input.chat === undefined ? {} : { chat: input.chat }),
        ...(input.before === undefined ? {} : { before: input.before }),
      });
    },
  };
  return { api, calls, signals };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MessageSearchController', () => {
  let clock: ManualClock;
  let changes = 0;

  beforeEach(() => {
    clock = manualClock();
    changes = 0;
  });

  function control(api: SearchApi): MessageSearchController {
    return new MessageSearchController({
      api,
      onChange: () => {
        changes += 1;
      },
      frames: clock.frames,
    });
  }

  it('stays idle below 2 characters and debounces the first keystrokes', async () => {
    const { api, calls } = fakeApi(async () => ({ items: [] }));
    const controller = control(api);

    controller.setQuery('t');
    clock.run();
    await flush();
    expect(controller.view.status).toBe('idle');
    expect(calls).toHaveLength(0);

    controller.setQuery('te');
    expect(controller.view.status).toBe('loading');
    expect(calls).toHaveLength(0);

    clock.run();
    await flush();
    expect(calls).toHaveLength(1);
    expect(controller.view.status).toBe('ready');
  });

  it('debounces typing: one request for fast keystrokes', async () => {
    const { api, calls } = fakeApi(async () => ({ items: [] }));
    const controller = control(api);

    controller.setQuery('ter');
    controller.setQuery('terr');
    controller.setQuery('terra');
    expect(clock.pending()).toBe(1);
    clock.run();
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.q).toBe('terra');
  });

  it('cancels the in-flight request when the query changes', async () => {
    let release!: (value: { items: [] }) => void;
    const gate = new Promise<{ items: [] }>((resolve) => {
      release = resolve;
    });
    const { api, calls, signals } = fakeApi(() => gate);
    const controller = control(api);

    controller.setQuery('terra');
    clock.run();
    await flush();
    expect(calls).toHaveLength(1);

    controller.setQuery('terrac');
    clock.run();
    await flush();

    expect(signals[0]?.aborted).toBe(true);
    release({ items: [] });
    await flush();
    // The late first answer is ignored: only the second request counts.
    expect(calls).toHaveLength(2);
  });

  it('scopes to one chat and clears the scope', async () => {
    const { api, calls } = fakeApi(async () => ({ items: [] }));
    const controller = control(api);

    controller.setQuery('terra');
    controller.setChat('ana');
    clock.run();
    await flush();
    expect(calls[0]).toMatchObject({ q: 'terra', chat: 'ana' });

    controller.setChat(undefined);
    clock.run();
    await flush();
    expect(calls[1]).toMatchObject({ q: 'terra' });
    expect(calls[1]).not.toHaveProperty('chat');
  });

  it('reports rate limits separately from other errors, with a retry', async () => {
    let failures = 0;
    const { api } = fakeApi(async () => {
      failures += 1;
      if (failures === 1) {
        throw new SearchApiError(429, 'rate_limited', 'Too many');
      }
      return { items: [] };
    });
    const controller = control(api);

    controller.setQuery('terra');
    clock.run();
    await flush();

    const view = controller.view;
    expect(view.status).toBe('error');
    if (view.status !== 'error') throw new Error('unreachable');
    expect(view.rateLimited).toBe(true);
    expect(view.message).toContain('Too many');

    view.retry();
    await flush();
    expect(controller.view.status).toBe('ready');
  });

  it('hides the search entirely on 501', async () => {
    const { api } = fakeApi(async () => {
      throw new SearchApiError(501, 'search_unavailable', 'No search');
    });
    const controller = control(api);

    controller.setQuery('terra');
    clock.run();
    await flush();
    expect(controller.view.status).toBe('unavailable');
  });

  it('pages forward with the server cursor, not the last item date', async () => {
    // The server's cursor is an opaque microsecond stamp (`nextBefore`); the
    // client forwards it unchanged — sending the ISO date 400s.
    const CURSOR = '1758988200000000';
    const { api, calls } = fakeApi(async (input) => {
      if (input.before === undefined) {
        return { items: [hit('ana', 'ana-2', '2026-09-28T12:00:00Z')], nextBefore: CURSOR };
      }
      expect(input.before).toBe(CURSOR);
      return { items: [hit('ana', 'ana-1', '2026-09-28T10:00:00Z')] };
    });
    const controller = control(api);

    controller.setQuery('terra');
    clock.run();
    await flush();
    const ready = controller.view;
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('unreachable');
    expect(ready.items.map((item) => item.messageId)).toEqual(['ana-2']);
    expect(ready.nextBefore).toBe(CURSOR);

    controller.loadMore();
    await flush();
    expect(calls[1]).toMatchObject({ before: CURSOR });
    const paged = controller.view;
    if (paged.status !== 'ready') throw new Error('unreachable');
    expect(paged.items.map((item) => item.messageId)).toEqual(['ana-2', 'ana-1']);
    expect(paged.nextBefore).toBeUndefined();
  });

  it('ends the spinner with an inline error when a page fails', async () => {
    const CURSOR = '1758988200000000';
    let pages = 0;
    const { api } = fakeApi(async (input) => {
      if (input.before === undefined) {
        return { items: [hit('ana', 'ana-2', '2026-09-28T12:00:00Z')], nextBefore: CURSOR };
      }
      pages += 1;
      throw new SearchApiError(400, 'invalid_request', 'Bad cursor');
    });
    const controller = control(api);

    controller.setQuery('terra');
    clock.run();
    await flush();

    controller.loadMore();
    await flush();
    expect(pages).toBe(1);
    const failed = controller.view;
    expect(failed.status).toBe('ready');
    if (failed.status !== 'ready') throw new Error('unreachable');
    // The items stay, the spinner ends (no cursor surfaced), the error shows.
    expect(failed.items.map((item) => item.messageId)).toEqual(['ana-2']);
    expect(failed.nextBefore).toBe(CURSOR);
    expect(failed.pageError?.message).toContain("Couldn't load more");

    // Retry re-sends the same cursor; a late page after a new query is dropped.
    failed.pageError?.retry();
    await flush();
    expect(pages).toBe(2);
  });

  it('ignores an abort as a silent cancel, not an error', async () => {
    const { api } = fakeApi(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const controller = control(api);

    controller.setQuery('terra');
    clock.run();
    await flush();
    // Still loading (the superseding request owns the state), never an error.
    expect(controller.view.status).toBe('loading');
  });

  it('never calls the API after dispose', async () => {
    const { api, calls } = fakeApi(async () => ({ items: [] }));
    const controller = control(api);

    controller.setQuery('terra');
    controller.dispose();
    clock.run();
    await flush();
    expect(calls).toHaveLength(0);
    expect(changes).toBeGreaterThan(0);
  });

  it('waits MESSAGE_SEARCH_DEBOUNCE_MS of about 300 ms', () => {
    expect(MESSAGE_SEARCH_DEBOUNCE_MS).toBe(300);
  });

  it('does not log the query: the API receives it only as a request param', async () => {
    const logged: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    try {
      const { api } = fakeApi(async () => ({ items: [] }));
      const controller = control(api);
      controller.setQuery('supersecretquery');
      clock.run();
      await flush();
      expect(logged.join('\n')).not.toContain('supersecretquery');
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
