---
id: T-1031
title: "Size split T97: apps/mobile/src/components/chat/message-search.ts (451 lines) into chat/{message-search-format,message-search-scheduler}.ts"
status: todo
milestone: M5
branch: task/T-1031-split-mobile-message-search
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1031: Split the mobile `message-search.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/message-search.ts` is 451 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #93 (task T97): `components/chat/message-search-format.ts` and `chat/message-search-scheduler.ts`, under `apps/mobile/src/`. `message-search.ts` keeps the rest and re-exports every name it exports today.

Move the code unchanged, and skip the Dedup, because it crosses files to `lib/effect/timers.ts`.

The lead runs a phone smoke of the Chats tab search in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #93, and `apps/mobile/src/components/chat/message-search.ts`.

### Allowed files
`apps/mobile/src/components/chat/message-search.ts`, `apps/mobile/src/components/chat/message-search-format.ts`, `apps/mobile/src/components/chat/message-search-scheduler.ts`, `work/T-1031-split-mobile-message-search.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
