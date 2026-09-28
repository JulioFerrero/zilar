---
id: T-0035
title: Server follow-ups — rate-limit the Test-key route, readable name for unnamed contacts
status: todo
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

## Review (written by Claude)
