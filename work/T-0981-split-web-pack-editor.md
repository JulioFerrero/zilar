---
id: T-0981
title: "Size split T31: apps/web/src/components/PackEditor.tsx (783 lines) into components/sticker/{packEditorModel,BlobPreview,PackEditorForm,PackEditorItems,usePackSave}"
status: todo
milestone: M5
branch: task/T-0981-split-web-pack-editor
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0981: Split `PackEditor.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/PackEditor.tsx` is 783 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #27 (task T31). The new files go in a new `apps/web/src/components/sticker/` folder:
- `packEditorModel.ts`, `usePackSave.ts`;
- `BlobPreview.tsx`, `PackEditorForm.tsx`, `PackEditorItems.tsx`.

`PackEditor.tsx` keeps the `PackEditor` component and every export it has today.

The in-file Dedup is in scope:
- `setEmoji` and `retryItem` use `updateRow`;
- `moveItem` and the drop handler share one move helper.

The behaviour must stay the same. T-0982 splits `StickersPage.tsx` into the same new folder at the same time; touch only your own file names.

The lead checks it in Chrome in mock mode: create a pack, add a sticker, set its emoji, reorder, then save.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #27, and `apps/web/src/components/PackEditor.tsx`.

### Allowed files
`apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/sticker/packEditorModel.ts`, `apps/web/src/components/sticker/BlobPreview.tsx`, `apps/web/src/components/sticker/PackEditorForm.tsx`, `apps/web/src/components/sticker/PackEditorItems.tsx`, `apps/web/src/components/sticker/usePackSave.ts`, `work/T-0981-split-web-pack-editor.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
