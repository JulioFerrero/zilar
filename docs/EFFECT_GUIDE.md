# Effect guide for workers

> **Status, 2026-10-09:**
> - The codebase is Effect 4.0 end to end: Effect HTTP replaced Hono, `effect/sql` replaced drizzle, Effect Schema replaced zod, and both chat stores run on Effect. `pnpm effect:map` reads 99.6% on main; the last file, the server entry, is T-0838.
> - Workers start with the one-page `docs/EFFECT_BRIEF.md`. The section "The 100% rule and the client patterns" below is the reference behind it.
> - The older sections describe the first, server-only conversions. Where they say a framework "stays", the 2026-10-07 scope change overrides them.

Effect 4.0 owns the logic between our frameworks: pipelines, timeouts,
cancellation, single-flight, background loops. The early sections show the idioms used in
`apps/server/src/voice-transcription/pipeline.ts` — read it alongside that
file. For anything beyond it, read `docs/effect-reference/` first
(`LLMS.md` and the examples are Effect 4 and win over what you remember of
v3).

## The 100% rule and the client patterns (2026-10-09)

**The rule** (`docs/audit/effect-100-plan.md` section 1). A file is done when it uses Effect for everything that can wait, fail or touch the outside world, or when it has nothing of that kind in it.
- **The checker:** the Effect ratchet (`packages/devtools/src/effect-map/`) classifies every non-test source file as `effect`, `plain` (pure, which is fine), `exempt` (a `// effect-plain: <reason>` marker in the first 15 lines; at most 25 in the repo), or `needs-effect`.
- **Coverage:** Effect lines / (Effect lines + needs-effect lines).
- **The ratchet:** the gate fails on a new or regressed needs-effect file (R6, T-0768).
- **Tier B:** a Promise edge inside an Effect file (`Effect.runPromise` at a library callback, `await` inside `Effect.promise`). It is tracked, not failing.
- **Exempt by decision:** `packages/devtools/**`, `apps/site`, and the dev-only mock backends (`apps/web/src/store/mockStore.ts`, `apps/mobile/src/store/chat-store.ts`).

**Web and mobile UI:**
- **Actions:** one `useAction` per action and per row (keyed by the row id), never one guard for the whole screen. `useQuery` loads data; a reload keeps the old rows on screen until the answer arrives.
- **Browser and permission calls:** the clipboard, `prompt()`, pickers and media permissions are called synchronously inside the click, before any Effect step.
- **Structure and text:** keep the rendered structure; dialogs stay where they are (they are not portalled). Keep every text, and a store's `Error` message keeps its sentence.
- **API errors:** `fromApi` maps failures to `ApiFailure`. When a screen's error text reads a typed API error class (`instanceof AisApiError`, `ProfileApiError` and similar), keep the raw error with `Effect.tryPromise({ try, catch: (e) => e })` instead.
- **Interruption:** leaving a screen interrupts its loads. An action that must finish once started (leave a group, change a role, save then navigate) is `Effect.uninterruptible`, or it is forked so unmount does not stop it.
- **Send-like actions** (each GIF pick, each message) run as their own fiber. Never use `replace` or `ignore` for them; `replace` is for loads where a stale answer must not win.
- **Loops and timers** (tickers, polling) survive a throw only with `Effect.catchDefect` inside the repeat. Never use `catchCause` there, because it also sees normal interruption.
- **Lint:** never read `ref.current` during render, and never call setState inside an effect only to mirror state. Run `pnpm exec oxlint <files>` before you commit.

**The stores** (T-0835 web, T-0836 mobile):
- **Shape:** each concern lives in a module under `store/effects/` (lifecycle, polling, history, send, groups, events, pins), and every background job runs in the store's Scope, so `stop()` interrupts it.
- **Unchanged API:** `StoreApi` is the same as before, and the Promise `XmppCore` is reached through `lift`.
- **Not yet:** `XmppCoreEffect` (T-0801) is ready, but moving the stores and the AI gateway onto it, and deleting the Promise facade (plan X8), is a separate step. It needs Julio's live messaging check.

