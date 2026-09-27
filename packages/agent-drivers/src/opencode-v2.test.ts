import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_PASSWORD,
  FakeOpenCodeServer,
  type FakeFrame,
  type RecordedRequest,
} from './fake-opencode-server';
import { createOpenCodeV2Driver } from './opencode-v2';
import { DriverError, type AgentEvent, type SessionRef, type StartOptions } from './types';

const SESSION: SessionRef = { sessionId: 'ses_1' };

const startOptions: StartOptions = {
  directory: '/tmp/galena-desk',
  model: { providerID: 'opencode', id: 'deepseek-v4.1-flash' },
  rules: [{ action: 'shell', resource: 'git push*', effect: 'deny' }],
};

function userMessage(): unknown {
  return { id: 'msg_user', type: 'user', time: { created: 0 }, text: 'hi' };
}

function assistantMessage(content: unknown[]): unknown {
  return { id: 'msg_1', type: 'assistant', time: { created: 1 }, content };
}

function idleMessage(): unknown {
  return { id: 'msg_idle', type: 'idle', time: { created: 2 }, outcome: 'succeeded' };
}

const textHello = [{ type: 'text', text: 'Hello' }];
const textHelloWorld = [{ type: 'text', text: 'Hello world' }];
const toolRunning = {
  type: 'tool',
  id: 'call_1',
  name: 'shell',
  state: { status: 'running', input: { command: 'ls' } },
};
const toolCompleted = {
  type: 'tool',
  id: 'call_1',
  name: 'shell',
  state: { status: 'completed', input: { command: 'ls' } },
};
const toolFailed = {
  type: 'tool',
  id: 'call_2',
  name: 'shell',
  state: { status: 'error', input: { command: 'false' }, error: { message: 'exit 1' } },
};
const reasoning = { type: 'reasoning', text: 'Thinking' };

const frames: FakeFrame[] = [
  { messages: [userMessage()], permissions: [] },
  { messages: [userMessage(), assistantMessage(textHello)], permissions: [] },
  {
    messages: [userMessage(), assistantMessage([...textHelloWorld, toolRunning])],
    permissions: [{ id: 'per_1', action: 'shell', resources: ['ls'] }],
  },
  {
    messages: [userMessage(), assistantMessage([...textHelloWorld, toolCompleted])],
    permissions: [],
  },
  {
    messages: [userMessage(), assistantMessage([...textHelloWorld, toolCompleted]), idleMessage()],
    permissions: [],
  },
];

let servers: FakeOpenCodeServer[] = [];

async function startServer(options: Parameters<typeof FakeOpenCodeServer.start>[0] = {}) {
  const server = await FakeOpenCodeServer.start(options);
  servers.push(server);
  return server;
}

