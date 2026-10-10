---
id: T-0987
title: "Size split T37: apps/mobile/src/components/chat/message-bubble.tsx (758 lines) into chat/{message-bubble-decor,message-bubble-content,message-bubble-actions,message-bubble-tombstone}; one BubbleInlineMeta"
status: todo
milestone: M5
branch: task/T-0987-split-mobile-message-bubble
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0987: Split the mobile message bubble

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/message-bubble.tsx` is 758 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #33 (task T37): `components/chat/message-bubble-decor.tsx`, `chat/message-bubble-content.tsx`, `chat/message-bubble-actions.tsx`, `chat/message-bubble-tombstone.tsx`, under `apps/mobile/src/`. `message-bubble.tsx` keeps the bubble and every export it has today.

The in-file Dedup is in scope: the markdown-branch meta and the plain-branch meta become one `BubbleInlineMeta`, with the same layout.

The lead runs a phone smoke of a chat in a mock build: text, markdown, an AI bubble and the long-press sheet.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #33, and `apps/mobile/src/components/chat/message-bubble.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-decor.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/message-bubble-tombstone.tsx`, `work/T-0987-split-mobile-message-bubble.md`.

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
