---
id: T-0761
title: "S9: server small edges C on Effect — git/proxy.ts (the GitProxy handler as an Effect program with HttpError failures, token via Effect.tryPromise, upstream fetch via the injected fetch) and connections/probe.ts (testKey as an Effect with timeoutOrElse; unreachable/401/403/429/ok mapping unchanged); same exported Promise signatures"
status: merged
milestone: M5
branch: task/T-0761-server-edges-c
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0761 (S9): git proxy and connection probe on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S9), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **`apps/server/src/git/proxy.ts`** (180 lines):
  - `export type GitProxy = (request: Request) => Promise<Response>` (line 134);
  - `createGitProxy(deps)` (line 136) returns an async handler (lines 142-179). The handler reads `request.arrayBuffer()` for receive-pack POSTs, throws `HttpError(403, 'push_rejected', ...)` for unparseable or disallowed refs, strips the hop-by-hop headers, awaits `tokenClient.getToken()` (line 171) and returns `fetchImpl(...)` (`deps.fetch ?? fetch`, line 140).
  - Since T-0740 it is called from `git/api.ts`, which is not mounted. The tests live under `apps/server/src/git/`; list them.
- **`apps/server/src/connections/probe.ts`** (101 lines):
  - `createProviderProbe(fetchImpl = fetch)` (line 60) returns `{ async testKey(provider, key) }` (lines 62-92). It fetches with `AbortSignal.timeout(PROBE_TIMEOUT_MS)`, maps a thrown fetch to `{ ok: false, message: 'The provider is unreachable' }`, 401 or 403 to `'The provider rejected the key'`, 429 to the rate-limit message, `response.ok` to `{ ok: true }`, and anything else to `'The provider returned an unexpected response'`.
  - The comment at lines 72-76 explains why no error detail is kept: a URL can echo the key.
- **The rules:** `docs/EFFECT_GUIDE.md` (Promise edge, lines 12-32; tagged errors, lines 61-72; `timeoutOrElse`, line 165). Check the APIs in `node_modules/effect/dist/*.d.ts` (Effect 4.0.2).

### What to build
1. **`git/proxy.ts`:**
   - add `gitProxyEffect(deps): (request: Request) => Effect.Effect<Response, HttpError>`. It reads the body, getting the token and calling the upstream fetch through `Effect.tryPromise`. It fails with the same `HttpError` values. A failure of the token client or of the upstream fetch must keep today's behaviour exactly: find out what happens today (an error thrown out of the async function) and keep it (a defect or rejection reaching the caller in the same way). Explain in the Report.
   - `createGitProxy` stays, returning `(request) => Effect.runPromise(gitProxyEffect(deps)(request))`. Ensure an `HttpError` failure rejects with the same `HttpError` instance (use `Effect.runPromise` plus the 4.0.2 way to unwrap a `Cause` failure if needed; check how `apps/server/src` already does this, for example `git grep -n "runPromiseExit\|squash" apps/server/src`).
2. **`connections/probe.ts`:** `testKeyEffect(provider, key): Effect.Effect<ProbeResult>` (no error channel: every outcome is a value). The fetch goes through `Effect.tryPromise` with the abort signal from Effect, and the timeout is `Effect.timeoutOrElse` with the same `PROBE_TIMEOUT_MS`, mapping to "unreachable". `testKey` runs it. All the messages stay byte-identical, and nothing from the error object reaches a message.
3. **Tests:** the existing git and connections tests must pass unchanged. Add one test per file for interruption: an interrupted probe aborts its fetch signal; a proxy request whose token call never resolves can be interrupted.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, the two files and their tests (`git grep -l "createGitProxy\|createProviderProbe" apps/server/src`).

### Allowed files
`apps/server/src/git/proxy.ts`, `apps/server/src/git/proxy.test.ts`, `apps/server/src/connections/probe.ts`, `apps/server/src/connections/probe.test.ts`, `work/T-0761-server-edges-c.md`.

