import { Effect, Fiber } from 'effect';
import { component, xml, type PushComponentFactory, type PushXmppElement } from '@xmpp/component';
import { parsePushIq } from './notification';
import { PUBSUB_NAMESPACE, PUSH_NAMESPACE, type PushNotification } from './protocol';
import { handleIncomingPush, type PushServiceDeps } from './service';
import { markPushOffline, markPushOnline } from '../health-status';

const DISCO_INFO_NAMESPACE = 'http://jabber.org/protocol/disco#info';

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
// publish IQs to Web Push. The reply is the IQ callee's, not ours: a publish
// route returns truthy, so `@xmpp/component` answers exactly one `result`.
// The old shape listened on `stanza` and answered by hand, which produced the
// callee's `service-unavailable` error first and our `result` second;
// ejabberd disables a push pair after an error IQ, so the device went silent.
// Every valid publish is answered `result`, even when the notification is
// dropped. IQs for one node are handled one at a time (a per-node promise
// chain), so two near-simultaneous messages resolve in arrival order.
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

  // `@xmpp/component`'s `error` event is not fatal — the connection can stay
  // up — so track liveness from the `status` event instead. `status` also
  // carries `online`/`offline`, so separate listeners for those are not needed.
  // The package ships no types (see `push/xmpp-component.d.ts`); that stub only
  // lists the events this module used before, so narrow `status` here rather
  // than widen a file outside this task's scope.
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
    // @xmpp/component reconnects on its own after an error; losing this
    // listener would crash the process on an unhandled 'error' event.
    logger.warn({ error: error.message }, 'push component error');
  });

  // ejabberd's mod_push sends each notification as a `set` IQ with one
  // `<pubsub>` child. Registering the route hands the reply to the callee,
  // which sends one `result`; delivery is forked onto the per-node chain so
  // the answer is not held back by the send.
  xmpp.iqCallee.set(PUBSUB_NAMESPACE, 'pubsub', (ctx) => {
    const notification = parsePushIq(ctx.stanza);
    if (notification !== undefined) {
      // One node belongs to one device of one user. The chain always advances,
      // even when a handler throws, so one bad IQ can never wedge later ones;
      // a finished chain is dropped so the map does not grow forever.
      const job = Effect.runFork(
        afterPrevious(
          chains.get(notification.node),
          handleNotification(service, logger, notification),
        ),
      );
      chains.set(notification.node, job);
      job.addObserver(() => {
        if (chains.get(notification.node) === job) {
          chains.delete(notification.node);
        }
      });
    }
    // A malformed publish is answered `result` too (as the old code did) and
    // never delivered; an error IQ would disable the push pair.
    return true;
  });

  // ejabberd probes the component on connect. The callee wraps the returned
  // query content in the `result` envelope for us.
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
            // The node is a delivery target, not a secret, and logging it is how
            // an operator matches a stray publish to a removed device.
            logger.info({ node: outcome.node }, 'push publish for an unknown node; dropped');
            break;
        }
      }),
    ),
    // `handleIncomingPush` is not supposed to throw; the callee still answers
    // `result` on its own, so a failure here is logged and carries on.
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

// The disco#info content ejabberd reads when it probes the component. The
// callee appends this query to the `result` it builds.
function discoInfoQuery(): PushXmppElement {
  return xml(
    'query',
    { xmlns: DISCO_INFO_NAMESPACE },
    xml('identity', { category: 'pubsub', type: 'push' }),
    xml('feature', { var: PUSH_NAMESPACE }),
    xml('feature', { var: PUBSUB_NAMESPACE }),
  );
}
