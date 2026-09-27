import { describe, expect, it, vi } from 'vitest';
import {
  xml,
  type XmppAuthenticate,
  type XmppClient,
  type XmppElement,
  type XmppJid,
  type XmppStatus,
} from '@xmpp/client';
import { createCore, type ClientOptions } from './client';
import type {
  ChatMessage,
  ConnectionStatus,
  DisplayedEvent,
  TypingEvent,
  XmppCore,
  XmppCoreOptions,
} from './types';
import {
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  DELAY_NAMESPACE,
  FORWARD_NAMESPACE,
  MAM_NAMESPACE,
  MUC_USER_NAMESPACE,
  REPLY_NAMESPACE,
  RSM_NAMESPACE,
} from './namespaces';

type FakeClient = XmppClient & {
  sent: XmppElement[];
  startCalls: number;
  stopCalls: number;
  emitOnline(jid: string): void;
  emitStatus(status: XmppStatus): void;
  emitStanza(stanza: XmppElement): void;
  emitClientError(error: Error): void;
};

function makeJid(value: string): XmppJid {
  return {
    toString: () => value,
    bare: () => makeJid(value.split('/')[0] ?? value),
  };
}

function createFakeClient(): FakeClient {
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  const sent: XmppElement[] = [];

  function emit(event: string, ...args: unknown[]): void {
    for (const listener of listeners.get(event) ?? []) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }

  const fake = {
    jid: null as XmppJid | null,
    status: 'offline' as XmppStatus,
    reconnect: { delay: 1000, on: () => fake },
    sent,
    startCalls: 0,
    stopCalls: 0,
    on(event: string, listener: (...args: never[]) => void) {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return fake;
    },
    removeListener(event: string, listener: (...args: never[]) => void) {
      listeners.get(event)?.delete(listener);
      return fake;
    },
    async start(): Promise<void> {
      fake.startCalls += 1;
    },
    async stop(): Promise<void> {
      fake.stopCalls += 1;
      fake.status = 'offline';
      emit('offline');
    },
    async disconnect(): Promise<void> {
      await fake.stop();
    },
    async send(stanza: XmppElement): Promise<void> {
      sent.push(stanza);
    },
    async sendMany(stanzas: XmppElement[]): Promise<void> {
      for (const stanza of stanzas) sent.push(stanza);
    },
    emitOnline(jid: string): void {
      const parsed = makeJid(jid);
      fake.jid = parsed;
      fake.status = 'online';
      emit('status', 'online');
      emit('online', parsed);
    },
    emitStatus(status: XmppStatus): void {
      fake.status = status;
      emit('status', status);
    },
    emitStanza(stanza: XmppElement): void {
      emit('stanza', stanza);
    },
    emitClientError(error: Error): void {
      emit('error', error);
    },
  };

  return fake as unknown as FakeClient;
}

