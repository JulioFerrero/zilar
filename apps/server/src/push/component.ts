import { Effect, Fiber } from 'effect';
import { component, xml, type PushComponentFactory, type PushXmppElement } from '@xmpp/component';
import {
  PUBSUB_NAMESPACE,
  PUSH_NAMESPACE,
  type PushNotification,
  DATA_FORMS_NAMESPACE,
  PUSH_SUMMARY_FORM_TYPE,
} from './protocol';
import { handleIncomingPush, type PushServiceDeps } from './service';
import { markPushOffline, markPushOnline } from '../health-status';

// Parses the IQ mod_push routes to the component; shape from XEP-0357
// example 12/13 and mod_push.erl `notify/7`.
function parsePushIq(stanza: PushXmppElement): PushNotification | undefined {
  if (!stanza.is('iq') || stanza.attrs['type'] !== 'set') {
    return undefined;
  }
  const pubsub = stanza.getChild('pubsub', PUBSUB_NAMESPACE);
  if (pubsub === undefined) {
    return undefined;
  }
  const publish = pubsub.getChild('publish');
  if (publish === undefined) {
    return undefined;
  }
  const node = publish.attrs['node'];
  if (node === undefined || node === '') {
    return undefined;
  }
  const notification = publish.getChild('item')?.getChild('notification', PUSH_NAMESPACE);
  if (notification === undefined) {
    return undefined;
  }
  const from = stanza.attrs['from'];
  if (from === undefined || from === '') {
    return undefined;
  }

  const fields = readSummaryFields(notification);
  if (fields === undefined) {
    return undefined;
  }

  // `<publish-options>` (the enable-time secret echo) is deliberately not
  // parsed: the publish arrives over our own authenticated component
  // connection, so the sender is trusted, and logging it would put a
  // credential-adjacent value in the log path.
  const result: PushNotification = {
    node,
    from,
    ...fields,
  };
  return result;
}

function readSummaryFields(
  notification: PushXmppElement,
): Pick<PushNotification, 'messageCount' | 'lastMessageSender' | 'lastMessageBody'> | undefined {
  const forms = notification.getChildren('x', DATA_FORMS_NAMESPACE);
  if (forms.length === 0) {
    return {};
  }
  const summary = forms.find((form) => formTypeOf(form) === PUSH_SUMMARY_FORM_TYPE);
  if (summary === undefined) {
    return undefined;
  }
  const result: Pick<PushNotification, 'messageCount' | 'lastMessageSender' | 'lastMessageBody'> =
    {};
  const count = readField(summary, 'message-count');
  if (count !== undefined) {
    result.messageCount = count;
  }
  const sender = readField(summary, 'last-message-sender');
  if (sender !== undefined) {
    result.lastMessageSender = sender;
  }
  const body = readField(summary, 'last-message-body');
  if (body !== undefined) {
    result.lastMessageBody = body;
  }
  return result;
}

function formTypeOf(form: PushXmppElement): string | undefined {
  for (const field of form.getChildren('field')) {
    if (field.attrs['var'] === 'FORM_TYPE') {
      return field.getChildText('value') ?? undefined;
    }
  }
  return undefined;
}

function readField(form: PushXmppElement, name: string): string | undefined {
  for (const field of form.getChildren('field')) {
    if (field.attrs['var'] === name) {
      return field.getChildText('value') ?? undefined;
    }
  }
  return undefined;
}
const DISCO_INFO_NAMESPACE = 'http://jabber.org/protocol/disco#info';

// How many publishes may wait or run for one node; over the cap a publish is
// dropped, so a slow device cannot grow memory.
const MAX_PENDING_PER_NODE = 50;

export type PushComponentOptions = {
  /** XEP-0114 component domain, e.g. `push.zilar.localhost`. */
  domain: string;
  /** Shared secret with ejabberd's component listener. */
  secret: string;
  /** Component listener port (ejabberd's `ejabberd_service`). */
  port: number;
  /** Host of ejabberd's component listener: `ejabberd` in compose, `127.0.0.1` in dev. */
  host: string;
  service: PushServiceDeps;
  logger: PushServiceDeps['logger'];
  createComponent?: PushComponentFactory;
};

export type PushComponentHandle = {
  stop: () => Promise<void>;
};

