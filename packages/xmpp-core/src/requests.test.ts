import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  xml,
  type XmppClient,
  type XmppElement,
  type XmppJid,
  type XmppStatus,
} from '@xmpp/client';
import { createCore } from './client';
import {
  Disconnected,
  HistorySendFailed,
  HistoryTimeout,
  JoinSendFailed,
  JoinTimeout,
  PushToggleFailed,
  PushToggleTimeout,
  UploadSlotFailed,
  UploadSlotInvalid,
  UploadSlotTimeout,
} from './errors';
import { HTTP_UPLOAD_NAMESPACE, MAM_NAMESPACE } from './namespaces';
import type { UploadRequest, XmppCore } from './types';

// The fake client and its helpers follow core.test.ts. Copied, not imported,
// so that file stays untouched.
type FakeClient = XmppClient & {
  sent: XmppElement[];
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
    status: 'offline' as XmppStatus,
    reconnect: { delay: 1000, on: () => fake },
    sent,
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
      fake.status = 'offline';
      emit('offline');
    },
    async disconnect(): Promise<void> {
      await fake.stop();
    },
    async send(stanza: XmppElement): Promise<void> {
      sent.push(stanza);
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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Under fake timers, advancing by 0 ms still lets queued promise callbacks run.
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

// Keepalive is off so no timer fires during a test. Each request gets the next
// id (req-1, req-2, ...), so a test can aim a late reply at one request.
async function connectedCore(fake: FakeClient): Promise<XmppCore> {
  let sequence = 0;
  const core = createCore(
    {
      service: 'ws://127.0.0.1:5280/ws',
      domain: 'zilar.localhost',
      getToken: async () => ({ jid: 'bob@zilar.localhost', token: 'tok' }),
      keepaliveMs: 0,
    },
    {
      createClient: () => fake,
      generateId: () => {
        sequence += 1;
        return `req-${sequence}`;
      },
    },
  );
  const connecting = core.connect();
  fake.emitOnline('bob@zilar.localhost');
  await connecting;
  await flush();
  return core;
}

// Connects with real timers, then switches to fake timers so the request
// timeouts (15 s, 30 s) can be advanced without waiting.
async function onlineWithFakeTimers(): Promise<{ fake: FakeClient; core: XmppCore }> {
  const fake = createFakeClient();
  const core = await connectedCore(fake);
  vi.useFakeTimers();
  return { fake, core };
}

// Makes every send reject, as a dropped socket would.
function failSends(fake: FakeClient, message: string): void {
  fake.send = async () => {
    throw new Error(message);
  };
}

// Attaches the handler at once, so a rejection that happens while timers
// advance is never reported as unhandled.
function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: unknown) => error,
  );
}

function expectFailure(
  error: unknown,
  errorClass: abstract new (...args: never[]) => object,
  tag: string,
  message: string,
): void {
  expect(error).toBeInstanceOf(errorClass);
  expect(error).toMatchObject({ _tag: tag, message });
}

function togglePush(core: XmppCore, enable: boolean): Promise<void> {
  const toggle = core.setPushEnabled;
  if (toggle === undefined) throw new Error('setPushEnabled is not available');
  return toggle({ pushJid: 'push.zilar.localhost', node: 'device-1', enable });
}

const UPLOAD: UploadRequest = { filename: 'photo.png', size: 3, contentType: 'image/png' };
const ROOM = 'project@rooms.zilar.localhost';
const CHAT = 'alice@zilar.localhost';

function slotReply(id: string): XmppElement {
  return xml(
    'iq',
    { type: 'result', id },
    xml(
      'slot',
      { xmlns: HTTP_UPLOAD_NAMESPACE },
      xml(
        'put',
        { url: 'https://files.zilar.localhost/put/abc' },
        xml('header', { name: 'X-Test' }, 'value'),
      ),
      xml('get', { url: 'https://files.zilar.localhost/get/abc' }),
    ),
  );
}

const SLOT = {
  putUrl: 'https://files.zilar.localhost/put/abc',
  getUrl: 'https://files.zilar.localhost/get/abc',
  headers: { 'X-Test': 'value' },
};

