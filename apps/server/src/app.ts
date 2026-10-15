// The one place that wires every route to the edge. The mounting itself lives
// in the area modules under `app/` (T-1460, plan #48): `messagingRoutes`,
// `mediaRoutes` and `aiRoutes` return their mounts in today's order, and
// `healthRoutes` returns the `/health` probe. Behaviour is unchanged.
import { createActionGateway } from './actions/gateway';
import { type AppDependencies, type BaseDeps, type RouteWiring } from './app/deps';
import { aiRoutes } from './app/routes-ai';
import { healthRoutes } from './app/routes-health';
import { mediaRoutes } from './app/routes-media';
import { messagingRoutes } from './app/routes-messaging';
import { createAuditRecorder } from './audit/service';
import { CurrentMailer, createMailer } from './auth/mailer';
import { createEdge, type EdgeHealth, type ZilarEdge } from './effect/edge';
import type { EffectApiMount } from './effect/http-core';
import { registerSqlRuntime } from './effect/sql';
import type { TestInviteLinksOverrides } from './invite-links/api';

// Re-exported for the authz sweep and the scheduler test, which read the
// edge's route manifest through `app.routes`.
export type { EdgeHealth, ZilarEdge };

// `AppDependencies` moved to `app/deps.ts` so the area modules can share it;
// it stays part of this module's surface.
export type { AppDependencies };

// Test seam for the join rate windows (T-0115): the invite-links tests set
// an injected clock and client IP through `setTestAppInviteLinks` so the
// windows can advance without waiting. Production never sets it.
let testInviteLinksOverrides: TestInviteLinksOverrides | undefined;

export function setTestAppInviteLinks(overrides: TestInviteLinksOverrides | undefined): void {
  testInviteLinksOverrides = overrides;
}

const mountsByApp = new WeakMap<ZilarEdge, ReadonlyArray<EffectApiMount>>();

/** The Effect module mounts of an app built by `createApp`, in mount order. */
export function effectMountsOf(app: ZilarEdge): ReadonlyArray<EffectApiMount> {
  return mountsByApp.get(app) ?? [];
}

export function createApp(deps: AppDependencies): ZilarEdge {
  const { db, config, logger, auth } = deps;
  // Bind the `effect/sql` runtime for this database once, before any module
  // that runs queries through it is built. The registry memoizes per handle,
  // so building routes (pins, blocks) no longer has to register it.
  registerSqlRuntime(db, config.DATABASE_URL);
  const audit = deps.audit ?? createAuditRecorder({ db, logger });
  // Default gateway: empty registry. Every action is denied
  // `unknown_action` until a later task registers an adapter, and there is
  // no HTTP route to request an action yet.
  const gateway =
    deps.actionGateway ??
    createActionGateway({
      db,
      adapters: {},
      audit,
      logger,
    });
  // Without an explicit mailer the setup and integrations routes build one
  // from the config, like `index.ts` does for production.
  const mailer = deps.mailer ?? new CurrentMailer(createMailer(config, logger));

  const base: BaseDeps = { db, config, logger, auth };
  const wiring: RouteWiring = {
    deps,
    base,
    audit,
    mailer,
    gateway,
    inviteLinksOverrides: testInviteLinksOverrides,
  };

  const mounts: EffectApiMount[] = [
    ...messagingRoutes(wiring),
    ...mediaRoutes(wiring),
    ...aiRoutes(wiring),
  ];
  const health = healthRoutes(wiring);

  const edge = createEdge({ mounts, auth, config, logger, health });
  mountsByApp.set(edge, mounts);
  return edge;
}
