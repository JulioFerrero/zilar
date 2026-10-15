---
id: T-1481
title: "Split packages/devtools/src/lead/autopilot.ts (671 lines, the last file over 400) under lead/autopilot/: task info, worker actions plus sweep, and the doctor tick move out unchanged; autopilot.ts keeps tickOnce and runAutopilot and re-exports what it exported"
status: merged
milestone: M5
branch: task/T-1481-autopilot-split
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1481: Split autopilot.ts

## Spec (written by Claude, do not edit)

### Why
`packages/devtools/src/lead/autopilot.ts` is 671 lines. It is the last source file over the 400-line rule (CLAUDE.md, Julio, 2026-10-10). This is a pure move: no behaviour changes. It follows T-1468's pattern (`lead/client.ts` plus `lead/client/`).

### Facts (the lead read them on main, 2026-10-15)
- **Top of `autopilot.ts`:** imports at `:1-38`; then `POLL_MS` (exported, `:40`), `MESSAGE_LIMIT` (`:41`), `AutopilotDeps` (`:43`) and `TickResult` (`:54`).
- **Task info (`:61-124`):** `extractVerdict` (exported, `:61`), `extractCounts` (exported, `:69`), `readTaskInfo` (`:85`) and `prereviewInfo` (`:110`).
- **Worker actions:** `applyActions` (`:125-256`) and `maybeSweep` (`:257-318`).
- **The worker tick:** `tickOnce` (exported, `:319-487`). It calls:
  - `maybeSweep` (`:327`), `readTaskInfo` (`:360`), `prereviewInfo` (`:372`) and `applyActions` (`:435`);
  - `tickDoctor` (`:466`).
- **The doctor tick:** `firstAuditSince` (`:488`), `tickDoctor` (`:505`) and `applyDoctorActions` (`:562-648`).
- **The loop:** `sleep` (`:649`) and `runAutopilot` (exported, `:653-671`).
- **Importers:**
  - `packages/devtools/src/lead/doctor.ts:3` imports `extractCounts` and `extractVerdict` from `./autopilot.js`;
  - `packages/devtools/src/lead/cli/commands.ts:3` imports `runAutopilot` and `AutopilotDeps`;
  - `packages/devtools/src/lead/autopilot.test.ts:5` imports `tickOnce` and `AutopilotDeps`.
- **The pattern:** `packages/devtools/src/lead/client.ts` is a barrel over `lead/client/` (T-1468).

### What to build
1. **`packages/devtools/src/lead/autopilot/task-info.ts`:** `extractVerdict`, `extractCounts`, `readTaskInfo` and `prereviewInfo`, moved unchanged and exported.
2. **`packages/devtools/src/lead/autopilot/actions.ts`:** `applyActions` and `maybeSweep`, moved unchanged and exported. Take `AutopilotDeps` with `import type` from `../autopilot.js`. If `applyActions` needs `MESSAGE_LIMIT` or `POLL_MS`, move that constant here and import it back.
3. **`packages/devtools/src/lead/autopilot/doctor-tick.ts`:** `firstAuditSince`, `tickDoctor` and `applyDoctorActions`, moved unchanged. Export `tickDoctor`.
4. **`autopilot.ts`** keeps:
   - the constants, `AutopilotDeps`, `TickResult`, `tickOnce`, `sleep` and `runAutopilot`;
   - a re-export of `extractVerdict` and `extractCounts`, so every existing import still works.
   - Its comment at the top names the split (T-1481), like `client.ts`. The file must end under 400 lines; each new file must be under 400 lines too.
5. **`packages/devtools/src/lead/doctor.ts:3`** imports `extractCounts` and `extractVerdict` from `./autopilot/task-info.js`, which removes the `doctor.ts` ↔ `autopilot.ts` import cycle. Nothing else in `doctor.ts` changes.
6. **No other changes:** no renamed function, no edited body, no new behaviour.

### Tests
None new. Every existing lead test must pass unchanged.

### Allowed files
- `packages/devtools/src/lead/autopilot.ts`
- `packages/devtools/src/lead/autopilot/task-info.ts`, `packages/devtools/src/lead/autopilot/actions.ts`, `packages/devtools/src/lead/autopilot/doctor-tick.ts`
- `packages/devtools/src/lead/doctor.ts`
- `work/T-1481-autopilot-split.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and every lead test passes unchanged.
- `wc -l` shows every file listed above under 400 lines.
- After the merge, the lead restarts the autopilot on the new code, and `status` and the event log work as before.

---

## Report (written by the worker when done)

### What I did
Pure move, no behaviour change. Split `packages/devtools/src/lead/autopilot.ts` (671 lines) into a barrel/loop file plus three files under `lead/autopilot/`:

- `autopilot/task-info.ts` — `extractVerdict`, `extractCounts`, `readTaskInfo` and `prereviewInfo`, moved unchanged. `readTaskInfo` and `prereviewInfo` are now exported (they were module-private before); the two extract functions stay exported.
- `autopilot/actions.ts` — `applyActions` and `maybeSweep`, moved unchanged and exported. Takes `AutopilotDeps` and `TickResult` with `import type` from `../autopilot.js`. Neither function uses `MESSAGE_LIMIT` or `POLL_MS`, so no constant moved.
- `autopilot/doctor-tick.ts` — `firstAuditSince`, `tickDoctor` and `applyDoctorActions`, moved unchanged. `tickDoctor` exported, the other two stay private.
- `autopilot.ts` keeps the top comment naming the split (T-1481), `POLL_MS`, `MESSAGE_LIMIT`, `AutopilotDeps`, `TickResult`, `tickOnce`, `sleep` and `runAutopilot`, and re-exports `extractCounts` and `extractVerdict` from `./autopilot/task-info.js` so every existing import still works.
- `doctor.ts:3` now imports `extractCounts` and `extractVerdict` from `./autopilot/task-info.js`, which removes the `doctor.ts` ↔ `autopilot.ts` import cycle. Nothing else in `doctor.ts` changed.

No function renamed, no body edited, no dependency added.

### Files changed
- `packages/devtools/src/lead/autopilot.ts` (671 → 234 lines)
- `packages/devtools/src/lead/autopilot/task-info.ts` (new, 71 lines)
- `packages/devtools/src/lead/autopilot/actions.ts` (new, 211 lines)
- `packages/devtools/src/lead/autopilot/doctor-tick.ts` (new, 179 lines)
- `packages/devtools/src/lead/doctor.ts` (import line 3 only)
- `work/T-1481-autopilot-split.md` (status + this report)

`wc -l`: autopilot.ts 234, actions.ts 211, doctor-tick.ts 179, task-info.ts 71 — all under 400.

### Commands and real results
- `pnpm install --frozen-lockfile`: done, no changes.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead`: 6 test files passed, 46 tests passed, 0 failed.
- `pnpm gate`: `GATE PASS`. Summary lines: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/devtools`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: …`, `size: every changed source file is within 400 lines`.

### Deviations / notes
- Only 6 files are reported changed against main; the three new files are new, so the count matches the Allowed-files list (the task file is counted too).
- No new tests, per the spec; every existing lead test passes unchanged.

### Blocked / needs a decision
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **Sizes:** `autopilot.ts` is 234 lines, and `actions.ts` 211, `doctor-tick.ts` 179 and `task-info.ts` 71.
- **Tests:** all 46 lead tests pass (6 files).
- **The move is exact:** with imports and export keywords set aside, the lines removed from `autopilot.ts` and the lines added under `autopilot/` are the same set.
- `doctor.ts` now imports from `autopilot/task-info.js`, which removes the import cycle.
- The lead restarts the autopilot on the new code after the merge.