function lastId(fake: FakeClient): string {
  return fake.sent.at(-1)?.attrs['id'] ?? '';
}

// Records whether a promise has settled, without changing its outcome.
function trackSettled(promise: Promise<unknown>): () => boolean {
  let done = false;
  const mark = (): void => {
    done = true;
  };
  promise.then(mark, mark);
  return () => done;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('requestUploadSlot', () => {
  it('resolves with the slot from a valid reply', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const requesting = core.requestUploadSlot(UPLOAD);
    await flush();
    const request = fake.sent.at(-1);
    expect(request?.attrs['to']).toBe('upload.zilar.localhost');

    fake.emitStanza(slotReply(lastId(fake)));
    await expect(requesting).resolves.toEqual(SLOT);
  });

  it('fails with UploadSlotInvalid when the reply has no slot', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const requesting = failureOf(core.requestUploadSlot(UPLOAD));
    await flush();
    fake.emitStanza(xml('iq', { type: 'result', id: lastId(fake) }));

    expectFailure(
      await requesting,
      UploadSlotInvalid,
      'UploadSlotInvalid',
      'the upload service returned an invalid slot',
    );
  });

  it('fails with UploadSlotTimeout when no reply comes', async () => {
    const { core } = await onlineWithFakeTimers();

    const requesting = failureOf(core.requestUploadSlot(UPLOAD));
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);

    expectFailure(
      await requesting,
      UploadSlotTimeout,
      'UploadSlotTimeout',
      'timed out requesting an upload slot',
    );
  });

  it('fails with UploadSlotFailed when the send rejects', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    failSends(fake, 'socket closed');

    const requesting = failureOf(core.requestUploadSlot(UPLOAD));
    await flush();

    expectFailure(
      await requesting,
      UploadSlotFailed,
      'UploadSlotFailed',
      'could not request an upload slot: socket closed',
    );
  });
});

describe('joinRoom', () => {
  it('fails with JoinSendFailed when the join presence cannot be sent', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    failSends(fake, 'socket closed');

    const joining = failureOf(core.joinRoom(ROOM, 'bob'));
    await flush();

    expectFailure(
      await joining,
      JoinSendFailed,
      'JoinSendFailed',
      `could not send the join presence for ${ROOM}: socket closed`,
    );
  });

  it('fails with JoinTimeout when the room never answers', async () => {
    const { core } = await onlineWithFakeTimers();

    const joining = failureOf(core.joinRoom(ROOM, 'bob'));
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);

    expectFailure(await joining, JoinTimeout, 'JoinTimeout', `timed out joining ${ROOM}`);
  });
});

describe('loadHistory', () => {
  it('fails with HistorySendFailed when the query cannot be sent', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    failSends(fake, 'socket closed');

    const loading = failureOf(core.loadHistory(CHAT, 'chat'));
    await flush();

    expectFailure(
      await loading,
      HistorySendFailed,
      'HistorySendFailed',
      `could not send the history query for ${CHAT}: socket closed`,
    );
  });

  it('fails with HistoryTimeout when the archive never answers', async () => {
    const { core } = await onlineWithFakeTimers();

    const loading = failureOf(core.loadHistory(CHAT, 'chat'));
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);

    expectFailure(
      await loading,
      HistoryTimeout,
      'HistoryTimeout',
      `timed out loading the history of ${CHAT}`,
    );
  });
});

describe('setPushEnabled', () => {
  it('fails with PushToggleFailed when the IQ cannot be sent', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);
    failSends(fake, 'socket closed');

    const toggling = failureOf(togglePush(core, true));
    await flush();

    expectFailure(
      await toggling,
      PushToggleFailed,
      'PushToggleFailed',
      'could not toggle push notifications: socket closed',
    );
  });

  it('fails with PushToggleTimeout when the server never answers', async () => {
    const { core } = await onlineWithFakeTimers();

    const toggling = failureOf(togglePush(core, false));
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);

    expectFailure(
      await toggling,
      PushToggleTimeout,
      'PushToggleTimeout',
      'timed out toggling push notifications',
    );
  });
});

