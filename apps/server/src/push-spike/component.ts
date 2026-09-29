import {
  component,
  xml,
  type SpikeComponent,
  type SpikeComponentFactory,
  type XmppElement,
} from '@xmpp/component';
import { buildPushPayload, type PushFilterInput } from './payload';
import { parsePushIq } from './notification';
import { PUBSUB_NAMESPACE } from './protocol';
import type { PushSpikeConfig } from './spike-config';
import type { SubscriptionStore } from './subscriptions';

export type PushSender = {
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<{ gone: boolean }>;
};

export type PushSpikeComponentOptions = {
  config: PushSpikeConfig;
  store: SubscriptionStore;
  sender: PushSender;
  logger: {
    info: (fields: Record<string, unknown>, message: string) => void;
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
  now?: () => number;
  createComponent?: SpikeComponentFactory;
};

export type PushSpikeHandle = {
  stop: () => Promise<void>;
};

// Connects to ejabberd as an XEP-0114 component and routes incoming
// XEP-0357 publish IQs to Web Push..answers every valid publish with
// result; a 404/410 from the push endpoint removes the stored subscription
// (see WebPush sender below).
export function startPushSpikeComponent(options: PushSpikeComponentOptions): PushSpikeHandle {
  const { config, store, sender, logger } = options;
  const createComponent: SpikeComponentFactory =
    options.createComponent ?? ((init) => component(init));
  if (config.PUSH_COMPONENT_JID === undefined || config.PUSH_COMPONENT_SECRET === undefined) {
    throw new Error('push spike component needs PUSH_COMPONENT_JID and PUSH_COMPONENT_SECRET');
  }
  const service = `xmpp://127.0.0.1:${config.PUSH_COMPONENT_PORT}`;
  const xmpp = createComponent({
    service,
    domain: config.PUSH_COMPONENT_JID,
    password: config.PUSH_COMPONENT_SECRET,
  });

  xmpp.on('error', (error: Error) => {
    // @xmpp/component reconnects on its own after an error; losing this
    // listener would crash the process on an unhandled 'error' event.
    logger.warn({ error: error.message }, 'push spike component error');
  });

  xmpp.on('stanza', (stanza: XmppElement) => {
    void handleStanza(xmpp, stanza, store, sender, logger);
  });

  void xmpp.start().catch((error: unknown) => {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'push spike component failed to start',
    );
  });

  return {
    stop: () => xmpp.stop().then(() => undefined),
  };
}

async function handleStanza(
  xmpp: SpikeComponent,
  stanza: XmppElement,
  store: SubscriptionStore,
  sender: PushSender,
  logger: PushSpikeComponentOptions['logger'],
): Promise<void> {
  const notification = parsePushIq(stanza);
  if (notification === undefined) {
    // Includes disco and any other IQ addressed to the component: answer
    // result so ejabberd does not treat us as dead.
    if (stanza.is('iq') && stanza.attrs['type'] === 'set') {
      await answerIq(xmpp, stanza, 'result');
    }
    return;
  }

  const stored = store.byNode(notification.node);
  const filter: PushFilterInput = {
    // Spike store has no chat_prefs / topic membership rows yet (T-0113 and
    // T-0108 are still planned): filtering is proven by the pure function
    // unit tests, and production joins the real tables here.
    muted: false,
    visible: true,
    chatId: stored === undefined ? undefined : `spike:${notification.node}`,
  };
  const payload = buildPushPayload(notification, filter);
  if (stored === undefined || payload === undefined) {
    await answerIq(xmpp, stanza, 'result');
    return;
  }

  try {
    const result = await sender.send(stored.subscription, JSON.stringify(payload));
    if (result.gone) {
      store.remove(notification.node);
      logger.info({ node: notification.node }, 'push subscription expired; removed');
    }
  } catch (error) {
    logger.warn(
      { node: notification.node, error: error instanceof Error ? error.message : String(error) },
      'push spike send failed',
    );
  }
  await answerIq(xmpp, stanza, 'result');
}

async function answerIq(xmpp: SpikeComponent, stanza: XmppElement, type: string): Promise<void> {
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

export function discoInfoHandler(jid: string): XmppElement {
  return xml(
    'iq',
    { type: 'result', from: jid },
    xml(
      'query',
      { xmlns: 'http://jabber.org/protocol/disco#info' },
      xml('identity', { category: 'pubsub', type: 'push' }),
      xml('feature', { var: 'urn:xmpp:push:0' }),
      xml('feature', { var: PUBSUB_NAMESPACE }),
    ),
  );
}
