---
id: T-1023
title: "Size split T77: apps/server/src/topics/rooms.ts (522 lines) into topics/{room-members,room-sync,room-push}.ts, the old path keeps the deps types and re-exports"
status: merged
milestone: M5
branch: task/T-1023-split-server-topic-rooms
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1023: Split `topics/rooms.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/topics/rooms.ts` is 522 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #73 (task T77): `topics/room-members.ts`, `topics/room-sync.ts`, `topics/room-push.ts`, under `apps/server/src/`. `topics/rooms.ts` keeps `TopicRoomDeps`, `PushUserSyncDeps` and re-exports of every name it exports today. The folder already holds `access.ts`, `ais.ts`, `api.ts`, `members.ts`, `queries.ts`, `roles.ts`, `schemas.ts` and `service.ts`; leave them as they are.

Move the code unchanged, and skip all four Dedup items, because they cross files. This file decides who is a member of each topic's XMPP room, which is permissions code: not one line of its logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #73, and `apps/server/src/topics/rooms.ts`.

### Allowed files
`apps/server/src/topics/rooms.ts`, `apps/server/src/topics/room-members.ts`, `apps/server/src/topics/room-sync.ts`, `apps/server/src/topics/room-push.ts`, `work/T-1023-split-server-topic-rooms.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/topics/rooms.ts` (522 lines) into three modules per `size-plan.md` §2.2 #73, keeping the old path a thin barrel that keeps `TopicRoomDeps`/`PushUserSyncDeps` and re-exports every name it exported before. Code moved verbatim; only module boundaries changed. The four **Dedup** items were skipped, as the spec says (they all cross files).

- `room-members.ts` — `desiredMembers` plus private `readGroupMembers`, `addTopicAiMembers`, `applyChannelAiVoice` (old 20–218).
- `room-sync.ts` — `SyncTopicRoomResult`, `syncTopicRoom`, private `mapRoomError`, and `errorName` (old 220–298, 513–522).
- `room-push.ts` — `syncPushSubscriptions`, `unsubscribeOne`, `PushDeviceHolders`, `pushDeviceHolders`, `nickFor`, `syncPushSubscriptionsForUser`, `visibleRoomLocalparts`, `RoomOptionsReconcileDeps`, `reconcileRoomSubscriptionOptions` (old 300–511).
- `rooms.ts` — barrel: keeps `TopicRoomDeps` and `PushUserSyncDeps`, re-exports the six moved names.

### Files changed

- `apps/server/src/topics/rooms.ts` (modified)
- `apps/server/src/topics/room-members.ts` (new)
- `apps/server/src/topics/room-sync.ts` (new)
- `apps/server/src/topics/room-push.ts` (new)
- `work/T-1023-split-server-topic-rooms.md` (this Report)

### `wc -l` (old and new)

```
522  (old) apps/server/src/topics/rooms.ts   [git show HEAD:...]
 25  apps/server/src/topics/rooms.ts
208  apps/server/src/topics/room-members.ts
 98  apps/server/src/topics/room-sync.ts
217  apps/server/src/topics/room-push.ts
```

Every new file and the barrel is at most 400 lines.

### Export list, before → after

Before (`grep -E '^export'` on old `rooms.ts`): `TopicRoomDeps` (13), `desiredMembers` (52), `SyncTopicRoomResult` (220), `syncTopicRoom` (231), `PushUserSyncDeps` (420), `syncPushSubscriptionsForUser` (433), `RoomOptionsReconcileDeps` (475), `reconcileRoomSubscriptionOptions` (486).

After, the barrel (`rooms.ts`) re-exports exactly those eight names, same kinds:

```
rooms.ts:5   export interface TopicRoomDeps
rooms.ts:12  export interface PushUserSyncDeps
rooms.ts:19  export { desiredMembers } from './room-members'
rooms.ts:20  export { syncTopicRoom, type SyncTopicRoomResult } from './room-sync'
rooms.ts:21  export { reconcileRoomSubscriptionOptions, syncPushSubscriptionsForUser,
                        type RoomOptionsReconcileDeps } from './room-push'
```

Two **new internal exports** were needed by sibling files and are *not* re-exported by the barrel (so the public surface is unchanged): `errorName` (from `room-sync.ts`, used by `room-push.ts`) and `syncPushSubscriptions` (from `room-push.ts`, used by `room-sync.ts`). No `grep -E '^export'` name was lost.

### Deviations and notes

- **Effect ratchet (rule 6).** `room-sync.ts` holds moved `async`/`await`/`try` code but imports no `effect` value, so the map classifies it `needs-effect`; it carries the sanctioned first-line marker `// effect-plain: moved unchanged from apps/server/src/topics/rooms.ts (size split)`. `room-members.ts` and `room-push.ts` import `Effect` as a value (kind `effect`); the barrel is `plain`. Gate printed `PASS effect`.
- **Internal cycle.** `room-sync.ts` imports `syncPushSubscriptions` from `room-push.ts`, and `room-push.ts` imports `errorName` from `room-sync.ts`. Both are hoisted function declarations referenced only inside function bodies, never at module-evaluation time, so the cycle is safe — the same pattern accepted in T-1002 and T-1013. No importer outside this task's files changed.
- No behaviour change: this is permissions/room-membership code, moved line-for-line. No test file was added or edited.

### Commands and results

- `pnpm install` — completed (`Done in 27.6s`, 15 workspace projects).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts src/invite-links/invite-links.test.ts` — 2 files, **43 passed**. These are the nearest tests that load the `./rooms` barrel (via `roles/sync.ts` and `invite-links/join.ts`).
- `pnpm gate` (repo root) — summary:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.9s)
PASS  lint  (1.3s)
PASS  typecheck  (5.1s)
PASS  effect  (1.6s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Security checklist

No logic change, so the checklist is unaffected: no secrets, no new route, no delete/update, no cap or uniqueness rule, no audit entry. Moved verbatim.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `topics/rooms.ts` (522 lines) keeps the deps types and the re-exports (25 lines), plus `room-members` (208), `room-sync` (98) and `room-push` (217).
- **The lead's line check:** the old file's non-import code lines, sorted, against the new files'. No line was lost. The only extras are names inside the multi-line import lists, so the room-membership logic is unchanged.
- **Check:** the gate passed.
