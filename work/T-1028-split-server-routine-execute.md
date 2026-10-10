---
id: T-1028
title: "Size split T105: apps/server/src/routines/execute.ts (434 lines) into routines/{outcomes,audit,preflight}.ts, the old path keeps ports, options and executeRoutine"
status: merged
milestone: M5
branch: task/T-1028-split-server-routine-execute
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1028: Split `routines/execute.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/routines/execute.ts` is 434 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #101 (task T105): `routines/outcomes.ts`, `routines/audit.ts` and `routines/preflight.ts`, under `apps/server/src/`. `routines/execute.ts` keeps the ports, the options, `executeRoutine` and re-exports of every name it exports today. The folder already holds `api.ts`, `queries.ts`, `schedule.ts`, `scheduler.ts`, `schemas.ts`, `service.ts`, `support.ts` and `wiring.ts`; leave them as they are.

Move the code unchanged, and skip all three Dedup items. The preflight decides whether a routine may run (approved hosts, pause after failures) and the audit records each run: not one line of either changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #101, and `apps/server/src/routines/execute.ts`.

### Allowed files
`apps/server/src/routines/execute.ts`, `apps/server/src/routines/outcomes.ts`, `apps/server/src/routines/audit.ts`, `apps/server/src/routines/preflight.ts`, `work/T-1028-split-server-routine-execute.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/routines/execute.ts` (434 lines) into three new files, moving the code
unchanged and leaving `execute.ts` as a thin barrel with the ports, the options, `executeRoutine`
and re-exports of every name it exported before. No importer changed.

New files:

- `routines/preflight.ts` — the ordered preflight checks: `isAiInTopicRoom`, `readCurrentHosts`,
  `isSubset` (old lines 183–237), plus the private `ToolVersionHostsRow` / `GroupAiRow` /
  `TopicRoomRow` types only they use.
- `routines/outcomes.ts` — the records a run writes and the post helpers: `postResult`,
  `truncateChars`, `markSkipped`, `markOk`, `recordFailure`, `pauseForFailures`,
  `pauseForHostsChanged`, `postNotice` (old lines 239–259, 261–266, 268–393), the four exported
  constants, and the private `truncateChars` / `postNotice`.
- `routines/audit.ts` — `auditRun` / `auditPaused` (old lines 395–434).

`execute.ts` keeps the header, `AiStatusRow` / `ToolRow`, `ExecuteRoutinePorts`,
`RoutineRunLogger`, `ExecuteRoutineOptions` and `executeRoutine`.

### Deviations

- **Dedup items skipped** as the spec says: `postResult` and `postNotice` stay two functions (not
  one `postToRoutine`), `auditRun`/`auditPaused` stay two (not one `recordRoutineAudit`), and the
  single-row reads are not folded into a `queryOne`.
- The plan's line ranges for this entry did not name `postResult` (239–259) or `truncateChars`
  (261–266) — they are the code the skipped Dedup would have merged away. Because nothing else
  owns them, I put both in `outcomes.ts` next to the other run-record helpers.
- `audit.ts` carries the rule-6 marker `// effect-plain: moved unchanged from
  apps/server/src/routines/execute.ts (size split)`: it is a moved file whose `async` functions
  trip the Effect ratchet, but it only calls `options.audit.record` and needs no Effect import.
  `outcomes.ts` and `preflight.ts` import `Effect` for `runSql`, so they are already `effect` and
  need no marker.

### Line counts (split-rules item 8)

```
old  apps/server/src/routines/execute.ts      434   (git show main:...)
new  apps/server/src/routines/execute.ts      178
new  apps/server/src/routines/outcomes.ts     175
new  apps/server/src/routines/audit.ts         47
new  apps/server/src/routines/preflight.ts     76
```

Every file is under 400 lines.

### Export list before / after (split-rules item 8)

`git show main:apps/server/src/routines/execute.ts | grep -E "^export"` (before):

```
export const MAX_POST_TEXT_CHARS = 4_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const FAILURE_PAUSE_NOTICE = (title: string): string =>
export const HOSTS_CHANGED_NOTICE = (title: string): string =>
export type { RoutineRow };
export interface ExecuteRoutinePorts {
export interface RoutineRunLogger {
export interface ExecuteRoutineOptions {
export async function executeRoutine(
```

`grep -E "^export"` on the barrel plus the new files (after) adds the moved helpers
(`postResult`, `markSkipped`, `markOk`, `recordFailure`, `pauseForFailures`,
`pauseForHostsChanged`, `auditRun`, `auditPaused`, `isAiInTopicRoom`, `readCurrentHosts`,
`isSubset`), which had to become exported so the barrel can import them. The **barrel's public
surface is unchanged**: the four constants and `RoutineRow` are re-exported, and
`ExecuteRoutinePorts`, `RoutineRunLogger`, `ExecuteRoutineOptions`, `executeRoutine` are still
defined and exported in `execute.ts` under the same names and kinds.

### Commands and results

- `pnpm install` — done in 19.7s, 15 workspace projects. Only warning: pre-existing mobile peer
  mismatch `@types/react-dom 19.3.0` wants `@types/react@^19.3.0` (found 19.2.18), not from this
  change.
- Single tests: none — `apps/server/src/routines/` holds no test file and no test imports
  `routines/execute` (`rg -l "routines" apps/server --glob '*.test.ts'` → no files).
- `pnpm gate` (first run) — `FAIL lint`: `outcomes.ts:21:16 error eslint(no-unused-vars):
  Function 'postResult' is declared but never used` (I had moved it without `export`). Fixed by
  exporting `postResult`; nothing else changed.
- `pnpm gate` (final) — summary lines:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (4.7s)
PASS  effect  (1.5s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Security checklist

Behaviour unchanged: only moves and added exports. The audit entries still carry ids and the fixed
`{ status, durationMs }` / `{ reason }` detail only, never output text, source or errors; no secret
reaches a log or URL. No route, `where` clause, cap or permission check changed.

### Files changed

`apps/server/src/routines/execute.ts` (modified), `apps/server/src/routines/outcomes.ts`,
`apps/server/src/routines/audit.ts`, `apps/server/src/routines/preflight.ts` (new),
`work/T-1028-split-server-routine-execute.md`. All inside the Allowed files.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `routines/execute.ts` (434 lines) is now 178 lines, plus `outcomes` (175), `audit` (47) and `preflight` (76).
- **The lead's line check:** the old file's non-import code lines against the new files'. They are identical, so the preflight and the run audit are unchanged.
- **Check:** the gate passed.
