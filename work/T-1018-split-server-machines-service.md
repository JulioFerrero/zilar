---
id: T-1018
title: "Size split T90: apps/server/src/machines/service.ts (476 lines) into machines/{pairing,machines,crypto,view}.ts, the old path keeps constants and re-exports"
status: merged
milestone: M5
branch: task/T-1018-split-server-machines-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1018: Split `machines/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/machines/service.ts` is 476 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #86 (task T90): `machines/pairing.ts`, `machines/machines.ts`, `machines/crypto.ts`, `machines/view.ts`, under `apps/server/src/`. `machines/service.ts` keeps the constants, `MachineServiceError` and re-exports of every name it exports today. The folder already holds `api.ts`, `codes.ts`, `hub.ts` and `registry.ts`; leave them as they are.

Move the code unchanged, and skip both Dedup items, because they cross files. The pairing code and `crypto.ts` are keys code (pairing codes, fingerprints, machine secrets), so not one line of their logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #86, and `apps/server/src/machines/service.ts`.

### Allowed files
`apps/server/src/machines/service.ts`, `apps/server/src/machines/pairing.ts`, `apps/server/src/machines/machines.ts`, `apps/server/src/machines/crypto.ts`, `apps/server/src/machines/view.ts`, `work/T-1018-split-server-machines-service.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split the 476-line `apps/server/src/machines/service.ts` into the four modules of
`docs/audit/size-plan.md` §2.2 #86, moving the code unchanged:

- `machines/crypto.ts` — `fingerprintOfPublicKey`, `verifyPairingSignature`.
- `machines/pairing.ts` — `countActivePairingCodes`, `createPairingCode`,
  `consumePairingCode`, `PairMachineInput`, `insertPendingMachine`, plus the
  private `isUniqueViolation` helper.
- `machines/machines.ts` — `countMachines`, `countPendingMachines`, `listMachines`,
  `listApprovedMachineKeys`, `findOwnedMachine`, `approveMachine`, `denyMachine`,
  `revokeMachine`, `renameMachine`, `deleteMachine`.
- `machines/view.ts` — `PublicMachine`, `toPublicMachine`, and the private
  `asString`/`asNumber`/`asStringArray` coercers.
- `machines/service.ts` is now the barrel: it keeps the three `MAX_*` caps,
  `MachineServiceError`, `MachineStatus` and the `MachineRow` type re-export, and
  re-exports every moved name.

The plan's Dedup item `isUniqueViolation` → `handles/store.ts` is cross-file, so it
is skipped per the spec; the helper has one caller (`insertPendingMachine`), which
moved to `pairing.ts`, so it moved there. The other Dedup item (`runSql`
boilerplate → §2.1) is also cross-file and skipped.

No importer changed; `api.ts`, `hub.ts`, `registry.ts` and `codes.ts` are untouched.

### Files changed

- `apps/server/src/machines/service.ts` (rewritten as the barrel)
- `apps/server/src/machines/pairing.ts` (new)
- `apps/server/src/machines/machines.ts` (new)
- `apps/server/src/machines/crypto.ts` (new)
- `apps/server/src/machines/view.ts` (new)
- `work/T-1018-split-server-machines-service.md` (this task)

### `wc -l` (old and new)

- old `apps/server/src/machines/service.ts` (main): **476**
- new `apps/server/src/machines/service.ts`: **50**
- `apps/server/src/machines/pairing.ts`: **184**
- `apps/server/src/machines/machines.ts`: **188**
- `apps/server/src/machines/crypto.ts`: **35**
- `apps/server/src/machines/view.ts`: **66**

Every new file and the barrel are at most 400 lines.

### Export diff before / after

Before: `git show main:apps/server/src/machines/service.ts | grep -E "^export"`.
After: `grep -E "^export"` on the barrel plus the four new files. Simplifying both
to exported names (then `sort -u`) gives an empty diff — 25 names, none added,
removed or changed kind:

```
approveMachine consumePairingCode countActivePairingCodes countMachines
countPendingMachines createPairingCode deleteMachine denyMachine findOwnedMachine
fingerprintOfPublicKey insertPendingMachine listApprovedMachineKeys listMachines
MachineRow MachineServiceError MachineStatus MAX_MACHINES_PER_USER
MAX_PAIRING_CODES_PER_USER MAX_PENDING_MACHINES_PER_USER PairMachineInput
PublicMachine renameMachine revokeMachine toPublicMachine verifyPairingSignature
```

`MachineRow` stays a type re-export (`export type { MachineRow } from '../db/rows'`),
`MachineStatus` a type, `MachineServiceError` a value class, `PublicMachine` /
`PairMachineInput` types; all the functions stay values.

### Effect ratchet (split-rules item 6)

`crypto.ts` holds moved-unchanged code with a `node:crypto` value import and a
`try`, so it would classify `needs-effect`; it carries
`// effect-plain: moved unchanged from apps/server/src/machines/service.ts (size split)`
as line 1. That is the only marker added. `pairing.ts` and `machines.ts` import
`effect` as a value (`effect`), and `view.ts` + the barrel are `plain`, so they need
no marker. The gate's `effect` step passed.

### Import graph note

The barrel defines the caps and `MachineServiceError` and re-exports from
`pairing`/`machines`/`crypto`/`view`; `pairing.ts` imports the caps and the error
(values) from `./service`, so `service ⇄ pairing` is a cycle. This is the same shape
as the already-on-main `push/service.ts` (barrel keeps the deps/outcome types and
TaggedErrors, and `push/delivery.ts` + `push/archive-scan.ts` import those values
from it), which passes the gate. Nothing is read at module-evaluation time — the
caps and the error are used only inside function bodies and the class constructor —
so the cycle is safe; the `authz-sweep` test, which builds the whole app, passed.

### Commands and results

- `pnpm install`: done (~24s), no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts`
  → 1 file passed, 5 tests passed. (There are no tests under `machines/`, so the gate
  selects none; I ran this one to exercise the barrel at runtime.)
- `pnpm gate` (from the repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (4.8s)
PASS  effect  (1.0s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations from the spec / plan

- Both Dedup items are skipped as the spec requires (they cross files).
- `isUniqueViolation` moved to `pairing.ts` (its only caller) instead of
  `handles/store.ts`.
- The barrel keeps the caps and `MachineServiceError` exactly as the spec says,
  which makes `service ⇄ pairing` a cycle (see the note above). If the lead prefers
  an acyclic layout, the caps and the error can move to `pairing.ts` and be
  re-exported from the barrel — a small change, but it deviates from the spec's
  "the old path keeps constants".

### Blocked / needs a decision

None.

### Open questions

- Keep the barrel holding the caps + `MachineServiceError` (as written), or move
  them into `pairing.ts` for a fully acyclic module graph?

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `machines/service.ts` (476 lines) keeps the constants, `MachineServiceError` and the re-exports, plus `pairing` (184), `machines` (188), `crypto` and `view`. The pairing and crypto code moved unchanged.
- **Check:** the gate passed.
