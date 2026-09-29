import { xml, type XmppElement } from '@xmpp/component';
import type { SpikeComponent } from '@xmpp/component';
import { describe, expect, it, vi } from 'vitest';
import { startPushSpikeComponent } from './component';
import { PUBSUB_NAMESPACE, PUSH_NAMESPACE } from './protocol';
import { createMemorySubscriptionStore } from './subscriptions';

function logger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function publishStanza(node: string) {
  return xml(
    'iq',
    { type: 'set', from: 'galena.localhost', to: 'push.galena.localhost', id: 'n99' },
    xml(
      'pubsub',
      { xmlns: PUBSUB_NAMESPACE },
      xml(
        'publish',
        { node },
        xml(
          'item',
          {},
          xml(
            'notification',
            { xmlns: PUSH_NAMESPACE },
            xml(
              'x',
              { xmlns: 'jabber:x:data', type: 'submit' },
              xml('field', { var: 'FORM_TYPE' }, xml('value', {}, 'urn:xmpp:push:summary')),
              xml('field', { var: 'last-message-body' }, xml('value', {}, 'hello')),
            ),
          ),
        ),
      ),
    ),
  );
}

describe('push spike component', () => {
  it('routes a publish IQ to the stored subscription and answers result', async () => {
    const store = createMemorySubscriptionStore();
    store.save({
      userId: 'user-1',
      node: 'spike-abc123',
      subscription: {
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'p', auth: 'a' },
      },
      createdAt: new Date(),
    });
    const sent: Array<{ endpoint: string; payload: string }> = [];
    const sender = {
      send: async (
        subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
        payload: string,
      ) => {
        sent.push({ endpoint: subscription.endpoint, payload });
        return { gone: false };
      },
    };

    const listeners = new Map<string, Array<(value: XmppElement) => void>>();
    const sentStanzas: XmppElement[] = [];
    const fake: SpikeComponent = {
      status: 'offline',
      on: (event, listener) => {
        const list = listeners.get(event) ?? [];
        if (event === 'stanza') {
          list.push(listener as (value: XmppElement) => void);
          listeners.set(event, list);
        }
        return fake;
      },
      start: async () => undefined,
      stop: async () => undefined,
      send: async (stanza: XmppElement): Promise<void> => {
        sentStanzas.push(stanza);
      },
    };

    const handle = startPushSpikeComponent({
      config: {
        PUSH_SPIKE_ENABLED: true,
        PUSH_COMPONENT_PORT: 5347,
        PUSH_COMPONENT_JID: 'push.galena.localhost',
        PUSH_COMPONENT_SECRET: 'secret',
      },
      store,
      sender,
      logger: logger(),
      createComponent: () => fake,
    });

    const stanzaListeners = listeners.get('stanza') ?? [];
    expect(stanzaListeners.length).toBe(1);
    await stanzaListeners[0]?.(publishStanza('spike-abc123'));

    expect(sent.length).toBe(1);
    expect(sent[0]?.endpoint).toBe('https://push.example.com/sub/1');
    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({ chatId: 'spike:spike-abc123' });
    const answer = sentStanzas.find((stanza) => stanza.is('iq'));
    expect(answer?.attrs['type']).toBe('result');
    expect(answer?.attrs['id']).toBe('n99');

    await handle.stop();
  });

  it('removes the subscription when the endpoint answers gone (404/410)', async () => {
    const store = createMemorySubscriptionStore();
    store.save({
      userId: 'user-1',
      node: 'spike-gone1',
      subscription: {
        endpoint: 'https://push.example.com/sub/gone',
        keys: { p256dh: 'p', auth: 'a' },
      },
      createdAt: new Date(),
    });
    const sender = { send: async () => ({ gone: true }) };

    const listeners = new Map<string, Array<(value: XmppElement) => void>>();
    const fake: SpikeComponent = {
      status: 'offline',
      on: (event, listener) => {
        const list = listeners.get(event) ?? [];
        if (event === 'stanza') {
          list.push(listener as (value: XmppElement) => void);
          listeners.set(event, list);
        }
        return fake;
      },
      start: async () => undefined,
      stop: async () => undefined,
      send: async (): Promise<void> => {},
    };

    const handle = startPushSpikeComponent({
      config: {
        PUSH_SPIKE_ENABLED: true,
        PUSH_COMPONENT_PORT: 5347,
        PUSH_COMPONENT_JID: 'push.galena.localhost',
        PUSH_COMPONENT_SECRET: 'secret',
      },
      store,
      sender,
      logger: logger(),
      createComponent: () => fake,
    });

    const stanzaListeners = listeners.get('stanza') ?? [];
    await stanzaListeners[0]?.(publishStanza('spike-gone1'));
    expect(store.byNode('spike-gone1')).toBeUndefined();

    await handle.stop();
  });
});
