import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import type { HttpServerRequest } from 'effect/http';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import { CurrentUser, handler } from './http-core';

const logged: Array<unknown> = [];
const logger = { error: (...args: Array<unknown>) => logged.push(args) } as unknown as Logger;

const request = {
  request: {
    headers: { 'x-request-id': 'req-7' },
  } as unknown as HttpServerRequest.HttpServerRequest,
};

function run<A, R>(effect: Effect.Effect<A, never, R | CurrentUser>): Promise<A> {
  return Effect.runPromise(
    Effect.provideService(effect, CurrentUser, { id: 'user-1' }) as Effect.Effect<A>,
  );
}

async function bodyOf(response: unknown): Promise<{ status: number; body: unknown }> {
  const web = HttpServerResponse.toWeb(response as HttpServerResponse.HttpServerResponse);
  return { status: web.status, body: await web.json() };
}

describe('handler', () => {
  it('passes the request and the current user to a Promise body', async () => {
    const result = await run(handler(logger, async (_req, user) => `hello ${user.id}`)(request));
    expect(result).toBe('hello user-1');
  });

  it('accepts an Effect body', async () => {
    const result = await run(handler(logger, (_req, user) => Effect.succeed(user.id))(request));
    expect(result).toBe('user-1');
  });

  it('renders a rejected HttpError through the envelope with the request id', async () => {
    const result = await run(
      handler(logger, async () => {
        throw new HttpError(404, 'not_found', 'Nope');
      })(request),
    );
    expect(await bodyOf(result)).toEqual({
      status: 404,
      body: { error: { code: 'not_found', message: 'Nope', requestId: 'req-7' } },
    });
  });

  it('renders a synchronous throw and an Effect defect as the logged 500', async () => {
    logged.length = 0;
    const thrown = await run(
      handler(logger, () => {
        throw new Error('boom');
      })(request),
    );
    const died = await run(handler(logger, () => Effect.die(new Error('bang')))(request));
    for (const result of [thrown, died]) {
      expect(await bodyOf(result)).toEqual({
        status: 500,
        body: {
          error: { code: 'internal_error', message: 'Internal server error', requestId: 'req-7' },
        },
      });
    }
    expect(logged).toHaveLength(2);
  });
});
