// Push API helpers shared by `./api-handlers` and `./api-subscribe`, split out
// of `./api` by T-1017 (size split). Moved unchanged: the strict decode
// options, the unique-violation walk and the error-class namer, plus the
// `requirePush` gate built once per api instance.

import { HttpError } from '../errors';
import { pushConfigError, type PushConfig } from './config';

// The three bodies' schemas live in the contract (`RegisterPushDevicePayload`,
// `PushSettingsPayload`, `PushTestPayload`) so the derived client encodes them;
// the handlers decode them by hand. Settings and test are strict.
export const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// Driver failures can be wrapped, so the unique code (23505 on Postgres and
// PGlite) lives on a nested `cause`. Walk the chain.
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return true;
    }
    if (
      typeof record.message === 'string' &&
      (/duplicate key/i.test(record.message) || /UNIQUE constraint/i.test(record.message))
    ) {
      return true;
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}

// Logs the error class only, never the message: a sync failure surfaces
// driver text that could echo query parameters.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

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
