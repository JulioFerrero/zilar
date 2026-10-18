import { HttpError } from '../errors';
import { pushConfigError, type PushConfig } from './config';

// The three bodies' schemas live in the contract so the derived client
// encodes them; settings and test are strict.
export const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// The test wake's chat id, shared with the mobile handler: the data-only
// wake draws the fixed "Push notifications work on this device." text.
export const TEST_WAKE_CHAT_ID = 'zilar:test';

// Builds the per-instance `requirePush` gate: 404 while push is disabled,
// 503 while enabled but not configured.
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
