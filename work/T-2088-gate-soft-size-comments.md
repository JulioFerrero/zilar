---
id: T-2088
title: "Gate: 400 lines becomes a warning (fail only over 800), a new check fails on added comments that cite a task ID, and AGENTS.md points workers at docs/COMMENTS.md instead of 'match the comment density'"
status: merged
milestone: M5
branch: task/T-2088-gate-soft-size-comments
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2088: Soft size limit and the comment rule in the gate

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18:
- **On size:** "we can overwrite the 400 lines if we can save on lines of code". Splitting a file only to meet 400 adds imports, re-exports and glue. `CLAUDE.md` now says 400 is a soft limit and only a file over 800 must be split.
- **On comments:** the comment wave (T-2072–T-2087) cut about 15k comment lines. Without a rule in the gate, workers write them back: `AGENTS.md:42` tells them to "match … comment density".

### Facts (read by the lead on 2026-10-18 at `6cb181a6a`)
- **The size check.** `packages/devtools/src/gate/size.ts`:
  - `:5` has `export const SIZE_LIMIT = 400;`.
  - `violation()` (`:50-55`) fails a file over the limit unless the base already had it over the limit and it did not grow.
  - `sizeViolations()` (`:57-65`) collects the failures.
- **Where the gate prints it.** `packages/devtools/src/gate/cli.ts:313-322` prints `size: every changed source file is within 400 lines`, or sets `failed = true` and prints `FAIL  size: … over 400 lines`. `sizeReport()` is at `:128`.
- **The existing tests.** `packages/devtools/src/gate/gate.test.ts:196-220` (`describe('file size check')`) expect the "limit 400" failures.
- **The worker rule.** `AGENTS.md:42` reads `- Match the style of the code around you: naming, file layout, comment density.`. The rules themselves are in `docs/COMMENTS.md`.

### Steps
1. **Size.**
   - In `size.ts`, keep `SIZE_LIMIT = 400` as the soft limit and add `export const HARD_SIZE_LIMIT = 800`.
   - `sizeViolations` fails only files over 800, keeping the same "already over on the base and not grown" exemption, measured against 800.
   - Add `sizeWarnings(files)`, returning the same message shape for files over 400 and up to 800.
   - In `cli.ts`, print each warning as `WARN  size: <message> (soft limit 400; fine when keeping the file whole saves lines)` without failing, and fail only on `sizeViolations`.
   - Update the size tests in `gate.test.ts` to the new limits, with at most 4 cases.
2. **Task IDs in comments.**
   - Create `packages/devtools/src/gate/comments.ts` with a pure `taskIdComments(diff: string): string[]`. It takes `git diff -U0 <base> -- apps packages` output and returns `<file>: <line text>` for each ADDED line in a file that `isSizeChecked` accepts, when the trimmed line is a comment (starts with `//`, `/*`, `*` or `{/*`) and matches `/\bT-\d{3,4}\b/`.
   - In `cli.ts`, run it next to the size check: on hits, `failed = true` and print `FAIL  comments: <n> added comment line(s) cite a task ID (docs/COMMENTS.md)` plus the lines. Otherwise print `comments: no task IDs in added comments`.
   - Add 2 cases to `gate.test.ts`: an added `// T-1234: …` comment is flagged, and `const id = 'T-1234'` is not.
3. **AGENTS.md.** Replace line 42 with: `- Match the naming and file layout of the code around you. Comments follow docs/COMMENTS.md: write one only for a WHY the code cannot say, and never cite a task ID (the task file and the commit carry the history).` Also add one line under it: `- 400 lines per file is a soft limit: never split a file only to meet it; only a file over 800 lines must be split.`

### Allowed files
- `packages/devtools/src/gate/size.ts`
- `packages/devtools/src/gate/cli.ts`
- `packages/devtools/src/gate/comments.ts`
- `packages/devtools/src/gate/gate.test.ts`
- `AGENTS.md`
- `work/T-2088-gate-soft-size-comments.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/gate/gate.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- The gate output shows the `comments:` line, and the size line uses the new wording.

---

## Report (written by the worker when done)

### What I did

- `packages/devtools/src/gate/size.ts`: kept `SIZE_LIMIT = 400` as the soft limit, added `HARD_SIZE_LIMIT = 800`. `sizeViolations` now fails only files over 800, with the same "already over on the base and not grown" exemption measured against 800. Added `sizeWarnings(files)` for changed source files over 400 and up to 800, with the same message shape (`<path>: <n> lines (main <base>); limit 400`). Exempt files are skipped by both.
- `packages/devtools/src/gate/cli.ts`: `sizeReport` now returns `{ warnings, failures }`. Warnings print as `WARN  size: <message> (soft limit 400; fine when keeping the file whole saves lines)` without failing; only hard violations fail, with `FAIL  size: <n> changed source file(s) over 800 lines`. The success line is now `size: no changed source file is over 800 lines`. Added `commentReport`, which runs `git diff -U0 <base> -- apps packages` and prints `comments: no task IDs in added comments`, or sets `failed = true` and prints `FAIL  comments: <n> added comment line(s) cite a task ID (docs/COMMENTS.md)` plus each hit.
- `packages/devtools/src/gate/comments.ts` (new): pure `taskIdComments(diff: string): string[]`. Parses `+++ b/<path>` headers, looks at added lines only, trims them, keeps `//`, `/*`, `*` and `{/*` comments matching `/\bT-\d{3,4}\b/` in files `isSizeChecked` accepts, and returns `<file>: <line text>`.
- `packages/devtools/src/gate/gate.test.ts`: rewrote `describe('file size check')` to 4 cases (hard limit 800, soft warning 400 plus no warning at exactly 400, base exemption over 800, exemptions) and moved the unchanged `countLines` assertions into their own `describe('countLines')`. Added `describe('task IDs in added comments')` with 2 cases: an added `// T-1234: …` line is flagged, and `const id = 'T-1234'` plus an added comment in a test file are not.
- `AGENTS.md`: replaced the "comment density" line with the two lines from the spec (comments follow `docs/COMMENTS.md`, never cite a task ID; 400 is a soft limit, only a file over 800 must be split).

### Checks run

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts`: 1 test file passed, 51 tests passed, 0 failed.
- `pnpm gate` from the repo root: GATE PASS. Summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (0.8s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (2.4s)`
  - `PASS  effect  (0.8s)`
  - `PASS  build @zilar/server  (0.4s)`
  - `PASS  tests @zilar/devtools  (0.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`

### Notes for the lead

- `sizeWarnings` warns for every changed source file in 401–800 lines, including a file the base already had over 400 and that did not grow; the spec asked for warnings without the base exemption, so I did not add one.
- The comments check follows the spec literally: `git diff -U0 <base>` does not list untracked files, so added comments in a brand-new untracked file are not checked until it is staged/committed. The `comments.ts` unit test covers the parsing independently.
- `AGENTS.md` is in this task's Allowed files, which overrides the general "never change AGENTS.md" safety rule for this one line; no other part of the file was touched.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit).
- **Size.** 400 is now a warning, and 800 fails (`HARD_SIZE_LIMIT`), with the same "already over on the base and not grown" exemption.
- **Comments.** A new pure check, `taskIdComments`, flags added comment lines that cite a task ID, in the files the size rule covers. Rewrapping an old comment that keeps its ID is flagged too, which is intended: the ID should go.
- **AGENTS.md** now points workers at `docs/COMMENTS.md` and states the soft limit.
