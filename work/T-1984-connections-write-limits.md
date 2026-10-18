---
id: T-1984
title: "Connections hardening: creating or editing a provider key gets a per-user rate limit (10/min) and a per-user cap (50 keys), like every other write"
status: merged
milestone: M5
branch: task/T-1984-connections-write-limits
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-1984: Limits on connection writes

## Spec (written by Claude, do not edit)

### Why
This is a fix from the lead's private security review of 2026-10-18 (T-1968).
- **The rule.** AGENTS.md asks for a limit or a cap on every write.
- **The gap.** Creating and updating a provider connection have neither. Each create also resolves a host name the user chose.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/connections/`)
- **The API.** `api.ts` (347 lines):
  - `createConnectionsApi` builds a `testLimiter` with `createRateLimiter({ max, windowMs, now })` (`:144-151`);
  - only the `test` route uses that limiter (`:263-265`);
  - create (`:187-215`) decodes the body, checks the base URL, then calls `createConnectionRow(deps.db, ...)`;
  - update is at `:216-250`.
- **The insert.** `service.ts:63-81` (`createConnection`) runs the `INSERT INTO provider_connections` with no count check.

### Steps
1. **Rate limit.** Add a per-user `writeLimiter` in `api.ts`, the same way `testLimiter` is built: 10 per minute, injectable through deps for tests. Use it on create and update, and answer `429 rate_limited` like the other limiters.
2. **Cap.** In `createConnection`, inside the same transaction as the insert, count the user's active rows. At 50 or more, fail with a `409` (`limit_reached`, "You have too many saved keys. Remove one first.").
3. **Tests** (keys are a crucial area): the 11th create in a minute answers 429, and the 51st key answers 409. Use the nearest existing connections test file.
4. **Keep files small.** Every file stays at or under 400 lines (`api.ts` is at 347).

### Allowed files
- `apps/server/src/connections/api.ts`
- `apps/server/src/connections/service.ts`
- `apps/server/src/connections/api.test.ts`
- `apps/server/src/connections/service.test.ts`
- `work/T-1984-connections-write-limits.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/connections --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did
- **Rate limit (10/min).** `apps/server/src/connections/api.ts`: added
  `CONNECTION_WRITE_RATE_LIMIT_MAX = 10` and
  `CONNECTION_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000`, built a `writeLimiter`
  the same way as `testLimiter` (injectable via the new optional
  `ConnectionsApiDependencies.writeLimiter`), and checked it in both the
  `create` and `update` handlers right after `requireCipher()`. Over budget
  answers the usual `429 rate_limited` ("Too many connection changes, try
  again in a minute"). One budget is shared by both writes.
- **Cap (50 active keys).** `apps/server/src/connections/service.ts`: added
  `CONNECTIONS_MAX_PER_USER = 50`; `createConnection` now runs the count and
  the insert in one `sql.withTransaction`, serialized by
  `pg_advisory_xact_lock(hashtext('connections:' + owner))` so two concurrent
  creates cannot both pass the check. It counts the owner's `active` rows and
  fails with `409 limit_reached` ("You have too many saved keys. Remove one
  first.") at 50.
- **Tests.** New `apps/server/src/connections/api.test.ts` (5 tests): 11th
  create is 429 and does not insert, 11th write is 429 when create and update
  share the budget, the 50th key is allowed, the 51st answers 409 with the
  fixed text and inserts nothing, and the cap is per user (another user can
  still create while the first is at 50).

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections/api.test.ts`
  → 5 passed (1 file). A first run had 2 failures caused by a mistake in my own
  test (I passed the response body instead of `body.id`, and compared the error
  body with `toEqual` although it also carries `requestId`); both were fixed in
  the test before the green run.
- `pnpm gate` (repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.1s)
  PASS  lint  (1.7s)
  PASS  typecheck  (4.8s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (11.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (The first `pnpm gate` failed only on Prettier for the new test file; I ran
  `pnpm exec prettier --write` on that one file and the rerun above passed.)

### Notes for the lead
- **Test file choice.** The Allowed files list `api.test.ts`/`service.test.ts`,
  which did not exist, and do not include the nearest existing connections test
  (`update-key.test.ts`), so I created `api.test.ts` and put all five tests
  there. I did not create `service.test.ts`.
- **Injection seam.** `writeLimiter` is injectable at
  `createConnectionsApi` level, as the spec asked, but `AppDependencies.connections`
  in `app/deps.ts` (outside the Allowed files) still forwards only `cipher`,
  `probe` and `logger`, so tests through `createApp` use the real 10/min budget.
  That is enough for the requested tests; if you want a clock/limiter injection
  through `createApp` later, `routes-ai.ts` and `deps.ts` would need widening.
- The cap counts only `status = 'active'` rows, per the spec.


## Review (written by Claude)

Approved.
- **Rate limit.** Create and update share one per-user limiter (10 per minute, injectable), checked before the body is read, and they answer 429 `rate_limited`.
- **Cap.** The cap of 50 is counted inside the insert transaction, under a per-owner advisory lock, so two concurrent creates can't both pass. At the cap the route answers 409 `limit_reached`.
- **Tests and checks.** Tests cover the 11th write and the 51st key. The pre-review is clean.
