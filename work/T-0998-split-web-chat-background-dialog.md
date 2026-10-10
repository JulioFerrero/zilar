---
id: T-0998
title: "Size split T66: apps/web/src/components/ChatBackgroundDialog.tsx (555 lines) into components/background/{backgroundOps,backgroundWrites,PresetGrid,BackgroundImages}"
status: todo
milestone: M5
branch: task/T-0998-split-web-chat-background-dialog
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0998: Split `ChatBackgroundDialog.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChatBackgroundDialog.tsx` is 555 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #62 (task T66). The new files go in a new `apps/web/src/components/background/` folder: `backgroundOps.ts`, `backgroundWrites.ts`, `PresetGrid.tsx` and `BackgroundImages.tsx`. `ChatBackgroundDialog.tsx` keeps the dialog and every export it has today. The entry has no Dedup.

The lead checks it in Chrome in mock mode: open a chat's background dialog, pick a preset and save.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #62, and `apps/web/src/components/ChatBackgroundDialog.tsx`.

### Allowed files
`apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/background/backgroundOps.ts`, `apps/web/src/components/background/backgroundWrites.ts`, `apps/web/src/components/background/PresetGrid.tsx`, `apps/web/src/components/background/BackgroundImages.tsx`, `work/T-0998-split-web-chat-background-dialog.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names how to open the dialog, for the lead's Chrome check.

---

## Report (written by the worker when done)

## Review (written by Claude)
