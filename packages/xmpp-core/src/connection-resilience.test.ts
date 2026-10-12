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
import { SM_ENABLE_TIMEOUT_MS } from './core-effect/config';
import { STREAM_MANAGEMENT_NS } from './stream-management';
import { createCore, type ClientOptions } from './client';
import type { ConnectionStatus, XmppCore, XmppCoreOptions } from './types';

type FakeClient = XmppClient & {
  sent: XmppElement[];
  stopCalls: number;
  disconnectCalls: number;
  socketEndCalls: number;
  socket: { end(): void };
  driverRunning: boolean;
  driverStartCalls: number;
  reconnectRuns: number;
  streamManagement: {
    id: string;
    enabled: boolean;
    on(event: string, listener: () => void): unknown;
    emitResumed(): void;
    enqueue(stanza: XmppElement): void;
  };
  emitOnline(jid: string): void;
  /** The `online` event with stream management still disabled (the real bind order). */
  emitOnlineRaw(jid: string): void;
  /** One incoming element (what stream-management observes for <enabled/>). */
  emitElement(element: XmppElement): void;
  emitResumed(): void;
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

  // Faithful to @xmpp/reconnect: the driver is one `disconnect` listener,
  // added by `start()` and removed by `stop()`. Starting twice without a
  // stop stacks a second listener, so one drop reconnects twice.
  function reconnectHandler(): void {
    fake.reconnectRuns += 1;
  }
  function driverListeners(): Set<(...args: never[]) => void> {
    let set = listeners.get('disconnect');
    if (set === undefined) {
      set = new Set();
      listeners.set('disconnect', set);
    }
    return set;
  }

  const fake = {
    jid: null as XmppJid | null,
    status: 'offline' as XmppStatus,
    sent,
    stopCalls: 0,
    disconnectCalls: 0,
    // F1 suspend/wake: the `socket` the suspend ends directly (an abrupt
    // close at the transport, no framing `</stream>`), the library's
    // reconnect driver it stops/starts, and the stream-management state
    // (`id` survives the suspend; a failed resume replaces it).
    socketEndCalls: 0,
    driverRunning: true,
    driverStartCalls: 0,
    reconnectRuns: 0,
    socket: {
      end() {
        fake.socketEndCalls += 1;
        fake.status = 'disconnect';
        emit('status', 'disconnect');
        emit('disconnect');
      },
    },
    reconnect: {
      delay: 1000,
      on: () => fake,
      start() {
        fake.driverRunning = true;
        fake.driverStartCalls += 1;
        // Like the library's `start()`: the listener stacks when started
        // twice without a stop.
        driverListeners().add(reconnectHandler as (...args: never[]) => void);
      },
      stop() {
        fake.driverRunning = false;
        driverListeners().delete(reconnectHandler as (...args: never[]) => void);
      },
    },
    streamManagement: {
      id: 'sm-1',
      enabled: false,
      outbound_q: [] as { stanza: XmppElement }[],
      on(event: string, listener: () => void) {
        let set = listeners.get(`sm:${event}`);
        if (set === undefined) {
          set = new Set();
          listeners.set(`sm:${event}`, set);
        }
        set.add(listener as (...args: never[]) => void);
        return fake;
      },
      emitResumed() {
        for (const listener of listeners.get('sm:resumed') ?? []) {
          (listener as () => void)();
        }
      },
      enqueue(stanza: XmppElement) {
        const queue = fake.streamManagement.outbound_q;
        queue.push({ stanza });
      },
    },
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
      fake.streamManagement.enabled = true;
      emit('status', 'online');
      emit('online', parsed);
    },
    // The real order: xmpp.js binds and reports `online` before it sends
    // <enable/>, so stream management is still inactive at the `online` event.
    emitOnlineRaw(jid: string): void {
      const parsed = makeJid(jid);
      fake.jid = parsed;
      fake.status = 'online';
      fake.streamManagement.enabled = false;
      emit('status', 'online');
      emit('online', parsed);
    },
    emitElement(element: XmppElement): void {
      emit('element', element);
    },
    // A stream-management resume: silent, like xmpp.js (`_ready(true)`) — no
    // `online` event, only the `resumed` the core listens for.
    emitResumed(): void {
      fake.status = 'online';
      fake.streamManagement.emitResumed();
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

  // Like the real client, whose factory starts the reconnect driver: one
  // `disconnect` listener from creation.
  driverListeners().add(reconnectHandler as (...args: never[]) => void);

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

  it.each([401, 403])(
    'a token failure with status %i is fatal after the one retry',
    async (status) => {
      const fake = createFakeClient();
      let calls = 0;
      const { core, captured } = await connectedCore(fake, async () => {
        calls += 1;
        throw errorWithStatus(status, 'the session is gone');
      });
      const errors: string[] = [];
      core.on('error', (event) => errors.push(event.message));

      // Two fatal answers in a row, then reported once and offline for good.
      fake.emitStatus('disconnect');
      const reauth = authenticateThrough(
        captured()!,
        fake,
        vi.fn(async () => {}),
      );
      const rejection = expect(reauth).rejects.toThrow('the session is gone');
      await flush();
      await vi.advanceTimersByTimeAsync(2_000);
      await rejection;
      await flush();

      expect(calls).toBe(2);
      expect(core.status()).toBe('offline');
      expect(fake.stopCalls).toBe(1);
      expect(errors.filter((message) => message.includes('the session is gone'))).toHaveLength(1);
    },
  );

  it('a single 401 on reconnect is retried once, then the core goes online', async () => {
    const fake = createFakeClient();
    let calls = 0;
    const { core, captured } = await connectedCore(fake, async () => {
      calls += 1;
      if (calls === 2) throw errorWithStatus(401, 'the session is gone');
      return { jid: 'bob@zilar.localhost', token: `tok-${calls}` };
    });
    const authenticate = vi.fn(async () => {});
    await authenticateThrough(captured()!, fake, authenticate);

    // The drop: the first per-reconnect fetch answers 401, the retry after the
    // wait answers fine, and the connection comes back online.
    fake.emitStatus('disconnect');
    const reauth = authenticateThrough(captured()!, fake, authenticate);
    await flush();
    expect(core.status()).toBe('reconnecting');
    expect(authenticate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await reauth;
    fake.emitOnline('bob@zilar.localhost');

    expect(core.status()).toBe('online');
    expect(fake.stopCalls).toBe(0);
    expect(calls).toBe(3);
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenNthCalledWith(
      2,
      { username: 'bob', password: 'tok-3' },
      'PLAIN',
    );
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

    await vi.advanceTimersByTimeAsync(4_500);
    expect(clients).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
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

  it('a replaced client reports its queued stanzas as unacked', async () => {
    // T-1216: a stanza sent just before the drop sits in the old client's
    // stream-management queue (`outbound_q`, which the library's
    // `disconnect` handler leaves alone). The watchdog replaces the client,
    // so the queued stanza gets neither `ack` nor `fail` — the replacement
    // reports it as `unacked` (the event a `fail` maps to), so the store
    // resends it once under the same id on the next online.
    const { core, clients } = await onlineThenWedged();
    const unacked: string[] = [];
    core.on('unacked', ({ stanzaId }) => unacked.push(stanzaId));

    clients[0]?.streamManagement.enqueue(
      xml('message', { xmlns: 'jabber:client', id: 'm-offline-two' }),
    );
    clients[0]?.streamManagement.enqueue(
      xml('presence', { xmlns: 'jabber:client', id: 'not-a-message' }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await flush();

    expect(clients).toHaveLength(2);
    expect(unacked).toEqual(['m-offline-two']);
  });

  it('keeps trying: a replacement that also wedges is replaced again', async () => {
    const { clients } = await onlineThenWedged();
    // The waits grow: 5 s, then 8 s, then 12 s, then 20 s.
    await vi.advanceTimersByTimeAsync(5_100);
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(7_700);
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(clients).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(12_100);
    expect(clients).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(20_100);
    expect(clients).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(20_100);
    expect(clients).toHaveLength(6);
  });

  it('a cold start that never gets going is replaced too', async () => {
    const { core, clients } = coreWithFakes();
    const connecting = core.connect();
    const failed = connecting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await failed).toBeInstanceOf(Error);
    await flush();
    // Replaced after 5 s (and again after the next 8 s): never waits for ever.
    expect(clients.length).toBeGreaterThanOrEqual(2);
    clients.at(-1)?.emitOnline('bob@zilar.localhost');
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

  it('a replacement racing an explicit connect never leaves the core watchdog', async () => {
    // T-1220: if an explicit connect() lands while the watchdog is stopping
    // the old client, the replacement used to return early without re-arming —
    // the core was left with no watchdog, and xmpp.js's own backoff (up to a
    // 30 s wait per retry, about 2 minutes cumulatively) drove the reconnect.
    const { core, clients } = await onlineThenWedged({ reconnectWatchdogFirstMs: 15_000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    clients[0]!.stop = () => gate;

    // The watchdog fires and blocks inside stale.stop().
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(core.status()).toBe('reconnecting');

    // An explicit connect() builds a fresh client while the old one stops.
    const reconnecting = core.connect().catch(() => undefined);
    await flush();
    expect(clients).toHaveLength(2);

    release();
    await flush();
    const before = clients.length;

    // The new client wedges: the watchdog must still replace it.
    await vi.advanceTimersByTimeAsync(8_100);
    await flush();
    expect(clients.length).toBeGreaterThan(before);

    clients.at(-1)?.emitOnline('bob@zilar.localhost');
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

// T-1220: the store flushes its text outbox on the `online` status, and a
// stanza written before the library sends <enable/> is never queued by stream
// management and never covered by the server's <a h/>, so its `ack` never
// arrives. The resent text kept its clock in the live session and ticked only
// after a cold restart (from history). A fresh bind must therefore report
// `online` only once stream management is active.
describe('connection resilience: online only after stream management', () => {
  function bindCore(): { core: XmppCore; fake: FakeClient } {
    const fake = createFakeClient();
    const core = createCore(
      tokenOptions(async () => ({ jid: 'bob@zilar.localhost', token: 'tok' })),
      { createClient: () => fake },
    );
    return { core, fake };
  }

  it('a fresh bind reports online only once <enabled/> arrives', async () => {
    const { core, fake } = bindCore();
    const statuses: ConnectionStatus[] = [];
    core.on('status', (status) => statuses.push(status));

    const connecting = core.connect();
    // The real order: bind -> `online`, with <enable/> still to come.
    fake.emitOnlineRaw('bob@zilar.localhost');
    await flush();
    expect(core.status()).toBe('connecting');
    expect(statuses).not.toContain('online');

    fake.emitElement(xml('enabled', { xmlns: STREAM_MANAGEMENT_NS, id: 'sm-1', resume: 'true' }));
    await connecting;
    expect(core.status()).toBe('online');
    expect(statuses.at(-1)).toBe('online');
  });

  it('a fresh bind that never enables stream management still comes online', async () => {
    const { core, fake } = bindCore();
    const connecting = core.connect();
    fake.emitOnlineRaw('bob@zilar.localhost');
    await flush();
    expect(core.status()).toBe('connecting');

    // A server that offers no stream management (or a lost <enabled/>) falls
    // back after the wait instead of staying offline for ever.
    await vi.advanceTimersByTimeAsync(SM_ENABLE_TIMEOUT_MS);
    await connecting;
    expect(core.status()).toBe('online');
  });

  it('a resume reports online without waiting for <enabled/>', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);
    // A resume replays the queued stanzas: the session is already managed, so
    // the transition must not be gated.
    fake.streamManagement.enabled = false;
    fake.emitResumed();
    await flush();
    expect(core.status()).toBe('online');
  });
});

// F1 (MP-1, MP-12): the mobile background lifecycle. `suspend()` parks the
// session without the framing `</stream>` so ejabberd keeps it pending and
// pushes; `wake()` reconnects, resuming when the server still holds it.
describe('background lifecycle: suspend and wake', () => {
  it('suspend keeps the SM id and closes without </stream>', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);
    const statuses: ConnectionStatus[] = [];
    core.on('status', (status) => statuses.push(status));

    await core.suspend?.();
    await flush();

    // The socket ended below the stream layer: `disconnect()` (the framing
    // `</stream>`) never ran, and the stream-management id survived for a
    // resume. The driver stopped, so nothing reconnects while suspended.
    expect(fake.socketEndCalls).toBe(1);
    expect(fake.disconnectCalls).toBe(0);
    expect(fake.driverRunning).toBe(false);
    expect(fake.streamManagement.id).toBe('sm-1');
    expect(core.status()).toBe('offline');
    expect(statuses).toEqual(['offline']);
  });

  it('a failing socket close still leaves the status offline', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    // The exact error-path case: suspend racing an already-dead socket whose
    // `end()` throws. `suspend()` must still resolve and report offline, so a
    // later `wake()` really connects instead of reporting a phantom resume.
    fake.socket.end = () => {
      throw new Error('already closed');
    };
    await core.suspend?.();
    await flush();

    expect(core.status()).toBe('offline');
    expect(fake.driverRunning).toBe(false);
  });

  it('wake after suspend resumes and reports resumed', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    await core.suspend?.();
    const waking = core.wake?.();
    // The driver restarts; the library steps back from `disconnect` so
    // `start()` runs on the same client, with the SM id intact.
    expect(fake.driverRunning).toBe(true);
    fake.emitResumed();
    expect(await waking).toBe('resumed');
    await flush();

    expect(core.status()).toBe('online');
    expect(core.me()).toBe('bob@zilar.localhost');
  });

  it('a failed resume reports rebound', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    await core.suspend?.();
    const waking = core.wake?.();
    // Resume failed: the server bound a fresh session with a new SM id.
    fake.streamManagement.id = 'sm-2';
    fake.emitOnline('bob@zilar.localhost');
    expect(await waking).toBe('rebound');
    await flush();

    expect(core.status()).toBe('online');
  });

  it('a fresh bind after a live session reports rebound; a resume does not', async () => {
    // T-1216: the store needs to tell a rebound from a resume. A fresh bind
    // replaced the stream, so its unacked stanzas may be lost and the store
    // resends each in-flight text once; a resume carried them, so it must not.
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);
    const rebounds: number[] = [];
    core.on('rebound', () => rebounds.push(1));

    fake.streamManagement.id = 'sm-2';
    fake.emitOnline('bob@zilar.localhost');
    expect(rebounds).toHaveLength(1);

    fake.emitResumed();
    expect(rebounds).toHaveLength(1);
  });

  it('wake without suspend does not stack reconnect listeners', async () => {
    const fake = createFakeClient();
    const { core } = await connectedCore(fake);

    // Three foregrounds with no background between them: the driver was
    // never stopped, so `wake()` must not start it again.
    for (let round = 0; round < 3; round += 1) {
      const waking = core.wake?.();
      fake.emitResumed();
      expect(await waking).toBe('resumed');
    }
    await flush();
    expect(fake.driverStartCalls).toBe(0);

    // One drop now runs the driver's listener exactly once.
    fake.socket.end();
    await flush();
    expect(fake.reconnectRuns).toBe(1);
  });
});