describe('a reply that arrives after the timeout', () => {
  it('is ignored for an upload slot, and a later request is answered by its own reply', async () => {
    const { fake, core } = await onlineWithFakeTimers();

    const first = failureOf(core.requestUploadSlot(UPLOAD));
    await settle();
    const firstId = lastId(fake);
    await vi.advanceTimersByTimeAsync(15_000);
    expectFailure(
      await first,
      UploadSlotTimeout,
      'UploadSlotTimeout',
      'timed out requesting an upload slot',
    );

    expect(() => fake.emitStanza(slotReply(firstId))).not.toThrow();
    await settle();

    const second = core.requestUploadSlot(UPLOAD);
    const secondDone = trackSettled(second);
    await settle();
    expect(secondDone()).toBe(false);
    expect(lastId(fake)).not.toBe(firstId);

    fake.emitStanza(slotReply(lastId(fake)));
    await expect(second).resolves.toEqual(SLOT);
  });

  it('is ignored for a join, and a later join of the same room resolves on its own presence', async () => {
    const { fake, core } = await onlineWithFakeTimers();

    const first = failureOf(core.joinRoom(ROOM, 'bob'));
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);
    expectFailure(await first, JoinTimeout, 'JoinTimeout', `timed out joining ${ROOM}`);

    expect(() => fake.emitStanza(xml('presence', { from: `${ROOM}/bob` }))).not.toThrow();
    await settle();

    const second = core.joinRoom(ROOM, 'bob');
    const secondDone = trackSettled(second);
    await settle();
    expect(secondDone()).toBe(false);

    fake.emitStanza(xml('presence', { from: `${ROOM}/bob` }));
    await expect(second).resolves.toBeUndefined();
  });

  it('is ignored for a history query, and a later query resolves on its own reply', async () => {
    const { fake, core } = await onlineWithFakeTimers();

    const first = failureOf(core.loadHistory(CHAT, 'chat'));
    await settle();
    const firstIqId = lastId(fake);
    await vi.advanceTimersByTimeAsync(30_000);
    expectFailure(
      await first,
      HistoryTimeout,
      'HistoryTimeout',
      `timed out loading the history of ${CHAT}`,
    );

    const lateFin = xml(
      'iq',
      { type: 'result', id: firstIqId },
      xml('fin', { xmlns: MAM_NAMESPACE }),
    );
    expect(() => fake.emitStanza(lateFin)).not.toThrow();
    await settle();

    const second = core.loadHistory(CHAT, 'chat');
    const secondDone = trackSettled(second);
    await settle();
    expect(secondDone()).toBe(false);

    fake.emitStanza(
      xml('iq', { type: 'result', id: lastId(fake) }, xml('fin', { xmlns: MAM_NAMESPACE })),
    );
    await expect(second).resolves.toMatchObject({ messages: [] });
  });

  it('is ignored for a push toggle, and a later toggle resolves on its own reply', async () => {
    const { fake, core } = await onlineWithFakeTimers();

    const first = failureOf(togglePush(core, true));
    await settle();
    const firstId = lastId(fake);
    await vi.advanceTimersByTimeAsync(15_000);
    expectFailure(
      await first,
      PushToggleTimeout,
      'PushToggleTimeout',
      'timed out toggling push notifications',
    );

    expect(() => fake.emitStanza(xml('iq', { type: 'result', id: firstId }))).not.toThrow();
    await settle();

    const second = togglePush(core, true);
    const secondDone = trackSettled(second);
    await settle();
    expect(secondDone()).toBe(false);

    fake.emitStanza(xml('iq', { type: 'result', id: lastId(fake) }));
    await expect(second).resolves.toBeUndefined();
  });
});

describe('disconnect while requests are pending', () => {
  it('fails pending upload and push requests with Disconnected', async () => {
    const fake = createFakeClient();
    const core = await connectedCore(fake);

    const upload = failureOf(core.requestUploadSlot(UPLOAD));
    const push = failureOf(togglePush(core, true));
    await flush();

    await core.disconnect();

    expectFailure(await upload, Disconnected, 'Disconnected', 'the XMPP client was disconnected');
    expectFailure(await push, Disconnected, 'Disconnected', 'the XMPP client was disconnected');
  });
});