function createDriver(server: FakeOpenCodeServer, pollIntervalMs = 1) {
  return createOpenCodeV2Driver({
    baseUrl: server.baseUrl,
    password: FAKE_PASSWORD,
    pollIntervalMs,
  });
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe('createOpenCodeV2Driver', () => {
  it('streams a scripted run in order without duplicates', async () => {
    const server = await startServer({ frames });
    const driver = createDriver(server);
    const session = await driver.start(startOptions);

    const events = await collect(driver.events(session));

    expect(events).toEqual([
      { type: 'text', messageId: 'msg_1', text: 'Hello' },
      { type: 'text', messageId: 'msg_1', text: ' world' },
      {
        type: 'tool_call',
        messageId: 'msg_1',
        callId: 'call_1',
        name: 'shell',
        input: { command: 'ls' },
      },
      { type: 'permission_request', requestId: 'per_1', action: 'shell', resources: ['ls'] },
      {
        type: 'tool_result',
        messageId: 'msg_1',
        callId: 'call_1',
        name: 'shell',
        status: 'completed',
      },
      { type: 'done', outcome: 'succeeded' },
    ]);
  });

  it('sends the model, location and permission rules when creating a session', async () => {
    const server = await startServer({ frames });
    const driver = createDriver(server);

    await driver.start(startOptions);

    const create = server.requests.find((request) => request.path === '/api/session');
    expect(create?.method).toBe('POST');
    expect(create?.body).toEqual({
      model: { providerID: 'opencode', id: 'deepseek-v4.1-flash' },
      location: { directory: '/tmp/galena-desk' },
      permissions: [{ action: 'shell', resource: 'git push*', effect: 'deny' }],
    });
  });

  it('maps permission decisions to the OpenCode reply vocabulary', async () => {
    const server = await startServer({ frames });
    const driver = createDriver(server);

    await driver.answerPermission(SESSION, 'per_1', 'allow_once');
    await driver.answerPermission(SESSION, 'per_2', 'allow_always');
    await driver.answerPermission(SESSION, 'per_3', 'reject', 'not now');

    const replies = server.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/reply'),
    );
    expect(replies.map((request) => request.body)).toEqual([
      { decision: 'once' },
      { decision: 'always' },
      { decision: 'reject', message: 'not now' },
    ]);
    expect(replies.map((request) => request.path)).toEqual([
      '/api/session/ses_1/permission/per_1/reply',
      '/api/session/ses_1/permission/per_2/reply',
      '/api/session/ses_1/permission/per_3/reply',
    ]);
  });

  it('calls interrupt on cancel', async () => {
    const server = await startServer({ frames });
    const driver = createDriver(server);

    await driver.cancel(SESSION);

    const interrupt: RecordedRequest | undefined = server.requests.find(
      (request) => request.path === '/api/session/ses_1/interrupt',
    );
    expect(interrupt?.method).toBe('POST');
  });

  it('returns a DriverError with the status but never the password on 401', async () => {
    const server = await startServer({
      fail: {
        status: 401,
        body: JSON.stringify({ _tag: 'UnauthorizedError', message: 'unauthorized' }),
      },
    });
    const driver = createDriver(server);

    let caught: unknown;
    try {
      await driver.start(startOptions);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DriverError);
    if (caught instanceof DriverError) {
      expect(caught.operation).toBe('start');
      expect(caught.status).toBe(401);
      expect(caught.message).toContain('unauthorized');
      expect(caught.message).not.toContain(FAKE_PASSWORD);
    }
  });

  it('returns a DriverError on 500 without the password', async () => {
    const server = await startServer({
      fail: { status: 500, body: JSON.stringify({ message: 'boom' }) },
    });
    const driver = createDriver(server);

    let caught: unknown;
    try {
      await driver.start(startOptions);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DriverError);
    if (caught instanceof DriverError) {
      expect(caught.status).toBe(500);
      expect(caught.message).toContain('boom');
      expect(caught.message).not.toContain(FAKE_PASSWORD);
    }
  });

  it('stops events when the abort signal fires', async () => {
    const server = await startServer({
      frames: [{ messages: [assistantMessage(textHello)], permissions: [] }],
    });
    const driver = createDriver(server, 5);
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    // The stream never ends on its own (the fake run has no idle message), so this
    // resolves only if the abort signal stops the loop.
    const consume = (async () => {
      for await (const event of driver.events(SESSION, controller.signal)) {
        events.push(event);
        if (events.length === 1) {
          controller.abort();
        }
      }
    })();
    await consume;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text' });
    expect(controller.signal.aborted).toBe(true);
  });

  it('emits an error event instead of crashing on malformed message JSON', async () => {
    const server = await startServer({ frames, malformedJson: 'message' });
    const driver = createDriver(server);

    const events = await collect(driver.events(SESSION));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(JSON.stringify(events[0])).not.toContain(FAKE_PASSWORD);
  });

  it('throws a DriverError on malformed session JSON', async () => {
    const server = await startServer({ malformedJson: 'create' });
    const driver = createDriver(server);

    await expect(driver.start(startOptions)).rejects.toBeInstanceOf(DriverError);
  });

  it('emits reasoning and failed tool results', async () => {
    const runFrames: FakeFrame[] = [
      {
        messages: [assistantMessage([reasoning, toolRunning])],
        permissions: [],
      },
      {
        messages: [assistantMessage([reasoning, toolFailed]), idleMessage()],
        permissions: [],
      },
    ];
    const server = await startServer({ frames: runFrames });
    const driver = createDriver(server);

    const events = await collect(driver.events(SESSION));

    expect(events).toEqual([
      { type: 'reasoning', messageId: 'msg_1', text: 'Thinking' },
      {
        type: 'tool_call',
        messageId: 'msg_1',
        callId: 'call_1',
        name: 'shell',
        input: { command: 'ls' },
      },
      {
        type: 'tool_call',
        messageId: 'msg_1',
        callId: 'call_2',
        name: 'shell',
        input: { command: 'false' },
      },
      {
        type: 'tool_result',
        messageId: 'msg_1',
        callId: 'call_2',
        name: 'shell',
        status: 'error',
        error: 'exit 1',
      },
      { type: 'done', outcome: 'succeeded' },
    ]);
  });
});

describe('FakeOpenCodeServer', () => {
  it('rejects requests without basic auth', async () => {
    const server = await startServer({ frames });

    const unauthorized = await fetch(`${server.baseUrl}/api/session`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${FAKE_PASSWORD}`).toString('base64')}`,
      },
    });
    expect(authorized.status).toBe(200);
  });
});
