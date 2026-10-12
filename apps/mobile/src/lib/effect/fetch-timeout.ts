// effect-plain: setTimeout abort timer per T-1224 (Hermes lacks AbortSignal.timeout); callers are Promise transports, not Effects
// A timeout for the mobile HTTP transports (T-1224): a request on a dead
// socket after a network change must fail instead of hanging for ever. The
// fetch always runs under an `AbortController` that aborts after `ms`; the
// timer is cleared when the fetch settles. A caller signal (the Effect client
// signal, search/GIF cancellation) is propagated: aborting it aborts the
// fetch, and an already-aborted signal fails fast. No `AbortSignal.timeout`/
// `any`: Hermes may lack them. Uploads and voice transcription never reach
// these transports (Expo file APIs with their own controllers), so they stay
// uncapped.

export const API_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const callerSignal = init.signal ?? undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onCallerAbort = (): void => controller.abort();
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort);
    }
  }
  let pending: Promise<Response>;
  try {
    pending = fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
    throw error;
  }
  return pending.finally(() => {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  });
}
