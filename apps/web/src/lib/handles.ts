import {
  ApiError,
  checkHandle as apiCheckHandle,
  claimHandle as apiClaimHandle,
  type HandleCheck,
} from '@/lib/api';

export { ApiError };

// Handle rules shared with the server (T-0163). The shapes, the reserved
// words and the suggestion builder mirror `apps/server/src/handles/rules.ts`
// exactly: the server is the authority (every value is re-checked there),
// this only shapes the client text. The reserved words below must stay
// identical to the server's `RESERVED_HANDLES` —
// `apps/server/src/handles/rules.test.ts` asserts the full list, and the
// mock suite below asserts the mock maps each of them to `reserved`.
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;

// Words nobody may take, whatever the casing. Must match the server list.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'root',
  'system',
  'zilar',
  'ejabberd',
  'api',
  'settings',
  'me',
  'everyone',
  'all',
  'here',
  'channel',
  'bot',
  'owner',
  'moderator',
]);

export type HandleAvailabilityReason = 'invalid' | 'reserved' | 'taken';

export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export function isValidHandleShape(handle: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(handle.trim());
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(normalizeHandle(handle));
}

// Reserved first (like the server): `me` is shorter than the minimum, but
// the useful answer is that the word itself cannot be taken.
export function classifyHandle(handle: string): HandleAvailabilityReason | null {
  if (isReservedHandle(handle)) {
    return 'reserved';
  }
  if (!isValidHandleShape(handle)) {
    return 'invalid';
  }
  return null;
}

/** Builds a suggestion from a display name or an email local part. */
export function suggestHandleFor(name: string, email?: string): string {
  const candidates = [name, email === undefined ? '' : (email.split('@')[0] ?? '')];
  for (const candidate of candidates) {
    const suggestion = shapeSuggestion(candidate);
    if (suggestion !== null) {
      return suggestion;
    }
  }
  return 'user';
}

function shapeSuggestion(raw: string): string | null {
  let shaped = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+/, '');
  shaped = shaped.replace(/_+$/, '');
  if (shaped === '') {
    return null;
  }
  if (!/^[a-z]/.test(shaped)) {
    shaped = `u_${shaped}`;
  }
  shaped = shaped.slice(0, HANDLE_MAX_LENGTH).replace(/_+$/, '');
  if (shaped.length < HANDLE_MIN_LENGTH) {
    shaped = shaped.padEnd(HANDLE_MIN_LENGTH, '0').slice(0, HANDLE_MAX_LENGTH);
  }
  if (classifyHandle(shaped) !== null) {
    return null;
  }
  return shaped;
}

export async function checkHandle(handle: string): Promise<HandleCheck> {
  return apiCheckHandle(handle);
}

export async function claimHandle(handle: string): Promise<{ handle: string }> {
  return apiClaimHandle(handle);
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'rate_limited';
}