function options(getToken: () => Promise<{ jid: string; token: string }>): XmppCoreOptions {
  return { service: 'ws://127.0.0.1:5280/ws', domain: 'galena.localhost', getToken };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Emulates the client calling the credentials provider and reporting a throw
// through its error event.
async function authenticateThrough(
  captured: ClientOptions,
  fake: FakeClient,
  authenticate: XmppAuthenticate,
): Promise<void> {
  try {
    await captured.credentials(authenticate, ['PLAIN']);
  } catch (error) {
    fake.emitClientError(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function connectedCore(fake: FakeClient): Promise<XmppCore> {
  const core = createCore(
    options(async () => ({ jid: 'bob@galena.localhost', token: 'tok' })),
    {
      createClient: () => fake,
    },
  );
  const connecting = core.connect();
  fake.emitOnline('bob@galena.localhost');
  await connecting;
  await flush();
  return core;
}

function joinPresences(fake: FakeClient, roomJid: string, nick: string): XmppElement[] {
  return fake.sent.filter(
    (stanza) =>
      stanza.is('presence') &&
      stanza.attrs['to'] === `${roomJid}/${nick}` &&
      stanza.attrs['type'] === undefined,
  );
}

describe('createXmppCore: connection lifecycle', () => {
  it('resolves connect on online and reports status and identity', async () => {
    const fake = createFakeClient();
    const statuses: ConnectionStatus[] = [];
    const core = createCore(
      options(async () => ({ jid: 'bob@galena.localhost', token: 'tok' })),
      {
        createClient: () => fake,
      },
    );
    core.on('status', (status) => statuses.push(status));

    const connecting = core.connect();
    expect(core.status()).toBe('connecting');

    fake.emitOnline('bob@galena.localhost');
    await connecting;

    expect(core.status()).toBe('online');
    expect(core.me()).toBe('bob@galena.localhost');
    expect(statuses).toEqual(['connecting', 'online']);

    await flush();
    expect(fake.sent.some((stanza) => stanza.is('presence'))).toBe(true);
    expect(
      fake.sent.some((stanza) => stanza.getChild('enable', CARBONS_NAMESPACE) !== undefined),
    ).toBe(true);
  });

  it('goes back to online and reports reconnecting after a dropped connection', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    fake.emitStatus('disconnect');
    expect(core.status()).toBe('reconnecting');

    fake.emitOnline('bob@galena.localhost');
    expect(core.status()).toBe('online');
  });

  it('stops reconnecting after a SASL failure', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const failure = new Error('not-authorized - Invalid username or password');
    failure.name = 'SASLError';
    fake.emitClientError(failure);
    await flush();

    expect(core.status()).toBe('offline');
    expect(fake.stopCalls).toBe(1);
  });

  it('unsubscribes with the function returned by on', async () => {
    const fake = createFakeClient();
    const core = createCore(
      options(async () => ({ jid: 'bob@galena.localhost', token: 'tok' })),
      {
        createClient: () => fake,
      },
    );
    const statuses: ConnectionStatus[] = [];
    const off = core.on('status', (status) => statuses.push(status));
    off();

    const connecting = core.connect();
    fake.emitOnline('bob@galena.localhost');
    await connecting;

    expect(statuses).toEqual([]);
  });
});

describe('createXmppCore: token login', () => {
  it('fetches a token on every authentication and uses the fresh one', async () => {
    let count = 0;
    const getToken = vi.fn(async () => {
      count += 1;
      return { jid: 'bob@galena.localhost', token: `tok-${count}` };
    });
    const fake = createFakeClient();
    let captured: ClientOptions | undefined;
    const core = createCore(options(getToken), {
      createClient: (clientOptions) => {
        captured = clientOptions;
        return fake;
      },
    });

    const connecting = core.connect();
    const authenticate = vi.fn(async () => {});
    await authenticateThrough(captured!, fake, authenticate);
    fake.emitOnline('bob@galena.localhost');
    await connecting;

    // A reconnect runs the credentials provider again.
    fake.emitStatus('disconnect');
    await authenticateThrough(captured!, fake, authenticate);
    fake.emitOnline('bob@galena.localhost');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenNthCalledWith(
      1,
      { username: 'bob', password: 'tok-1' },
      'PLAIN',
    );
    expect(authenticate).toHaveBeenNthCalledWith(
      2,
      { username: 'bob', password: 'tok-2' },
      'PLAIN',
    );
  });

  it('goes offline with an error and stops when getToken fails', async () => {
    const getToken = vi.fn(async () => {
      throw new Error('the token endpoint is down');
    });
    const fake = createFakeClient();
    let captured: ClientOptions | undefined;
    const core = createCore(options(getToken), {
      createClient: (clientOptions) => {
        captured = clientOptions;
        return fake;
      },
    });
    const errors: string[] = [];
    core.on('error', (event) => errors.push(event.message));

    const connecting = core.connect();
    await expect(
      authenticateThrough(
        captured!,
        fake,
        vi.fn(async () => {}),
      ),
    ).rejects.toThrow('the token endpoint is down');
    await expect(connecting).rejects.toThrow('the token endpoint is down');
    await flush();

    expect(errors.some((message) => message.includes('the token endpoint is down'))).toBe(true);
    expect(core.status()).toBe('offline');
    expect(fake.stopCalls).toBe(1);
  });

  it('never reports the token in an error message', async () => {
    const token = 'SECRET-TOKEN-VALUE';
    const fake = createFakeClient();
    let captured: ClientOptions | undefined;
    const core = createCore(
      options(async () => ({ jid: 'bob@galena.localhost', token })),
      {
        createClient: (clientOptions) => {
          captured = clientOptions;
          return fake;
        },
      },
    );
    const errors: string[] = [];
    core.on('error', (event) => errors.push(event.message));

    const connecting = core.connect();
    await authenticateThrough(
      captured!,
      fake,
      vi.fn(async () => {}),
    );
    fake.emitOnline('bob@galena.localhost');
    await connecting;

    fake.emitClientError(new Error(`authentication failed for ${token}`));

    expect(errors.some((message) => message.includes(token))).toBe(false);
    expect(errors.some((message) => message.includes('[redacted]'))).toBe(true);
  });
});

describe('createXmppCore: rooms', () => {
  it('resolves joinRoom on our own presence and rejects on an error', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    const roomJid = 'project@rooms.galena.localhost';

    const joining = core.joinRoom(roomJid, 'bob');
    await flush();
    expect(fake.sent.at(-1)?.attrs['to']).toBe(`${roomJid}/bob`);
    fake.emitStanza(xml('presence', { from: `${roomJid}/bob` }));
    await joining;

    const failing = core.joinRoom('locked@rooms.galena.localhost', 'bob');
    await flush();
    fake.emitStanza(
      xml(
        'presence',
        { from: 'locked@rooms.galena.localhost/bob', type: 'error' },
        xml(
          'error',
          { type: 'auth' },
          xml('registration-required', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }),
        ),
      ),
    );
    await expect(failing).rejects.toThrow('registration-required');
  });

  it('rejoins joined rooms after a reconnect', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    const roomJid = 'project@rooms.galena.localhost';

    const joining = core.joinRoom(roomJid, 'bob');
    await flush();
    fake.emitStanza(xml('presence', { from: `${roomJid}/bob` }));
    await joining;
    const before = joinPresences(fake, roomJid, 'bob').length;

    fake.emitStatus('disconnect');
    fake.emitOnline('bob@galena.localhost');
    await flush();

    expect(joinPresences(fake, roomJid, 'bob').length).toBe(before + 1);
  });

  it('leaves a room with an unavailable presence', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    const roomJid = 'project@rooms.galena.localhost';

    const joining = core.joinRoom(roomJid, 'bob');
    await flush();
    fake.emitStanza(xml('presence', { from: `${roomJid}/bob` }));
    await joining;

    await core.leaveRoom(roomJid);

    const leave = fake.sent.find(
      (stanza) => stanza.is('presence') && stanza.attrs['type'] === 'unavailable',
    );
    expect(leave?.attrs['to']).toBe(`${roomJid}/bob`);
  });
});

