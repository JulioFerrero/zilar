// Push module on the Effect `HttpApi` adapter (T-0543): the same methods,
// paths, statuses, bodies, texts and per-route step order as the retired
// router, mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its store runs on effect/sql.
//
// The three bodies are decoded manually inside their handlers (Effect Schema,
// same rules as the old zod schemas) and served with `handleRaw`, so each
// route keeps its exact order: `requirePush()` runs before the decode, and
// the decode runs before that route's limiter check — exactly like the old
// `requireSession` -> `requirePush` -> decode -> limiter sequence. The DELETE
// limiter is also checked inside its handler (after `requirePush`), for the
// same reason. No decode text changes: every failure answers byte-identical
// codes and messages.
//
// The subscribe body reuses the Effect schemas in `./subscriptions`, so the
// route and the stored subscription share one set of rules.
//
// T-1017 size split: the handlers live in `./api-handlers`, the subscribe
// handler in `./api-subscribe`, and the shared helpers in `./api-util`. This
// path keeps the dependencies, the group, the layer and the mount.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { PushGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { mountApi, schemaErrorLayer, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { PushConfig } from './config';
import { createPushGroupLayer } from './api-handlers';
import type { WebPushDelivery } from './sender';

export const PUSH_SUBSCRIBE_RATE_LIMIT_MAX = 30;
export const PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_SETTINGS_RATE_LIMIT_MAX = 60;
export const PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_TEST_RATE_LIMIT_MAX = 5;
export const PUSH_TEST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface PushRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Push env (kept separate from the server config so push stays optional). */
  push: PushConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  /** Injected in tests so the rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests so no real push relay is ever called. */
  sender?: WebPushDelivery;
}

export interface PushApiDependencies extends PushRoutesDependencies {
  subscribeLimiter?: RateLimiter;
  settingsLimiter?: RateLimiter;
  testLimiter?: RateLimiter;
}

const PushApi = HttpApi.make('push').add(PushGroup);

export function createPushApi(deps: PushApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const subscribeLimiter =
    deps.subscribeLimiter ??
    createRateLimiter({
      max: PUSH_SUBSCRIBE_RATE_LIMIT_MAX,
      windowMs: PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const settingsLimiter =
    deps.settingsLimiter ??
    createRateLimiter({
      max: PUSH_SETTINGS_RATE_LIMIT_MAX,
      windowMs: PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const testLimiter =
    deps.testLimiter ??
    createRateLimiter({
      max: PUSH_TEST_RATE_LIMIT_MAX,
      windowMs: PUSH_TEST_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = createPushGroupLayer(PushApi, deps, {
    subscribe: subscribeLimiter,
    settings: settingsLimiter,
    test: testLimiter,
  });

  const apiLayer = HttpApiBuilder.layer(PushApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(PushApi, apiLayer);
}
