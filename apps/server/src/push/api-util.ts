// Push API helpers shared by `./api-handlers` and `./api-subscribe`, split out
// of `./api` by T-1017 (size split). Moved unchanged: the strict decode options
// and the `requirePush` gate built once per api instance. The unique-violation
// walk and the error-class namer now live in `../effect/error-utils` (T-1043).

import { HttpError } from '../errors';
import { pushConfigError, type PushConfig } from './config';

// The three bodies' schemas live in the contract (`RegisterPushDevicePayload`,
// `PushSettingsPayload`, `PushTestPayload`) so the derived client encodes them;
// the handlers decode them by hand. Settings and test are strict.
export const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// Builds the per-instance `requirePush` gate: it answers 404 while push is
// disabled and 503 while it is enabled but not configured.
export function createRequirePush(deps: { push: PushConfig }): () => { storageKey: string } {
  function requirePush(): { storageKey: string } {
    if (!deps.push.PUSH_ENABLED) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    const error = pushConfigError(deps.push);
    if (error !== null) {
      throw new HttpError(503, 'push_unavailable', 'Push notifications are not configured');
    }
    return { storageKey: deps.push.PUSH_STORAGE_KEY as string };
  }
  return requirePush;
}
