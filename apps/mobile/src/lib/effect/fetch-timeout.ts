// effect-plain: setTimeout abort timer (Hermes lacks AbortSignal.timeout); callers are Promise transports, not Effects
// A request on a dead socket after a network change must fail instead of hanging: the fetch runs under an `AbortController` that aborts after `ms`, and a caller signal is propagated. No `AbortSignal.timeout`: Hermes may lack it.

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
