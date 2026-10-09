---
id: T-0759
title: "F1: web Effect runtime — apps/web/src/lib/effect/runtime.ts (one ManagedRuntime with the FetchHttpClient layer), errors.ts (ApiFailure tagged error mirroring ApiError: status, code, message, detail) and api-effect.ts (fromApi: lift any existing api.ts Promise call into an Effect with ApiFailure), unit-tested; no caller changes"
status: merged
milestone: M5
branch: task/T-0759-web-effect-runtime
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0759 (F1): the web Effect runtime and typed API errors

## Spec (written by Claude, do not edit)

### Why
This is Phase 1 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. §3.3 describes "lift first": components keep calling the existing `api.ts` functions, wrapped in an Effect. This task adds the three building blocks; F2 then builds the hooks on them. No component or `api.ts` function changes here.

### Verified facts (do not re-derive)
- **`apps/web/src/lib/api.ts`:**
  - `ApiError` (lines 10-22) is a plain `Error` subclass with `status: number`, `code: string`, `message` and `detail: Record<string, unknown>`;
  - the private `request()` (line 238) maps a network failure to `new ApiError(0, 'network_error', 'Could not reach the server')` (around line 258);
  - there are 274 exports.
- **Effect 4.0.2 provides:**
  - `effect/http` (the package exports `./http` → `dist/http/index.js`);
  - `FetchHttpClient.layer: Layer.Layer<HttpClient.HttpClient>` (`dist/http/FetchHttpClient.d.ts:76`);
  - `ManagedRuntime.make(layer, options?)` (`dist/ManagedRuntime.d.ts:258`).

  `apps/web/package.json` depends on `effect` `^4.0.2` and `@effect/atom-react` `4.0.2`.
- **Existing atom wiring:** `apps/web/src/store/atomStore.ts:1` imports `Atom` and `AtomRegistry` from `effect/reactivity`, and `apps/web/src/store/ChatStoreProvider.tsx:1` uses `RegistryContext` from `@effect/atom-react`.
- **The rules to follow:** `docs/EFFECT_GUIDE.md`. In particular, lines 12-32 cover Promise edges, 61-72 cover one tagged error per failure mode with no secrets or URLs in errors, and 101-124 cover lifting with `Effect.promise`/`tryPromise`. Read it before writing code.
- **Existing directory:** there is no `apps/web/src/lib/effect/` directory today.

### What to build
1. **`apps/web/src/lib/effect/runtime.ts`:** `export const webLayer = FetchHttpClient.layer` (kept as a named layer so later tasks can merge more services into it), `export const webRuntime = ManagedRuntime.make(webLayer)`, and `runWeb = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) => webRuntime.runPromise(effect)`. Add a short comment that this is the single web runtime (guide: one runtime per process).
2. **`apps/web/src/lib/effect/errors.ts`:** `export class ApiFailure extends Data.TaggedError('ApiFailure')<{ status: number; code: string; message: string; detail: Record<string, unknown> }>`, plus `export const toApiFailure = (cause: unknown): ApiFailure`:
   - an `ApiError` is copied field by field, keeping the message byte-identical;
   - anything else becomes `status 0`, `code 'unknown_error'`, `message 'Something went wrong'`, `detail {}`. Never put `String(cause)` in the message.
   - Also export `isApiFailureCode(code)`, a refinement for `Effect.catchIf`.
3. **`apps/web/src/lib/effect/api-effect.ts`:** `export const fromApi = <A>(call: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ApiFailure>`, which is `Effect.tryPromise({ try: call, catch: toApiFailure })`. The `AbortSignal` comes from `tryPromise`, so an interrupted Effect aborts the request when the callee passes the signal on. Existing `api.ts` functions do not take a signal yet; that is fine, callers simply ignore it: `fromApi(() => getMe())`.
4. **Tests** in `apps/web/src/lib/effect/errors.test.ts` and `api-effect.test.ts`:
   - an `ApiError` maps field for field;
   - an unknown throw maps to `unknown_error`, and the message does not contain the thrown text;
   - `fromApi` succeeds and fails as expected;
   - interrupting the fiber aborts the signal (use a call that waits on the signal);
   - `runWeb` runs a trivial Effect.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.3 and §3.6, `apps/web/src/lib/api.ts` (lines 1-60 and 230-300), `apps/web/src/store/atomStore.ts`.

