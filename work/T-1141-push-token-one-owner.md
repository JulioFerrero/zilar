---
id: T-1141
title: "Push: a native token belongs to one account — registering an fcm/apns token deletes every other user's row with that token in the same transaction, so an offline sign-out can't leave the old account's wakes going to the next user's phone"
status: merged
milestone: M5
branch: task/T-1141-push-token-one-owner
model: auto
effort: default
depends_on: [T-1139]
estimate: 0.1 day
---

# T-1141: One owner per device token

## Spec (written by Claude, do not edit)

### Why
Found in the T-1139 pre-review (nit 2).

**The failure:**
1. A signs out of the phone app while offline. The best-effort `DELETE /api/push/subscriptions/:id` fails, so A's `fcm` row stays.
2. B signs in on the same phone. FCM tokens are per app install, so B registers **the same token** under B's id.
3. A's new messages now wake a phone signed in as B.

The wake carries no text, but B's phone still learns that A got a message. A device token must belong to one account only.

**What the lead read:** `apps/server/src/push/store.ts` `saveDevice` (`:75`). The native branch (`:96-120`) runs under the per-user advisory lock (`:88`). It reads the stale rows for **the same user** and token (`:101-103`), deletes them (`:104-105`) and inserts the new row. `staleNodes` (`:81`, `:103`) are later passed to `disablePushPair` (`:165`).

### What to build
1. **In the native branch, inside the same transaction and before the insert,** also delete the rows where `token = ${input.token} AND user_id <> ${input.userId}`.
   - Those rows belong to other users. Their nodes must **not** go into `staleNodes`: that `disablePushPair` is for this user's own pairs. The push component already drops a publish for an unknown node.
   - The per-user lock doesn't cover the other user, but the `DELETE` by token is atomic. Two different users registering one token at the same moment end with the last one winning, which is fine.
2. **Logs:** if you add one, log only the count of removed rows, never the token or the other user's id.
3. **Web Push stays unchanged:** endpoints are per browser profile, not shared.
4. **Tests** (keys and the device store), at most 2 added to `apps/server/src/push/store.test.ts`:
   - user B registering a token that user A holds leaves only B's row;
   - user A's other tokens are untouched.

### Read first
`AGENTS.md`, `apps/server/src/push/store.ts:60-170` and `apps/server/src/push/store.test.ts`.

### Allowed files
`apps/server/src/push/store.ts`, `apps/server/src/push/store.test.ts`, `work/T-1141-push-token-one-owner.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/store.test.ts src/push/api-subscribe.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `store.ts` stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did

In the native branch of `saveDevice` (`apps/server/src/push/store.ts`), inside the
same transaction and before the insert, I added a second `DELETE`:

```sql
DELETE FROM push_subscriptions
WHERE token = ${input.token} AND user_id <> ${input.userId}
```

This drops any row another account holds for the same token, so a native token
belongs to one account only. The rows are deliberately **not** added to
`staleNodes`: that list goes to `disablePushPair(input.userId, node)` and is for
this user's own pairs, and the push component already drops a publish for an
unknown node. Web Push is untouched (the endpoint branch is unchanged).

No log line was added: the spec says "if you add one", and this module has no
logger, so I kept the change to the single statement plus a comment.

### Files changed

- `apps/server/src/push/store.ts` — added the cross-user token `DELETE` (11 lines: comment + statement).
- `apps/server/src/push/store.test.ts` — added 2 tests.
- `work/T-1141-push-token-one-owner.md` — front matter + this Report.

`store.ts` is 350 lines (acceptance: at most 400).

### Tests added (2)

- `moves a token to the second account that registers it`: A saves `shared-token`, B
  registers the same token; A has 0 rows and B has the single row B saved.
- `leaves the first account's other tokens untouched`: A has `kept-token` and
  `shared-token`; after B takes `shared-token`, A still has exactly `kept-token`.

Both use the device store and keys helpers already in the file; no external
service, no real keys.

### Commands run (real results)

- `pnpm install` — done in 11.9s, 1180 packages.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/store.test.ts` — 1 file, **8 passed**.
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/push/store.test.ts src/push/api-subscribe.test.ts` — 2 files, **12 passed**.
- `pnpm gate` — first run **GATE FAIL** on `format` (`store.test.ts`, a single-quoted title with an apostrophe); fixed with `pnpm exec prettier --write apps/server/src/push/store.test.ts` (only that one string quote changed). Second run:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (3.3s)
PASS  effect  (0.7s)
PASS  tests @zilar/server  (4.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

All 3 changed files are inside the Allowed files.

### Deviations / problems

- One gate round lost to Prettier only (apostrophe in a test title); no code or
  behaviour change from that.

### Blocked / needs a decision

None. No open questions.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 follow-up, accepted as a note.**
- **`store.ts` (350 lines):** the native branch now deletes `token = X AND user_id <> me` in the same transaction, before the insert. Those rows stay out of `staleNodes`, and nothing is logged.
- **Accepted follow-up:** two accounts registering one token in the same instant could both keep a row. A token belongs to one app install, and that install has one account signed in at a time, so this can't happen in practice.
- **Tests:** the lead ran `store.test.ts` and `api-subscribe.test.ts` on the branch: 12 green, including the two new cross-user cases.