describe('createXmppCore: messages and markers', () => {
  it('sends a message and returns its id', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const { id } = await core.sendMessage('alice@galena.localhost', 'chat', 'hello', {
      replyTo: { id: 'm-0' },
    });

    const sent = fake.sent.at(-1);
    expect(sent?.attrs).toMatchObject({ type: 'chat', to: 'alice@galena.localhost', id });
    expect(sent?.getChildText('body')).toBe('hello');
    expect(sent?.getChild('reply', REPLY_NAMESPACE)?.attrs['id']).toBe('m-0');
  });

  it('rejects sending when offline', async () => {
    const fake = createFakeClient();
    const core = createCore(
      options(async () => ({ jid: 'bob@galena.localhost', token: 'tok' })),
      {
        createClient: () => fake,
      },
    );
    await expect(core.sendMessage('alice@galena.localhost', 'chat', 'hi')).rejects.toThrow(
      'not online',
    );
  });

  it('sends typing and displayed markers', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    core.sendTyping('project@rooms.galena.localhost', 'groupchat', 'composing');
    core.markDisplayed('project@rooms.galena.localhost', 'groupchat', 'm-1');
    await flush();

    expect(
      fake.sent.some((stanza) => stanza.getChild('composing', CHAT_STATES_NAMESPACE) !== undefined),
    ).toBe(true);
    expect(
      fake.sent.some(
        (stanza) => stanza.getChild('displayed', CHAT_MARKERS_NAMESPACE) !== undefined,
      ),
    ).toBe(true);
  });

  it('emits message, typing and displayed events from incoming stanzas', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    const messages: ChatMessage[] = [];
    const typing: TypingEvent[] = [];
    const displayed: DisplayedEvent[] = [];
    core.on('message', (message) => messages.push(message));
    core.on('typing', (event) => typing.push(event));
    core.on('displayed', (event) => displayed.push(event));

    fake.emitStanza(
      xml(
        'message',
        { from: 'alice@galena.localhost', type: 'chat', id: 'm-1' },
        xml('body', {}, 'hi'),
      ),
    );
    fake.emitStanza(
      xml(
        'message',
        { from: 'alice@galena.localhost', type: 'chat' },
        xml('composing', { xmlns: CHAT_STATES_NAMESPACE }),
      ),
    );
    fake.emitStanza(
      xml(
        'message',
        { from: 'alice@galena.localhost', type: 'chat' },
        xml('displayed', { xmlns: CHAT_MARKERS_NAMESPACE, id: 'm-0' }),
      ),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe('hi');
    expect(typing).toHaveLength(1);
    expect(displayed).toHaveLength(1);
  });

  it('ignores messages from another domain', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    const messages: ChatMessage[] = [];
    core.on('message', (message) => messages.push(message));

    fake.emitStanza(
      xml(
        'message',
        { from: 'alice@evil.example.com', type: 'chat', id: 'm-1' },
        xml('body', {}, 'nope'),
      ),
    );

    expect(messages).toHaveLength(0);
  });
});

