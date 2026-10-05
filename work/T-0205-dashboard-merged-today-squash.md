---
id: T-0205
title: Lead tooling: the dashboard's "merged today" list reads the new one-commit-per-task merges
status: planned
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

## Review (written by Claude)
