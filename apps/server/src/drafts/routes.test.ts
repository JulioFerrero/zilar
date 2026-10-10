import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { waitFor } from '../test-support/wait';
import { createDraftHub, type DraftHub } from './hub';
import { createDraftsApi, DRAFT_SSE_HEARTBEAT_MS } from './api';

const CHAT_JID = 'ai-abc@zilar.localhost';
const decoder = new TextDecoder();

interface SseEvent {
  event: string;
  data: string;
}

// Reads `event:`/`data:` blocks off an SSE body incrementally.
function createSseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let buffer = '';
  return {
    async readEvent(timeoutMs = 5000): Promise<SseEvent> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = '';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data.push(line.slice(5).trim());
            }
          }
          if (event !== '') {
            return { event, data: data.join('\n') };
          }
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error('timed out waiting for an SSE event');
        }
        const { value, done } = await reader.read();
        if (done) {
          throw new Error('the SSE stream closed early');
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel(): Promise<void> {
      return reader.cancel();
    },
    async readChunk(timeoutMs = 5000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (buffer === '') {
        if (Date.now() > deadline) {
          throw new Error('timed out waiting for an SSE chunk');
        }
        const { value, done } = await reader.read();
        if (done) {
          throw new Error('the SSE stream closed early');
        }
        buffer += decoder.decode(value, { stream: true });
      }
      const chunk = buffer;
      buffer = '';
      return chunk;
    },
  };
}

describe('GET /api/drafts/stream', () => {
  let context: TestContext;
  let fullApp: TestApp;
  let hub: DraftHub;

  beforeEach(async () => {
    context = await createTestContext();
    fullApp = testApp(context);
    hub = createDraftHub();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await context.close();
  });

  // The Effect handler matches the full `/api`-prefixed path, so build the
  // request against it directly instead of mounting the old Hono wrapper.
  function routesForCookie() {
    const api = createDraftsApi({ auth: context.auth, hub });
    return {
      request(path: string, init?: RequestInit): Promise<Response> {
        return api.handler(new Request(`${TEST_BASE_URL}/api${path}`, init));
      },
    };
  }

  it('returns 401 without a session', async () => {
    const response = await fullApp.request(`${TEST_BASE_URL}/api/drafts/stream`);
    expect(response.status).toBe(401);
    expect(hub.listenerCount('anyone')).toBe(0);
  });

  it('streams a published draft then end in SSE format, for the caller only', async () => {
    const owner = await bootstrapUser(context, fullApp, 'owner@example.com');
    const routes = routesForCookie();
    const response = await routes.request('/drafts/stream', {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const sse = createSseReader(response.body as ReadableStream<Uint8Array>);

    await waitFor(() => hub.listenerCount(owner.id) === 1);
    const turnId = randomUUID();
    const publisher = hub.publishTurn(owner.id, CHAT_JID, turnId);
    publisher.push('Hello, Jul');
    publisher.push('Hello, Julio');
    publisher.end('sent');

    // Throttle: the burst collapses to at most 2 drafts, then `end` last.
    const first = await sse.readEvent();
    expect(first.event).toBe('draft');
    expect(JSON.parse(first.data)).toMatchObject({ type: 'draft', chatJid: CHAT_JID, turnId });

    let lastDraft = first;
    let end: SseEvent | undefined;
    for (let i = 0; i < 3; i += 1) {
      const next = await sse.readEvent();
      if (next.event === 'end') {
        end = next;
        break;
      }
      lastDraft = next;
    }
    expect(end?.event).toBe('end');
    expect(JSON.parse(end?.data ?? '')).toEqual({
      type: 'end',
      chatJid: CHAT_JID,
      turnId,
      outcome: 'sent',
    });
    expect(JSON.parse(lastDraft.data)).toMatchObject({ text: 'Hello, Julio' });

    await sse.cancel();
    await waitFor(() => hub.listenerCount(owner.id) === 0);
  });

  it('unsubscribes on disconnect: the hub listener count goes back to 0', async () => {
    const owner = await bootstrapUser(context, fullApp, 'leaver@example.com');
    const routes = routesForCookie();
    const response = await routes.request('/drafts/stream', {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(200);
    const sse = createSseReader(response.body as ReadableStream<Uint8Array>);
    await waitFor(() => hub.listenerCount(owner.id) === 1);

    hub.publish(owner.id, {
      type: 'end',
      chatJid: CHAT_JID,
      turnId: randomUUID(),
      outcome: 'sent',
    });
    const received = await sse.readEvent();
    expect(received.event).toBe('end');

    await sse.cancel();
    await waitFor(() => hub.listenerCount(owner.id) === 0);
  });

  it('sends a heartbeat comment while idle', async () => {
    // The user is created first: only the idle stream itself runs on fake
    // timers, so auth and the database stay on real ones.
    const owner = await bootstrapUser(context, fullApp, 'idler@example.com');
    vi.useFakeTimers();
    try {
      const routes = routesForCookie();
      const response = await routes.request('/drafts/stream', {
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(200);
      const sse = createSseReader(response.body as ReadableStream<Uint8Array>);
      await vi.advanceTimersByTimeAsync(0);
      expect(hub.listenerCount(owner.id)).toBe(1);

      const pending = sse.readChunk();
      await vi.advanceTimersByTimeAsync(DRAFT_SSE_HEARTBEAT_MS);
      expect(await pending).toContain(': heartbeat');

      await sse.cancel();
      await vi.advanceTimersByTimeAsync(0);
      expect(hub.listenerCount(owner.id)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