describe('createXmppCore: history', () => {
  function mamResult(queryId: string, archiveId: string, stamp: string, body: string): XmppElement {
    return xml(
      'message',
      { from: 'project@rooms.galena.localhost', to: 'bob@galena.localhost/laptop' },
      xml(
        'result',
        { xmlns: MAM_NAMESPACE, queryid: queryId, id: archiveId },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml('delay', { xmlns: DELAY_NAMESPACE, stamp }),
          xml(
            'message',
            {
              from: 'project@rooms.galena.localhost/alice',
              type: 'groupchat',
              id: `m-${archiveId}`,
            },
            xml('body', {}, body),
            xml('x', { xmlns: MUC_USER_NAMESPACE }, xml('item', { jid: 'alice@galena.localhost' })),
          ),
        ),
      ),
    );
  }

  it('loads a room page, oldest first, with complete and first', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const history = core.loadHistory('project@rooms.galena.localhost', 'groupchat');
    await flush();

    const iq = fake.sent.at(-1);
    expect(iq?.attrs['to']).toBe('project@rooms.galena.localhost');
    const queryId = iq?.getChild('query', MAM_NAMESPACE)?.attrs['queryid'] ?? '';
    const iqId = iq?.attrs['id'] ?? '';

    fake.emitStanza(mamResult(queryId, 'archive-2', '2026-09-27T10:01:00Z', 'second'));
    fake.emitStanza(mamResult(queryId, 'archive-1', '2026-09-27T10:00:00Z', 'first'));
    fake.emitStanza(
      xml(
        'iq',
        { type: 'result', id: iqId },
        xml(
          'fin',
          { xmlns: MAM_NAMESPACE, complete: 'true' },
          xml('set', { xmlns: RSM_NAMESPACE }, xml('first', {}, 'archive-1')),
        ),
      ),
    );

    const page = await history;
    expect(page.messages.map((message) => message.body)).toEqual(['first', 'second']);
    expect(page.messages[0]?.id).toBe('archive-1');
    expect(page.complete).toBe(true);
    expect(page.first).toBe('archive-1');
  });

  it('rejects a history query that the server answers with an error', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const history = core.loadHistory('alice@galena.localhost', 'chat');
    await flush();
    const iqId = fake.sent.at(-1)?.attrs['id'] ?? '';

    fake.emitStanza(
      xml(
        'iq',
        { type: 'error', id: iqId },
        xml(
          'error',
          { type: 'cancel' },
          xml('forbidden', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }),
        ),
      ),
    );

    await expect(history).rejects.toThrow('forbidden');
  });
});
