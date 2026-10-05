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
