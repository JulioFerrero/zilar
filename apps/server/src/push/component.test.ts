import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  component,
  xml,
  type PushComponent,
  type PushComponentFactory,
  type PushXmppElement,
} from '@xmpp/component';
import { PUBSUB_NAMESPACE, PUSH_NAMESPACE } from './protocol';
import { startPushComponent, type PushComponentHandle } from './component';
import type { PushServiceDeps } from './service';

// `startPushComponent` calls `handleIncomingPush` from `./delivery`; stubbing it
// keeps this a unit test of the IQ routing, with no archive or database.
const { handleIncomingPush } = vi.hoisted(() => ({ handleIncomingPush: vi.fn() }));
vi.mock('./delivery', () => ({ handleIncomingPush }));

// The real `@xmpp/component` wires the real IQ callee middleware and listens
// for `element`. The fake never connects: `start`/`stop` resolve and `send`
// records the replies instead of writing to a socket.
type FakeComponent = PushComponent & {
  emit(event: string, ...args: unknown[]): void;
};

function factory(sent: PushXmppElement[]): {
  make: PushComponentFactory;
  fake: () => FakeComponent;
} {
  let created: FakeComponent | undefined;
  const make: PushComponentFactory = (options) => {
    const xmpp = component(options) as unknown as FakeComponent;
    xmpp.start = () => Promise.resolve();
    xmpp.stop = () => Promise.resolve();
    xmpp.send = (stanza) => {
      sent.push(stanza);
      return Promise.resolve();
    };
    created = xmpp;
    return xmpp;
  };
  return {
    make,
    fake: () => {
      if (created === undefined) {
        throw new Error('fake component was not created');
      }
      return created;
    },
  };
}

function start(
  sent: PushXmppElement[],
  logger: PushServiceDeps['logger'] = { info: () => {}, warn: () => {} },
): { fake: FakeComponent; handle: PushComponentHandle } {
  const { make, fake } = factory(sent);
  const handle = startPushComponent({
    domain: 'push.zilar.localhost',
    secret: 'shared-secret',
    host: '127.0.0.1',
    port: 5347,
    service: {
      config: { xmpp: { domain: 'chat.zilar.app' } },
    } as unknown as PushServiceDeps,
    logger,
    createComponent: make,
  });
  return { fake: fake(), handle };
}

function iq(attrs: Record<string, string>, ...children: PushXmppElement[]): PushXmppElement {
  return xml('iq', attrs, ...children);
}

function publishIq(
  node: string | undefined,
  id = 'iq-1',
  from = 'chat.zilar.app',
): PushXmppElement {
  return iq(
    { type: 'set', id, from, to: 'push.zilar.localhost' },
    xml(
      'pubsub',
      { xmlns: PUBSUB_NAMESPACE },
      xml(
        'publish',
        node === undefined ? {} : { node },
        xml('item', {}, xml('notification', { xmlns: PUSH_NAMESPACE })),
      ),
    ),
  );
}

beforeEach(() => {
  handleIncomingPush.mockReset();
  handleIncomingPush.mockResolvedValue({ kind: 'sent', userId: 'user-1', deviceId: 'device-1' });
});

describe('startPushComponent', () => {
  it('answers a publish IQ with exactly one result and runs delivery', async () => {
    const sent: PushXmppElement[] = [];
    const { fake } = start(sent);

    fake.emit('element', publishIq('p-node-1'));

    await vi.waitFor(() => expect(handleIncomingPush).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(handleIncomingPush).toHaveBeenCalledWith(expect.anything(), {
      node: 'p-node-1',
      from: 'chat.zilar.app',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.is('iq')).toBe(true);
    expect(sent[0]?.attrs['type']).toBe('result');
    expect(sent[0]?.attrs['id']).toBe('iq-1');
    expect(sent[0]?.attrs['to']).toBe('chat.zilar.app');
    expect(sent[0]?.getChild('error')).toBeUndefined();
  });

  it('answers a malformed publish with one result and does not deliver', async () => {
    const sent: PushXmppElement[] = [];
    const { fake } = start(sent);

    fake.emit('element', publishIq(undefined, 'bad-1'));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.attrs['type']).toBe('result');
    expect(sent[0]?.attrs['id']).toBe('bad-1');
    expect(handleIncomingPush).not.toHaveBeenCalled();
  });

  it('drops a publish from a user JID', async () => {
    const sent: PushXmppElement[] = [];
    const { fake } = start(sent);

    fake.emit('element', publishIq('p-node-1', 'user-1', 'ana@chat.zilar.app/laptop'));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent[0]?.attrs['type']).toBe('result');
    expect(handleIncomingPush).not.toHaveBeenCalled();
  });

  it('caps a node at 50 pending publishes and warns once', async () => {
    const sent: PushXmppElement[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handleIncomingPush.mockImplementation(() =>
      gate.then(() => ({ kind: 'sent', userId: 'user-1', deviceId: 'device-1' })),
    );
    const warn = vi.fn();
    const { fake } = start(sent, { info: () => undefined, warn });

    for (let index = 0; index < 60; index += 1) {
      fake.emit('element', publishIq('p-capped', `iq-${index}`));
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ node: 'p-capped' }, expect.any(String));

    release();
    await vi.waitFor(() => expect(handleIncomingPush).toHaveBeenCalledTimes(50));
  });

  it('answers a disco#info get with our identity and features', async () => {
    const sent: PushXmppElement[] = [];
    const { fake } = start(sent);

    fake.emit(
      'element',
      iq(
        { type: 'get', id: 'disco-1', from: 'chat.zilar.app', to: 'push.zilar.localhost' },
        xml('query', { xmlns: 'http://jabber.org/protocol/disco#info' }),
      ),
    );

    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const reply = sent[0];
    expect(reply?.attrs['type']).toBe('result');
    expect(reply?.attrs['id']).toBe('disco-1');
    const query = reply?.getChild('query', 'http://jabber.org/protocol/disco#info');
    expect(query).toBeDefined();
    expect(query?.getChild('identity')?.attrs['type']).toBe('push');
    expect(query?.getChildren('feature').map((feature) => feature.attrs['var'])).toEqual([
      PUSH_NAMESPACE,
      PUBSUB_NAMESPACE,
    ]);
  });
});
