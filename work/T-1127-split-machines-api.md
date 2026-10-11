---
id: T-1127
title: "Size split: apps/server/src/machines/api.ts (404) — toMachineView, invalidCode, toConflict and INVALID_JSON move unchanged to machines/api-helpers.ts"
status: merged
milestone: M5
branch: task/T-1127-split-machines-api
model: auto
effort: default
depends_on: [T-1122]
estimate: 0.05 day
---

# T-1127: Split `machines/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10). `apps/server/src/machines/api.ts` has 404 lines (read by the lead).

**The four private helpers before `createMachinesApi` (`:121`):**
- `toMachineView` (`:97-104`);
- `invalidCode` (`:106-108`), a 400 `invalid_code` error;
- `toConflict` (`:110-115`), which maps `MachineServiceError` to a 409;
- `INVALID_JSON` (`:117-119`, with its comment).

### What to build
1. **A new `apps/server/src/machines/api-helpers.ts`** holds those four, **moved byte-for-byte** (comments included), each exported, with the imports they need.
2. **`api.ts`** imports them and changes nothing else. Its exports are unchanged.
3. **No behaviour change.**
4. **Line counts:** `api.ts` is at most 400 lines. Paste `wc -l` in the Report.
5. **Tests:** run any test next to `machines/` (`ls apps/server/src/machines/`) and paste the results, or say there is none.

### Read first
`AGENTS.md`, and `apps/server/src/machines/api.ts`.

### Allowed files
`apps/server/src/machines/api.ts`, `apps/server/src/machines/api-helpers.ts`, `work/T-1127-split-machines-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `api.ts` is at most 400 lines.

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/machines/api-helpers.ts` holding the four private helpers moved out of `api.ts`, each exported, byte-for-byte including their comments: `toMachineView`, `invalidCode`, `toConflict`, `INVALID_JSON`. It imports `Machine` (type) from `@zilar/api-contract`, `HttpError` from `../errors`, and `MachineServiceError` + `PublicMachine` (type) from `./service`.
- `api.ts` now imports those four from `./api-helpers` and defines nothing else differently. No behaviour change: same method bodies, same route order, same texts/statuses/logs/audit.
- Removed the now-unused imports from `api.ts` that existed only for the moved helpers: `type Machine` (`@zilar/api-contract`), and `MachineServiceError` + `type PublicMachine` (`./service`). Lint forbids unused imports; this is the only edit beyond the import addition and it does not change behaviour or exports.

### Files changed
- `apps/server/src/machines/api.ts` (modified)
- `apps/server/src/machines/api-helpers.ts` (new)
- `work/T-1127-split-machines-api.md` (this report)

### Commands and real results
- `pnpm install`: Done in 26.8s (frozen install clean; only a pre-existing peer-dependency warning for `apps/mobile`).
- `ls apps/server/src/machines/`: no test files next to `machines/` (`api.ts codes.ts crypto.ts hub.ts machines.ts pairing.ts registry.ts service.ts view.ts`), and `grep` found no test that imports `createMachinesApi` or `machines/api`, so there is no test to run for this change.
- `wc -l`: `apps/server/src/machines/api.ts` = **376** lines (was 404, limit is 400); `apps/server/src/machines/api-helpers.ts` = 32 lines.
- `pnpm gate` summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.6s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None affecting behaviour. The only deviation from a literal "changes nothing else": I removed three imports in `api.ts` that the moved helpers were the sole users of, since leaving them would fail lint's unused-import rule.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit (the header says "private helpers").**
- **The split:** `machines/api.ts` goes from 404 to 376 lines. `toMachineView`, `invalidCode`, `toConflict` and `INVALID_JSON` move to `machines/api-helpers.ts` (32). `INVALID_JSON` stays a single `Symbol`, now imported by `api.ts`, so its identity check is unchanged.
- **The lead's line check:** the removed lines missing from the new file are only the declarations that gained `export` and their import names.
- **The gate passed.**
