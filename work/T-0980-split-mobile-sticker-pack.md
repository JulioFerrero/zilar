---
id: T-0980
title: "Size split T24: apps/mobile/src/app/settings/sticker-pack.tsx (859 lines) into components/stickers/{use-pack-editor,pack-visibility-field,pack-saved-grid,pack-fresh-list,pack-actions}; one VisibilityOption"
status: todo
milestone: M5
branch: task/T-0980-split-mobile-sticker-pack
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0980: Split the mobile sticker pack screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/sticker-pack.tsx` is 859 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #20 (task T24): `components/stickers/use-pack-editor.ts`, `stickers/pack-visibility-field.tsx`, `stickers/pack-saved-grid.tsx`, `stickers/pack-fresh-list.tsx`, `stickers/pack-actions.tsx`, under `apps/mobile/src/`. The route file keeps its default export, the shell and the load states.

- **One more split:** `use-pack-editor.ts` would be about 400 lines from the plan's range 85–484. If it goes over 400, split it once more (`split-rules.md` item 4), for example into `use-pack-editor.ts` plus `use-pack-items.ts`, and name the new file in the Report.
- **In scope:** the in-file Dedup, one `VisibilityOption` for the two duplicated radios.
- **Out of scope:** `use-session-token.ts`, because it is shared with `stickers.tsx` and so crosses files.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #20, and `apps/mobile/src/app/settings/sticker-pack.tsx`.

### Allowed files
`apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/components/stickers/use-pack-editor.ts`, `apps/mobile/src/components/stickers/use-pack-items.ts`, `apps/mobile/src/components/stickers/pack-visibility-field.tsx`, `apps/mobile/src/components/stickers/pack-saved-grid.tsx`, `apps/mobile/src/components/stickers/pack-fresh-list.tsx`, `apps/mobile/src/components/stickers/pack-actions.tsx`, `work/T-0980-split-mobile-sticker-pack.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for. The lead runs a phone smoke of `/settings/sticker-pack` in a mock build.

---

## Report (written by the worker when done)

## Review (written by Claude)
