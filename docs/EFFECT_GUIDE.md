# Effect guide for workers

Effect 4.0 owns the logic between our frameworks: pipelines, timeouts,
cancellation, single-flight, background loops. Hono routes, React
components, drizzle queries and better-auth keep their current shape, and
zod stays at the boundaries. This guide shows the idioms actually used in
`apps/server/src/voice-transcription/pipeline.ts` — read it alongside that
file. For anything beyond it, read `docs/effect-reference/` first
(`LLMS.md` and the examples are Effect 4 and win over what you remember of
v3).

## The Promise boundary rule

Each module exports plain `Promise` functions. Effect runs inside;
`Effect.runPromise` sits at the edge, once per public function:

```ts
export function fetchAndTranscribe(input: FetchAndTranscribeInput): Promise<string> {
  return Effect.runPromise(
    fetchAndTranscribeEffect(input).pipe(
      Effect.catchTags({
        AudioUnavailable: (error: AudioUnavailable) => Effect.fail(transcriptErrorToHttp(error)),
        // ... one arm per typed error
      }),
    ),
  );
}
```

Callers and tests see `Promise`s and never import Effect. Never return an
`Effect` from a route handler, a React component, or a drizzle query
function.

## `Effect.gen` versus pipes

- `Effect.gen` for sequencing steps that read top-to-bottom (fetch, check,
  call, store). `yield*` a typed error to fail; `return` the value.
- `.pipe(...)` for attaching one behaviour to one effect: a timeout, an
  error mapping, a retry. Do not wrap a whole `Effect.gen` in a function
  that only returns it — use `Effect.fnUntraced` instead (below).

```ts
const fetchAndTranscribeEffect = Effect.fnUntraced(function* (
  input: FetchAndTranscribeInput,
): Effect.fn.Return<string, TranscriptPipelineError> {
  const audio = yield* fetchAudioEffect(input.fetchAudio, input.internalUrl);
  yield* checkAudioEffect(audio);
  const result = yield* transcribeEffect(input.transcribe, { ... });
  return yield* storeTranscriptEffect(input.db, input.urlHash, result);
});
```

Reusable functions use `Effect.fnUntraced` (no tracing span; preferred for
library code) or `Effect.fn("name")` (adds a span; use when the function is
a useful tracing boundary). Annotate the generator return with
`Effect.fn.Return<Success, Failure>` — without it the error channel widens
and `catchTags` at the boundary stops typechecking. Never invent services
or layers for a single function: plain `Effect.fnUntraced` functions that
take their dependencies as arguments are enough.

## Typed errors and the fixed HTTP mapping

Define one `Data.TaggedError` class per failure mode, with no fields unless
a field is needed for control flow (never secrets, URLs, or provider text):

```ts
export class AudioUnavailable extends Data.TaggedError('AudioUnavailable') {}
export class VoiceTooLarge extends Data.TaggedError('VoiceTooLarge') {}
```

Construction is `new AudioUnavailable()`; failing inside a generator is
`return yield* new AudioUnavailable()`. Map each to its fixed answer at the
Promise boundary (see above) so HTTP answers stay identical: 502
`audio_unavailable`, 413 `voice_too_large`, 422 `not_audio`, 502
`transcription_failed`. The network's or provider's message never leaves the
module — tests assert the raw text appears nowhere.

Two details that bit us:

- `Effect.tryPromise({ try, catch })` maps a rejection with `catch`. If the
  mapper itself throws (an unexpected error you re-throw), the effect dies
  with a defect instead of failing typed. Catch-all mappers must return a
  typed error for every input, or the boundary sees `Cause<never>` and
  typechecking fails under `exactOptionalPropertyTypes`.
- `Effect.timeout` adds `Cause.TimeoutError` to the error channel. Prefer
  `Effect.timeoutOrElse({ duration, orElse })`: the fallback runs on expiry
  and the error channel keeps only your typed error.

```ts
const fetched = yield* Effect.tryPromise({
  try: () => fetchAudio(internalUrl),
  catch: () => new AudioUnavailable(),
}).pipe(
  Effect.timeoutOrElse({
    duration: Duration.millis(VOICE_FETCH_TIMEOUT_MS),
    orElse: () => Effect.fail(new AudioUnavailable()),
  }),
);
```

DB failures stay defects and must reject with the original error,
identical and unwrapped — never `catch: (cause) => Cause.die(cause)` plus
`Effect.orDie`: that double-wraps the rejection (the mapper receives the
whole `Cause`, `Cause.die` wraps it again) and `runPromise` rejects with an
opaque `Cause` wrapper instead of the drizzle error. Lift the drizzle
promise with plain `Effect.promise` (no typed-error mapper), so a down
database rejects exactly like the old `await` did. Same for the provider
call: squash the cause and re-check with `instanceof` — a provider refusal
becomes the typed error, anything else dies with the original value:

```ts
const awaitDb = <A>(promise: () => Promise<A>): Effect.Effect<A, never, never> =>
  Effect.promise(promise);

const result = yield* Effect.promise(() => transcribe(input)).pipe(
  Effect.catchCause((cause) => {
    const failure = Cause.squash(cause);
    if (failure instanceof TranscriptionProviderError) {
      return Effect.fail(new TranscriptionFailed());
    }
    return Effect.die(failure);
  }),
  // ...
);
```

Two regression tests assert `error).toBe(original)` for a DB drop and for
an unexpected transcriber throw.

## Timeouts and interruption

`Effect.timeoutOrElse` preempts the loser: the timed-out fetch or provider
call is interrupted. This pipeline registers no finalizers and holds no
resource across the timeout; if a future pipeline does, manage the lifetime
with `Effect.acquireRelease`.
The single-flight map (`shareInFlight`) removes its entry in `finally` (via
`.then(cleanup, cleanup)` on the shared promise), so an interrupted waiter
never poisons the next tap — a new test asserts `size()` returns to 0 after
an aborted waiter. No transaction or lock is held across the network; the
advisory lock still covers only the re-check + insert.

## How to test

Plain Vitest (`describe`/`it`/`expect` from `vitest`) with fakes, like the
existing route tests. You do not need `@effect/vitest`: run plain promises
with `Effect.runPromise`, and assert on the settled `Promise`:

```ts
const waiter = Effect.runPromise(
  Effect.tryPromise(() => inFlight.run('hash', start)),
  { signal: AbortSignal.timeout(20) },
);
await expect(waiter).rejects.toThrow();
```

Inject fakes at the seams (`audioFetcher`, `transcribe`), never the network
or a real key. Sentinel tests prove secrets, URLs and transcript text reach
neither logs, audit rows nor error bodies.

## Effect 4 facts learned in the conversions (2026-10-07)

Each item was hit by a worker in a merged task; trust these over memory of v3.

- **Callback effects:** `Effect.callback` is the constructor. `Effect.async` does not exist in 4.0.0. `resume` takes an `Effect`, not a value. The register function's return value is the interruption finalizer: destroy the request or socket there (T-0484 `web-tools/guarded-fetch.ts`).
- **`Effect.timeoutOrElse`** interrupts the source (its finalizers run) and keeps only your typed error. `Effect.timeout` adds `Cause.TimeoutError` to the error channel instead (T-0484).
- **`Effect.tryPromise`** passes an `AbortSignal` that fires on interruption. Hand it to `fetch` (T-0492).
- **Scoped resources:** `Effect.acquireRelease` inside `Effect.scoped` guarantees cleanup on every exit path. The sandbox worker thread is always terminated this way (T-0489 `sandbox/run-tool.ts`).
- **Background loops:** `Effect.repeat(effect, Schedule.spaced(d))` runs the effect **once immediately**, then spaces the repeats. For "first run after one interval", wrap the whole repeated program in a single `Effect.delay(d)`; don't delay the inner effect, or each cycle waits twice (T-0486). Run the loop with `Effect.runFork` and stop it with `Fiber.interrupt`, which returns an `Effect`: use `runFork` for a sync `close()` and `runPromise` for an async one.
- **A loop must survive a throw:** a bare `repeat` stops at the first defect, with no log. Wrap the inner effect in `Effect.catchDefect(...)` and log there. Do **not** use `catchCause`: it also sees the normal interruption at `close()` and logs a false error. `catchAllCause` does not exist in v4 (T-0486, T-0488).
- **Timers keep the process alive:** Effect's sleep uses a plain `setTimeout` without `unref`. A loop fiber must be interrupted on shutdown (`index.ts` already calls each `close`/`stop`), or the process won't exit (T-0486).
- **Schema, strict objects:** zod's `z.strictObject` becomes a decode with `{ onExcessProperty: 'error' }`. `Schema.is` ignores excess keys, so don't use it for strict checks (T-0494). A plain `z.object` strips unknown keys, which is the Effect default. `.passthrough()` becomes `Schema.StructWithRest`.
- **Schema, record keys:** `Schema.Record(key, value)` does **not** run checks on the key schema. Bound key length or count with a check on the whole record (T-0501).
- **Schema, mutability:** Struct fields and Arrays are readonly. Use `struct()` from `@zilar/protocol` (`mutableKey` on every field) and `Schema.mutable(Schema.Array(...))` to keep zod's mutable types (T-0494).
- **`Effect.catch`** is exported as `catch_ as catch`, which our tsc setting doesn't pick up. Use `catchTag` / `catchTags` (T-0173).

