---
id: T-0764
title: "S8: server small edges B on Effect — search/routes.ts runSearch as runSearchEffect (HttpError failures, archive queries via tryPromise → 502, no try/catch or Promise.all), search/api.ts yields it with Effect.orDie into the existing envelope; drafts/hub.ts throttle timer as a forked Effect.sleep fiber (interrupt replaces clearTimeout), same publish order and same sync push/flush/end API"
status: merged
milestone: M5
branch: task/T-0764-server-edges-b
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-0764 (S8): message search and the draft throttle on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S8), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **`apps/server/src/search/routes.ts`** (521 lines): `export async function runSearch(deps, userId, query): Promise<SearchResult>` (line 305). It:
  - throws `HttpError` 501, 400 and 404 for configuration and input problems (lines 310-325);
  - awaits `allowedArchives(...)` (line 318; the helper lives in `search/service.ts:84`);
  - runs two archive queries with `Promise.all` inside a try/catch that maps any failure to `HttpError(502, 'search_failed', 'Message search failed, try again later')` (lines 339-350);
  - runs a fuzzy query in a second try/catch with the same 502 (lines 459-480).
- **The only caller** is `search/api.ts:164-171`: `yield* Effect.promise(() => runSearch(...))` inside `withErrorEnvelope(...)`.
- **`withErrorEnvelope`** (`apps/server/src/effect/http-core.ts:131-139`) takes an `Effect<A, never, R>` and turns defects into the error envelope, so today an `HttpError` reaches it as a defect.
- **`apps/server/src/drafts/hub.ts`** (148 lines): `publishTurn` (line 70) keeps `timer` (`setTimeout` at line 108, `clearTimeout` at 119 and 132). `push`, `flush` and `end` are synchronous, and the comment at lines 101-103 says `flush` and `end` publish synchronously so the ordering with `end` stays exact.
- **The tests:** `drafts/hub.test.ts` uses `vi.useFakeTimers()` and `vi.advanceTimersByTime` (lines 59-83). The search tests are `search/search.test.ts` and `search/match.test.ts`. `search/service.ts` is out of scope.
- **The rules:** `docs/EFFECT_GUIDE.md` (Promise edges, lines 12-32; timers that must be interruptible, line 165). Check the 4.0.2 APIs in `node_modules/effect/dist/*.d.ts`.

### What to build
1. **`search/routes.ts`:** `runSearchEffect(deps, userId, query): Effect.Effect<SearchResult, HttpError>`.
   - The same checks become `Effect.fail(new HttpError(...))` with the same status, code and message.
   - `allowedArchives` goes through `Effect.promise`, so its rejection stays a defect, as today.
   - The two archive queries run as `Effect.all([...], { concurrency: 2 })` of `Effect.tryPromise`, and any failure maps to the same 502. The fuzzy query likewise.
   - Keep the log line and its fields exactly as they are: count and duration, never the query.
   - Keep `runSearch` as a thin Promise export (`Effect.runPromise`) only if something else imports it (check with `git grep`); otherwise delete it.
2. **`search/api.ts`:** yield `runSearchEffect(...).pipe(Effect.orDie)` instead of `Effect.promise(() => runSearch(...))`. The envelope then sees the same `HttpError` defect as today.
3. **`drafts/hub.ts`:** the throttle becomes a fiber. Instead of `setTimeout`, `push` forks `Effect.sleep(remaining)` followed by `flushLatest`, using `Effect.runFork`. `flush` and `end` interrupt it (`Fiber.interrupt`, run synchronously with `Effect.runSync` or `runFork`; pick what keeps them synchronous) instead of `clearTimeout`.
   - The public API, the synchronous publishing and the event order must stay identical.
   - `hub.test.ts` must pass unchanged. It uses vitest fake timers, so check that Effect's default clock honours them; if it does not, stop and report it, and do not rewrite the tests.
4. **Tests:** every existing search, drafts and gateway draft test passes unchanged. Add one hub test proving that `end` interrupts a pending flush (the delayed draft never publishes after `end`).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/search/routes.ts`, `apps/server/src/search/api.ts`, `apps/server/src/effect/http-core.ts` (lines 100-140), `apps/server/src/drafts/hub.ts` and the tests of both modules.

### Allowed files
`apps/server/src/search/routes.ts`, `apps/server/src/search/api.ts`, `apps/server/src/search/routes.test.ts`, `apps/server/src/drafts/hub.ts`, `apps/server/src/drafts/hub.test.ts`, `work/T-0764-server-edges-b.md`.

In `hub.test.ts`, only add the new test; change no existing test.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search src/drafts
pnpm gate
```