### Allowed files
`apps/web/src/lib/effect/runtime.ts`, `apps/web/src/lib/effect/errors.ts`, `apps/web/src/lib/effect/errors.test.ts`, `apps/web/src/lib/effect/api-effect.ts`, `apps/web/src/lib/effect/api-effect.test.ts`, `work/T-0759-web-effect-runtime.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib/effect
pnpm gate
```

### Acceptance
- The three modules exist, are fully typed and are tested.
- No other file changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `apps/web/src/lib/effect/runtime.ts`: `webLayer = FetchHttpClient.layer` (from `effect/http`), `webRuntime = ManagedRuntime.make(webLayer)`, and `runWeb(effect)` = `webRuntime.runPromise(effect)`.
- Added `apps/web/src/lib/effect/errors.ts`: `ApiFailure` (`Data.TaggedError('ApiFailure')` with `status`, `code`, `message`, `detail`), `toApiFailure(cause)` and `isApiFailureCode(code)`.
- Added `apps/web/src/lib/effect/api-effect.ts`: `fromApi(call)` = `Effect.tryPromise({ try: call, catch: toApiFailure })`.
- Added the tests `errors.test.ts` and `api-effect.test.ts`. No other file changed; no component or `api.ts` change.
- Set `status: in-progress` at the start and `status: review` at the end.

### Commands and real results
- `pnpm install`: done, no errors.
- `pnpm exec prettier --write` on the five new files: two were reformatted (`errors.test.ts`, `api-effect.ts`), no logic change.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/effect`: 2 files, 10 tests passed, 0 failed.
- `pnpm gate` from the worktree root (exit 0). Summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Exported API (signatures only)
- `runtime.ts`:
  - `webLayer: Layer.Layer<HttpClient.HttpClient>`
  - `webRuntime: ManagedRuntime.ManagedRuntime<HttpClient.HttpClient, never>`
  - `runWeb: <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) => Promise<A>`
- `errors.ts`:
  - `class ApiFailure extends Data.TaggedError('ApiFailure')<{ readonly status: number; readonly code: string; readonly message: string; readonly detail: Record<string, unknown> }>`
  - `toApiFailure: (cause: unknown) => ApiFailure`
  - `isApiFailureCode: (code: string) => (failure: ApiFailure) => boolean`
- `api-effect.ts`:
  - `fromApi: <A>(call: (signal: AbortSignal) => Promise<A>) => Effect.Effect<A, ApiFailure>`

### Tests (10 total)
- `toApiFailure`: an `ApiError` maps field for field (message byte-identical, including `detail`); a network `ApiError` (status 0) maps unchanged; an unknown `Error` maps to `unknown_error` with the message `Something went wrong` and does not contain the thrown text; a string, `undefined`, `null` and a number map the same way.
- `isApiFailureCode`: matches only the failure with that code.
- `fromApi`: resolves the value; a rejected `ApiError` becomes an `ApiFailure` with the same status, code and message; an unknown throw becomes `unknown_error`; interrupting the run (`Effect.runPromise(..., { signal })` aborted) aborts the `AbortSignal` the call received.
- `runWeb`: runs `Effect.succeed(3)` and resolves to 3.

### Deviations and open points
- The spec asked for `isApiFailureCode` as a "refinement". I made it a plain predicate, `(failure: ApiFailure) => boolean`, which `Effect.catchIf` accepts. A refinement over the same type would add nothing.
- `toApiFailure` does not pass an `ApiFailure` through unchanged; the spec did not cover it, so any non-`ApiError` input becomes `unknown_error`.
- `errors.ts` imports `ApiError` from `@/lib/api`, so the error module pulls in `api.ts` and its mock imports.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **`runtime.ts`:** one `ManagedRuntime` over `FetchHttpClient.layer`, plus `runWeb`.
- **`errors.ts`:** `ApiFailure` mirrors `ApiError` field for field, and an unknown cause gets a generic message with no thrown text.
- **`api-effect.ts`:** `fromApi` uses `tryPromise` with the abort signal.
- **`isApiFailureCode`:** a plain predicate is fine for `catchIf`.
- **Tests:** 10 pass, and the gate passed.
