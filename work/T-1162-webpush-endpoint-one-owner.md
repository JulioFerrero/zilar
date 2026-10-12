---
id: T-1162
title: "Push: a Web Push endpoint belongs to one account — registering an endpoint drops any other user's row for the same endpoint (like native tokens since T-1141), so user A's pushes never reach a browser now used by B"
status: merged
milestone: M5
branch: task/T-1162-webpush-endpoint-one-owner
model: auto
effort: default
depends_on: [T-1152]
estimate: 0.1 day
---

# T-1162: One owner per Web Push endpoint

## Spec (written by Claude, do not edit)

### Why
This is the T-1152 review follow-up. Native tokens already have a single owner: `saveDevice` deletes other users' rows for the same token (`apps/server/src/push/store.ts:100`, `WHERE token = ${input.token} AND user_id <> ${input.userId}`). The Web Push branch only deduplicates within the same user (`:159-171`, `WHERE user_id = … AND endpoint = …`).

So when account B signs in on a browser where account A had enabled push, then enables push, A's row for the **same endpoint** stays, and A's messages keep pushing to that browser.

### What to build
1. **In the webpush branch of `saveDevice`**, inside the same transaction and per-user lock: delete rows whose `endpoint` equals the new endpoint and whose `user_id` differs, mirroring `:100`. Those rows are not this user's pairs, so they stay out of `staleNodes`, as in the native branch's comment. `store.ts` is 396 lines: keep it at most 400, and if the comment doesn't fit, shorten neighbouring comments rather than growing the file.
2. **Test** (permissions), one, in `apps/server/src/push/store.test.ts`, next to the existing `moves a token to the second account that registers it` test: the second account registering the same Web Push endpoint leaves exactly one row, owned by the second account.

### Read first
`AGENTS.md`, `apps/server/src/push/store.ts:80-200` and `apps/server/src/push/store.test.ts:100-150`.

### Allowed files
`apps/server/src/push/store.ts`, `apps/server/src/push/store.test.ts`, `work/T-1162-webpush-endpoint-one-owner.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/store.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `store.ts` stays at most 400 lines.

---

## Report (written by the worker when done)

Did: mirrored the native single-owner DELETE into the webpush branch of
`saveDevice` (inside the same transaction, before reading this user's rows),
so a Web Push endpoint belongs to one account; added the permissions test
next to the native `moves a token …` test.

Files changed:
- `apps/server/src/push/store.ts` (webpush branch: endpoint-owner DELETE +
  2-line comment; file now exactly 400 lines)
- `apps/server/src/push/store.test.ts` (new test
  `moves a Web Push endpoint to the second account that registers it`)

Commands (real results):
- `pnpm install`: done in 21.1s
- `pnpm --filter @zilar/server exec vitest run src/push/store.test.ts
  --reporter=dot`: 1 file passed, 10 tests passed (7.00s)
- `pnpm gate`: PASS install (frozen) 1.7s, PASS format 0.7s, PASS lint 1.3s,
  PASS typecheck 3.4s, PASS effect 1.1s, PASS tests @zilar/server 6.4s;
  scope: every changed file inside Allowed files; GATE PASS

Security checklist: the added DELETE is scoped by endpoint + `user_id <>`
(cannot wipe another endpoint, never touches same-user rows that feed
`staleNodes`); runs inside the existing transaction under the per-user
advisory lock; no secrets, routes, caps, or audit entries touched.

Problems / deviations / open questions: none. Spec item 1 placed the DELETE
before the same-user read (like the native branch at :100); verified the
read-after-write still dedups same-user rows and the file stays at 400 lines.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 follow-up.**
- **The change:** the webpush branch of `saveDevice` drops other users' rows for the same endpoint, as the native branch does.
- **Test:** 10 of 10 in the branch, run by the lead.
- **Size:** `store.ts` is exactly 400 lines.
- **Follow-up:** a theoretical cross-user concurrency race, shared with the native branch.
