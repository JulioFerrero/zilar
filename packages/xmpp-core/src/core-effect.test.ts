import { describe, expect, it } from 'vitest';
import { Effect, Fiber, Stream } from 'effect';
import { xml, type XmppClient, type XmppElement, type XmppJid } from '@xmpp/client';
import { createCoreEffect, type CoreEffect } from './core-effect';
import { NotOnline } from './errors';
import { createXmppCoreEffect } from './index';
import type { ChatMessage, ConnectionStatus } from './types';

type FakeClient = XmppClient & {
  sent: XmppElement[];
  failSends: Error | undefined;
  emitOnline(jid: string): void;
  emitStanza(stanza: XmppElement): void;
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
    status: 'offline',
    reconnect: { delay: 1000, on: () => fake },
    sent,
    failSends: undefined as Error | undefined,
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
    async start(): Promise<void> {},
    async stop(): Promise<void> {
      emit('offline');
    },
    async disconnect(): Promise<void> {
      await fake.stop();
    },
    async send(stanza: XmppElement): Promise<void> {
      if (fake.failSends !== undefined) throw fake.failSends;
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
    emitStanza(stanza: XmppElement): void {
      emit('stanza', stanza);
    },
  };

  return fake as unknown as FakeClient;
}

function makeCore(fake: FakeClient): CoreEffect {
  return createCoreEffect(
    {
      service: 'ws://127.0.0.1:5280/ws',
      domain: 'zilar.localhost',
      getToken: async () => ({ jid: 'bob@zilar.localhost', token: 'tok' }),
      keepaliveMs: 0,
      reconnectWatchdogMs: 0,
    },
    { createClient: () => fake, generateId: () => 'id-1' },
  );
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connectOnline(core: CoreEffect, fake: FakeClient): Promise<void> {
  const connecting = Effect.runPromise(core.connect());
  fake.emitOnline('bob@zilar.localhost');
  await connecting;
  await flush();
  fake.sent.length = 0;
}

describe('createXmppCoreEffect', () => {
  it('is exported from the package index', () => {
    const core = createXmppCoreEffect({
      service: 'ws://127.0.0.1:5280/ws',
      domain: 'zilar.localhost',
      getToken: async () => ({ jid: 'bob@zilar.localhost', token: 'tok' }),
    });
    expect(core.status()).toBe('offline');
    expect(Effect.isEffect(core.connect())).toBe(true);
  });
});

describe('XmppCoreEffect events', () => {
  it('delivers an incoming message to the message Stream', async () => {
    const fake = createFakeClient();
    const core = makeCore(fake);
    await connectOnline(core, fake);

    const received = Effect.runFork(core.events.message.pipe(Stream.take(1), Stream.runCollect));
    fake.emitStanza(
      xml(
        'message',
        { from: 'alice@zilar.localhost/phone', type: 'chat', id: 'm-1' },
        xml('body', {}, 'hello'),
      ),
    );

    const messages: ChatMessage[] = [...(await Effect.runPromise(Fiber.join(received)))];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: 'hello', fromJid: 'alice@zilar.localhost' });
  });

  it('delivers the status changes to the status Stream and to on() callbacks alike', async () => {
    const fake = createFakeClient();
    const core = makeCore(fake);
    const viaCallback: ConnectionStatus[] = [];
    core.on('status', (status) => viaCallback.push(status));

    const viaStream = Effect.runFork(core.events.status.pipe(Stream.take(2), Stream.runCollect));
    await connectOnline(core, fake);

    expect([...(await Effect.runPromise(Fiber.join(viaStream)))]).toEqual(['connecting', 'online']);
    expect(viaCallback).toEqual(['connecting', 'online']);
  });

  it('runs on() callbacks synchronously inside the stanza handler', async () => {
    const fake = createFakeClient();
    const core = makeCore(fake);
    await connectOnline(core, fake);
    const bodies: Array<string | undefined> = [];
    core.on('message', (message) => bodies.push(message.body));

    fake.emitStanza(
      xml(
        'message',
        { from: 'alice@zilar.localhost/phone', type: 'chat', id: 'm-2' },
        xml('body', {}, 'now'),
      ),
    );

    expect(bodies).toEqual(['now']);
  });
});

describe('XmppCoreEffect sends', () => {
  it('fails with NotOnline when offline', async () => {
    const core = makeCore(createFakeClient());

    const error = await Effect.runPromise(
      Effect.flip(core.sendMessage('alice@zilar.localhost', 'chat', 'hi')),
    );

    expect(error).toBeInstanceOf(NotOnline);
    expect(error.message).toBe('the XMPP connection is not online');
  });

  it('sends the message and returns its id when online', async () => {
    const fake = createFakeClient();
    const core = makeCore(fake);
    await connectOnline(core, fake);

    const result = await Effect.runPromise(core.sendMessage('alice@zilar.localhost', 'chat', 'hi'));

    expect(result).toEqual({ id: 'id-1' });
    expect(fake.sent.at(-1)?.getChildText('body')).toBe('hi');
  });

  it('fails with the error the library rejected with', async () => {
    const fake = createFakeClient();
    const core = makeCore(fake);
    await connectOnline(core, fake);
    const rejection = new Error('socket closed');
    fake.failSends = rejection;

    const error = await Effect.runPromise(
      Effect.flip(core.sendRetraction('alice@zilar.localhost', 'chat', 'm-1')),
    );

    expect(error).toBe(rejection);
  });

  it('does nothing for typing while offline', async () => {
    const fake = createFakeClient();
    const core = makeCore(fake);

    await Effect.runPromise(core.sendTyping('alice@zilar.localhost', 'chat', 'composing'));

    expect(fake.sent).toEqual([]);
  });
});