// Runs the server as an XEP-0114 component and routes XEP-0357 publish IQs
// to Web Push. The reply is the callee's: a publish route returns truthy so
// exactly one `result` is sent, even when the notification is dropped. IQs
// for one node are handled one at a time so they resolve in arrival order.
export function startPushComponent(options: PushComponentOptions): PushComponentHandle {
  const createComponent: PushComponentFactory =
    options.createComponent ?? ((init) => component(init));
  const xmpp = createComponent({
    service: `xmpp://${options.host}:${options.port}`,
    domain: options.domain,
    password: options.secret,
  });
  const { service, logger } = options;
  // The publish IQ must come from ejabberd's own XMPP domain; a user JID or
  // any other server is dropped.
  const serverDomain = service.config.xmpp.domain;
  const chains = new Map<string, Fiber.Fiber<void>>();
  const pending = new Map<string, number>();
  const saturated = new Set<string>();

  const statusEmitter = xmpp as unknown as {
    on(event: 'status', listener: (status: string) => void): unknown;
  };
  statusEmitter.on('status', (status) => {
    if (status === 'online') {
      markPushOnline();
      return;
    }
    if (status === 'disconnect' || status === 'offline' || status === 'disconnecting') {
      markPushOffline(status);
    }
  });

  xmpp.on('error', (error: Error) => {
    logger.warn({ error: error.message }, 'push component error');
  });

  // ejabberd's mod_push sends a `set` IQ with one `<pubsub>` child; the route
  // hands the reply to the callee, which sends one `result`, and delivery is
  // forked so the answer is not held back. A publish whose `from` is not
  // exactly the server's domain is dropped: a user must not be able to make
  // the component push to a device.
  xmpp.iqCallee.set(PUBSUB_NAMESPACE, 'pubsub', (ctx) => {
    const notification = parsePushIq(ctx.stanza);
    if (notification !== undefined && notification.from === serverDomain) {
      scheduleNotification(notification);
    }
    return true;
  });

  function scheduleNotification(notification: PushNotification): void {
    const { node } = notification;
    const queued = pending.get(node) ?? 0;
    if (queued >= MAX_PENDING_PER_NODE) {
      if (!saturated.has(node)) {
        saturated.add(node);
        logger.warn({ node }, 'push node queue is full; dropping new publishes');
      }
      return;
    }
    pending.set(node, queued + 1);
    const job = Effect.runFork(
      afterPrevious(chains.get(node), handleNotification(service, logger, notification)),
    );
    chains.set(node, job);
    job.addObserver(() => {
      if (chains.get(node) === job) {
        chains.delete(node);
      }
      const left = (pending.get(node) ?? 1) - 1;
      if (left <= 0) {
        pending.delete(node);
        saturated.delete(node);
      } else {
        pending.set(node, left);
      }
    });
  }

  xmpp.iqCallee.get(DISCO_INFO_NAMESPACE, 'query', () => discoInfoQuery());

  Effect.runFork(
    Effect.promise(() => xmpp.start()).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => {
          markPushOffline('start-failed');
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'push component failed to start',
          );
        }),
      ),
    ),
  );

  return {
    stop: () => Effect.runPromise(Effect.promise(() => xmpp.stop()).pipe(Effect.asVoid)),
  };
}

function afterPrevious(
  previous: Fiber.Fiber<void> | undefined,
  job: Effect.Effect<void>,
): Effect.Effect<void> {
  const settled = previous === undefined ? Effect.void : Effect.exit(Fiber.join(previous));
  return settled.pipe(
    Effect.andThen(job),
    Effect.catchCause(() => Effect.void),
  );
}

function handleNotification(
  service: PushServiceDeps,
  logger: PushServiceDeps['logger'],
  notification: PushNotification,
): Effect.Effect<void> {
  return Effect.promise(() => handleIncomingPush(service, notification)).pipe(
    Effect.andThen((outcome) =>
      Effect.sync(() => {
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
            logger.info({ node: outcome.node }, 'push publish for an unknown node; dropped');
            break;
        }
      }),
    ),
    Effect.catchDefect((error) =>
      Effect.sync(() =>
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'push handler failed',
        ),
      ),
    ),
  );
}

function discoInfoQuery(): PushXmppElement {
  return xml(
    'query',
    { xmlns: DISCO_INFO_NAMESPACE },
    xml('identity', { category: 'pubsub', type: 'push' }),
    xml('feature', { var: PUSH_NAMESPACE }),
    xml('feature', { var: PUBSUB_NAMESPACE }),
  );
}
