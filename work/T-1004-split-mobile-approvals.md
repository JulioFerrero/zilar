---
id: T-1004
title: "Size split T74: apps/mobile/src/app/settings/approvals.tsx (529 lines) into components/approvals/{use-approvals,pending-tab,rules-section}"
status: merged
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

**Status:** review

### What I did

Split `apps/mobile/src/app/settings/approvals.tsx` (529 lines) into a thin screen plus three files under `apps/mobile/src/components/approvals/`, following `docs/audit/size-plan.md` §2.3 #70 and `docs/audit/split-rules.md`. Code was moved unchanged; no behaviour change, no dedup (the plan entry has none).

- The screen (`approvals.tsx`) keeps `AisScreenShell`, `RevokeConfirmDialog`, the default export `ApprovalsScreen` and the `OwnedRule` re-export.
- `use-approvals.ts` holds the state and actions (load, decisions, revoke flow, clock, notice) behind `useApprovals()`.
- `pending-tab.tsx` holds `PendingTab` plus its private `DecidingRow`.
- `rules-section.tsx` holds `RulesSection`.

`LoadStatus` moved to `use-approvals.ts` (exported) because `rules-section.tsx` needs it; the screen no longer uses it directly. That is the only name added to the module surface. The existing files in the folder (`always-allowed-row.tsx`, `approval-row.tsx`, `format-relative.ts`, `rows.ts`) were not touched.

### Files changed (`wc -l`)

| File | lines |
| --- | --- |
| `apps/mobile/src/app/settings/approvals.tsx` (before, main) | 529 |
| `apps/mobile/src/app/settings/approvals.tsx` (after) | 114 |
| `apps/mobile/src/components/approvals/use-approvals.ts` | 347 |
| `apps/mobile/src/components/approvals/pending-tab.tsx` | 80 |
| `apps/mobile/src/components/approvals/rules-section.tsx` | 66 |

All new files and the screen are under 400 lines. `work/T-1004-split-mobile-approvals.md` is also changed (this Report and the status).

### Export diff

Before (`git show main:apps/mobile/src/app/settings/approvals.tsx | grep -E "^export"`):

```
export type OwnedRule = OwnedScreenRule;
export default function ApprovalsScreen() {
```

After (`grep -E "^export"` on the screen and the three new files):

```
approvals.tsx     export type { OwnedRule } from '@/components/approvals/use-approvals';
approvals.tsx     export default function ApprovalsScreen() {
use-approvals.ts  export type LoadStatus = 'loading' | 'ready' | 'error';
use-approvals.ts  export type OwnedRule = OwnedScreenRule;
use-approvals.ts  export function useApprovals() { … }
pending-tab.tsx   export function PendingTab({ … })
rules-section.tsx export function RulesSection({ … })
```

`OwnedRule` (type) and the default export keep the same names and kinds from the same original path. No importer changes: only `apps/mobile/src/lib/settings-items.ts` referenced the route (by `href`), and nothing imports `OwnedRule`.

### Checks and commands

- `pnpm install` — done, no errors (only the pre-existing peer-dependency warning for `@types/react-dom`).
- Single tests: none run. The `components/approvals/` and `app/settings/` folders hold no test files, so nothing was near the change.
- `pnpm gate` from the repo root:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (3.4s)
PASS  format  (1.4s)
PASS  lint  (2.1s)
PASS  typecheck  (5.8s)
PASS  effect  (3.4s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The task's `pnpm --filter @zilar/mobile typecheck` is covered by the gate's `typecheck` step (`turbo run typecheck --affected`), which includes `@zilar/mobile` because its files changed, and it passed.

### Effect ratchet

No `// effect-plain:` marker was needed. `use-approvals.ts` imports `Effect` as a value (class `effect`); `pending-tab.tsx` and `rules-section.tsx` classify as `plain` with no signals; the screen classifies as `plain`. The `effect` gate step passed.

### Deviations / notes

- The plan's line ranges shift a little: `LoadStatus` (old line 37) rides with the hook, and the screen's retained JSX calls `runRules` and `setRefreshing` from the hook, so those are returned from `useApprovals()`. No behaviour change.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `settings/approvals.tsx` (529 lines) is now 114 lines, plus `components/approvals/{use-approvals,pending-tab,rules-section}`, the largest `use-approvals.ts` at 347.
- **The lead's phone smoke** (mock build, `/settings/approvals`):
  - the pending "Rotate the staging API token" card shows the worst-case cost and Approve once, Always and Deny;
  - Always clears it, and the screen shows "Nothing is waiting for you."
- **Seen on main too:**
  - "Always allowed" stays empty after Always, because rules load only for the AIs in pending rows (main `approvals.tsx:209`). Logged as a follow-up.
  - The card shows "expires Expired" because of the mock's date.
- **Check:** the gate passed.
