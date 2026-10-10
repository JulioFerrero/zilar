---
id: T-0970
title: "Size split T22: packages/devtools/src/lead/batch.ts (913 lines) into lead/batch/{types,text,wave,parsers,check,report,merge,real}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0970-split-lead-batch
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0970: Split `lead/batch.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/batch.ts` is 913 lines (`wc -l`, main, 2026-10-10). The plan read it at 910; T-0930 (`c26a3ce9`) changed it slightly since.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #18 (task T22): `lead/batch/types.ts`, `lead/batch/text.ts`, `lead/batch/wave.ts`, `lead/batch/parsers.ts`, `lead/batch/check.ts`, `lead/batch/report.ts`, `lead/batch/merge.ts`, `lead/batch/real.ts`, under `packages/devtools/src/`. `lead/batch.ts` becomes the barrel.

- **In scope:** the in-file Dedup, one `countKinds(outcome)`.
- **Out of scope:** `isRecord` → `lead/is-record.ts`, because it crosses files.

`lead batch check` must still work: run `pnpm exec tsx src/lead/cli.ts batch --help` (or the nearest no-side-effect command) in `packages/devtools`, and paste the output.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #18, and `packages/devtools/src/lead/batch.ts`.

### Allowed files
`packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch/types.ts`, `packages/devtools/src/lead/batch/text.ts`, `packages/devtools/src/lead/batch/wave.ts`, `packages/devtools/src/lead/batch/parsers.ts`, `packages/devtools/src/lead/batch/check.ts`, `packages/devtools/src/lead/batch/report.ts`, `packages/devtools/src/lead/batch/merge.ts`, `packages/devtools/src/lead/batch/real.ts`, `work/T-0970-split-lead-batch.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the CLI output.

---

## Report (written by the worker when done)

**Status:** review. Split done per `docs/audit/split-rules.md` and the plan entry `docs/audit/size-plan.md` §2.2 #18. No behaviour change: code moved unchanged, the only edits are imports/exports and the in-file `countKinds` dedup. `lead/batch.ts` is now a barrel.

### Files and sizes (`wc -l`)

| File | Lines |
|---|---:|
| `packages/devtools/src/lead/batch.ts` (old, `git show HEAD`) | 913 |
| `packages/devtools/src/lead/batch.ts` (barrel) | 27 |
| `batch/types.ts` | 83 |
| `batch/text.ts` | 27 |
| `batch/wave.ts` | 81 |
| `batch/parsers.ts` | 147 |
| `batch/check.ts` | 270 |
| `batch/report.ts` | 105 |
| `batch/merge.ts` | 132 |
| `batch/real.ts` | 120 |

All new files and the barrel are ≤ 400 lines; no `max-lines` warning.

Boundaries follow the plan entry (its line numbers had drifted a little, as the spec warned): types = error + interfaces (`BatchError`, `CommandResult`, `BatchPackage`, `BatchDeps`, `Failure`, `TaskOutcome`, `CheckResult`, plus the previously-private `LastWave`); text = ANSI/line helpers + `safeName`; wave = worktree paths, task validation, `ownerOf`; parsers = typecheck/lint/prettier/vitest parsers + `isRecord`; check = `runPool`/`prepareTask`/`combine`/`runChecks`/`runBatchCheck`; report = `taskIssues`/`summaryLine`/`failureItem`/`fixFile`/`reportText`; merge = `BatchMergeDeps`/`BatchMergeResult`/`readLastWave`/`boardTitle`/`runBatchMerge`; real = `runShell`/`testArgsOf`/`readPackages`/`realBatchDeps`/`realBatchMergeDeps`.

### Export list before / after

Before: `git show HEAD:.../batch.ts | grep -E '^export'` listed 20 names.

After: the barrel re-exports the same 20 names with the same kinds, and no new name. Nothing was added or removed, so the diff is empty:

```
value: BatchError, waveWorktree, ownerOf,
       parseTypecheckErrors, parseLintErrors, parsePrettierFiles, parseVitestFailures,
       runBatchCheck, runBatchMerge, testArgsOf, realBatchDeps, realBatchMergeDeps