### Acceptance
- `routes.ts` and `hub.ts` import Effect; there is no `async`/`await`, try/catch, `setTimeout` or `clearTimeout` left in the converted code.
- The behaviour and the tests are unchanged, plus the one new test.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed
- `apps/server/src/search/routes.ts`: `runSearch` (async) is now `runSearchEffect`, an `Effect.fnUntraced` returning `Effect.fn.Return<SearchResult, HttpError>`. The 501, 400 and 404 checks are `Effect.fail(new HttpError(...))` with the same status, code and message. `allowedArchives` is `Effect.promise`, so a rejection stays a defect. The two archive queries are `Effect.all([Effect.tryPromise, Effect.tryPromise], { concurrency: 2 })`, and the fuzzy query is `Effect.tryPromise` with the candidate loop inside `Effect.try`. Every archive failure maps to the same 502. The log line is unchanged (count and duration only). `runSearch` is deleted: its only caller was `search/api.ts`, and `git grep` finds no other use.
- `apps/server/src/search/api.ts`: `yield* runSearchEffect(deps, user.id, {...}).pipe(Effect.orDie)`. The envelope sees the same `HttpError` defect as before.
- `apps/server/src/drafts/hub.ts`: `timer` is a `Fiber.Fiber<void>`. `push` forks `Effect.sleep(remaining).pipe(Effect.andThen(Effect.sync(flushLatest)))` with `Effect.runFork`. `flush` and `end` call `cancelTimer()`, which runs `Effect.runSync(Fiber.interrupt(timer))`. The public API, the synchronous publishing and the event order are unchanged.
- `apps/server/src/drafts/hub.test.ts`: one new test, `end interrupts a pending throttled flush, so nothing publishes after end`. No existing test was changed.

### Start and interruption
- Start: `Effect.runFork`, the same pattern as `actions/gateway.ts` and `approvals/sweeper.ts`.
- Interruption: `Effect.runSync(Fiber.interrupt(timer))`, synchronous. The new test asserts `vi.getTimerCount()` is 1 after a pending push and 0 right after `end`, so the sleep's `clearTimeout` ran synchronously.
- Fake timers: Effect's `sleepMillis` calls the global `setTimeout` at call time (`node_modules/effect/dist/internal/effect.js:2877`). The existing hub tests pass unchanged, and the new test's control (a second, un-ended turn) shows a pending fiber flush fires under `vi.advanceTimersByTime`.

### Test counts
- Before (`src/search`, `src/drafts`): 4 files, 50 passed (search 36 `it`, drafts 14: hub 10, routes 4).
- After: 4 files, 51 passed (50 + 1 new hub test).
- `src/drafts/hub.test.ts` alone: 11 passed.
- Gateway draft tests (`src/agents/gateway.test.ts`, `reply.test.ts`, `integration.test.ts`): 2 files passed, 213 tests; `integration.test.ts` is skipped by design (`describe.skipIf(!ENABLED)`, needs real XMPP and LiteLLM).

### Gate
- First run: GATE FAIL on typecheck, `search/routes.ts:509 TS2339 Property 'toString' does not exist on type 'never'`. Cause: TypeScript narrowed `let oldest` to `null` from its initializer, because `pushItem` assigns it in a closure. Fix: `let oldest = null as bigint | null;` with a comment. `pnpm --filter @zilar/server typecheck` then passed.
- Second run: GATE PASS.

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (0.8s)
PASS  typecheck  (2.2s)
PASS  tests @zilar/server  (21.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations and open points
- Resolved in fix round 1 (see below): the 502 path had no test, and the query builders ran outside the old try.
- The gate's runner typecheck was a turbo cache hit whose replayed log names `zilar-T-0763`. The result is the same code, so I did not act on it.

### Fix round 1 (lead review)
- The query builders are back inside the 502 mapping, as in the old try: the main pair builds `buildArchiveQuery` and `buildArchiveEditsQuery` in one `Effect.try` mapped to `searchFailed`, then runs both `Effect.tryPromise` queries; `buildFuzzyCandidatesQuery` runs in its own `Effect.try` before the fuzzy `tryPromise`. `buildTsQuery` stays outside, as before.
- New `apps/server/src/search/routes.test.ts` (3 tests, added to Allowed files): (a) the archive query rejects, giving 502 `search_failed` with the exact message and no raw error text; (b) only the fuzzy query rejects (selected by `AS "body"`), giving the same 502 after 3 query calls; (c) a builder throws before any query runs: `buildArchiveQuery` reads `owners.rooms`, and the fixture's `rooms` getter throws, giving the same 502 with `query` not called. The test mocks `allowedArchives` (the owner scope) and calls `runSearchEffect` directly with `Effect.flip`. It does not go through the HTTP envelope, so the status mapping is checked at the typed-error level.
- Counts: `src/search src/drafts` 5 files, 54 passed (50 before, +1 hub, +3 routes). `routes.test.ts` alone: 3 passed.
- Gate: GATE PASS, 6 changed files, all in Allowed.

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (3.0s)
PASS  format  (1.0s)
PASS  lint  (1.0s)
PASS  typecheck  (4.3s)
PASS  tests @zilar/server  (28.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **`runSearchEffect`:** the query builders and queries sit inside the same 502 mapping as before, and `api.ts` yields it with `orDie` into the envelope (the same defect path as today).
- **The hub throttle:** a forked `Effect.sleep` fiber that `flush` and `end` interrupt synchronously (the new test checks the timer count drops to 0).
- **Tests:** 3 new route tests cover the 502 paths, and the counts go from 50 to 54; the gate passed.
