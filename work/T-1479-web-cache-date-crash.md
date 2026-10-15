---
id: T-1479
title: "URGENT live fix: web goes blank on reload when the cached chat list holds a row with createdAt/pinnedAt (JSON strings, not Dates): rehydrate both in the web cache, and make chatSortTime tolerate a string date"
status: merged
milestone: M5
branch: task/T-1479-web-cache-date-crash
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1479: Cached dates crash the web list

## Spec (written by Claude, do not edit)

### Why
**Production web can go blank on reload.**
- Web paints the cached chat list at start (`apps/web/src/store/effects/lifecycle.ts:127-133`).
- The cache read turns `lastMessage.createdAt` back into a `Date` but leaves the row's own `createdAt` and `pinnedAt` as strings (`apps/web/src/store/chatListCache.ts:67-80`).
- Since T-1476 (live), `groupChats` calls `chatSortTime` on every row. A group whose General has no message reaches `chat.createdAt?.getTime()`, and that throws on a string.
- The lead reproduced it headless on main `66299e827`: a cached group General row with `createdAt: '2026-10-01T10:00:00.000Z'` and no `lastMessage` gives `TypeError: chat.createdAt?.getTime is not a function` and a blank page.
- `pinnedAt` has the same gap (`groupPinTime`, `apps/web/src/store/chatGroups.ts`, and `sortTopics` call `pinnedAt?.getTime()`).

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/store/chatListCache.ts:67-80`:** `readChatListCache` copies the rest of each row as is, and rehydrates only `lastMessage.createdAt`.
- **`packages/chat-core/src/topics.ts:9-13`:** `chatSortTime` returns `chat.lastMessage?.createdAt.getTime() ?? chat.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY`.
- **`ChatSummary`'s `Date` fields** are `pinnedAt`, `createdAt` and `lastSeenAt` (`packages/chat-core/src/types.ts`); the cache already drops `lastSeenAt`.
- **The mobile cache has the same gap.** T-1474 (running) fixes it in `apps/mobile/src/lib/chat-list-cache.ts`. **Do not touch that file.**

### What to build
1. **`chatListCache.ts`:** on read, turn `createdAt` and `pinnedAt` into `Date`s when they are valid date strings, and drop them when they are not (like `lastMessage.createdAt`).
2. **`packages/chat-core/src/topics.ts`:** `chatSortTime` tolerates a non-`Date` value.
   - Use a small private helper: a `Date` gives `getTime()`; a string gives `Date.parse`, falling back to `-Infinity` when that is `NaN`; anything else gives `-Infinity`.
   - Apply it to both `lastMessage.createdAt` and `createdAt`. It is a defence, so a future cache gap never blanks the app.
3. Nothing else changes.

### Tests
One case in the nearest existing chat-core test file for `chatSortTime` (create `packages/chat-core/src/topics.test.ts` if none exists): a row with a string `createdAt` and no `lastMessage` sorts by that time and does not throw. The chat list is part of the message pipeline.

### Allowed files
- `apps/web/src/store/chatListCache.ts`
- `packages/chat-core/src/topics.ts`, `packages/chat-core/src/topics.test.ts`
- `work/T-1479-web-cache-date-crash.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/topics.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's headless reproduction (a cached empty-General row with a string `createdAt`) shows the list, with no page error.
- Live after the deploy.

---

## Report (written by the worker when done)

### What I did

1. `apps/web/src/store/chatListCache.ts` — `readChatListCache` now pulls `createdAt`
   and `pinnedAt` out of each cached row and runs them through a small private
   `rehydrateDate(value)`: a valid date string becomes a `Date`; anything else
   (non-string, or an unparsable string) is dropped, i.e. the field stays absent,
   matching what the read already does for `lastMessage.createdAt`.
2. `packages/chat-core/src/topics.ts` — added a private `sortStamp(value)` helper:
   a `Date` gives `getTime()`, a string gives `Date.parse` (or `-Infinity` when
   that is `NaN`), anything else gives `-Infinity`. `chatSortTime` now applies it
   to `lastMessage.createdAt` (when a message exists) and to `createdAt`, so a
   leftover string no longer throws.
3. `packages/chat-core/src/topics.test.ts` (new; no existing chat-core test
   covered `chatSortTime`) — one case: two message-less rows whose `createdAt`
   are strings sort by that time (newer first) and `chatSortTime` returns the
   parsed milliseconds without throwing.

Nothing else changed. `sortTopics`/`groupPinTime` still call `pinnedAt?.getTime()`;
that path is fixed by the rehydration in item 1 (the cache is the only place a
`pinnedAt` string can reach them), which is what the spec asked for.

### Files changed (4, all inside Allowed files)

- `apps/web/src/store/chatListCache.ts`
- `packages/chat-core/src/topics.ts`
- `packages/chat-core/src/topics.test.ts` (new)
- `work/T-1479-web-cache-date-crash.md`

### Commands and real results

- `pnpm install`: done, 11.6s.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/topics.test.ts`:
  `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` (repo root): exit 0, ended with `GATE PASS`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/web  (4.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Problems / deviations

- None. The lead's headless reproduction and the live check cannot be run from this
  worktree; I verified the fix at the unit level (string `createdAt`, no
  `lastMessage`, no throw, correct order) and via the gate's typecheck and the
  web + chat-core test runs.

### Open questions

- None.

## Review (written by Claude)
Lead, 2026-10-15: approved, urgent live fix. Pre-review CLEAN, nit 0.
- **The headless reproduction** (a cached empty-General row with a string `createdAt`):
  - main with T-1476: blank page, `TypeError: chat.createdAt?.getTime is not a function`;
  - this branch: the list renders, with 0 page errors.
- The new `topics.test.ts` passes.
- **Also carried:** two lead pitfalls in `docs/LEAD_HANDOFF.md` (check list changes with a cached list on reload; never subtract two `-Infinity` values in a comparator).
