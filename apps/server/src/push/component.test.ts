import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushComponent, PushXmppElement } from '@xmpp/component';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { startPushComponent } from './component';
import { createPushCipher } from './crypto';
import type { PushServiceDeps } from './service';
import { saveDevice } from './store';
import type { ArchivePool } from '../search/service';
import type { WebPushSubscription } from './subscriptions';
import { createPushTestTables } from './test-tables';
import { PUBSUB_NAMESPACE, PUSH_NAMESPACE } from './protocol';

const STORAGE_KEY = 'test-push-storage-key-0000000000000000';

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

// Structural element fake: the component only reads `is`/`attrs` here.
function publishStanza(node: string, id = 'n1'): PushXmppElement {
  const attrs: Record<string, string | undefined> = {
    type: 'set',
    from: TEST_XMPP_DOMAIN,
    to: 'push.galena.localhost',
    id,
  };
  return {
    is: (name) => name === 'iq',
    attrs,
    getChild: (name, xmlns) => {
      if (name === 'pubsub' && xmlns === PUBSUB_NAMESPACE) {
        return {
          is: () => false,
          attrs: {},
          getChild: (child) => {
            if (child !== 'publish') {
              return undefined;
            }
            return {
              is: () => false,
              attrs: { node },
              getChild: (grandchild) =>
                grandchild === 'item'
                  ? {
                      is: () => false,
                      attrs: {},
                      getChild: (great) =>
                        great === 'notification'
                          ? {
                              is: () => false,
                              attrs: { xmlns: PUSH_NAMESPACE },
                              getChild: () => undefined,
                              getChildren: () => [],
                              getChildText: () => undefined,
                              getName: () => 'notification',
                              getChildElements: () => [],
                              text: () => '',
                            }
                          : undefined,
                      getChildren: () => [],
                      getChildText: () => undefined,
                      getName: () => 'item',
                      getChildElements: () => [],
                      text: () => '',
                    }
                  : undefined,
              getChildren: () => [],
              getChildText: () => undefined,
              getName: () => 'publish',
              getChildElements: () => [],
              text: () => '',
            };
          },
          getChildren: () => [],
          getChildText: () => undefined,
          getName: () => 'pubsub',
          getChildElements: () => [],
          text: () => '',
        };
      }
      return undefined;
    },
    getChildren: () => [],
    getChildText: () => undefined,
    getName: () => 'iq',
    getChildElements: () => [],
    text: () => '',
  };
}

