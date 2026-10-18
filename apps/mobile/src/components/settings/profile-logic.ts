/**
 * The plain-logic half of the settings area, kept hook- and JSX-free so Vitest
 * covers it. Holds the friendly error texts (web's words), the handle
 * availability view model and the handle suggestion builder.
 */

import { handleSaveMessage, parseUrl } from '@zilar/chat-core';

import { ProfileApiError } from '../../lib/profile-api';

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

export type HandleAvailabilityReason = HandleCheckReason | 'rate_limited';

export type HandleAvailability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; handle: string }
  | { state: 'unavailable'; reason: HandleAvailabilityReason };

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

export function isHandleRateLimited(error: unknown): boolean {
  return error instanceof ProfileApiError && error.code === 'rate_limited';
}

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

export function friendlyClaimError(error: unknown): string {
  if (error instanceof ProfileApiError) {
    return (
      handleSaveMessage(
        { code: error.code, message: error.message, nextChangeAt: error.nextChangeAt },
        'username',
      ) ?? error.message
    );
  }
  return 'Could not save your username. Try again.';
}

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
        return 'That file is not a picture we can use. Try another photo.';
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

export {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  suggestHandle as suggestHandleFor,
} from '@zilar/protocol';

export type AvatarPhase =
  | { name: 'idle' }
  | { name: 'picked'; uri: string; mimeType: string }
  | { name: 'uploading'; uri: string; mimeType: string; progress: number }
  | { name: 'failed'; message: string }
  | { name: 'removed' };

/**
 * The `expo-image` source for an avatar url. The server's `avatarUrl` is a
 * relative `/api/avatars/<id>` path, so it resolves against the API origin. The
 * bearer rides only to that origin, so a `file://` preview or a foreign url gets
 * no headers and the token can never leak cross-origin.
 */
export function avatarImageSource(
  url: string,
  apiUrl: string,
  token: string | undefined,
): { uri: string; headers?: { authorization: string } } {
  if (url.startsWith('file://') || url.startsWith('data:')) {
    return { uri: url };
  }
  const api = parseUrl(apiUrl);
  if (api === undefined) {
    return { uri: url };
  }
  const origin = api.origin;
  const absolute = url.startsWith('/') ? `${origin}${url}` : url;
  const absoluteUrl = parseUrl(absolute);
  const sameOrigin = absoluteUrl !== undefined && absoluteUrl.origin === origin;
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
