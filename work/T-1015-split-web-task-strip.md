---
id: T-1015
title: "Size split T99: apps/web/src/components/TaskStrip.tsx (442 lines) into components/topic/{stripModel,StatusMenu,OwnerMenu,LinkEditor}; one patchLocal"
status: todo
milestone: M5
branch: task/T-1015-split-web-task-strip
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1015: Split `TaskStrip.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/TaskStrip.tsx` is 442 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #95 (task T99). The new files go in a new `apps/web/src/components/topic/` folder: `stripModel.ts`, `StatusMenu.tsx`, `OwnerMenu.tsx` and `LinkEditor.tsx`. `TaskStrip.tsx` keeps the save wiring, the composition and every export it has today.

The in-file Dedup is in scope:
- the optimistic `setState(chats.map(...))` patch in `chooseStatus`, `chooseOwner` and `saveLink` becomes one `patchLocal(topic => …)`;
- the three "close all menus" lines become one helper.

The lead checks it in Chrome in mock mode: a topic's strip, changing its status and owner, and adding a link.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #95, and `apps/web/src/components/TaskStrip.tsx`.

### Allowed files
`apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/topic/stripModel.ts`, `apps/web/src/components/topic/StatusMenu.tsx`, `apps/web/src/components/topic/OwnerMenu.tsx`, `apps/web/src/components/topic/LinkEditor.tsx`, `work/T-1015-split-web-task-strip.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
