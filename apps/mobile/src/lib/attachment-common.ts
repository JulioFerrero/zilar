import { parseUrl } from '@zilar/chat-core';
import { Data, Effect, type Effect as EffectType } from 'effect';

import { API_URL } from './auth';

export const TOO_LARGE_MESSAGE = 'That file is larger than 50 MB.';
export const EMPTY_MESSAGE = 'That file is empty.';
export const DENIED_MESSAGE =
  'Zilar needs access to your photos to attach them. You can allow it in Settings.';
export const CAMERA_DENIED_MESSAGE =
  'Zilar needs access to your camera to take a photo. You can allow it in Settings.';
export const PICK_FAILED_MESSAGE = 'Could not pick that file. Try again.';
export const OPEN_FAILED_MESSAGE = 'Could not open that file. Try again.';

/**
 * A failure that ends in a fixed user-facing message, never server text.
 */
export class NativeFailure extends Data.TaggedError('NativeFailure')<{
  readonly message: string;
}> {}

export type ErrorResult = { status: 'error'; message: string };

export const orErrorResult = <A>(
  effect: Effect.Effect<A, NativeFailure>,
): Effect.Effect<A | ErrorResult> =>
  effect.pipe(
    Effect.catchTag('NativeFailure', ({ message }) =>
      Effect.succeed<ErrorResult>({ status: 'error', message }),
    ),
  );

/**
 * Our API origin only: any other host gets no auth headers, so a hostile URL can never receive the session token.
 */
export const authHeadersFor = Effect.fnUntraced(function* (
  url: string,
  apiUrl: string | undefined,
  getToken: (() => Promise<string | undefined>) | undefined,
): EffectType.fn.Return<Record<string, string> | undefined> {
  if (apiUrl === undefined || getToken === undefined) {
    return undefined;
  }
  const origins = yield* Effect.try({
    try: () => ({ apiOrigin: new URL(apiUrl).origin, targetOrigin: new URL(url).origin }),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
  if (origins === undefined || origins.apiOrigin !== origins.targetOrigin) {
    return undefined;
  }
  const token = yield* Effect.tryPromise({
    try: () => getToken(),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
  return token === undefined ? undefined : { authorization: `Bearer ${token}` };
});

export function isApiOriginUrl(url: string, apiUrl: string | undefined = API_URL): boolean {
  const apiOrigin = apiUrl === undefined ? undefined : parseUrl(apiUrl)?.origin;
  return apiOrigin !== undefined && parseUrl(url)?.origin === apiOrigin;
}

/**
 * An `/upload/` file on our own API origin goes through `GET /api/files`, where the server checks the session and the chat membership; every other URL loads directly.
 */
export function mediaUrl(
  chatId: string,
  url: string,
  apiUrl: string | undefined = API_URL,
): string {
  const parsed = parseUrl(url);
  const apiOrigin = apiUrl === undefined ? undefined : parseUrl(apiUrl)?.origin;
  if (parsed === undefined || apiOrigin === undefined || parsed.origin !== apiOrigin) {
    return url;
  }
  if (!parsed.pathname.startsWith('/upload/') || parsed.pathname.length <= '/upload/'.length) {
    return url;
  }
  return `${apiOrigin}/api/files?chat=${encodeURIComponent(chatId)}&url=${encodeURIComponent(url)}`;
}

/**
 * The block carries an id, never a URL, so a card cannot point the app at another host.
 */
export function cardMediaUrl(id: string, apiUrl: string | undefined = API_URL): string | undefined {
  const apiOrigin = apiUrl === undefined ? undefined : parseUrl(apiUrl)?.origin;
  return apiOrigin === undefined
    ? undefined
    : `${apiOrigin}/api/card-media/${encodeURIComponent(id)}`;
}
