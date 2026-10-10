---
id: T-1038
title: "Size split T120: apps/web/src/components/FolderEditorDialog.tsx (404 lines) into components/folder/{folderEditorModel,ChatPicker,FolderIconPicker,FolderHideSection}"
status: todo
milestone: M5
branch: task/T-1038-split-web-folder-editor
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1038: Split `FolderEditorDialog.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/FolderEditorDialog.tsx` is 404 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #116 (task T120). The new files go in a new `apps/web/src/components/folder/` folder: `folderEditorModel.ts`, `ChatPicker.tsx`, `FolderIconPicker.tsx` and `FolderHideSection.tsx`. The dialog keeps every export it has today.

Move the code unchanged; the plan lists no major Dedup.

The lead checks the folder editor in Chrome in mock mode: create a folder, pick an icon, include a chat, and save.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #116, and `apps/web/src/components/FolderEditorDialog.tsx`.

### Allowed files
`apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/folder/folderEditorModel.ts`, `apps/web/src/components/folder/ChatPicker.tsx`, `apps/web/src/components/folder/FolderIconPicker.tsx`, `apps/web/src/components/folder/FolderHideSection.tsx`, `work/T-1038-split-web-folder-editor.md`.

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
