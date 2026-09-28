import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppStateLike } from '../store/real-store';
import {
  subscribeToDrafts,
  type DraftHubEvent,
  type DraftStreamOptions,
  type DraftXhr,
} from './drafts';

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

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
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
      `event: draft\ndata: {"type":"draft","chatJid":"ai@galena.test","turnId":"${TURN}","text":"Hel`,
    );
    expect(events).toHaveLength(0);
    xhr.push('lo"}\n\n');
    expect(events).toEqual([
      { type: 'draft', chatJid: 'ai@galena.test', turnId: TURN, text: 'Hello' },
    ]);

    // Several frames (and a heartbeat) in a single chunk.
    xhr.push(
      `: heartbeat\n\nevent: draft\ndata: {"type":"draft","chatJid":"ai@galena.test","turnId":"${TURN}","text":"Hello there"}\n\nevent: end\ndata: {"type":"end","chatJid":"ai@galena.test","turnId":"${TURN}","outcome":"sent"}\n\n`,
    );
    expect(events).toEqual([
      { type: 'draft', chatJid: 'ai@galena.test', turnId: TURN, text: 'Hello' },
      { type: 'draft', chatJid: 'ai@galena.test', turnId: TURN, text: 'Hello there' },
      { type: 'end', chatJid: 'ai@galena.test', turnId: TURN, outcome: 'sent' },
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
      'event: draft\ndata: {"type":"draft","chatJid":"ai@galena.test","turnId":"nope","text":"x"}\n\n',
    );
    xhr.push(
      `event: end\ndata: {"type":"end","chatJid":"ai@galena.test","turnId":"${TURN}","outcome":"weird"}\n\n`,
    );
    xhr.push('event: draft\ndata: {"type":"something-else"}\n\n');

    expect(events).toHaveLength(0);
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

  it('does not open without a session token', async () => {
    const { created } = setup({ getToken: () => undefined });
    await flush();
    expect(created).toHaveLength(0);
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
