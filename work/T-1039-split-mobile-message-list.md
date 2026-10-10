---
id: T-1039
title: "Size split T114: apps/mobile/src/components/chat/message-list.tsx (418 lines) into chat/{use-stable-handlers,use-message-list-scroll,message-list-row}"
status: todo
milestone: M5
branch: task/T-1039-split-mobile-message-list
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1039: Split the mobile `message-list.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/message-list.tsx` is 418 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #110 (task T114): `components/chat/use-stable-handlers.ts`, `chat/use-message-list-scroll.ts` and `chat/message-list-row.tsx`, under `apps/mobile/src/`. `message-list.tsx` keeps the list and every export it has today.

Move the code unchanged, and skip the Dedup, because it crosses files to `lib/effect/timers.ts`. The scroll behaviour stays the same: it keeps the bottom pinned on new messages, loads older messages near the top, and jumps to a message.

The lead runs a phone smoke of scrolling a chat in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #110, and `apps/mobile/src/components/chat/message-list.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-stable-handlers.ts`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/message-list-row.tsx`, `work/T-1039-split-mobile-message-list.md`.

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
