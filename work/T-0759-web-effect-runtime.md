---
id: T-0759
title: "F1: web Effect runtime — apps/web/src/lib/effect/runtime.ts (one ManagedRuntime with the FetchHttpClient layer), errors.ts (ApiFailure tagged error mirroring ApiError: status, code, message, detail) and api-effect.ts (fromApi: lift any existing api.ts Promise call into an Effect with ApiFailure), unit-tested; no caller changes"
status: todo
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

## Review (written by Claude)
