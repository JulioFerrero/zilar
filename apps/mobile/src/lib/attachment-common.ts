/**
 * Shared pieces of the native attachment seams (T-1021): the fixed
 * user-facing messages, the `NativeFailure` error step and its `error`-result
 * conversion, and the same-origin bearer header helper. Split out of
 * `attachment-native.ts` so the picker, uploader, opener and GIF downloader
 * never import the barrel.
 */

import { Data, Effect, type Effect as EffectType } from 'effect';

export const TOO_LARGE_MESSAGE = 'That file is larger than 50 MB.';
export const EMPTY_MESSAGE = 'That file is empty.';
export const DENIED_MESSAGE =
  'Zilar needs access to your photos to attach them. You can allow it in Settings.';
export const CAMERA_DENIED_MESSAGE =
  'Zilar needs access to your camera to take a photo. You can allow it in Settings.';
export const PICK_FAILED_MESSAGE = 'Could not pick that file. Try again.';
export const OPEN_FAILED_MESSAGE = 'Could not open that file. Try again.';

/**
 * A step that ends in a fixed user-facing message. The public methods turn it
 * back into the `error` result their callers already get (`orErrorResult`).
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
 * The bearer token for our own API origin only. Any other host gets no auth
 * headers, so a hostile URL can never receive the session token.
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