## Server runtime and logging (T-0495)

- **One runtime per process.** `makeServerRuntime(layer)` in `apps/server/src/effect/runtime.ts` builds a `ManagedRuntime` that shares one memo map, so a resource layer is built once per process. Only the edge (`index.ts`) creates it and disposes it on shutdown.
- **Domain modules export Effects**, or plain Promise functions that run through a runtime they are handed. `Effect.runPromise` and `runFork` belong at the edge; the small converted modules (mailer, Giphy, Telegram import) still run at their own edge until the services lane wires them into the runtime.
- **Tests build their own runtime** from test layers (`runtime.test.ts`), never the process one.
- **Logging:** provide `makePinoLoggerLayer(logger)` from `apps/server/src/effect/logger.ts`. `Effect.log*` then goes to our pino instance:
  - string parts become `msg`;
  - **object parts become top-level fields, so pino's `redactPaths` censor them** (`Effect.log({ password })` comes out as `[redacted]`);
  - an `Error` part or a failure `Cause` becomes `err: { name, message }`, never a stack or extra props;
  - annotations and spans become fields too.
  
  Log secrets-bearing objects as objects, never interpolated into the message string: pino cannot redact free text.

## Moving a server route module onto Effect HTTP (T-0498)

Hono stays the outer edge until every module has moved. Each module becomes an `HttpApi` group mounted under Hono by `apps/server/src/effect/http.ts`; `apps/server/src/handles/api.ts` is the worked example.

1. **Group:** in `<module>/api.ts`, `HttpApiGroup.make('<id>').add(<endpoints>).middleware(Session).prefix('/api')` and `HttpApi.make('<id>').add(group)`. The `/api` prefix is required, because the adapter forwards the full Hono path.
2. **Schemas:** Effect `Schema.Struct`s replace zod for the query and payload. Map decode failures to the module's old answers with a module-local `HttpApiMiddleware.layerSchemaErrorTransform`; usually that is `400 invalid_request` through `failureResponse(...)`. A strict body uses the `HttpApi.PayloadParseOptions: { onExcessProperty: 'error' }` annotation.
3. **Auth:** use `.middleware(Session)` and read the user with `yield* CurrentUser`. The 401 comes before any decode.
4. **Handlers:** lift Promise and DB calls with `Effect.promise` and wrap each body in `withErrorEnvelope(effect, logger, requestId)`. Keep the rate limiters, the `now` seam and the audit calls identical.
5. **Layer:** `HttpApiBuilder.group(...)`, then `HttpApiBuilder.layer(api)` with the group, `sessionLayer` and the schema-error layer provided, then `HttpRouter.toWebHandler(layer.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })`. **Keep the router logger off:** it logs full URLs, which would bypass Hono's redacted path logging.
6. **Mount:** export `{ handler, routes }` with the exact `{ method, path }` pairs, then replace the module's `app.route('/api', …)` line with `mountEffectRoutes(app, routes, handler)`. **Use exact routes, not a wildcard,** so the authz sweep test still sees every route.
7. **Proof:** the module's existing Hono-level test passes unchanged. If it cannot, stop and report BLOCKED.

## Whole-codebase conversion (2026-10-07)

The rules in "What NOT to do" below were written for the first, logic-only conversions. **Julio extended the scope** to the whole codebase: Effect Schema replaces zod, `effect/sql` replaces drizzle, Effect HTTP replaces Hono, and `@effect/atom-react` replaces zustand. See `docs/ROADMAP_EFFECT.md` and `docs/audit/effect-everywhere-plan.md`. A task that says it converts one of those layers overrides the matching "do not" below. The foundation tasks (T-0494 protocol Schema, T-0495 runtime and logger, T-0496 the `effect/sql` spike) define the patterns; this guide gains a section for each as they merge.

## What NOT to do

- No `any`, no `@ts-ignore`, no untyped catch-all that swallows the error
  into a generic 500. Every failure mode gets a tagged error and a fixed
  answer.
- Never leak secrets in error messages: typed errors carry no payload by
  default; audit entries carry ids only (the URL hash, never the URL).
- Do not introduce Effect Schema for request validation (zod stays), Effect
  HTTP/client/platform packages, services, or layers — unless the task says
  so.
- Do not change existing tests to fit the conversion. If one cannot pass
  unchanged, stop and explain in the Report.
