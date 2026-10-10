import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppStateLike } from '../store/real-store';
import {
  subscribeToDrafts,
  type DraftHubEvent,
  type DraftStreamOptions,
  type DraftXhr,
} from './drafts';
import { flushMicrotasks as flush } from '@/test/wait';

const TURN = '3f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b';

/** A fake `XMLHttpRequest` whose `responseText` the test grows chunk by chunk. */
class FakeXhr implements DraftXhr {
  readyState = 0;
  status = 200;
  responseText = '';
  onprogress: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  aborted = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(): void {}

  abort(): void {
    this.aborted = true;
  }

  /** Appends a chunk and reports partial progress (React Native's readyState 3). */
  push(chunk: string): void {
    this.responseText += chunk;
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.onreadystatechange?.();
    }
    this.onprogress?.();
  }

  /** Appends the last chunk and completes without a progress event. */
  complete(chunk: string): void {
    this.responseText += chunk;
    this.readyState = 4;
    this.onreadystatechange?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

interface FakeAppState extends AppStateLike {
  set(state: string): void;
}

function fakeAppState(initial = 'active'): FakeAppState {
  let state = initial;
  const handlers = new Set<(next: string) => void>();
  return {
    current: () => state,
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    set(next) {
      state = next;
      for (const handler of handlers) {
        handler(next);
      }
    },
  };
}

interface Harness {
  appState: FakeAppState;
  created: FakeXhr[];
  events: DraftHubEvent[];
  close: () => void;
}

function setup(overrides: Partial<DraftStreamOptions> = {}): Harness {
  const appState = fakeAppState();
  const created: FakeXhr[] = [];
  const events: DraftHubEvent[] = [];
  const close = subscribeToDrafts((event) => events.push(event), {
    url: 'http://test/api/drafts/stream',
    getToken: () => 'secret-token',
    appState,
    createXhr: () => {
      const xhr = new FakeXhr();
      created.push(xhr);
      return xhr;
    },
    ...overrides,
  });
  return { appState, created, events, close };
}

describe('subscribeToDrafts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the bearer token and parses frames split across chunks', async () => {
    const { created, events } = setup();
    await flush();

    expect(created).toHaveLength(1);
    const xhr = created[0]!;
    expect(xhr.method).toBe('GET');
    expect(xhr.url).toBe('http://test/api/drafts/stream');
    expect(xhr.headers['Authorization']).toBe('Bearer secret-token');
    expect(xhr.headers['Accept']).toBe('text/event-stream');

    // One frame split across two chunks.
    xhr.push(
      `event: draft\ndata: {"type":"draft","chatJid":"ai@zilar.test","turnId":"${TURN}","text":"Hel`,
    );
    expect(events).toHaveLength(0);
    xhr.push('lo"}\n\n');
    expect(events).toEqual([
      { type: 'draft', chatJid: 'ai@zilar.test', turnId: TURN, text: 'Hello' },
    ]);

    // Several frames (and a heartbeat) in a single chunk.
    xhr.push(
      `: heartbeat\n\nevent: draft\ndata: {"type":"draft","chatJid":"ai@zilar.test","turnId":"${TURN}","text":"Hello there"}\n\nevent: end\ndata: {"type":"end","chatJid":"ai@zilar.test","turnId":"${TURN}","outcome":"sent"}\n\n`,
    );
    expect(events).toEqual([
      { type: 'draft', chatJid: 'ai@zilar.test', turnId: TURN, text: 'Hello' },
      { type: 'draft', chatJid: 'ai@zilar.test', turnId: TURN, text: 'Hello there' },
      { type: 'end', chatJid: 'ai@zilar.test', turnId: TURN, outcome: 'sent' },
    ]);
  });

  it('drops invalid JSON, wrong shapes and heartbeats', async () => {
    const { created, events } = setup();
    await flush();
    const xhr = created[0]!;

    xhr.push(': heartbeat\n\n');
    xhr.push('data: not json\n\n');
    xhr.push(`event: draft\ndata: {"type":"draft","chatJid":"","turnId":"${TURN}","text":"x"}\n\n`);
    xhr.push(
      'event: draft\ndata: {"type":"draft","chatJid":"ai@zilar.test","turnId":"nope","text":"x"}\n\n',
    );
    xhr.push(
      `event: end\ndata: {"type":"end","chatJid":"ai@zilar.test","turnId":"${TURN}","outcome":"weird"}\n\n`,
    );
    xhr.push('event: draft\ndata: {"type":"something-else"}\n\n');

    expect(events).toHaveLength(0);
  });

  it('parses a tail that arrives only with readyState 4', async () => {
    const { created, events } = setup();
    await flush();
    const xhr = created[0]!;

    xhr.push(
      `event: draft\ndata: {"type":"draft","chatJid":"ai@zilar.test","turnId":"${TURN}","text":"Hel`,
    );
    expect(events).toHaveLength(0);

    // The remaining frame (here the closing `end`) arrives only on completion.
    xhr.complete(
      `lo"}\n\nevent: end\ndata: {"type":"end","chatJid":"ai@zilar.test","turnId":"${TURN}","outcome":"sent"}\n\n`,
    );
    expect(events).toEqual([
      { type: 'draft', chatJid: 'ai@zilar.test', turnId: TURN, text: 'Hello' },
      { type: 'end', chatJid: 'ai@zilar.test', turnId: TURN, outcome: 'sent' },
    ]);
  });

  it('reconnects with a growing jittered backoff after a drop', async () => {
    vi.useFakeTimers();
    const { created } = setup({ baseDelayMs: 1000, maxDelayMs: 30_000, random: () => 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);

    created[0]!.fail();
    await vi.advanceTimersByTimeAsync(499);
    expect(created).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(created).toHaveLength(2);

    created[1]!.fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(created).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(created).toHaveLength(3);
  });

  it('closes on background and reopens on active', async () => {
    const { appState, created } = setup();
    await flush();
    expect(created).toHaveLength(1);

    appState.set('background');
    expect(created[0]!.aborted).toBe(true);
    await flush();
    expect(created).toHaveLength(1);

    appState.set('active');
    await flush();
    expect(created).toHaveLength(2);
  });

  it('closes the stream and stops reconnecting', async () => {
    const { created, close } = setup();
    await flush();
    const xhr = created[0]!;

    close();
    expect(xhr.aborted).toBe(true);

    xhr.fail();
    await flush();
    expect(created).toHaveLength(1);
  });

  it('retries with backoff when the token is missing, then connects', async () => {
    vi.useFakeTimers();
    const tokens: Array<string | undefined> = [undefined, 'secret-token'];
    let calls = 0;
    const created: FakeXhr[] = [];
    subscribeToDrafts(() => {}, {
      url: 'http://test/api/drafts/stream',
      getToken: () => tokens[calls++],
      appState: fakeAppState(),
      createXhr: () => {
        const xhr = new FakeXhr();
        created.push(xhr);
        return xhr;
      },
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(created).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(499);
    expect(created).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect(created).toHaveLength(1);
    expect(created[0]!.headers['Authorization']).toBe('Bearer secret-token');
  });

  it('retries with backoff when getToken throws', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const created: FakeXhr[] = [];
    subscribeToDrafts(() => {}, {
      url: 'http://test/api/drafts/stream',
      getToken: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('no secure storage');
        }
        return 'secret-token';
      },
      appState: fakeAppState(),
      createXhr: () => {
        const xhr = new FakeXhr();
        created.push(xhr);
        return xhr;
      },
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(created).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(2);
    expect(created).toHaveLength(1);
  });

  it('does not open while the app starts in the background', async () => {
    const appState = fakeAppState('background');
    const created: FakeXhr[] = [];
    subscribeToDrafts(() => {}, {
      url: 'http://test/api/drafts/stream',
      getToken: () => 'secret-token',
      appState,
      createXhr: () => {
        const xhr = new FakeXhr();
        created.push(xhr);
        return xhr;
      },
    });
    await flush();
    expect(created).toHaveLength(0);

    appState.set('active');
    await flush();
    expect(created).toHaveLength(1);
  });
});
