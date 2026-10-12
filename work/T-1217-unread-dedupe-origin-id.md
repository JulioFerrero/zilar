---
id: T-1217
title: "Server unread counts a resent message once: rows of one chat with the same sender and origin id (a client resend after a lost stream-management ack is archived as a second row) bump the unread count only once"
status: merged
milestone: M5
branch: task/T-1217-unread-dedupe-origin-id
model: auto
effort: default
depends_on: [T-1214]
estimate: 0.1 day
---

# T-1217: Count a resent message once

## Spec (written by Claude, do not edit)

### Why
The lead's emulator check (`work/T-1216-delivered-but-stuck-sending.md`) found a resend stored twice:
- A text reached the server just as the network dropped, at 03:42:46Z. Its stream-management ack was lost, and the client resent it under the **same origin id**. ejabberd archived a **second row**, at 03:46:58Z.
- Julio's `/api/chats` unread for that DM went from 3 to 4.
- Resending after an unknown delivery is correct (at-least-once). The server has to count the message once.

Push already skips a repeated origin id per device node (`apps/server/src/push/archive-scan.ts:64,86`, marked in `delivery.ts:256-263`), so push isn't part of this task.

### What to build
1. In `unreadForChats` (`apps/server/src/chats/unread.ts:290-318`), the loop over `page` rows bumps `entry.unread` once per non-own row (`:314-318`). Keep a per-chat `Set` of `kind`, `barePeer`, `nick` and `originId` (the `ArchiveUnreadRow` fields at `:39-48`).
   - A row whose key is already in the set doesn't bump the count again.
   - The preview logic (`:301-312`, first row per chat) is unchanged.
   - Only the count changes; no SQL change.
2. `unread.ts` is 344 lines; keep it at most 400.
3. **Test** (the message pipeline), plus 1, in `apps/server/src/chats/reads.test.ts`, following the existing unread tests there: two archive rows in one DM from the peer with the same origin id give `unread: 1`, while two rows with different origin ids give 2.

### Read first
`AGENTS.md`, `apps/server/src/chats/unread.ts` and `apps/server/src/chats/reads.test.ts`.

### Allowed files
`apps/server/src/chats/unread.ts`, `apps/server/src/chats/reads.test.ts`, `work/T-1217-unread-dedupe-origin-id.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check after deploy:** `/api/chats` answers 200, with `unread` and `lastMessage` present.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/chats/unread.ts`: in `unreadForChats`, the loop over `page` rows now keeps a per-chat `Set<string>` of counted-row keys (`kind`, `barePeer`, `nick`, `originId`, NUL-joined). A non-own row whose key is already in the set no longer bumps `unread`. A resent message archived twice under the same origin id therefore counts once; distinct origin ids still each count. Only the count changed — the preview (first row per chat) and the SQL are untouched.
- `apps/server/src/chats/reads.test.ts`: added one test, `counts a resent message once per chat`, that seeds two DMs from the peer after a mark: two rows with the same origin id (`unread: 1`, preview shows the newest row) and two rows with different origin ids (`unread: 2`).

### Files changed
- `apps/server/src/chats/unread.ts`
- `apps/server/src/chats/reads.test.ts`
- `work/T-1217-unread-dedupe-origin-id.md` (front matter status/report)

### Commands and real results
- `pnpm install`: Done in 9.9s (only peer-dependency warnings for `apps/mobile`, pre-existing).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/reads.test.ts`: Test Files 1 passed (1), Tests 8 passed (8), Duration 10.54s.
- `pnpm gate`: `GATE PASS`; summary lines: `PASS install (frozen) (1.1s)`, `PASS format (0.7s)`, `PASS lint (0.9s)`, `PASS typecheck (3.7s)`, `PASS effect (0.9s)`, `PASS tests @zilar/server (10.8s)`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`.

### Problems / deviations
- None. `unread.ts` is now 351 lines, within the 400 limit.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **The change:** `unreadForChats` keeps a per-chat set of `kind`, `barePeer`, `nick` and `originId`, so a repeated non-own row doesn't bump the count again. The preview and the SQL are unchanged.
- **Lead checks:** server `reads.test.ts` 8 of 8; server `tsc` gives 0 errors.
- **Still to do after deploy:** `/api/chats` answers 200 with `unread` and `lastMessage`. Julio's Claude Test DM should now count the duplicated "Offline two" once.