**Server fire-and-forget:** `Effect.runFork` with `Effect.catchDefect`, keeping the same log text and fields. A fork that must start at once (a busy flag) is started synchronously.

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
- **Schema, custom messages:** in effect 4.0.2 the `{ message }` option on `isMinLength` and `isMaxLength` does **not** reach the issue annotations, so code that walks the issues for a message falls back to its generic text. A `Schema.makeFilter` that returns the text does carry it, and so does the first line of the `SchemaError` message. When a zod message must stay byte-identical, prove each text with a test or a quick check (T-0561 pre-review).
- **Schema, numbers:** `z.number()` rejects `NaN` and `±Infinity`; `Schema.Number` accepts them. Use `Schema.Finite` (and `Schema.isInt()`, which also rejects `NaN`) wherever the zod schema had `z.number()` (T-0565, T-0569).
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
8. **Output schemas strip unknown keys.** An endpoint's success schema is an encoder, so a field the service returns but the schema omits silently disappears for web and mobile, and TypeScript does not catch it. List every field of the service's return type, and compare the two side by side in the Report.
9. **Step order:** when the old route checked the rate limiter before decoding the body, use an endpoint middleware for the limiter (see `pins/api.ts` and `groups/api.ts`).
10. **Message texts:** a test-asserted text stays byte-identical. A generic decode message may become Schema's text; list the old and new texts in the Report.
11. **Tests that mount the old Hono factory directly:** keep `createXRoutes(deps): Hono` exported as a thin wrapper. It builds the Effect API, registers each pair from an exported `X_API_ROUTES` list on a `new Hono()` (path minus `/api`), and forwards `context.req.raw` to `api.handler`. The tests stay unchanged; the wrapper goes away when those tests move to `createApp` (see `push/api.ts`, T-0543).
12. **Binary bodies (`voice/api.ts`):** declare the endpoint with no payload
   schema and read the body from `request.request.stream` (an Effect `Stream`)
   with `Stream.runForEachWhile`, stopping as soon as the running total passes
   the cap, so the body is never buffered whole. Answer raw bytes with
   `HttpServerResponse.uint8Array(bytes, { headers })`; `HttpApiBuilder` returns
   any handler-returned `HttpServerResponse` untouched, headers included.
13. **Client IP (`invite-links/api.ts`, `machines/api.ts`):** `forwardRequest` strips any client copy of `x-zilar-socket-address` and stamps the real socket address (T-0563); read it with `socketAddressOf(request)`. For the trusted-proxy rule, use `clientIpFrom({ forwardedFor, socketAddress }, hops)` from `apps/server/src/http/client-ip.ts`. A test seam `getClientIp` takes the Effect request, so tests that pass `() => '10.0.0.1'` stay unchanged. An item-11 wrapper must delete the header and stamp its own value before forwarding (`machines/routes.ts`).
14. **Server-Sent Events (`drafts/api.ts`):** declare the endpoint with no payload schema and return `HttpServerResponse.stream(frames.pipe(Stream.encodeText), { headers })`. Build frames with `Stream.unwrap(Effect.acquireRelease(subscribe, unsubscribe))` around a `Queue.unbounded` the hub listener offers into with `offerUnsafe`; drain it with `Stream.fromEffectRepeat(Queue.take(queue).pipe(Effect.timeoutOption(heartbeat)))` so idleness answers the heartbeat comment. `toReadableStreamWith` cancels the fiber on disconnect, which runs the unsubscribe.

## Moving a server service onto effect/sql (T-0496, T-0510, T-0519)

