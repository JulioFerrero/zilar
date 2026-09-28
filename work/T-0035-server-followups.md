---
id: T-0035
title: Server follow-ups — rate-limit the Test-key route, readable name for unnamed contacts
status: blocked
milestone: M2
branch: task/T-0035-server-followups
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0028]
estimate: 0.5 day
---

# T-0035: Two small server follow-ups from the board

## Spec (written by Claude, do not edit)

### Goal

These are two follow-ups from `work/BOARD.md` that real users would hit. Both are small and server-only.

1. **`POST /api/connections/:id/test` calls the provider on every request.** A signed-in user can loop on it and hammer a provider with a stored key. That could get the owner's key rate-limited or flagged by the provider, and it costs requests. This comes from the T-0028 review.
2. **Users with an empty name show as blank rows in the chat list.** The lead saw 4 of them live during the T-0032 review. Users who signed in with an email code but never set a name have `user.name = ''`. `listContacts` passes that straight through, so `/api/chats` gives them `title: ''` and the web shows a row with no text.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/xmpp/routes.ts`: `createRateLimiter`, the in-memory, per-user, per-process limiter, and how it's injected (`now`) and tested.
- `apps/server/src/connections/routes.ts` and its test: the `/test` route.
- `apps/server/src/contacts/service.ts`: `listContacts`, plus its tests.
- `apps/web/src/routes/ConnectionsPage.tsx`: it already maps a 429 to a rate-limit message. Check this and say so in the Report; don't change the web.

### Allowed files
- `apps/server/src/rate-limit.ts` (new) and its test. Move `createRateLimiter` here so both routes share it, parameterized by `max` and `windowMs`.
- `apps/server/src/xmpp/routes.ts`: only to import the shared limiter instead of its own copy. Its behaviour and limits must not change, and its existing tests must still pass unchanged.
- `apps/server/src/connections/routes.ts` and its test
- `apps/server/src/contacts/service.ts` and its test
- `work/T-0035-server-followups.md`

**Not allowed:**
- `apps/server/src/chats/**`, `ais/**`, `ai/**` and `db/**`. Another task (T-0033) is changing these right now.
- `apps/web/**`
- `apps/mobile/**`
- `packages/**`
- `infra/**`
- `docs/**`

### Allowed dependencies
None.

### What to build

**1. A shared limiter** (`apps/server/src/rate-limit.ts`)
- `createRateLimiter({ max, windowMs, now })` returns `{ allow(key): boolean }`. It's the same sliding-window logic as today, moved here.
- Keep the comment about it being per process.
- `xmpp/routes.ts` uses it with its current constants, so its behaviour is identical.
- Also prune empty keys, so the map doesn't grow forever with one entry per user who ever called. Keep that change minimal and tested.

**2. Rate-limit the Test-key route**
- Per **user id**: at most **5 tests per minute**. Put the constants at the top of the file with a one-line why.
- Over the limit, return `429` `rate_limited` with the message "Too many key tests, try again in a minute".
- The check happens **before** decrypting the key or calling the provider. A test must prove the provider probe isn't called when limited.
- The limit is per user, not per connection: one user rotating through many connections is still capped.

**3. A readable name for unnamed contacts** (`listContacts`)
- When `user.name` is empty or whitespace-only, return the name `Unnamed user`.
- **Don't** fall back to the email or any part of it. A contact's email must not leak into another user's chat list.
- Order: `listContacts` sorts by `user.name` in SQL, so unnamed users currently sort first. Make them sort **after** named contacts, and keep the order stable.
- Tests:
  - a contact with `name: ''` and one with `name: '   '` both come back as `Unnamed user`;
  - no field of the result contains the contact's email;
  - named contacts keep their names and their order.

### Tests (Vitest, no real network)
- The limiter: allows up to `max`, blocks after that, allows again once the window has passed (with an injected `now`), and prunes empty keys.
- The Test-key route:
  - the 6th call inside a minute returns 429 `rate_limited`, and the probe isn't called;
  - another user isn't affected;
  - calls work again after the window.
- The XMPP token route's existing limiter tests pass unchanged.
- `listContacts`: see item 3.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] Only the Allowed files changed. Verify with `git diff --name-only main...HEAD`.
- [ ] A 429 response never reaches the provider.
- [ ] No email appears in any contact or chat-list field.
- [ ] The Report states the real command results.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Making sign-up require a name. That's a product decision and belongs to a separate task.
- A shared limiter across processes (Redis or similar).
- Any web change.

## Report (written by the worker when done)

### What I did
1. **Shared limiter** (`apps/server/src/rate-limit.ts`, new): moved the sliding-window
   `createRateLimiter` here as `createRateLimiter({ max, windowMs, now })`, keeping the
   per-process comment. It calls `now()` once per `allow()` and prunes keys whose entries
   all fell out of the window on every call, so the map can't grow forever.
2. **`apps/server/src/xmpp/routes.ts`**: deleted its local limiter, imports the shared one
   with the same constants (`30` per `10 min`). Behaviour unchanged.
3. **`apps/server/src/connections/routes.ts`**: added `CONNECTION_TEST_RATE_LIMIT_MAX = 5`
   / `CONNECTION_TEST_RATE_LIMIT_WINDOW_MS = 60_000` at the top with a one-line why, plus an
   optional `now` dependency (mirrors the XMPP route; defaults to `Date.now`, `app.ts`
   untouched). `POST /connections/:id/test` now checks `testLimiter.allow(user.id)` after
   the session/cipher/owned-connection checks and **before** decrypt or provider probe,
   throwing `429 rate_limited` / `Too many key tests, try again in a minute`. Only real
   provider-bound tests consume quota; 404/503 precedence is preserved.
4. **`apps/server/src/contacts/service.ts`**: `listContacts` maps empty/whitespace-only
   names to exported `UNNAMED_CONTACT_NAME = 'Unnamed user'` (never the email), then moves
   unnamed contacts after named ones with a stable partition (SQL `orderBy` untouched).

### Web 429 check (spec asked for this)
`apps/web/src/routes/ConnectionsPage.tsx` has **no** dedicated 429 branch. Its local
`request()` throws `Error(server message)` for any non-OK status and `testConnection`
displays `error.message`, so the 429's message ("Too many key tests, try again in a
minute") already surfaces in the UI. No web change needed (web is out of scope anyway).
The only 429-specific UI mapping in web is auth-only (`AuthFlow.tsx`).

### Deviations from the spec (all additive, behaviour as specified)
- Limiter returns `{ allow, size }`, not exactly `{ allow }`: `size` (keys tracked) is the
  only way to observe pruning in a test. `allow` semantics match the spec.
- `ConnectionsRoutesDependencies` gained optional `now` so the window-expiry route test
  doesn't wait 60 s or mock the global clock. Prod path uses `Date.now`.
- `listContacts` tracks blankness with a flag, so a user literally named "Unnamed user"
  would still sort among named contacts.

### Files changed
- `apps/server/src/rate-limit.ts` (new) + `apps/server/src/rate-limit.test.ts` (new)
- `apps/server/src/xmpp/routes.ts` (import shared limiter only)
- `apps/server/src/connections/routes.ts` + `routes.test.ts` (limit + 3 tests)
- `apps/server/src/contacts/service.ts` + `contacts.test.ts` (unnamed fallback + 1 test)

### Command results (real)
- `pnpm install`: ok (32.8 s).
- `pnpm format:check`: first run warned on 3 files; after `prettier --write`,
  "All matched files use Prettier code style!".
- `pnpm lint` (oxlint): pass, no warnings.
- `pnpm typecheck` (turbo, 9 tasks): pass.
- Targeted: `rate-limit.test.ts` 6/6 pass; `contacts.test.ts` 8/8 pass;
  `connections/routes.test.ts` 16/16 pass; `xmpp/routes.test.ts` 8/8 pass unchanged.
  (One iteration of the connections window test failed first: my bare `Hono` test app
  lacked `createApp`'s `HttpError` mapping so the 429 surfaced as 500. Fixed by adding a
  minimal `onError` in that one test only; prod code untouched.)
- `pnpm exec turbo test --force --filter=@galena/server`: **262 passed, 5 skipped,
  1 failed**. The failure is `src/chats/chats.test.ts > returns my DMs and groups…`:
  `expected title "" but got "Unnamed user"` — the intended new behaviour (see Blocked).
  A direct full-file `vitest run` (not a Checks command) additionally showed load-related
  hook timeouts scattered across unrelated files; all of those pass on re-run / in the
  turbo run, so they are parallel-PGlite flakes, except the deterministic chats one.
- `pnpm build`: pass (2 tasks successful; `@galena/server` has no build script).

### Blocked / needs a decision
`GET /api/chats` builds DM titles directly from `listContacts` (`chats/routes.ts:37-43`),
so the spec's own goal ("`/api/chats` gives them `title: ''`") is fixed by my change —
but `chats/chats.test.ts:73-78` still expects the old blank title via the stored name.
That file is under `apps/server/src/chats/**`, which is **not allowed** for me (T-0033 is
changing it). Question for the lead: **may I update that one stale expectation
(`title: ''` → `'Unnamed user'`), or will you / T-0033 handle it at merge?** I changed
nothing under `chats/**`. Until that line is updated, the `turbo test` check cannot go
fully green through no fault of the in-scope code.

## Review (written by Claude)
