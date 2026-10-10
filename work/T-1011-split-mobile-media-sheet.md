---
id: T-1011
title: "Size split T87: apps/mobile/src/components/chat/media-sheet.tsx (491 lines) into chat/{media-rows,media-sheet-content}; one MediaRow shell"
status: todo
milestone: M5
branch: task/T-1011-split-mobile-media-sheet
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1011: Split the mobile media sheet

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/media-sheet.tsx` is 491 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #83 (task T87): `components/chat/media-rows.tsx` and `chat/media-sheet-content.tsx`, under `apps/mobile/src/`. `media-sheet.tsx` keeps the sheet and every export it has today.

- **In scope:** the in-file part of the Dedup. `FileRow`, `LinkRow` and `VoiceRow` share one `MediaRow` shell, and each keeps its own texts and icons.
- **Out of scope:** the `formatFileSize` move, because it crosses files.

The lead runs a phone smoke of a chat's "Media, files and links" sheet in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #83, and `apps/mobile/src/components/chat/media-sheet.tsx`.

### Allowed files
`apps/mobile/src/components/chat/media-sheet.tsx`, `apps/mobile/src/components/chat/media-rows.tsx`, `apps/mobile/src/components/chat/media-sheet-content.tsx`, `work/T-1011-split-mobile-media-sheet.md`.

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
