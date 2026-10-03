import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  xml,
  type XmppAuthenticate,
  type XmppClient,
  type XmppElement,
  type XmppJid,
  type XmppStatus,
} from '@xmpp/client';
import { PING_NAMESPACE } from './namespaces';
import { createCore, type ClientOptions } from './client';
import type { ConnectionStatus, XmppCore, XmppCoreOptions } from './types';

type FakeClient = XmppClient & {
  sent: XmppElement[];
  stopCalls: number;
  disconnectCalls: number;
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
    stopCalls: 0,
    disconnectCalls: 0,
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
      fake.status = 'connecting';
      emit('status', 'connecting');
    },
    async stop(): Promise<void> {
      fake.stopCalls += 1;
      fake.status = 'offline';
      emit('status', 'offline');
    },
    async disconnect(): Promise<void> {
      // Faithful to @xmpp/connection: a torn-down socket reports the
      // `disconnect` status (not `offline`), which is what the library's
      // auto-reconnect listens for.
      fake.disconnectCalls += 1;
      fake.status = 'disconnect';
      emit('status', 'disconnect');
      emit('disconnect');
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

function errorWithStatus(status: number, message: string): Error {
  const error = new Error(message);
  Object.assign(error, { status });
  return error;
}

function tokenOptions(
  getToken: () => Promise<{ jid: string; token: string }>,
  extra: Partial<XmppCoreOptions> = {},
): XmppCoreOptions {
  return {
    service: 'ws://127.0.0.1:5280/ws',
    domain: 'zilar.localhost',
    getToken,
    ...extra,
  };
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

async function connectedCore(
  fake: FakeClient,
  getToken: () => Promise<{ jid: string; token: string }> = async () => ({
    jid: 'bob@zilar.localhost',
    token: 'tok',
  }),
  extra: Partial<XmppCoreOptions> = {},
): Promise<{ core: XmppCore; captured: () => ClientOptions | undefined }> {
  let captured: ClientOptions | undefined;
  const core = createCore(tokenOptions(getToken, extra), {
    createClient: (clientOptions) => {
      captured = clientOptions;
      return fake;
    },
  });
  const connecting = core.connect();
  fake.emitOnline('bob@zilar.localhost');
  await connecting;
  return { core, captured: () => captured };
}

async function flush(): Promise<void> {
  // Fake timers are on for the whole file: a real `setTimeout` flush never
  // fires, so advance by zero instead (it also flushes microtasks).
  await vi.advanceTimersByTimeAsync(0);
}

function pingRequests(fake: FakeClient): XmppElement[] {
  return fake.sent.filter(
    (stanza) =>
      stanza.is('iq') &&
      stanza.attrs['type'] === 'get' &&
      stanza.getChild('ping', PING_NAMESPACE) !== undefined,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connection resilience: transient versus fatal token errors', () => {
  it('a network token failure on reconnect does not stop reconnecting', async () => {
    const fake = createFakeClient();
    let calls = 0;
    const { core, captured } = await connectedCore(fake, async () => {
      calls += 1;
      if (calls === 2) throw new Error('the network is down');
      return { jid: 'bob@zilar.localhost', token: `tok-${calls}` };
    });
    const statuses: ConnectionStatus[] = [];
    core.on('status', (status) => statuses.push(status));
    const authenticate = vi.fn(async () => {});

    // The first connect authenticates fine.
    await authenticateThrough(captured()!, fake, authenticate);

    // The drop: the library would now reconnect and ask for a fresh token.
    fake.emitStatus('disconnect');
    expect(core.status()).toBe('reconnecting');

    await expect(authenticateThrough(captured()!, fake, authenticate)).rejects.toThrow(
      'the network is down',
    );
    await flush();

    // Transient: still reconnecting, nothing torn down, no fatal stop.
    expect(core.status()).toBe('reconnecting');
    expect(fake.stopCalls).toBe(0);
    expect(statuses).not.toContain('offline');

    // The next attempt succeeds and the client is online again.
    await authenticateThrough(captured()!, fake, authenticate);
    fake.emitOnline('bob@zilar.localhost');
    expect(core.status()).toBe('online');
    // The failed second attempt never reached SASL; the third used a fresh
    // token.
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenNthCalledWith(
      2,
      { username: 'bob', password: 'tok-3' },
      'PLAIN',
    );
  });

  it.each([0, 429, 500, 503])(
    'a token failure with status %i is transient and keeps reconnecting',
    async (status) => {
      const fake = createFakeClient();
      let calls = 0;
      const { core, captured } = await connectedCore(fake, async () => {
        calls += 1;
        if (calls === 2) throw errorWithStatus(status, `token endpoint answered ${status}`);
        return { jid: 'bob@zilar.localhost', token: 'tok' };
      });
      const authenticate = vi.fn(async () => {});
      await authenticateThrough(captured()!, fake, authenticate);

      fake.emitStatus('disconnect');
      await expect(authenticateThrough(captured()!, fake, authenticate)).rejects.toThrow(
        `token endpoint answered ${status}`,
      );
      await flush();

      expect(core.status()).toBe('reconnecting');
      expect(fake.stopCalls).toBe(0);
    },
  );

  it.each([401, 403])('a token failure with status %i is fatal', async (status) => {
    const fake = createFakeClient();
    const { core, captured } = await connectedCore(fake, async () => {
      throw errorWithStatus(status, 'the session is gone');
    });
    const errors: string[] = [];
    core.on('error', (event) => errors.push(event.message));

    // Reported once, then offline for good.
    fake.emitStatus('disconnect');
    await expect(
      authenticateThrough(
        captured()!,
        fake,
        vi.fn(async () => {}),
      ),
    ).rejects.toThrow('the session is gone');
    await flush();

    expect(core.status()).toBe('offline');
    expect(fake.stopCalls).toBe(1);
    expect(errors.filter((message) => message.includes('the session is gone'))).toHaveLength(1);
  });

  it('a SASL authentication error stays fatal', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    const failure = new Error('not-authorized - Invalid username or password');
    failure.name = 'SASLError';
    fake.emitClientError(failure);
    await flush();

    expect(core.status()).toBe('offline');
    expect(fake.stopCalls).toBe(1);
  });
});

describe('connection resilience: backoff', () => {
  it('waits 1s, 2s, 4s, 8s, 15s, then 30s between attempts and resets after success', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    // The initial online resets the schedule: the first wait is 1 s.
    expect(fake.reconnect.delay).toBe(1000);

    const seen: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      fake.emitStatus('disconnect');
      fake.emitStatus('connecting');
      seen.push(fake.reconnect.delay);
    }
    expect(seen).toEqual([2000, 4000, 8000, 15000, 30000, 30000, 30000]);

    fake.emitOnline('bob@zilar.localhost');
    expect(core.status()).toBe('online');
    expect(fake.reconnect.delay).toBe(1000);
  });

  it('a cold start that never went online still walks the backoff schedule', async () => {
    const fake = createFakeClient();
    const core = createCore(
      tokenOptions(async () => ({ jid: 'bob@zilar.localhost', token: 'tok' })),
      { createClient: () => fake },
    );

    const connecting = core.connect();
    // The initial attempt leaves the library's 1 s wait untouched.
    expect(fake.reconnect.delay).toBe(1000);

    // Each retry arms the wait after it: 2 s, 4 s, 8 s, never stuck at 1 s
    // (a phone that starts offline must not hammer the token route).
    for (const expected of [2000, 4000, 8000]) {
      fake.emitStatus('disconnect');
      fake.emitStatus('connecting');
      expect(fake.reconnect.delay).toBe(expected);
    }

    fake.emitOnline('bob@zilar.localhost');
    await connecting;
    expect(core.status()).toBe('online');
    expect(fake.reconnect.delay).toBe(1000);
  });
});

