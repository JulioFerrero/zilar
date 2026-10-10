---
id: T-1014
title: "Size split T91: apps/web/src/routes/MachinesPage.tsx (473 lines) into components/machines/{machineRowOps,PendingRow,ApprovedRow,RevokedRow}; one useMachineAction, one AddMachineButton"
status: todo
milestone: M5
branch: task/T-1014-split-web-machines-page
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1014: Split `MachinesPage.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/routes/MachinesPage.tsx` is 473 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #87 (task T91). The new files go in `apps/web/src/components/machines/`: `machineRowOps.ts`, `PendingRow.tsx`, `ApprovedRow.tsx` and `RevokedRow.tsx`. The page keeps the load, the section composition and every export it has today.

- **Existing files:** the folder already holds `AddMachineDialog.tsx`, `ApprovedMachineCard.tsx`, `errors.ts`, `MachineListSkeleton.tsx`, `PendingMachineCard.tsx` and `RevokedMachineCard.tsx`. Leave them as they are.
- **In scope:** the in-file Dedup:
  - the three rows' repeated `useAction` + `shownFailure` → `failureText` becomes one `useMachineAction`, in `machineRowOps.ts`;
  - the three "Add machine" buttons become one `AddMachineButton`, in `machineRowOps.ts` or a new `AddMachineButton.tsx`.
- **Same behaviour:** approve, deny, rename, revoke and delete keep their own texts and calls.

The lead checks `/settings/machines` in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #87, and `apps/web/src/routes/MachinesPage.tsx`.

### Allowed files
`apps/web/src/routes/MachinesPage.tsx`, `apps/web/src/components/machines/machineRowOps.ts`, `apps/web/src/components/machines/PendingRow.tsx`, `apps/web/src/components/machines/ApprovedRow.tsx`, `apps/web/src/components/machines/RevokedRow.tsx`, `apps/web/src/components/machines/AddMachineButton.tsx`, `work/T-1014-split-web-machines-page.md`.

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
