---
id: T-1007
title: "Size split T81: apps/web/src/components/AvatarUploader.tsx (514 lines) into components/avatar/{avatarImageCodec,avatarErrors,CropDialog}; one applyCrop"
status: todo
milestone: M5
branch: task/T-1007-split-web-avatar-uploader
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1007: Split `AvatarUploader.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/AvatarUploader.tsx` is 514 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #77 (task T81). The new files go in a new `apps/web/src/components/avatar/` folder: `avatarImageCodec.ts`, `avatarErrors.ts` and `CropDialog.tsx`. `AvatarUploader.tsx` keeps pick, save and remove, the section shell, and every export it has today.

The in-file Dedup is in scope: the three crop clamps (the `pick` reset, `onPointerMove` and the zoom change) become one `applyCrop(state)`, with the same bounds.

The lead checks it in Chrome in mock mode, on the Profile page's picture section.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #77, and `apps/web/src/components/AvatarUploader.tsx`.

### Allowed files
`apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/avatar/avatarImageCodec.ts`, `apps/web/src/components/avatar/avatarErrors.ts`, `apps/web/src/components/avatar/CropDialog.tsx`, `work/T-1007-split-web-avatar-uploader.md`.

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