The recipe is `docs/audit/effect-sql-migration.md` §(a). The examples are `apps/server/src/pins/service.ts`, `apps/server/src/blocks/service.ts` and `apps/server/src/contact-requests/service.ts`.
- **Signatures:** keep the exported signatures. `db: ServerDatabase` stays the key for `sqlRuntimeFor(db).runPromise(...)`. `createApp` registers the runtime once (T-0510).
- **Transactions:** `sql.withTransaction`, with the same raw `pg_advisory_xact_lock(hashtext(...))` statements in the same order. Lock order across modules: `contact-sender:` before `user-block:`.
- **Unique violations:** check `SqlError.SqlError` with `reason._tag === 'UniqueViolation'`. It exposes the constraint name. Keep the raw `code === '23505'` fallback, and never match message text.
- **Race recovery:** re-read through a fresh `runSql(deps.db, …)` after the transaction rejects, never inside the aborted transaction.
- **Testing a unique-violation race:** PGlite has one connection, so a real race cannot run. Add test-only deps hooks: `onInsert` fires inside the transaction just before the INSERT and can throw a real `new SqlError.SqlError({ reason: new SqlError.UniqueViolation({ constraint }) })`; `onRecovery` fires on the fresh connection and can seed the concurrent winner and trace the order. Production never sets them.
- **Rows:** `SELECT *` and `RETURNING *` come back camelCased through `transformResultNames` (`apps/server/src/effect/sql.ts`). `timestamptz` columns come back as `Date`.
- **Every database needs a registered runtime:** `createApp` and `createTestContext` register one. A test or CLI that builds its own `db` calls `registerSqlRuntime(db, url)` itself and `disposeSqlRuntime(db)` on teardown (`auth/invites.test.ts`, `auth/invite-cli.ts`, T-0574). **Never register inside a domain module.**
- **jsonb:** write `${JSON.stringify(value)}::jsonb`; the driver parses jsonb back on read (T-0568).
- **Tests that fake drizzle stop working:** effect/sql never calls `db.transaction` or `db.select`, so a test that patches `db.transaction` to park a join or that passes a fake `{ select }` db to inject a failure fails after the move (T-0607, T-0609). Before writing a spec, grep the module's tests for `db.transaction =`, `realTransaction` and fake `{ select` objects. If you find one, allow that test file and say how to replace the injection: a test-only deps hook (`beforeJoinTransaction`, `onInsert`), a `vi.mock` that fails once, or a failing `SqlClient` layer. The assertions stay. Proven patterns: `voice-transcription/pipeline.test.ts` (T-0669) and `setup/routes.test.ts` (T-0675) use a partial `vi.mock('../effect/sql', …)` with `sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor)`, then `mockReturnValueOnce({ runPromise: () => Promise.reject(err) })` on the call they want to fail.
- **Seed and assert in tests with `testSql(context)`** (`test-support.ts`, T-0695). It runs an Effect on the test db's runtime: ``await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<Row>`SELECT ...`; }))``. Rules:
  - write snake_case columns, and read rows back camelCased;
  - give every column that drizzle filled in JavaScript (`$defaultFn`); columns with a SQL default can be left out;
  - give each read a small local row type;
  - a no-secret check keeps `SELECT *`, so it still covers every column.

  Examples: `pins/pins.test.ts`, `search/search.test.ts`, `actions/gateway.test.ts`. Tests no longer import `drizzle-orm` (T-0697 to T-0729).

## Moving a mobile API client onto Effect (T-0506)

`apps/mobile/src/lib/pins-api.ts` is the worked example for the other `*-api.ts` files.
- **Decode:** decode the boundary with Effect Schema (`struct` from `@zilar/protocol`).
- **Lenient fields:** a field the client must tolerate (an unknown kind becomes a default) is `Schema.Unknown.pipe(Schema.decodeTo(Target, { decode: SchemaGetter.transform(fn) }))`.
- **Requests:** run the request as an Effect pipeline, cut back to a `Promise` at the edge with `Effect.runPromise`. Keep the error class with the same `status`, `code` and `message`.
- **Exported parsers:** keep each exported `parseX` as a thin wrapper over the schema.
- **Proof:** `expo export` runs the Hermes bundle check (12.2 MB hbc after T-0506), and `pnpm phone:smoke` checks it on the emulator.

## Web API client (T-0505)

- **The response helpers:** `decodeResponse` in `apps/web/src/lib/api.ts` accepts a zod schema or an Effect Schema until the last section moves.
- **Optional fields:** use `Schema.optional`, not `optionalKey`, because of `exactOptionalPropertyTypes`.
- **zod `.catchall`:** becomes `Schema.StructWithRest(struct, [Schema.Record(Schema.String, Schema.Unknown)])`.
- **Tests:** a test that called zod `.parse` on an exported schema changes only that call, to `Schema.decodeUnknownSync(schema)(x)`.

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
