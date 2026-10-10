---
id: T-1013
title: "Size split T95: apps/mobile/src/components/chat/gif-panel.tsx (461 lines) into chat/{gif-cells,gif-paging,gif-panel-sheet}"
status: todo
milestone: M5
branch: task/T-1013-split-mobile-gif-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1013: Split the mobile GIF panel

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/gif-panel.tsx` is 461 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #91 (task T95): `components/chat/gif-cells.tsx`, `chat/gif-paging.ts`, `chat/gif-panel-sheet.tsx`, under `apps/mobile/src/`. `gif-panel.tsx` keeps the panel and every export it has today.

- **Move unchanged:** move the code as it is, and skip the Dedup. `panel-sheet.tsx` is shared with `sticker-panel.tsx`, so it crosses files.

The lead runs a phone smoke of the composer's GIF tab in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #91, and `apps/mobile/src/components/chat/gif-panel.tsx`.

### Allowed files
`apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/chat/gif-cells.tsx`, `apps/mobile/src/components/chat/gif-paging.ts`, `apps/mobile/src/components/chat/gif-panel-sheet.tsx`, `work/T-1013-split-mobile-gif-panel.md`.

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
