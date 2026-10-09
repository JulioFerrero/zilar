import { Effect, Fiber } from 'effect';
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
    service: `xmpp://${options.host}:${options.port}`,
    domain: options.domain,
    password: options.secret,
  });
  const { service, logger } = options;
  // The latest job per node, as a fiber. The next job for that node joins it.
  const chains = new Map<string, Fiber.Fiber<void>>();

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
    const job = Effect.runFork(
      afterPrevious(
        chains.get(notification.node),
        handleNotification(xmpp, service, logger, stanza, notification),
      ),
    );
    chains.set(notification.node, job);
    job.addObserver(() => {
      if (chains.get(notification.node) === job) {
        chains.delete(notification.node);
      }
    });
  });

  Effect.runFork(
    Effect.promise(() => xmpp.start()).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() =>
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'push component failed to start',
          ),
        ),
      ),
    ),
  );

  return {
    stop: () => Effect.runPromise(Effect.promise(() => xmpp.stop()).pipe(Effect.asVoid)),
  };
}

// Runs `job` once the previous job for the same node has finished. The
// previous job's outcome is ignored, so a failed one never skips this one.
function afterPrevious(
  previous: Fiber.Fiber<void> | undefined,
  job: Effect.Effect<void>,
): Effect.Effect<void> {
  const settled = previous === undefined ? Effect.void : Effect.exit(Fiber.join(previous));
  return settled.pipe(
    Effect.andThen(job),
    // As before, a job that still fails is dropped quietly so the next one runs.
    Effect.catchCause(() => Effect.void),
  );
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
    sendQuietly(xmpp, withEnvelope(discoInfoHandler(domain), id, from));
    return;
  }
  if (type === 'set') {
    Effect.runFork(answerIq(xmpp, stanza, 'result'));
  }
}

// Fire and forget: a failed send is dropped, never retried.
function sendQuietly(xmpp: PushComponent, stanza: PushXmppElement): void {
  Effect.runFork(
    Effect.promise(() => xmpp.send(stanza)).pipe(Effect.catchDefect(() => Effect.void)),
  );
}

function withEnvelope(stanza: PushXmppElement, id: string, to: string): PushXmppElement {
  const attrs = { ...stanza.attrs, id, to };
  return xml('iq', attrs, ...stanza.getChildElements());
}

function handleNotification(
  xmpp: PushComponent,
  service: PushServiceDeps,
  logger: PushServiceDeps['logger'],
  stanza: PushXmppElement,
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
            // The node is a delivery target, not a secret, and logging it is how
            // an operator matches a stray publish to a removed device.
            logger.info({ node: outcome.node }, 'push publish for an unknown node; dropped');
            break;
        }
      }),
    ),
    // `handleIncomingPush` is not supposed to throw, but an error IQ would
    // disable the push pair in ejabberd — log and carry on instead.
    Effect.catchDefect((error) =>
      Effect.sync(() =>
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'push handler failed',
        ),
      ),
    ),
    Effect.andThen(answerIq(xmpp, stanza, 'result')),
  );
}

function answerIq(xmpp: PushComponent, stanza: PushXmppElement, type: string): Effect.Effect<void> {
  const id = stanza.attrs['id'];
  const from = stanza.attrs['from'];
  if (id === undefined || from === undefined) {
    return Effect.void;
  }
  // Best effort: the component reconnect path already logs.
  return Effect.promise(() => xmpp.send(xml('iq', { type, id, to: from }))).pipe(
    Effect.catchDefect(() => Effect.void),
  );
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