describe('connection resilience: keepalive', () => {
  it('pings the server domain after silence and reconnects when no reply arrives', async () => {
    const fake = createFakeClient();
    const statuses: ConnectionStatus[] = [];
    const { core } = await connectedCore(fake);
    core.on('status', (status) => statuses.push(status));
    const pingsBefore = pingRequests(fake).length;

    // Silence for the idle period: exactly one ping goes out.
    await vi.advanceTimersByTimeAsync(30_000);
    const pings = pingRequests(fake);
    expect(pings).toHaveLength(pingsBefore + 1);
    expect(pings.at(-1)?.attrs['to']).toBe('zilar.localhost');

    // No reply within the reply window: the dead socket is torn down and
    // the client reconnects through the normal path.
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(fake.disconnectCalls).toBe(1);
    expect(core.status()).toBe('reconnecting');

    fake.emitOnline('bob@zilar.localhost');
    expect(core.status()).toBe('online');
    expect(statuses).toEqual(['reconnecting', 'online']);
  });

  it('any received stanza resets the idle timer', async () => {
    const fake = createFakeClient();
    await connectedCore(fake);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(pingRequests(fake)).toHaveLength(0);

    // Traffic just before the deadline restarts the full idle period.
    fake.emitStanza(xml('message', { from: 'alice@zilar.localhost', type: 'chat', id: 'm-1' }));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(pingRequests(fake)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(pingRequests(fake)).toHaveLength(1);
  });

  it.each(['result', 'error'] as const)(
    'a %s ping reply counts as alive and restarts the idle timer',
    async (type) => {
      const fake = createFakeClient();
      await connectedCore(fake);

      await vi.advanceTimersByTimeAsync(30_000);
      const ping = pingRequests(fake).at(-1);
      expect(ping).toBeDefined();
      const pingId = ping?.attrs['id'] ?? '';

      // The reply arrives just before the deadline: no teardown, and the
      // next idle period starts over.
      await vi.advanceTimersByTimeAsync(14_000);
      fake.emitStanza(xml('iq', { type, id: pingId, from: 'zilar.localhost' }));
      await flush();
      await vi.advanceTimersByTimeAsync(15_000);
      await flush();
      expect(fake.disconnectCalls).toBe(0);
      expect(pingRequests(fake)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(16_000);
      expect(pingRequests(fake)).toHaveLength(2);
    },
  );

  it('sends no pings after disconnect and leaves no timers behind', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    await core.disconnect();
    const sentBefore = fake.sent.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await flush();
    expect(fake.sent.length).toBe(sentBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a keepaliveMs of 0 disables the keepalive', async () => {
    const fake = createFakeClient();
    await connectedCore(fake, async () => ({ jid: 'bob@zilar.localhost', token: 'tok' }), {
      keepaliveMs: 0,
    });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pingRequests(fake)).toHaveLength(0);
  });
});

describe('connection resilience: answering server pings', () => {
  it('replies to an incoming ping with an empty result', async () => {
    const fake = createFakeClient();
    await connectedCore(fake);

    fake.emitStanza(
      xml(
        'iq',
        { type: 'get', id: 'server-ping-1', from: 'zilar.localhost' },
        xml('ping', { xmlns: PING_NAMESPACE }),
      ),
    );
    await flush();

    const reply = fake.sent.find((stanza) => stanza.attrs['id'] === 'server-ping-1');
    expect(reply?.attrs).toMatchObject({
      type: 'result',
      to: 'zilar.localhost',
    });
    expect(reply?.getChildElements()).toHaveLength(0);
  });

  it('ignores an iq get without a ping child', async () => {
    const fake = createFakeClient();
    await connectedCore(fake);
    const sentBefore = fake.sent.length;

    fake.emitStanza(xml('iq', { type: 'get', id: 'other-1', from: 'zilar.localhost' }));
    await flush();

    expect(fake.sent.length).toBe(sentBefore);
  });
});

// Device test 2026-10-03 (Android emulator, airplane mode for 40 s): after the
// network came back the app stayed on "Connecting..." for ever, until it was
// force closed. xmpp.js only retries after a socket `disconnect`; a failed
// attempt that never produces one leaves the client waiting. The watchdog
// replaces a client that stays connecting or reconnecting too long.
describe('connection resilience: reconnect watchdog', () => {
  function coreWithFakes(extra: Partial<XmppCoreOptions> = {}): {
    core: XmppCore;
    clients: FakeClient[];
  } {
    const clients: FakeClient[] = [];
    const core = createCore(
      tokenOptions(async () => ({ jid: 'bob@zilar.localhost', token: 'tok' }), extra),
      {
        createClient: () => {
          const fake = createFakeClient();
          clients.push(fake);
          return fake;
        },
      },
    );
    return { core, clients };
  }

  async function onlineThenWedged(extra: Partial<XmppCoreOptions> = {}) {
    const { core, clients } = coreWithFakes(extra);
    const connecting = core.connect();
    clients[0]?.emitOnline('bob@zilar.localhost');
    await connecting;
    // The socket drops and the library never retries (no further events).
    clients[0]?.emitStatus('disconnect');
    expect(core.status()).toBe('reconnecting');
    return { core, clients };
  }

  it('replaces a client that stays reconnecting, and ignores the old one afterwards', async () => {
    const { core, clients } = await onlineThenWedged();

    await vi.advanceTimersByTimeAsync(24_000);
    expect(clients).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_500);
    await flush();
    expect(clients).toHaveLength(2);
    expect(clients[0]?.stopCalls).toBe(1);
    expect(clients[1]?.status).toBe('connecting');

    // Late events of the replaced client must not move the core.
    clients[0]?.emitOnline('bob@zilar.localhost');
    expect(core.status()).toBe('reconnecting');

    clients[1]?.emitOnline('bob@zilar.localhost');
    expect(core.status()).toBe('online');
  });

  it('keeps trying: a replacement that also wedges is replaced again', async () => {
    const { clients } = await onlineThenWedged();
    await vi.advanceTimersByTimeAsync(26_000);
    await vi.advanceTimersByTimeAsync(26_000);
    await flush();
    expect(clients).toHaveLength(3);
  });

  it('a cold start that never gets going is replaced too', async () => {
    const { core, clients } = coreWithFakes();
    const connecting = core.connect();
    const failed = connecting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await failed).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(11_000);
    await flush();
    expect(clients).toHaveLength(2);
    clients[1]?.emitOnline('bob@zilar.localhost');
    expect(core.status()).toBe('online');
  });

  it('an explicit connect() while stuck (a resume) replaces the client at once', async () => {
    const { core, clients } = await onlineThenWedged();
    const reconnecting = core.connect();
    await flush();
    expect(clients).toHaveLength(2);
    clients[1]?.emitOnline('bob@zilar.localhost');
    await reconnecting;
    expect(core.status()).toBe('online');
  });

  it('can be disabled with 0', async () => {
    const { clients } = await onlineThenWedged({ reconnectWatchdogMs: 0 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(clients).toHaveLength(1);
  });

  it('stops for good on disconnect() and when the client comes back by itself', async () => {
    // The keepalive is off here: this test is about the watchdog alone.
    const { core, clients } = await onlineThenWedged({ keepaliveMs: 0 });
    clients[0]?.emitOnline('bob@zilar.localhost');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients).toHaveLength(1);
    expect(core.status()).toBe('online');

    clients[0]?.emitStatus('disconnect');
    await core.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients).toHaveLength(1);
  });
});
