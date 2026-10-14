---
id: T-1427
title: "Gate: enforce the 400-line rule: a changed source file may not end above 400 lines unless it was already above 400 on main and did not grow; tests, mocks and generated files exempt"
status: merged
milestone: M5
branch: task/T-1427-gate-file-size
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1427: The gate checks file size

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: **at most 400 lines per source file**; tests, mocks and generated files are exempt (CLAUDE.md). Nothing enforces it, so files slip past:
- T-1425 grew `apps/mobile/src/app/ais/[id].tsx` from 372 to 439 lines, and only the lead's manual `wc -l` caught it;
- several files are already over the limit (`apps/server/src/main.ts` 569, `apps/server/src/config.ts` 518, `packages/runner-tunnel/src/runner.ts` 656, `packages/runner-tunnel/src/server.ts` 619).

### Facts (the lead checked them on main, 2026-10-15)
- **The gate** is `packages/devtools/src/gate/`: `cli.ts`, `plan.ts`, `scope.ts`, `migrations.ts`, `images.ts` (T-1412), with tests in `gate.test.ts`.
  - Each static check prints one line, like `images: …` or `FAIL images: …`. Follow how `images.ts` and `scope.ts` are wired into `cli.ts`.
- The gate already knows the changed files against `main` ("gate: N changed file(s) against main").

### What to build
1. **`packages/devtools/src/gate/size.ts`** (new): for each **changed** `.ts`/`.tsx`/`.mjs`/`.js` file under `apps/` or `packages/`, count lines in the working tree.
   - **Exempt:** `*.test.*`, `*.spec.*`, `test-harness*`, files under `__mocks__/`, `fixtures/`, `mock/`, `packages/mock-backend/`, generated files (`*.gen.*`, `drizzle/meta/`, `routeTree.gen.ts`), and `.d.ts`.
   - A file over 400 lines **fails** unless it was already over 400 on `main` **and** the change didn't make it longer (line count ≤ main's).
   - The failure message names the file and both counts: `apps/mobile/src/app/ais/[id].tsx: 439 lines (main 372); limit 400`.
2. **Wire it into the gate:** print `size: every changed source file is within 400 lines` or `FAIL size: …`, one line per file.
3. **A short note in `docs/LEAD_LOOP.md`**, where the gate checks are listed, if they are.

### Tests (pipeline: few)
In `gate.test.ts`:
- a new file of 401 lines fails;
- a file growing from 372 to 439 fails;
- a file at 569 on main that stays at 569 passes;
- 569 → 570 fails;
- a test file of 900 lines passes.

### Allowed files
`packages/devtools/src/gate/**`, `docs/LEAD_LOOP.md`, `work/T-1427-gate-file-size.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/gate --reporter=dot
pnpm gate
```

### Acceptance
The gate passes on this branch and prints the size line.

---

## Report (written by the worker when done)

**What I did**

- Added `packages/devtools/src/gate/size.ts`: `isSizeChecked` (which files the rule
  applies to), `countLines`, and `sizeViolations` (the pure check).
- Wired it into `packages/devtools/src/gate/cli.ts` (`baseLineCount`, `sizeReport`, and
  the output line), following how `images.ts` and `scope.ts` are wired.
- Added a `file size check` block to `packages/devtools/src/gate/gate.test.ts`.
- Left `docs/LEAD_LOOP.md` unchanged: it describes the loop but does not list the
  individual gate checks, so per the spec's "if they are" there was nothing to update.

**Behaviour**

- Checks each changed `.ts`/`.tsx`/`.mjs`/`.js` file under `apps/` or `packages/`.
- A file over 400 lines fails unless the base branch already had it over 400 and the
  change did not make it longer (branch lines ≤ base lines).
- Exempt: `*.test.*`, `*.spec.*`, `test-harness*`, `__mocks__/`, `fixtures/`, `mock/`,
  `packages/mock-backend/`, `*.gen.*`, `drizzle/meta/`, `routeTree.gen.ts`, `*.d.ts`.
- Failure message names the file and both counts, e.g.
  `apps/mobile/src/app/ais/[id].tsx: 439 lines (main 372); limit 400`.
- The gate prints `size: every changed source file is within 400 lines`, or
  `FAIL  size: …` followed by one line per file.

**Commands**

- `pnpm install`: Done in 11.4s.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate`:
  1 test file passed, 47 tests passed (7 of them new for this task).
- `pnpm gate` from the repo root:

```
$ pnpm gate
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (2.6s)
PASS  effect  (0.6s)
PASS  tests @zilar/devtools  (0.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

**Deviations / notes**

- A file absent on the base reports `main 0` in the message; the spec fixed the format
  only for the 372→439 case, and this keeps the same "both counts" shape for new files.
- `docs/LEAD_LOOP.md` not changed (see above).

**Open questions**

- None.

**Round (fix round 1: PREREVIEW should-fix)**

- Fixed finding 1 (should-fix): `isSizeChecked` now exempts the dotted harness form.
  `size.ts` matched only `name.startsWith('test-harness')` (bare `test-harness.ts`),
  so `apps/server/src/agents/gateway.test-harness.ts` (485 lines) was checked and
  would fail the gate. It now exempts a basename where `test-harness` is a dot-segment
  (`/(^|\.)test-harness\./`), covering both `test-harness.ts` and
  `gateway.test-harness.ts`, per `.oxlintrc.json` / T-1042.
- Test added: `apps/server/src/agents/gateway.test-harness.ts` added to the
  "exempts tests, mocks, fixtures, generated and declaration files" case in
  `gate.test.ts`.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts`:
  1 test file passed, 47 tests passed.
- `pnpm gate`: GATE PASS (`size: every changed source file is within 400 lines`;
  install/format/lint/typecheck/effect/tests all PASS; scope inside Allowed files).
- Commit: `T-1427: fix finding 1 - exempt dotted *.test-harness.ts from the size check`.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round, nit 1.
- packages/devtools/src/gate/size.ts is 79 lines; the gate tests pass locally (gate.test.ts, 47).
- Merged after T-1422, T-1425 and T-1426, which grew app.ts and main.ts before this check existed.
