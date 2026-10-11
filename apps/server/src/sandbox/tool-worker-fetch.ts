import { parentPort } from 'node:worker_threads';
import { Cause, Duration, Effect } from 'effect';
import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { FetchResponse } from './host-fetch';
import { withFetchPrefix, type SandboxLimits } from './limits';

// The fetch bridge between the QuickJS guest and the parent thread: every
// `fetch()` becomes a small JSON message out and a `fetch-result` message in.

export interface WorkerFetchPayload {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyPresent: boolean;
}

type Deferred = ReturnType<QuickJSContext['newPromise']>;

// The first matching `fetch-result` wins. The timeout is an Effect timer: when
// it fires, the callback is interrupted and its finalizer removes the listener.
export function waitForFetchResponse(
  id: number,
  fetchTimeoutMs: number,
): Effect.Effect<FetchResponse, Error> {
  return Effect.callback<FetchResponse, Error>((resume) => {
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const record = message as Record<string, unknown>;
      if (record.type !== 'fetch-result' || record.id !== id) {
        return;
      }
      parentPort?.off('message', onMessage);
      if (record.ok === true) {
        const body = record.body;
        resume(
          Effect.succeed({
            status: typeof record.status === 'number' ? record.status : 0,
            body: body instanceof Uint8Array ? body : new Uint8Array(0),
          }),
        );
        return;
      }
      resume(
        Effect.fail(
          new Error(typeof record.message === 'string' ? record.message : 'fetch failed'),
        ),
      );
    };
    parentPort?.on('message', onMessage);
    return Effect.sync(() => {
      parentPort?.off('message', onMessage);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(fetchTimeoutMs + 1000),
      orElse: () => Effect.fail(new Error('fetch timeout')),
    }),
  );
}

export interface FetchBridgeDeps {
  limits: SandboxLimits;
  context: QuickJSContext;
  readFetchCount: () => number;
  addFetch: () => void;
  track: (handle: QuickJSHandle) => QuickJSHandle;
  settleVm: (settle: (handle: QuickJSHandle) => void, handle: QuickJSHandle) => void;
  enterVm: () => void;
  exitVm: () => void;
  rejectWith: (deferred: { reject: (handle: QuickJSHandle) => void }, text: string) => void;
}

// Installs the guest `fetch` implementation. It reads and bumps the run's
// fetch count through the callbacks so the worker entry keeps owning it.
export function createFetchBridge(
  deps: FetchBridgeDeps,
): (urlHandle: QuickJSHandle, initHandle?: QuickJSHandle) => QuickJSHandle {
  const {
    limits,
    context,
    readFetchCount,
    addFetch,
    track,
    settleVm,
    enterVm,
    exitVm,
    rejectWith,
  } = deps;
  let fetchId = 0;

  // Everything after the url check, as one Effect. The caller starts it with
  // `runPromise`, which runs the fiber up to its first wait synchronously, so
  // the early rejection and the 'fetch' message still happen before
  // `fetchImpl` returns. A failure here becomes a rejection of the tool's
  // fetch promise; a throw from `rejectWith` itself rejects the run, which
  // crashes the worker exactly as the old unhandled rejection did.
  const fetchEffect = (
    deferred: Deferred,
    urlText: string,
    initHandle: QuickJSHandle | undefined,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (readFetchCount() >= limits.maxFetches) {
        rejectWith(deferred, 'fetch_denied: too many fetches');
        return;
      }
      addFetch();
      let method = 'GET';
      let headers: Record<string, string> = {};
      let bodyPresent = false;
      if (initHandle !== undefined) {
        yield* Effect.match(
          Effect.try(() => {
            if (context.typeof(initHandle) !== 'undefined') {
              const dumpedInit: unknown = context.dump(initHandle);
              if (typeof dumpedInit === 'object' && dumpedInit !== null) {
                const init = dumpedInit as Record<string, unknown>;
                if (typeof init.method === 'string') {
                  method = init.method;
                }
                if (typeof init.body !== 'undefined' && init.body !== null) {
                  bodyPresent = true;
                }
                if (typeof init.headers === 'object' && init.headers !== null) {
                  const rawHeaders = init.headers as Record<string, unknown>;
                  for (const [name, value] of Object.entries(rawHeaders)) {
                    if (typeof value === 'string') {
                      headers[name.toLowerCase()] = value;
                    }
                  }
                }
              }
            }
          }),
          {
            onFailure: () => {
              headers = {};
            },
            onSuccess: () => undefined,
          },
        );
      }
      const id = fetchId++;
      const payload: WorkerFetchPayload = { id, url: urlText, method, headers, bodyPresent };
      parentPort?.postMessage({ type: 'fetch', ...payload });
      const response = yield* waitForFetchResponse(id, limits.fetchTimeoutMs);
      const bodyBytes = response.body;
      const bodyText = Buffer.from(bodyBytes).toString('utf8');
      const responseHandle = track(context.newObject());
      context.setProp(
        responseHandle,
        'ok',
        track(response.status >= 200 && response.status < 300 ? context.true : context.false),
      );
      context.setProp(responseHandle, 'status', track(context.newNumber(response.status)));
      const textFn = track(
        context.newFunction('text', () => {
          const out = context.newPromise();
          out.resolve(track(context.newString(bodyText)));
          return out.handle;
        }),
      );
      context.setProp(responseHandle, 'text', textFn);
      const jsonFn = track(
        context.newFunction('json', () => {
          const out = context.newPromise();
          enterVm();
          try {
            context.setProp(context.global, '__zilar_body', track(context.newString(bodyText)));
            const parsed = context.evalCode('JSON.parse(__zilar_body)', 'tool.js');
            if (parsed.error) {
              parsed.error.dispose();
              out.reject(track(context.newString('invalid json')));
            } else {
              const value = parsed.value;
              track(value);
              out.resolve(value);
            }
          } finally {
            exitVm();
          }
          return out.handle;
        }),
      );
      context.setProp(responseHandle, 'json', jsonFn);
      settleVm((handle) => deferred.resolve(handle), responseHandle);
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        const message = error instanceof Error ? error.message : 'fetch failed';
        return Effect.sync(() => {
          rejectWith(deferred, withFetchPrefix(message));
        });
      }),
    );

  const fetchImpl = (urlHandle: QuickJSHandle, initHandle?: QuickJSHandle): QuickJSHandle => {
    const deferred = context.newPromise();
    let urlText = '';
    try {
      urlText = context.getString(urlHandle);
    } catch {
      rejectWith(deferred, 'fetch_denied: invalid url');
      return deferred.handle;
    }
    void Effect.runPromise(fetchEffect(deferred, urlText, initHandle));
    return deferred.handle;
  };

  return fetchImpl;
}
