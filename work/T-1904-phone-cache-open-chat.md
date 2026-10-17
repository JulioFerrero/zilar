---
id: T-1904
title: "Smooth app task 5: the phone's offline message cache keeps 50 chats (was 30) and always includes the chat currently open, so topics and notification-opened chats start from the local copy"
status: merged
milestone: M5
branch: task/T-1904-phone-cache-open-chat
model: auto
effort: default
depends_on: [T-1901]
estimate: 25 min
---

# T-1904: The phone caches more chats, and always the open one

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §3 "Phone" and §5 task 5.** The phone cache keeps the newest messages of the first 30 rows in display order. Every topic is its own row and pinned groups come first, so the topic someone is about to open often falls outside it. A chat opened from a notification outside the window isn't cached at all.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/store/offline-cache.ts`** (328 lines): `MAX_CACHED_CHATS = 30` (`:23`). `offlineSnapshot(userId, chats, messagesByChat)` (`:183`) takes `chats.slice(0, MAX_CACHED_CHATS)` (`:192`).
- **`apps/mobile/src/store/offline-cache-sync.ts:42`** calls `offlineSnapshot(state.me?.id, state.chats, state.messagesByChat)`.
- **`getActiveChatId(): string | null`** (`apps/mobile/src/lib/push/active-chat.ts:16`) is the chat the app currently shows.
- **The tests** are `apps/mobile/src/store/offline-cache.test.ts`.

### Steps
1. **`offline-cache.ts`:**
   - `MAX_CACHED_CHATS = 50`;
   - `offlineSnapshot` gains an optional 4th parameter `activeChatId?: string | null`;
   - when it is set, names a chat in `chats` and is outside the first 50, include that chat too, so 51 at most. The order is unchanged otherwise.
2. **`offline-cache-sync.ts`:** pass `getActiveChatId()`.
3. **Tests:** in `offline-cache.test.ts`, one test that a 60-chat list with the active chat at index 55 includes it. Update any test that assumes 30.
4. **Size:** files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/store/offline-cache.ts`
- `apps/mobile/src/store/offline-cache-sync.ts`
- `apps/mobile/src/store/offline-cache.test.ts`
- `work/T-1904-phone-cache-open-chat.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/store/offline-cache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The cache keeps up to 50 chats plus the open one.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `offline-cache.ts`: `MAX_CACHED_CHATS` is now 50; `offlineSnapshot` takes an optional 4th
  parameter `activeChatId?: string | null` and, when that chat is in `chats` but outside the
  first 50, appends it after the window (51 entries at most). The rest of the order is
  unchanged. The file/function comments now say 50 and mention the open chat.
- `offline-cache-sync.ts`: the store subscription passes `getActiveChatId()`.
- `offline-cache.test.ts`: added one test with 60 chat rows and the active chat at index 55;
  it asserts the snapshot keys are the first 50 rows followed by `c-55`. No existing test
  assumed 30. Added a small `chatRow` helper for the test's `ChatSummary` fixtures.
- Files stay under 400 lines (offline-cache.ts 350, test 270, sync 55).

### Checks run
- `pnpm install --silent`: no output (already installed).
- `pnpm --filter @zilar/mobile exec vitest run src/store/offline-cache.test.ts --reporter=dot --maxWorkers=2`:
  1 file passed, 6 tests passed.
- `pnpm gate`: the first run failed only on Prettier in `offline-cache.test.ts`. I ran
  `pnpm exec prettier --write` on that file and the next run passed. After filling in this
  Report I ran `pnpm gate` again on the final tree; it also ended with `GATE PASS`. Summary
  lines of the final run:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.6s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/mobile  (5.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The open chat is appended at the end of the cached set (the first 50 keep their order), since
  it is outside the display window. It is only cached when `messagesByChat` already has rows
  for it, the same rule as every other chat.
- `getActiveChatId()` is read when the store changes; the task spec only asks to pass it, so a
  chat that is opened without a following store change is picked up on the next change.
- Followed the security checklist: this change stores no new data, only raises a local cap from
  30 to 50 and adds the already-open chat; no logs, routes, queries or secrets are touched.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `f20115381`.
- **The change:** `cachedChats` keeps the first 50 chats in display order, plus the open chat when it falls outside them.
- **The ids match:** `getActiveChatId()` mirrors the store's `activeChatId`, which uses the same ids as `chat.id`.
- **Tests:** one new test covers the active chat at index 55.

