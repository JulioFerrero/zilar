// 3 to 32 characters, `a-z`, `0-9` and `_`, starting with a letter; stored with the typed casing but compared case-insensitively.

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;

const HANDLE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;

// Words nobody may take, whatever the casing.
export const RESERVED_HANDLES = new Set([
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

// Typed casing is stored, `handle_lower` is compared; trimmed first so `  Ada ` and `ada` are one handle.
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export function isValidHandleShape(handle: string): boolean {
  return HANDLE_PATTERN.test(handle.trim());
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(normalizeHandle(handle));
}

// A reserved word is `reserved` whatever its shape (`me` is shorter than the minimum); an unusable shape is `invalid`; anything else is valid.
export function classifyHandle(handle: string): HandleAvailabilityReason | null {
  if (isReservedHandle(handle)) {
    return 'reserved';
  }
  if (!isValidHandleShape(handle)) {
    return 'invalid';
  }
  return null;
}

export function suggestHandle(name: string, email?: string): string {
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
    .replace(/^_+/, '')
    .replace(/_+$/, '');
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
  if (!isValidHandleShape(shaped) || isReservedHandle(shaped)) {
    return null;
  }
  return shaped;
}
