---
id: T-0995
title: "Size split T41: apps/mobile/src/app/settings/machines.tsx (717 lines) into components/machines/{mutations,use-machines-list,machines-header,pending-machines,approved-machines,revoked-machines,machine-card,add-machine-sheet}"
status: todo
milestone: M5
branch: task/T-0995-split-mobile-machines
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0995: Split the mobile machines screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/machines.tsx` is 717 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #37 (task T41). The eight new files go in `apps/mobile/src/components/machines/`:
- `mutations.ts`, `use-machines-list.ts`;
- `machines-header.tsx`, `pending-machines.tsx`, `approved-machines.tsx`, `revoked-machines.tsx`, `machine-card.tsx`, `add-machine-sheet.tsx`.

The screen keeps the header, the ScrollView, the ConfirmDialog and its default export.

- **Existing files:** the folder already holds `errors.ts`, `machine-change.ts`, `machines-mock.ts` and `use-machines-api.ts`. Leave them as they are.
- **In scope:** the in-file Dedup. `machine-card.tsx` is the one row that all three sections use, with each section's own buttons and texts.
- **Out of scope:** the `row-errors` item, because it crosses files to `connections.tsx`.

The lead runs a phone smoke of `/settings/machines` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #37, and `apps/mobile/src/app/settings/machines.tsx`.

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/machines/mutations.ts`, `apps/mobile/src/components/machines/use-machines-list.ts`, `apps/mobile/src/components/machines/machines-header.tsx`, `apps/mobile/src/components/machines/pending-machines.tsx`, `apps/mobile/src/components/machines/approved-machines.tsx`, `apps/mobile/src/components/machines/revoked-machines.tsx`, `apps/mobile/src/components/machines/machine-card.tsx`, `apps/mobile/src/components/machines/add-machine-sheet.tsx`, `work/T-0995-split-mobile-machines.md`.

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
