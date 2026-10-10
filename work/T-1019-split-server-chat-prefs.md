---
id: T-1019
title: "Size split T98: apps/server/src/chat-prefs/service.ts (445 lines) into chat-prefs/{access,backgrounds}.ts, the old path keeps the rest and re-exports"
status: todo
milestone: M5
branch: task/T-1019-split-server-chat-prefs
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1019: Split `chat-prefs/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/chat-prefs/service.ts` is 445 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #94 (task T98): `chat-prefs/access.ts` and `chat-prefs/backgrounds.ts`, under `apps/server/src/`. `chat-prefs/service.ts` keeps the constants, the view, `listChatPrefs`, `putChatPref`, and re-exports of every name it exports today.

Move the code unchanged, and skip the Dedup, because it crosses files to `effect/sql.ts`. `canSeeRoomJid`, `canDm` and `requireChatAccess` decide who may set prefs on which chat, which is permissions code: not one line of it changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #94, and `apps/server/src/chat-prefs/service.ts`.

### Allowed files
`apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/access.ts`, `apps/server/src/chat-prefs/backgrounds.ts`, `work/T-1019-split-server-chat-prefs.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
