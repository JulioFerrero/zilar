---
id: T-1023
title: "Size split T77: apps/server/src/topics/rooms.ts (522 lines) into topics/{room-members,room-sync,room-push}.ts, the old path keeps the deps types and re-exports"
status: todo
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

## Review (written by Claude)
