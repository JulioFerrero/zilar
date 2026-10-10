---
id: T-1014
title: "Size split T91: apps/web/src/routes/MachinesPage.tsx (473 lines) into components/machines/{machineRowOps,PendingRow,ApprovedRow,RevokedRow}; one useMachineAction, one AddMachineButton"
status: merged
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

### What I did

Split `apps/web/src/routes/MachinesPage.tsx` (473 lines) following `docs/audit/split-rules.md` and the plan entry §2.2 #87:

- `machineRowOps.ts` (new): the page's `ConfirmingState` / `ConfirmKind` / `EMPTY_CONFIRMING` (old 39–47), `shownFailure`, `clearFailure`, `failureText` (old 448–473), plus the Dedup item: one `useMachineAction` that wraps `useAction` and returns the row's failure text (null until a call fails, so a two-action row can prefer one text over the other), and one `clearFailure` shared by all rows.
- `PendingRow.tsx`, `ApprovedRow.tsx`, `RevokedRow.tsx` (new): the three row components moved unchanged (old 285–330, 346–403, 413–446); each now uses `useMachineAction` instead of its own `useAction` + `shownFailure`/`failureText`. Approve, deny, rename, revoke and delete keep their own fallbacks and calls.
- `AddMachineButton.tsx` (new): the Dedup item for the three identical "Add machine" buttons (old 157–165, 188–197, 235–243). The page still decides when each one renders.
- `MachinesPage.tsx`: keeps the load, `useQuery`/`useAction` for machines + AIs, the section composition, and its single `export function MachinesPage`. Its imports were trimmed to what it still uses (e.g. `Plus`, the five machine api calls, the card components and `machineErrorMessage` moved out).

No behaviour change intended: the wrappers' error text resolution (`denyError ?? approveError ?? ''`, `renameError ?? revokeError ?? ''`, `deleteError ?? ''`) is exactly the old `failure !== undefined ? failureText(...) : …` chain. The route path and its only importer (`AppRoutes.tsx`) are unchanged.

No `// effect-plain:` marker was needed: `pnpm gate`'s effect check passed (the row files import Effect as a value → `effect`; `machineRowOps.ts` has only type imports and no signals → `plain`).

### Files changed

- `apps/web/src/routes/MachinesPage.tsx` (modified)
- `apps/web/src/components/machines/machineRowOps.ts` (new)
- `apps/web/src/components/machines/PendingRow.tsx` (new)
- `apps/web/src/components/machines/ApprovedRow.tsx` (new)
- `apps/web/src/components/machines/RevokedRow.tsx` (new)
- `apps/web/src/components/machines/AddMachineButton.tsx` (new)
- `work/T-1014-split-web-machines-page.md` (this report)

### Line counts (`wc -l`)

Old file: `MachinesPage.tsx` 473.
New: `MachinesPage.tsx` 223, `machineRowOps.ts` 70, `PendingRow.tsx` 69, `ApprovedRow.tsx` 77, `RevokedRow.tsx` 50, `AddMachineButton.tsx` 16. Every new file and the page are under the 400-line limit.

### Export list: before → after

Before (`git show main:apps/web/src/routes/MachinesPage.tsx | grep -E "^export"`):

```
export function MachinesPage() {
```

After (`grep -E "^export"` on the page + the five new files):

```
routes/MachinesPage.tsx:      export function MachinesPage() {
components/machines/machineRowOps.ts:  export interface ConfirmingState {
components/machines/machineRowOps.ts:  export type ConfirmKind = keyof ConfirmingState;
components/machines/machineRowOps.ts:  export const EMPTY_CONFIRMING: ConfirmingState = { ... };
components/machines/machineRowOps.ts:  export function clearFailure<A>(...): void {
components/machines/machineRowOps.ts:  export function failureText(failure, fallback): string {
components/machines/machineRowOps.ts:  export function useMachineAction<I, A>(...)
components/machines/PendingRow.tsx:    export function PendingRow({...}: PendingRowProps) {
components/machines/ApprovedRow.tsx:   export function ApprovedRow({...}: ApprovedRowProps) {
components/machines/RevokedRow.tsx:    export function RevokedRow({...}: RevokedRowProps) {
components/machines/AddMachineButton.tsx: export function AddMachineButton({...}: AddMachineButtonProps) {
```

The original path keeps its one export (`MachinesPage`); the new names are additive. No name was renamed or dropped.

### Commands run and results

- `pnpm install` → done, 23.2s (one pre-existing peer-dependency warning in `apps/mobile`).
- `pnpm --filter @zilar/web build` → `✓ built in 785ms` (only the pre-existing >500 kB chunk warning).
- `pnpm gate` (final run, after the format fix) → summary:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (6.0s)
PASS  effect  (1.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test files were run; there are no test files for `MachinesPage` or the moved rows (`grep` found none), and the gate reports `no nearby test files` for `@zilar/web`.

### Problems / deviations

- One extra `pnpm gate` round: the first run failed `format` on `PendingRow.tsx` (the destructured props line was too long). I wrapped it by hand and re-ran; the second gate is the one pasted above. No other deviations from the spec.

### Open questions

None. Manual UI check of `/settings/machines` is the lead's, per the spec.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `MachinesPage.tsx` (473 lines) is now 223 lines, plus `components/machines/{machineRowOps,PendingRow,ApprovedRow,RevokedRow}`. One `useMachineAction` and one `AddMachineButton` replace the copies.
- **The lead checked it in Chrome on `/settings/machines?mock=1`:**
  - Waiting for approval shows office-linux with its fingerprint, Approve and Deny, and Your machines shows dev-mac (Online) with Revoke;
  - Approve moves office-linux to Your machines ("Never connected"), and the Add machine button moves to that section's header;
  - Add machine opens the pairing dialog with a code, its expiry and Copy.
- **Check:** the gate passed, and so did the web build.