If a listed test file does not exist, create it.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/git src/connections
pnpm gate
```

### Acceptance
- Both files import Effect, with no async handler bodies or try/catch left.
- The exported signatures and behaviour are unchanged, and the tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed (4 files, all in Allowed files)
- `apps/server/src/git/proxy.ts`: new `gitProxyEffect(deps)` returning `(request) => Effect<Response, HttpError>` (an `Effect.fnUntraced` program, `Effect.fn.Return<Response, HttpError>`). Refusals are `Effect.fail(new HttpError(403, 'push_rejected', ...))` with the same messages. `createGitProxy` is now `(request) => Effect.runPromise(gitProxyEffect(deps)(request))`. Exported types and signatures are unchanged.
- `apps/server/src/connections/probe.ts`: new `export function testKeyEffect(fetchImpl)(provider, key): Effect<ProbeOutcome>` (no error channel). The fetch goes through `Effect.tryPromise` with the Effect abort signal, the timeout is `Effect.timeoutOrElse` with `PROBE_TIMEOUT_MS`, and the internal `ProbeUnreachable` (`Data.TaggedError`) maps to the unchanged "unreachable" message. Status mapping and all messages are byte-identical. `createProviderProbe().testKey` is `Effect.runPromise(testKeyEffect(fetchImpl)(provider, key))`.
- `apps/server/src/git/proxy.test.ts`: +1 test, "can be interrupted while the token call never resolves, without reaching upstream".
- `apps/server/src/connections/probe.test.ts`: +1 test, "aborts the provider request when the probe is interrupted".
- No existing test was changed.

### Deviations from the spec (and why)
1. **`Effect.promise`, not `Effect.tryPromise`, for the body read, the token call and the upstream fetch in `proxy.ts`.** `docs/EFFECT_GUIDE.md` (typed errors section) says a DB or provider rejection must reach the caller unchanged, and `Effect.promise` does that. A `tryPromise` with a mapping `catch` would turn the rejection into a typed failure, and `runPromise` would then reject with the mapped error. The upstream fetch still gets the abort signal (`Effect.promise` passes it when the thunk takes an argument), so an interrupted proxy request aborts upstream. The probe uses `Effect.tryPromise` as the spec asked, because its `catch` maps to the typed "unreachable" outcome.
2. **`testKeyEffect` takes the injected `fetchImpl` first.** Curried as `testKeyEffect(fetchImpl)(provider, key)`, mirroring `gitProxyEffect(deps)(request)`. The spec signature had no place for the fetch.

### Failure behaviour (checked in the code)
- **Today, token failure:** `GitHubAppTokenClient.getToken` rejects with `GitTokenError` (`git/token.ts`, fixed message, no secret). The old async handler rejected with it. `git/api.ts` lifts it with `Effect.promise`, so it becomes a defect carrying the original error. `withErrorEnvelope` then calls `failureResponse` (`effect/http-core.ts:110-123`): it logs `unhandled request error` (`err`) and answers **500 `internal_error`**.
- **Now:** the token rejection goes through `Effect.promise`, so it is a defect carrying the same `GitTokenError` instance. `runPromise` rethrows it (`causeSquash`, verified in `node_modules/effect/dist/internal/effect.js`), and the 500 path is identical. An upstream fetch rejection behaves the same way. A `HttpError` failure rejects with the same instance, so `httpErrorResponse` answers as before.
- **Probe:** a thrown fetch, a timeout, or a sync throw while building the URL or headers gives "The provider is unreachable", as before. Nothing from the error object reaches the message.
- No new test covers the token-failure 500 path. The equivalence comes from the reasoning above, not from a test.

### Commands and results
- `pnpm install`: done.
- `pnpm exec prettier --write` on the 4 files: all unchanged.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/git/proxy.test.ts src/connections/probe.test.ts`: 2 files passed, 17 tests passed.
- **Before** (`... src/git src/connections`, baseline on the untouched branch): Test Files 6 passed | 1 skipped (7); Tests **53 passed | 1 skipped (54)**.
- **After** (same command): Test Files 6 passed | 1 skipped (7); Tests **55 passed | 1 skipped (56)**. Two new tests, no failures.
- `pnpm gate` from the worktree root: exit 0, summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate's test step took 1.0s, and I did not verify which tests it ran. My own run above covered `src/git` and `src/connections` in full.
- Scratch: I briefly wrote the gate output to a log file in the worktree and deleted it before committing. `git status` showed only the 4 source files before the task-file edit.

### Problems / open questions
- Only the single-file proxy and probe tests were run by me; the 1.0s gate test step is not something I could verify, as noted above.
- Nothing blocked. Deviations 1 and 2 are the only departures from the spec, and both are explained above.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **`gitProxyEffect`:** refusals are `Effect.fail(HttpError)`; the body, token and upstream fetch use `Effect.promise`, so a rejection still reaches `api.ts` as the same defect and gives a 500 (this matches today). The upstream fetch now gets the abort signal.
- **The probe:** `testKeyEffect(fetchImpl)` uses `tryPromise` plus `timeoutOrElse` and has no error channel; the messages are byte-identical, and no detail from the error object is kept.
- **Results:** the tests go from 53 to 55 (two new interruption tests), and the gate passed.
