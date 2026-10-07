import { describe, expect, it } from 'vitest';
import { FAKE_PASSWORD, FakeOpenCodeServer, type FakeFrame } from './fake-opencode-server';
import { createOpenCodeV2Driver } from './opencode-v2';
import type { AgentEvent, PromptRef, SessionRef } from './types';

const SESSION: SessionRef = { sessionId: 'ses_1' };
const AFTER: PromptRef = { messageId: 'msg_user_1', createdAt: 0 };

describe('OpenCodeV2Driver on Effect', () => {
  it('aborts a long poll sleep promptly when the signal fires', async () => {
    const frames: FakeFrame[] = [
      {
        messages: [
          {
            id: 'msg_1',
            type: 'assistant',
            time: { created: 1 },
            content: [{ type: 'text', text: 'hello' }],
          },
        ],
        permissions: [],
      },
    ];
    const server = await FakeOpenCodeServer.start({ frames });
    try {
      // A long interval proves the abort interrupts the poll sleep instead of waiting it out.
      const driver = createOpenCodeV2Driver({
        baseUrl: server.baseUrl,
        password: FAKE_PASSWORD,
        pollIntervalMs: 30_000,
      });
      const controller = new AbortController();
      const events: AgentEvent[] = [];
      const startedAt = Date.now();

      for await (const event of driver.events(SESSION, {
        after: AFTER,
        signal: controller.signal,
      })) {
        events.push(event);
        controller.abort();
      }

      expect(events).toEqual([{ type: 'text', messageId: 'msg_1', text: 'hello' }]);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await server.close();
    }
  });

  it('interrupts the poll fiber when the consumer abandons the iterator', async () => {
    const frames: FakeFrame[] = [
      {
        messages: [
          {
            id: 'msg_1',
            type: 'assistant',
            time: { created: 1 },
            content: [{ type: 'text', text: 'hello' }],
          },
        ],
        permissions: [],
      },
    ];
    const server = await FakeOpenCodeServer.start({ frames });
    try {
      const driver = createOpenCodeV2Driver({
        baseUrl: server.baseUrl,
        password: FAKE_PASSWORD,
        pollIntervalMs: 20,
      });
      const iterator = driver
        .events(SESSION, { after: AFTER, signal: new AbortController().signal })
        [Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first).toEqual({
        done: false,
        value: { type: 'text', messageId: 'msg_1', text: 'hello' },
      });

      // Abandon the iterator without aborting the signal: the driver must stop its own fiber.
      await iterator.return?.();
      const pollsAfterReturn = countMessagePolls(server);
      const requestsAfterReturn = server.requests.length;

      // Several poll intervals elapse; an interrupted fiber must not fetch again.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const pollsLater = countMessagePolls(server);
      expect(pollsLater).toBe(pollsAfterReturn);
      expect(server.requests.length).toBe(requestsAfterReturn);
    } finally {
      await server.close();
    }
  });

  it('settles return() while a next() is pending and the signal is not aborted', async () => {
    // Every poll returns no messages, so the pending `Queue.take` has nothing to settle it.
    // Abandoning the iterator must still resolve `return()` and stop the fiber.
    const server = await FakeOpenCodeServer.start({
      frames: [{ messages: [], permissions: [] }],
    });
    try {
      const driver = createOpenCodeV2Driver({
        baseUrl: server.baseUrl,
        password: FAKE_PASSWORD,
        pollIntervalMs: 20,
      });
      const iterator = driver
        .events(SESSION, { after: AFTER, signal: new AbortController().signal })
        [Symbol.asyncIterator]();

      const pending = iterator.next();
      const returned = await iterator.return?.();
      expect(returned).toEqual({ done: true, value: undefined });
      await expect(pending).resolves.toEqual({ done: true, value: undefined });

      const pollsAfterReturn = countMessagePolls(server);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(countMessagePolls(server)).toBe(pollsAfterReturn);
    } finally {
      await server.close();
    }
  });

  it('rejects the iterator with the original error when the poll loop hits a defect', async () => {
    const boom = new Error('event mapping exploded');
    // A fake server whose response throws a non-DriverError when the driver reads it, a
    // defect raised inside the poll loop (the message/event mapping path wraps thrown
    // values, so an injectable identity-preserving defect comes from reading the response).
    const driver = createOpenCodeV2Driver({
      baseUrl: 'http://127.0.0.1:9',
      password: FAKE_PASSWORD,
      fetchImpl: async () =>
        ({
          get ok(): boolean {
            throw boom;
          },
          status: 200,
          json: async () => ({ data: [] }),
        }) as unknown as Response,
    });

    const iterator = driver
      .events(SESSION, { after: AFTER, signal: new AbortController().signal })
      [Symbol.asyncIterator]();
    try {
      await expect(iterator.next()).rejects.toBe(boom);
    } finally {
      await iterator.return?.();
    }
  });
});

function countMessagePolls(server: FakeOpenCodeServer): number {
  return server.requests.filter((request) => request.path.startsWith('/api/session/ses_1/message'))
    .length;
}
