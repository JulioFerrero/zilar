// The push module on the Effect `HttpApi` adapter. The bodies are decoded
// manually with Effect Schema and served with `handleRaw`, so each route
// keeps its order: `requirePush()` before the decode, the decode before the
// route's limiter, and the DELETE limiter inside its handler. The subscribe
// body reuses the schemas in `./subscriptions`.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { PushGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { mountApi, schemaErrorLayer, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { ArchivePool } from '../search/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { PushConfig } from './config';
import { createPushGroupLayer } from './api-handlers';
import type { WebPushDelivery } from './sender';
import type { FcmSender } from './fcm';

export const PUSH_SUBSCRIBE_RATE_LIMIT_MAX = 30;
export const PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_SETTINGS_RATE_LIMIT_MAX = 60;
export const PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PUSH_TEST_RATE_LIMIT_MAX = 5;
export const PUSH_TEST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const PUSH_PREVIEW_RATE_LIMIT_MAX = 120;
export const PUSH_PREVIEW_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface PushRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Push env (kept separate from the server config so push stays optional). */
  push: PushConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  archive?: ArchivePool;
  /** Injected in tests so the rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests so no real push relay is ever called. */
  sender?: WebPushDelivery;
  /** Injected in tests so the test route sends no real FCM wake. When absent,
   * the group layer builds one once with `createNativeSender`. */
  nativeSender?: FcmSender;
}

export interface PushApiDependencies extends PushRoutesDependencies {
  subscribeLimiter?: RateLimiter;
  settingsLimiter?: RateLimiter;
  testLimiter?: RateLimiter;
  previewLimiter?: RateLimiter;
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
  const previewLimiter =
    deps.previewLimiter ??
    createRateLimiter({
      max: PUSH_PREVIEW_RATE_LIMIT_MAX,
      windowMs: PUSH_PREVIEW_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = createPushGroupLayer(PushApi, deps, {
    subscribe: subscribeLimiter,
    settings: settingsLimiter,
    test: testLimiter,
    preview: previewLimiter,
  });

  const apiLayer = HttpApiBuilder.layer(PushApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(PushApi, apiLayer);
}
