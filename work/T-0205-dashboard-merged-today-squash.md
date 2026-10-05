---
id: T-0205
title: Lead tooling: the dashboard's "merged today" list reads the new one-commit-per-task merges
status: merged
milestone: M5
branch: task/T-0205-dashboard-merged-today-squash
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0200]
estimate: 0.2 day
---

# T-0205: Dashboard "merged today" after squash merges

## Spec (written by Claude, do not edit)

### Why
Since T-0200, `lead merge` lands a task as ONE commit whose subject is `T-XXXX: <summary>`; there is no `board: T-XXXX merged` commit any more. The dashboard's "merged today" list only looks for the old form, so from now on it would stay empty. Found by the T-0200 pre-review (follow-up).

### Verified facts (do not re-derive)
- `mergedToday` in `packages/devtools/src/lead/collect-snapshot.ts` (line 161) runs `git log main --since=<local midnight> --grep=^board: T-.* merged$ --format=%ct|%s` (lines 164-170) and parses each line with `/^(\d+)\|board: (T-\d+) merged$/` (line 176), then reads the task's title with `readFields(deps.root, id)`.
- No test covers `mergedToday` today (`snapshot.test.ts` tests the rendering only).

### What to build
1. In `collect-snapshot.ts`, add and export a pure function `parseMergedLog(stdout: string): { id: string; time: string }[]` that accepts both subject forms: `board: T-XXXX merged` (old merges) and `T-XXXX: <anything>` (new squash merges), returns one entry per task id (the first, newest line wins; drop later duplicates), with `time` as the ISO string of the `%ct` seconds.
2. `mergedToday` runs `git log main --first-parent --since=<local midnight> --format=%ct|%s` (no `--grep`) and uses `parseMergedLog`; the rest (title through `readFields`) is unchanged. Lines like `work: ...` or `docs: ...` are ignored by the parser.
3. Tests in a new `packages/devtools/src/lead/collect-snapshot.test.ts` for `parseMergedLog`: a squash subject, an old board subject, a `work:` line ignored, a task appearing twice counts once, an empty input gives `[]`.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/collect-snapshot.ts` (lines 155-200).

### Allowed files
`packages/devtools/src/lead/collect-snapshot.ts`, `packages/devtools/src/lead/collect-snapshot.test.ts` (new), `work/T-0205-dashboard-merged-today-squash.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/collect-snapshot.test.ts
pnpm gate
```

### Acceptance
- `parseMergedLog` handles both forms and the cases above; `mergedToday` uses it.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The dashboard rendering, any other snapshot field.

---

## Report (written by the worker when done)

### What I did
- Added and exported `parseMergedLog(stdout)` in `packages/devtools/src/lead/collect-snapshot.ts`. It accepts both `board: T-XXXX merged` (old form) and `T-XXXX: <anything>` (squash form), and drops anything else (e.g. `work:`, `docs:`). It uses a `Map` keyed by task id so that, since `git log` is newest-first, the first matching line per id wins and later duplicates are dropped.
- Changed `mergedToday` to call `git log main --first-parent --since=<local midnight> --format=%ct|%s` (no `--grep`) and feed the output through `parseMergedLog`. The title lookup via `readFields(deps.root, id)` is unchanged.
- Added `packages/devtools/src/lead/collect-snapshot.test.ts` with the five required cases (squash subject, old board subject, `work:` ignored, same task twice → one entry, empty input → `[]`).

### Files changed
- `packages/devtools/src/lead/collect-snapshot.ts` — added `parseMergedLog`, rewired `mergedToday`.
- `packages/devtools/src/lead/collect-snapshot.test.ts` — new test file.
- `work/T-0205-dashboard-merged-today-squash.md` — front-matter status + this Report.

### Commands run
- `pnpm install` — completed in 24.4s (peer-dep warnings only).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/collect-snapshot.test.ts` — 5 passed (1).
- `pnpm exec prettier --write packages/devtools/src/lead/collect-snapshot.test.ts` — reformatted one line split across an array literal so the prettier check stops flagging it. `pnpm exec prettier --check` on both files now reports `All matched files use Prettier code style!`.
- `pnpm gate` (final run) — summary:
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (13.6s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (2.5s)`
  - `PASS  tests @zilar/devtools  (1.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - 3 changed files against main, all inside the Allowed files.

### Deviations / open questions
None. Implemented the spec as written.

## Review (written by Claude)

**Verdict:** Approved, first round; the first MiniMax M3 task. `parseMergedLog` accepts both `board: T-XXXX merged` and the new `T-XXXX: <summary>` subjects, keeps the newest line per task, and `mergedToday` uses it over `git log --first-parent`. Tests cover both forms, ignored lines, duplicates and empty input. Pre-review clean. Accepted nits: a subject without a space after the colon is not counted (lead merge always writes one); an impossible timestamp would throw (git always gives valid seconds).
