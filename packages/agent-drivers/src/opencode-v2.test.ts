import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_PASSWORD,
  FakeOpenCodeServer,
  type FakeFrame,
  type FakePromptResponse,
  type RecordedRequest,
} from './fake-opencode-server';
import { createOpenCodeV2Driver } from './opencode-v2';
import {
  DriverError,
  type AgentEvent,
  type PromptRef,
  type SessionRef,
  type StartOptions,
} from './types';

const SESSION: SessionRef = { sessionId: 'ses_1' };

// The default fake prompt response, so `events()` can be called without a real prompt.
const AFTER: PromptRef = { messageId: 'msg_user_1', createdAt: 0 };

const startOptions: StartOptions = {
  directory: '/tmp/galena-desk',
  model: { providerID: 'opencode', id: 'deepseek-v4.1-flash' },
  rules: [{ action: 'shell', resource: 'git push*', effect: 'deny' }],
};

function userMessage(id = 'msg_user_1', created = 0): unknown {
  return { id, type: 'user', time: { created }, text: 'hi' };
}

function assistantMessage(id: string, created: number, content: unknown[]): unknown {
  return { id, type: 'assistant', time: { created }, content };
}

function idleMessage(id = 'msg_idle', created = 2, outcome = 'succeeded'): unknown {
  return { id, type: 'idle', time: { created }, outcome };
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
  { messages: [userMessage(), assistantMessage('msg_1', 1, textHello)], permissions: [] },
  {
    messages: [userMessage(), assistantMessage('msg_1', 1, [...textHelloWorld, toolRunning])],
    permissions: [{ id: 'per_1', action: 'shell', resources: ['ls'] }],
  },
  {
    messages: [userMessage(), assistantMessage('msg_1', 1, [...textHelloWorld, toolCompleted])],
    permissions: [],
  },
  {
    messages: [
      userMessage(),
      assistantMessage('msg_1', 1, [...textHelloWorld, toolCompleted]),
      idleMessage(),
    ],
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
    const prompt = await driver.prompt(session, 'hi');

    const events = await collect(driver.events(session, { after: prompt }));

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

  it('wraps a fetch rejection in a DriverError without the URL or password', async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    const driver = createOpenCodeV2Driver({
      baseUrl: 'http://127.0.0.1:1',
      password: FAKE_PASSWORD,
      fetchImpl: failingFetch,
      pollIntervalMs: 1,
    });

    let caught: unknown;
    try {
      await driver.start(startOptions);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DriverError);
    if (caught instanceof DriverError) {
      expect(caught.operation).toBe('start');
      expect(caught.status).toBeUndefined();
      expect(caught.message).toContain('start could not reach the server');
      expect(caught.message).not.toContain(FAKE_PASSWORD);
      expect(caught.message).not.toContain('127.0.0.1');
    }

    await expect(driver.prompt(SESSION, 'hi')).rejects.toBeInstanceOf(DriverError);

    const events = await collect(driver.events(SESSION, { after: AFTER }));
    expect(events).toEqual([{ type: 'error', message: 'events could not reach the server' }]);
  });

  it('stops events when the abort signal fires', async () => {
    const server = await startServer({
      frames: [{ messages: [assistantMessage('msg_1', 1, textHello)], permissions: [] }],
    });
    const driver = createDriver(server, 5);
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    // The stream never ends on its own (the fake run has no idle message), so this
    // resolves only if the abort signal stops the loop.
    const consume = (async () => {
      for await (const event of driver.events(SESSION, {
        after: AFTER,
        signal: controller.signal,
      })) {
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

    const events = await collect(driver.events(SESSION, { after: AFTER }));

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
        messages: [assistantMessage('msg_1', 1, [reasoning, toolRunning])],
        permissions: [],
      },
      {
        messages: [assistantMessage('msg_1', 1, [reasoning, toolFailed]), idleMessage()],
        permissions: [],
      },
    ];
    const server = await startServer({ frames: runFrames });
    const driver = createDriver(server);

    const events = await collect(driver.events(SESSION, { after: AFTER }));

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

describe('follow-up prompts', () => {
  const promptResponses: FakePromptResponse[] = [
    { id: 'msg_p1', createdAt: 0 },
    { id: 'msg_p2', createdAt: 10 },
  ];

  it('streams only the new run and ends on the new idle', async () => {
    const followUpFrames: FakeFrame[] = [
      {
        messages: [
          userMessage('msg_p1', 0),
          assistantMessage('msg_old', 1, [{ type: 'text', text: 'old answer' }]),
          idleMessage('msg_idle_old', 2),
          userMessage('msg_p2', 10),
          assistantMessage('msg_new', 11, [{ type: 'text', text: 'new answer' }]),
          idleMessage('msg_idle_new', 12),
        ],
        permissions: [],
      },
    ];
    const server = await startServer({ frames: followUpFrames, promptResponses });
    const driver = createDriver(server);
    const session = await driver.start(startOptions);
    await driver.prompt(session, 'first');
    const prompt = await driver.prompt(session, 'second');

    const events = await collect(driver.events(session, { after: prompt }));

    expect(events).toEqual([
      { type: 'text', messageId: 'msg_new', text: 'new answer' },
      { type: 'done', outcome: 'succeeded' },
    ]);
  });

  it('collects a follow-up run that arrives over several polls', async () => {
    const old = assistantMessage('msg_old', 1, [{ type: 'text', text: 'old answer' }]);
    const oldIdle = idleMessage('msg_idle_old', 2);
    const runFrames: FakeFrame[] = [
      {
        messages: [userMessage('msg_p1', 0), old, oldIdle, userMessage('msg_p2', 10)],
        permissions: [],
      },
      {
        messages: [
          userMessage('msg_p1', 0),
          old,
          oldIdle,
          userMessage('msg_p2', 10),
          assistantMessage('msg_new', 11, [{ type: 'text', text: 'part one' }]),
        ],
        permissions: [],
      },
      {
        messages: [
          userMessage('msg_p1', 0),
          old,
          oldIdle,
          userMessage('msg_p2', 10),
          assistantMessage('msg_new', 11, [{ type: 'text', text: 'part one part two' }]),
          idleMessage('msg_idle_new', 12),
        ],
        permissions: [],
      },
    ];
    const server = await startServer({ frames: runFrames, promptResponses });
    const driver = createDriver(server);
    const session = await driver.start(startOptions);
    await driver.prompt(session, 'first');
    const prompt = await driver.prompt(session, 'second');

    const events = await collect(driver.events(session, { after: prompt }));

    expect(events).toEqual([
      { type: 'text', messageId: 'msg_new', text: 'part one' },
      { type: 'text', messageId: 'msg_new', text: ' part two' },
      { type: 'done', outcome: 'succeeded' },
    ]);
  });

  it('falls back to timestamps when the prompt message is not in the page', async () => {
    const fallbackFrames: FakeFrame[] = [
      {
        messages: [
          assistantMessage('msg_old', 1, [{ type: 'text', text: 'old answer' }]),
          idleMessage('msg_idle_old', 2),
          assistantMessage('msg_new', 11, [{ type: 'text', text: 'new answer' }]),
          idleMessage('msg_idle_new', 12),
        ],
        permissions: [],
      },
    ];
    const server = await startServer({ frames: fallbackFrames });
    const driver = createDriver(server);
    const missing: PromptRef = { messageId: 'msg_p2', createdAt: 10 };

    const events = await collect(driver.events(SESSION, { after: missing }));

    expect(events).toEqual([
      { type: 'text', messageId: 'msg_new', text: 'new answer' },
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