describe('push component', () => {
  let context: TestContext;
  let sent: Array<{ endpoint: string; payload: string }>;
  let archiveRows: Array<Record<string, unknown>>;

  const archive: ArchivePool = {
    query: async () => archiveRows as unknown as import('../search/service').ArchiveRow[],
    close: async () => {},
  };

  function service(): PushServiceDeps {
    return {
      db: context.db,
      config: context.config,
      archive,
      cipher: createPushCipher(STORAGE_KEY),
      sender: {
        send: async (target, payload) => {
          sent.push({ endpoint: target.endpoint, payload });
          return { gone: false };
        },
      },
      logger: context.logger,
      recentlyNotified: new Map(),
    };
  }

  function fakeComponent(): {
    fake: PushComponent;
    listeners: Map<string, Array<(value: never) => void>>;
    sentStanzas: PushXmppElement[];
  } {
    const listeners = new Map<string, Array<(value: never) => void>>();
    const sentStanzas: PushXmppElement[] = [];
    const fake: PushComponent = {
      status: 'offline',
      on: (event, listener) => {
        const list = listeners.get(event) ?? [];
        list.push(listener as (value: never) => void);
        listeners.set(event, list);
        return fake;
      },
      start: async () => undefined,
      stop: async () => undefined,
      send: async (stanza: PushXmppElement) => {
        sentStanzas.push(stanza);
      },
    };
    return { fake, listeners, sentStanzas };
  }

  beforeEach(async () => {
    context = await createTestContext();
    await createPushTestTables(context.db);
    sent = [];
    archiveRows = [];
  });

  afterEach(async () => {
    await context.close();
  });

  it('routes a publish IQ to the stored device and answers result', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await saveDevice(context.db, createPushCipher(STORAGE_KEY), {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-comp-1',
      subscription: subscription('https://push.example.com/comp-1'),
      userAgent: null,
      now: new Date(),
    });
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [
      {
        owner: localpartFor(ana.id),
        barePeer: bobJid,
        kind: 'chat',
        nick: '',
        originId: 'dm-comp-1',
        timestamp: BigInt(Date.parse('2026-09-30T10:00:00Z')) * 1000n,
        text: 'component hello',
        xml: `<message from="${bobJid}/x"><body>component hello</body></message>`,
      },
    ];

    const { fake, listeners, sentStanzas } = fakeComponent();
    const handle = startPushComponent({
      domain: 'push.galena.localhost',
      secret: 'secret',
      port: 5347,
      service: service(),
      logger: { info: vi.fn(), warn: vi.fn() },
      createComponent: () => fake,
    });

    for (const stanza of listeners.get('stanza') ?? []) {
      (stanza as (value: PushXmppElement) => void)(publishStanza('p-comp-1'));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe('https://push.example.com/comp-1');
    // Every publish is answered with result, even on the way through.
    expect(
      sentStanzas.filter((stanza) => stanza.is('iq') && stanza.attrs['type'] === 'result'),
    ).toHaveLength(1);
    await handle.stop();
  });

  it('answers result for unknown nodes and non-push IQs', async () => {
    const { fake, listeners, sentStanzas } = fakeComponent();
    const handle = startPushComponent({
      domain: 'push.galena.localhost',
      secret: 'secret',
      port: 5347,
      service: service(),
      logger: { info: vi.fn(), warn: vi.fn() },
      createComponent: () => fake,
    });

    const discoQuery: PushXmppElement = {
      is: (name) => name === 'query',
      attrs: { xmlns: 'http://jabber.org/protocol/disco#info' },
      getChild: () => undefined,
      getChildren: () => [],
      getChildText: () => undefined,
      getName: () => 'query',
      getChildElements: () => [],
      text: () => '',
    };
    for (const stanza of listeners.get('stanza') ?? []) {
      const emit = stanza as (value: PushXmppElement) => void;
      emit(publishStanza('p-unknown'));
      emit({
        is: (name) => name === 'iq',
        attrs: { type: 'set', id: 'disco-1', from: TEST_XMPP_DOMAIN },
        getChild: () => undefined,
        getChildren: () => [],
        getChildText: () => undefined,
        getName: () => 'iq',
        getChildElements: () => [],
        text: () => '',
      });
      emit({
        is: (name) => name === 'iq',
        attrs: { type: 'get', id: 'disco-2', from: TEST_XMPP_DOMAIN },
        getChild: (name: string) => (name === 'query' ? discoQuery : undefined),
        getChildren: () => [],
        getChildText: () => undefined,
        getName: () => 'iq',
        getChildElements: () => [],
        text: () => '',
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sent).toHaveLength(0);
    expect(
      sentStanzas.filter((stanza) => stanza.is('iq') && stanza.attrs['type'] === 'result'),
    ).toHaveLength(3);
    const disco = sentStanzas.find((stanza) => stanza.attrs['id'] === 'disco-2');
    expect(disco?.attrs['to']).toBe(TEST_XMPP_DOMAIN);
    expect(
      disco
        ?.getChild('query', 'http://jabber.org/protocol/disco#info')
        ?.getChildren('feature')
        .map((feature) => feature.attrs['var']),
    ).toEqual(['urn:xmpp:push:0', 'http://jabber.org/protocol/pubsub']);
    await handle.stop();
  });

  it('handles two publish IQs for one node without losing either', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await saveDevice(context.db, createPushCipher(STORAGE_KEY), {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-comp-2',
      subscription: subscription('https://push.example.com/comp-2'),
      userAgent: null,
      now: new Date(),
    });
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    const local = localpartFor(ana.id);
    archiveRows = [
      {
        owner: local,
        barePeer: bobJid,
        kind: 'chat',
        nick: '',
        originId: 'dm-second',
        timestamp: BigInt(Date.parse('2026-09-30T10:01:00Z')) * 1000n,
        text: 'second',
        xml: `<message from="${bobJid}/x"><body>second</body></message>`,
      },
      {
        owner: local,
        barePeer: bobJid,
        kind: 'chat',
        nick: '',
        originId: 'dm-first',
        timestamp: BigInt(Date.parse('2026-09-30T10:00:00Z')) * 1000n,
        text: 'first',
        xml: `<message from="${bobJid}/x"><body>first</body></message>`,
      },
    ];

    const { fake, listeners } = fakeComponent();
    const handle = startPushComponent({
      domain: 'push.galena.localhost',
      secret: 'secret',
      port: 5347,
      service: service(),
      logger: { info: vi.fn(), warn: vi.fn() },
      createComponent: () => fake,
    });

    for (const stanza of listeners.get('stanza') ?? []) {
      const emit = stanza as (value: PushXmppElement) => void;
      emit(publishStanza('p-comp-2', 'n1'));
      emit(publishStanza('p-comp-2', 'n2'));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The per-node chain serializes the two handlers: the first sends the
    // newest message, the second sends the older one it had not seen (no
    // cross-IQ suppression — finding 4). Both publish IQs get a result.
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ body: 'second' });
    expect(JSON.parse(sent[1]!.payload)).toMatchObject({ body: 'first' });

    // And a third IQ for the same node stays silent: both are now seen.
    for (const stanza of listeners.get('stanza') ?? []) {
      (stanza as (value: PushXmppElement) => void)(publishStanza('p-comp-2', 'n3'));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toHaveLength(2);
    await handle.stop();
  });
});
