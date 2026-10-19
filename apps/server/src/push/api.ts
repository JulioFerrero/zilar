// The push module on the Effect `HttpApi` adapter. The bodies are decoded
// manually with Effect Schema and served with `handleRaw`, so each route
// keeps its order: `requirePush()` before the decode, the decode before the
// route's limiter, and the DELETE limiter inside its handler. The subscribe
// body reuses the schemas in `./subscriptions`.

import type { ServerCore } from '../app/deps';

import { HttpApi } from 'effect/http-api';
import { PushGroup } from '@zilar/api-contract';

import { mountGroups, type EffectApiMount } from '../effect/http-core';
import { limiter, type RateLimiter } from '../rate-limit';
import type { ArchivePool } from '../search/service';
import type { PushConfig } from './config';
import { createPushGroupLayer } from './api-handlers';
import type { WebPushDelivery } from './sender';
import type { FcmSender } from './fcm';

export interface PushRoutesDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'adminClient' | 'logger'
> {
  /** Push env (kept separate from the server config so push stays optional). */
  push: PushConfig;
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
  const subscribeLimiter = deps.subscribeLimiter ?? limiter('pushSubscribe', now);
  const settingsLimiter = deps.settingsLimiter ?? limiter('pushSettings', now);
  const testLimiter = deps.testLimiter ?? limiter('pushTest', now);
  const previewLimiter = deps.previewLimiter ?? limiter('pushPreview', now);

  const groupLayer = createPushGroupLayer(PushApi, deps, {
    subscribe: subscribeLimiter,
    settings: settingsLimiter,
    test: testLimiter,
    preview: previewLimiter,
  });

  return mountGroups(PushApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: true,
  });
}
