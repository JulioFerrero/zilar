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

// Read by the authz sweep and the scheduler test through `app.routes`.
export type { EdgeHealth, ZilarEdge };

export type { AppDependencies };

// Test seam: the invite-links tests inject a clock and client IP; production never sets it.
let testInviteLinksOverrides: TestInviteLinksOverrides | undefined;

export function setTestAppInviteLinks(overrides: TestInviteLinksOverrides | undefined): void {
  testInviteLinksOverrides = overrides;
}

const mountsByApp = new WeakMap<ZilarEdge, ReadonlyArray<EffectApiMount>>();

export function effectMountsOf(app: ZilarEdge): ReadonlyArray<EffectApiMount> {
  return mountsByApp.get(app) ?? [];
}

export function createApp(deps: AppDependencies): ZilarEdge {
  const { db, config, logger, auth } = deps;
  // Bind the `effect/sql` runtime once per database handle before building routes.
  registerSqlRuntime(db, config.DATABASE_URL);
  const audit = deps.audit ?? createAuditRecorder({ db, logger });
  // Default gateway: an empty registry, so every action is denied until an adapter registers.
  const gateway =
    deps.actionGateway ??
    createActionGateway({
      db,
      adapters: {},
      audit,
      logger,
    });
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
