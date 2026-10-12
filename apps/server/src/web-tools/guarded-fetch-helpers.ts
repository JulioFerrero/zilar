// effect-plain: moved unchanged from apps/server/src/web-tools/guarded-fetch.ts (size split)
// T-1240: helpers split out of `guarded-fetch.ts` unchanged (plus the
// `classifyFetchFailureReason` extraction), so that file stays at or under
// 400 lines. All pure: no guard state, no request.
export const WEB_MAX_DECODE_CHARS = 2 * 1024 * 1024;

export type BadUrlReason = 'invalid' | 'https-only' | 'credentials' | 'port';

export type FetchFailureReason = 'timeout' | 'too-large' | 'failed';

/** The fixed summary text for a bad-url failure. */
export function badUrlSummary(reason: BadUrlReason): string {
  switch (reason) {
    case 'invalid':
      return 'invalid url';
    case 'https-only':
      return 'only https urls are allowed';
    case 'credentials':
      return 'credentials in url are not allowed';
    case 'port':
      return 'explicit port is not allowed';
  }
}

/** The fixed summary text for a fetch failure. */
export function fetchFailedSummary(reason: FetchFailureReason): string {
  switch (reason) {
    case 'timeout':
      return 'fetch timed out';
    case 'too-large':
      return 'response too large';
    case 'failed':
      return 'fetch failed';
  }
}

/** Maps a raw network error to its failure category. */
export function classifyFetchFailureReason(error: unknown): FetchFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return 'timeout';
  }
  if (/too large|too big/i.test(message)) {
    return 'too-large';
  }
  return 'failed';
}

/** A failed get, the false branch of `GuardedGetResult`. */
export interface GuardedFailure {
  ok: false;
  summary: string;
  detail?: string;
}

export function failure(summary: string, detail?: string): GuardedFailure {
  return detail === undefined ? { ok: false, summary } : { ok: false, summary, detail };
}

/** The fixed summary (plus the redirect target as `detail`) for a 3xx answer. */
export function redirectFailure(status: number, location: string | null): GuardedFailure {
  if (location === null) {
    return failure(`not followed: redirect (status ${status})`);
  }
  return failure(
    'not followed: redirect',
    `The page redirects to ${location.slice(0, 2048)}. Call the tool again with that URL if you want to follow it.`,
  );
}

/** The media type before `;`, lowercased; `null` when it is missing or malformed. */
export function mediaTypeOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || mediaType.length === 0 || !mediaType.includes('/')) {
    return null;
  }
  return mediaType;
}

// Decodes the body as UTF-8 (replacing undecodable bytes) with a hard cap
// so a hostile page cannot blow up the server's memory at decode time.
export function decodeCapped(raw: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  if (text.length <= WEB_MAX_DECODE_CHARS) {
    return text;
  }
  return text.slice(0, WEB_MAX_DECODE_CHARS);
}
