---
id: T-0764
title: "S8: server small edges B on Effect — search/routes.ts runSearch as runSearchEffect (HttpError failures, archive queries via tryPromise → 502, no try/catch or Promise.all), search/api.ts yields it with Effect.orDie into the existing envelope; drafts/hub.ts throttle timer as a forked Effect.sleep fiber (interrupt replaces clearTimeout), same publish order and same sync push/flush/end API"
status: todo
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
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/search/routes.ts`, `search/api.ts`, `effect/http-core.ts` (lines 100-140), `drafts/hub.ts` and the tests of both modules.

### Allowed files
`apps/server/src/search/routes.ts`, `apps/server/src/search/api.ts`, `apps/server/src/drafts/hub.ts`, `apps/server/src/drafts/hub.test.ts`, `work/T-0764-server-edges-b.md`.

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

## Review (written by Claude)
