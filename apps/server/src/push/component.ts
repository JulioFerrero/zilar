import {
  component,
  xml,
  type PushComponent,
  type PushComponentFactory,
  type PushXmppElement,
} from '@xmpp/component';
import { parsePushIq } from './notification';
import { PUBSUB_NAMESPACE, type PushNotification } from './protocol';
import { handleIncomingPush, type PushServiceDeps } from './service';

export type PushComponentOptions = {
  /** XEP-0114 component domain, e.g. `push.galena.localhost`. */
  domain: string;
  /** Shared secret with ejabberd's component listener. */
  secret: string;
  /** Component listener port (ejabberd's `ejabberd_service`). */
  port: number;
  service: PushServiceDeps;
  logger: PushServiceDeps['logger'];
  createComponent?: PushComponentFactory;
};

export type PushComponentHandle = {
  stop: () => Promise<void>;
};

// Runs the server as an XEP-0114 component and routes incoming XEP-0357
// publish IQs to Web Push. Every valid publish is answered with `result`,
// even when the notification is dropped: ejabberd disables a push pair
// after an error IQ, so an error reply would silently kill the device.
// IQs for one node are handled one at a time (a per-node promise chain), so
// two near-simultaneous messages resolve in arrival order.
export function startPushComponent(options: PushComponentOptions): PushComponentHandle {
  const createComponent: PushComponentFactory =
    options.createComponent ?? ((init) => component(init));
  const xmpp = createComponent({
    service: `xmpp://127.0.0.1:${options.port}`,
    domain: options.domain,
    password: options.secret,
  });
  const { service, logger } = options;
  const chains = new Map<string, Promise<void>>();

  xmpp.on('error', (error: Error) => {
    // @xmpp/component reconnects on its own after an error; losing this
    // listener would crash the process on an unhandled 'error' event.
    logger.warn({ error: error.message }, 'push component error');
  });

  xmpp.on('stanza', (stanza: PushXmppElement) => {
    const notification = parsePushIq(stanza);
    if (notification === undefined) {
      handleNonPushStanza(xmpp, stanza, options.domain);
      return;
    }
    // One node belongs to one device of one user. The chain always advances,
    // even when a handler throws, so one bad IQ can never wedge later ones;
    // a finished chain is dropped so the map does not grow forever.
    const tail = chains.get(notification.node) ?? Promise.resolve();
    const head = tail.then(() => handleNotification(xmpp, service, logger, stanza, notification));
    const cleanup = head.then(
      () => undefined,
      () => undefined,
    );
    chains.set(notification.node, cleanup);
    void cleanup.then(() => {
      if (chains.get(notification.node) === cleanup) {
        chains.delete(notification.node);
      }
    });
  });

  void xmpp.start().catch((error: unknown) => {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'push component failed to start',
    );
  });

  return {
    stop: () => xmpp.stop().then(() => undefined),
  };
}

// Anything that is not a push publish: answer disco `get` with our identity
// (ejabberd probes the component on connect) and every other IQ `set` with
// a bare `result`, so ejabberd never treats us as dead.
function handleNonPushStanza(xmpp: PushComponent, stanza: PushXmppElement, domain: string): void {
  if (!stanza.is('iq')) {
    return;
  }
  const type = stanza.attrs['type'];
  const id = stanza.attrs['id'];
  const from = stanza.attrs['from'];
  if (id === undefined || from === undefined) {
    return;
  }
  if (
    type === 'get' &&
    stanza.getChild('query', 'http://jabber.org/protocol/disco#info') !== undefined
  ) {
    void xmpp.send(withEnvelope(discoInfoHandler(domain), id, from)).catch(() => undefined);
    return;
  }
  if (type === 'set') {
    void answerIq(xmpp, stanza, 'result');
  }
}

function withEnvelope(stanza: PushXmppElement, id: string, to: string): PushXmppElement {
  const attrs = { ...stanza.attrs, id, to };
  return xml('iq', attrs, ...stanza.getChildElements());
}

async function handleNotification(
  xmpp: PushComponent,
  service: PushServiceDeps,
  logger: PushServiceDeps['logger'],
  stanza: PushXmppElement,
  notification: PushNotification,
): Promise<void> {
  try {
    const outcome = await handleIncomingPush(service, notification);
    switch (outcome.kind) {
      case 'sent':
        logger.info({ userId: outcome.userId, deviceId: outcome.deviceId }, 'push sent');
        break;
      case 'dropped':
        logger.info(
          { userId: outcome.userId, deviceId: outcome.deviceId, reason: outcome.reason },
          'push dropped',
        );
        break;
      case 'unknown-device':
        // The node is a delivery target, not a secret, and logging it is how
        // an operator matches a stray publish to a removed device.
        logger.info({ node: outcome.node }, 'push publish for an unknown node; dropped');
        break;
    }
  } catch (error) {
    // `handleIncomingPush` is not supposed to throw, but an error IQ would
    // disable the push pair in ejabberd — log and carry on instead.
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'push handler failed',
    );
  }
  await answerIq(xmpp, stanza, 'result');
}

async function answerIq(xmpp: PushComponent, stanza: PushXmppElement, type: string): Promise<void> {
  const id = stanza.attrs['id'];
  const from = stanza.attrs['from'];
  if (id === undefined || from === undefined) {
    return;
  }
  try {
    await xmpp.send(xml('iq', { type, id, to: from }));
  } catch {
    // Best effort: the component reconnect path already logs.
  }
}

export function discoInfoHandler(pushJid: string): PushXmppElement {
  return xml(
    'iq',
    { type: 'result', from: pushJid },
    xml(
      'query',
      { xmlns: 'http://jabber.org/protocol/disco#info' },
      xml('identity', { category: 'pubsub', type: 'push' }),
      xml('feature', { var: 'urn:xmpp:push:0' }),
      xml('feature', { var: PUBSUB_NAMESPACE }),
    ),
  );
}
