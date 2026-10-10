---
id: T-1004
title: "Size split T74: apps/mobile/src/app/settings/approvals.tsx (529 lines) into components/approvals/{use-approvals,pending-tab,rules-section}"
status: todo
milestone: M5
branch: task/T-1004-split-mobile-approvals
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1004: Split the mobile approvals screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/approvals.tsx` is 529 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #70 (task T74): `components/approvals/use-approvals.ts`, `approvals/pending-tab.tsx`, `approvals/rules-section.tsx`, under `apps/mobile/src/`.

- **The screen keeps:** `AisScreenShell`, `RevokeConfirmDialog` and its default export.
- **No Dedup:** the entry has none.
- **Existing files:** the folder already holds `always-allowed-row.tsx`, `approval-row.tsx`, `format-relative.ts` and `rows.ts`. Leave them as they are.
- **Same behaviour:** approving, denying and revoking are permissions code. Every call and its arguments stay the same.

The lead runs a phone smoke of `/settings/approvals` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #70, and `apps/mobile/src/app/settings/approvals.tsx`.

### Allowed files
`apps/mobile/src/app/settings/approvals.tsx`, `apps/mobile/src/components/approvals/use-approvals.ts`, `apps/mobile/src/components/approvals/pending-tab.tsx`, `apps/mobile/src/components/approvals/rules-section.tsx`, `work/T-1004-split-mobile-approvals.md`.

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
