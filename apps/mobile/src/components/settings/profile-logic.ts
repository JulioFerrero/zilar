/**
 * The plain-logic half of the settings area, kept hook- and JSX-free so
 * Vitest covers it without a simulator: the friendly error texts (the same
 * words as web's `friendlyError`/`reasonText`), the handle availability
 * view model (loading, available, taken-with-reason), and the handle
 * suggestion builder (the same rules as web's `suggestHandleFor`).
 */

import { ProfileApiError } from '../../lib/profile-api';

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

/** The client-side reasons the live check can show: the server's three plus the rate limit. */
export type HandleAvailabilityReason = HandleCheckReason | 'rate_limited';

export type HandleAvailability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; handle: string }
  | { state: 'unavailable'; reason: HandleAvailabilityReason };

/** Folds a check result (or its failure) into the availability view model. */
export function handleAvailabilityFor(
  trimmed: string,
  result:
    | { ok: true; available: boolean; reason?: HandleCheckReason | undefined }
    | { ok: false; rateLimited: boolean },
): HandleAvailability {
  if (!result.ok) {
    return result.rateLimited
      ? { state: 'unavailable', reason: 'rate_limited' }
      : { state: 'idle' };
  }
  if (result.available) {
    return { state: 'available', handle: trimmed };
  }
  return { state: 'unavailable', reason: result.reason ?? 'taken' };
}

/** True when the error is the check rate limit (shown inline, not as a form error). */
export function isHandleRateLimited(error: unknown): boolean {
  return error instanceof ProfileApiError && error.code === 'rate_limited';
}

/** The live-check line under the handle input, or null when it stays quiet. */
export function handleAvailabilityText(view: HandleAvailability): string | null {
  switch (view.state) {
    case 'available':
      return `@${view.handle} is available`;
    case 'unavailable':
      return reasonText(view.reason);
    default:
      return null;
  }
}

export function reasonText(reason: HandleAvailabilityReason | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That username is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That username is taken. Try another.';
  }
}

/** The claim failure in plain words, mirroring web's `friendlyError`. */
export function friendlyClaimError(error: unknown): string {
  if (error instanceof ProfileApiError) {
    switch (error.code) {
      case 'handle_invalid':
        return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
      case 'handle_reserved':
        return 'That username is reserved. Try another.';
      case 'handle_taken':
        return 'That username was just taken. Try another.';
      case 'handle_change_too_soon':
        return error.message;
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not save your username. Try again.';
}

/** The avatar failure in plain words, mirroring web's `friendlyUploadError`. */
export function friendlyAvatarError(error: unknown): string {
  if (error instanceof ProfileApiError) {
    switch (error.code) {
      case 'avatar_empty':
        return 'The picture file is empty.';
      case 'avatar_too_large':
        return 'The picture is larger than 256 KiB. Try a smaller file.';
      case 'avatar_animated':
        return 'The picture must be a still image, not an animation.';
      case 'avatar_not_square':
        return 'The picture must be square.';
      case 'avatar_bad_size':
        return 'The picture must be between 64 and 512 pixels on each side.';
      case 'avatar_not_image':
        return 'That file is not a supported picture. Choose a PNG, JPEG or WebP image.';
      case 'rate_limited':
        return 'Too many uploads — wait a little and try again.';
      case 'network_error':
        return 'Could not reach the server. Try again.';
      default:
        return error.message;
    }
  }
  return 'Could not save the picture. Try again.';
}

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;

/** Builds a handle suggestion from a display name or an email local part. */
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

// Reserved first (like the server): `me` is shorter than the minimum, but
// the useful answer is that the word itself cannot be taken. Must match the
// server's `RESERVED_HANDLES` in `apps/server/src/handles/rules.ts`.
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
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
  if (RESERVED_HANDLES.has(shaped)) {
    return null;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(shaped)) {
    return null;
  }
  return shaped;
}

/** The phases of the profile avatar control (picked, uploading, failed, removed). */
export type AvatarPhase =
  | { name: 'idle' }
  | { name: 'picked'; uri: string; mimeType: string }
  | { name: 'uploading'; uri: string; mimeType: string; progress: number }
  | { name: 'failed'; message: string }
  | { name: 'removed' };

/**
 * The `expo-image` source for an avatar url. The server's `avatarUrl` is a
 * relative `/api/avatars/<id>` path, so it resolves against the API origin
 * (the same way `stickerImageSource` resolves sticker paths). The bearer
 * rides only to that origin: a `file://` preview or a foreign url gets no
 * headers, so the session token can never leak cross-origin.
 */
export function avatarImageSource(
  url: string,
  apiUrl: string,
  token: string | undefined,
): { uri: string; headers?: { authorization: string } } {
  if (url.startsWith('file://') || url.startsWith('data:')) {
    return { uri: url };
  }
  let origin: string;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    return { uri: url };
  }
  const absolute = url.startsWith('/') ? `${origin}${url}` : url;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(absolute).origin === origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin || token === undefined) {
    return { uri: absolute };
  }
  return { uri: absolute, headers: { authorization: `Bearer ${token}` } };
}

export function avatarPhaseLabel(phase: AvatarPhase, hasCurrent: boolean): string {
  switch (phase.name) {
    case 'uploading':
      return `Uploading… ${Math.round(phase.progress * 100)}%`;
    case 'failed':
      return phase.message;
    case 'picked':
      return 'A new picture is ready. Save it below.';
    case 'removed':
      return 'Picture removed.';
    default:
      return hasCurrent
        ? 'Change or remove your picture.'
        : 'Add a picture so friends recognize you.';
  }
}