type:  CommandResult, BatchPackage, BatchDeps, Failure, TaskOutcome, CheckResult,
       BatchMergeDeps, BatchMergeResult
```

Home of each after the split: `types.ts` (all 7 types + `BatchError`), `wave.ts` (`waveWorktree`, `ownerOf`), `parsers.ts` (the 4 parsers), `check.ts` (`runBatchCheck`), `merge.ts` (`BatchMergeDeps`, `BatchMergeResult`, `runBatchMerge`), `real.ts` (`testArgsOf`, `realBatchDeps`, `realBatchMergeDeps`). Types are re-exported with `export type`, values with `export`, matching the originals.

The split files export a few helpers that were private before so the other new files can import them (`LastWave`; `WAVE_BRANCH`/`MESSAGE_LINES`/`stripAnsi`/`firstLines`/`lastLines`/`lines`/`safeName`; `taskWorktree`/`findTaskFileIn`/`validateTasks`/`stamp`; `isRecord`; `taskIssues`/`summaryLine`/`fixFile`/`reportText`). None of these is re-exported by the barrel, so the public surface is unchanged. `packages/devtools/src/lead/cli.ts` imports only `realBatchDeps`, `realBatchMergeDeps`, `runBatchCheck`, `runBatchMerge` and was not edited.

### Dedup

One `countKinds(outcome)` in `batch/report.ts` returns the per-kind failure counts and replaces the repeated `filter((failure) => failure.kind === …)` chains in `summaryLine` (4 filters) and `reportText` (3 filters); `taskIssues` sums the same record. Output strings are byte-for-byte the same paths.

`isRecord` (`batch/parsers.ts`) is kept as a single copy and exported to `batch/merge.ts` and `batch/real.ts`. It was **not** moved to `lead/is-record.ts`: that dedup crosses files and is out of scope by the spec, so `lead/watch.ts`/`client.ts`/`session.ts` are untouched.

### Effect ratchet

No `// effect-plain:` marker was needed. `packages/devtools/` is in `EXEMPT_PATHS` (`src/effect-map/generate.ts`), so every new file classifies `exempt`; the gate's `effect` step passed.

### Commands run

- `pnpm install` — done, lockfile unchanged (`+ turbo 2.11.4`, `Done in 13.3s`).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts` — 1 file passed, 17 tests passed.
- `pnpm exec tsx src/lead/cli.ts batch --help` (in `packages/devtools`) — the nearest no-side-effect command; `batch` has no `--help` subcommand, so it loads the module and prints the usage line: `lead: usage: lead batch <check|merge> <T-XXXX> <T-XXXX> ...`, `exit=1`. A plain `--help` also lists `batch check …` and `batch merge …`, so the command is still wired.
- `pnpm exec prettier --write` on the changed files once (the first gate run flagged `check.ts`), then:
- `pnpm gate` (from the repo root):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (2.2s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/devtools  (11.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

- First gate run failed `format` on `batch/check.ts` and, after that, `typecheck` on `batch/real.ts` (it imported `BatchMergeDeps` from `./types.js` instead of `./merge.js`). Both fixed inside the Allowed files; the gate then passed. Recorded here so the diff is honest.
- No new tests, no test edited. No dependency added.

### Security checklist

No secrets, auth, permissions, DB/`where` scopes, routes or audit code were touched: this is a pure relocation of the `lead batch` CLI's helpers. No request logging, tokens or user data involved.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `lead/batch.ts` (913 lines) becomes a barrel plus the 8 `lead/batch/*.ts` files, the largest `check.ts` at 270, with one `countKinds` in place of the copies.
- **The CLI still loads:** the lead ran `lead batch` on the branch, and it prints its usage line.
- **Check:** the gate passed.
