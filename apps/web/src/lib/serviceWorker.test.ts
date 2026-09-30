import { beforeEach, describe, expect, it, vi } from 'vitest';

// The service worker ships verbatim from `public/` with no imports, so the
// tests stub the `self` global and import the file, then drive the captured
// `push` and `notificationclick` handlers with fakes.

interface CapturedHandlers {
  push: Array<(event: FakePushEvent) => void>;
  notificationclick: Array<(event: FakeClickEvent) => void>;
  install: Array<(event: { waitUntil: (promise: Promise<unknown>) => void }) => void>;
  activate: Array<(event: { waitUntil: (promise: Promise<unknown>) => void }) => void>;
  fetch: Array<
    (event: { request: { mode: string }; respondWith: (value: unknown) => void }) => void
  >;
}

interface ShownNotification {
  title: string;
  options: Record<string, unknown>;
}

interface FakePushEvent {
  data?: { json: () => unknown; text: () => string } | undefined;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface FakeClickEvent {
  notification: { close: () => void; data?: { chatId?: string } };
  waitUntil: (promise: Promise<unknown>) => void;
}

const handlers: CapturedHandlers = {
  push: [],
  notificationclick: [],
  install: [],
  activate: [],
  fetch: [],
};
const shown: ShownNotification[] = [];
const openedWindows: string[] = [];
const focused: string[] = [];
let closedCount = 0;
const windowUrls = ['https://galena.test/'];

function fakeSelf() {
  return {
    addEventListener: (event: keyof CapturedHandlers, handler: never): void => {
      handlers[event].push(handler as never);
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>): Promise<void> => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () =>
        windowUrls.map((url) => ({ url, focus: async () => focused.push(url) })),
      openWindow: async (url: string) => {
        openedWindows.push(url);
      },
      claim: async () => {},
    },
    skipWaiting: () => Promise.resolve(),
  };
}

vi.stubGlobal('caches', undefined);

async function loadWorker(): Promise<void> {
  const source: string = await import('../../public/sw.js?raw').then(
    (module: { default: string }) => module.default,
  );
  const run = new Function('self', source) as (self: unknown) => void;
  run(fakeSelf());
}

function firePush(data?: FakePushEvent['data']): Promise<unknown> {
  const pending: Promise<unknown>[] = [];
  for (const handler of handlers.push) {
    handler({ data, waitUntil: (promise) => pending.push(promise) });
  }
  return Promise.all(pending);
}

function fireClick(chatId?: string): Promise<unknown> {
  const pending: Promise<unknown>[] = [];
  for (const handler of handlers.notificationclick) {
    handler({
      notification: {
        close: () => {
          closedCount += 1;
        },
        ...(chatId === undefined ? {} : { data: { chatId } }),
      },
      waitUntil: (promise) => pending.push(promise),
    });
  }
  return Promise.all(pending);
}

describe('service worker', () => {
  // The worker module registers its listeners once on import; the tests
  // reset only the captured effects between cases.
  beforeEach(async () => {
    if (handlers.push.length === 0) {
      await loadWorker();
    }
    shown.length = 0;
    openedWindows.length = 0;
    focused.length = 0;
    closedCount = 0;
    windowUrls.length = 0;
  });

  it('shows the payload title and body, tagged by message', async () => {
    await firePush({
      json: () => ({
        title: 'Ana in Acme',
        body: 'hello there',
        chatId: 'room@rooms.x',
        messageId: 'm-1',
      }),
      text: () => '',
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('Ana in Acme');
    expect(shown[0]!.options).toMatchObject({
      body: 'hello there',
      tag: 'm-1',
      renotify: true,
      data: { chatId: 'room@rooms.x' },
    });
  });

  it('tags by chat id when the payload has no message id', async () => {
    await firePush({
      json: () => ({ title: 'Galena', body: 'hi', chatId: 'room@rooms.x' }),
      text: () => '',
    });
    expect(shown[0]!.options).toMatchObject({
      tag: 'room@rooms.x',
      data: { chatId: 'room@rooms.x' },
    });
  });

  it('falls back to placeholders for missing or broken payloads', async () => {
    await firePush(undefined);
    await firePush({
      json: () => {
        throw new Error('not json');
      },
      text: () => 'plain fallback',
    });
    expect(shown.map((entry) => entry.title)).toEqual(['New message', 'New message']);
    expect(shown[1]!.options).toMatchObject({ body: 'plain fallback' });
  });

  it('focuses the open chat window or opens the chat', async () => {
    windowUrls.push('https://galena.test/c/room%40rooms.x');
    await fireClick('room@rooms.x');
    expect(closedCount).toBe(1);
    expect(focused).toEqual(['https://galena.test/c/room%40rooms.x']);
    expect(openedWindows).toEqual([]);

    windowUrls.length = 0;
    await fireClick('room@rooms.x');
    expect(openedWindows).toEqual(['/c/room%40rooms.x']);
  });

  it('opens the home page when the notification has no chat', async () => {
    await fireClick(undefined);
    expect(openedWindows).toEqual(['/']);
  });
});
