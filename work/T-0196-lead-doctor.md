---
id: T-0196
title: Lead tooling: the doctor, a Muse session that audits main after merges
status: planned
milestone: M5
branch: task/T-0196-lead-doctor
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0197, T-0198]
estimate: 1 day
---

# T-0196: Lead tooling: the doctor

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-04: "we need a doctor/control AI with also Muse Spark to control these things: the quality of the code, check for bugs". Each task gets a pre-review before it merges, but that review sees the task alone. Nothing looks at `main` after several merges: the full test suites of the touched packages (workers and pre-reviewers only run the tests of the files they touch), two tasks that each pass but break each other, leftovers from conflict resolution. The doctor is one Muse session that wakes after merges, runs the checks on `main`, reviews the commits since its last visit like a skeptic, and writes `DOCTOR.md`. The loop is in `docs/LEAD_LOOP.md`: only workers write code, and the lead's commits touch only `work/` and `docs/`; the doctor checks that too. The autopilot prints one line for the lead. The doctor never edits, commits or merges; the lead turns its findings into tasks.

### Verified facts (do not re-derive)
- Pre-review is the model to copy: `packages/devtools/src/lead/start-prereview.ts` (`startPrereviewSession`: `client.createSession({ title, agent: 'build', model: PREREVIEW_MODEL, directory, permissions: loadRulesFile(path.join(promptsDirPath, 'rules.json')) })`, then `client.promptDetached(sessionId, prompt)`; the prompt is `renderPrompt(loadPrompt(promptsDirPath, 'prereview'), {...})`).
- `PromptName` is a union in `packages/devtools/src/lead/prompts.ts`; templates live in `packages/devtools/prompts/*.md` and use `{{NAME}}` placeholders.
- The state file schema is `stateFileSchema` in `types.ts` (`{ version: 1, tasks }`). `loadState` in `state.ts` REBUILDS the object from `validated.data.tasks` and returns only `{ version: 1, tasks }`: a new top-level field would be silently dropped unless `loadState`, `emptyState`, the `StateFile` type and the schema all carry it. This already bit a per-task field once.
- The autopilot loop is `tickOnce` in `autopilot.ts`; `decide` in `decide.ts` is a pure function and is the pattern for testable decisions. `AutopilotDeps` has `client`, `runner` (a `GitRunner`), `statePath`, `promptsDirPath`; the CLI builds it in `runAutopilotCommand` in `cli.ts`, where `findRepoRoot()` gives the main checkout.
- `extractCounts` and `extractVerdict` in `autopilot.ts` already parse the `Counts: must-fix=N, should-fix=N, nit=N` line and the `Verdict:` line of a review file. Reuse them.
- Task worktrees are siblings of the main checkout named `zilar-T-XXXX`; `lead merge` removes them. Nothing may ever delete or reset a worker's worktree.

### What to build
1. `packages/devtools/prompts/doctor.md` (new template, placeholders `{{HEAD}}`, `{{SHORT_HEAD}}`, `{{SINCE}}`, `{{SHORT_SINCE}}`, `{{WORKTREE}}`). The doctor is told: you are a DOCTOR, not an implementer; you are in a detached worktree of `main` at {{SHORT_HEAD}}; the last audit was at {{SHORT_SINCE}}. Steps: (a) list `git log --oneline {{SINCE}}..{{HEAD}}` and `git diff --stat {{SINCE}}..{{HEAD}}`; (b) run `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, then the tests of every package touched since {{SINCE}} with `pnpm --filter <package> test --maxWorkers=2` (the whole package suite, once; wait for each run to finish); (c) look for merge leftovers: `git ls-files | grep -E '\.(orig|rej|bak)$'` and conflict markers (`<<<<<<<` or `>>>>>>>` at the start of a line) in tracked files; (d) a commit whose message does not start with `T-XXXX:` (the lead's commits: `board:`, `work:`, `docs:`) must change only files under `work/` and `docs/`; any other path in such a commit is a must-fix finding; (e) review every `T-XXXX:` commit like a skeptic: does the diff do what the message says; is any file rewritten or mostly deleted although the message does not explain it (read `git show --stat`); for commits starting with `T-XXXX:` open `work/T-XXXX-*.md` and compare the changed files with its Allowed files and its Acceptance; tests that pass for the wrong reason; the security checklist in `AGENTS.md`; a new user-visible feature with no entry in `docs/FEATURES.md` or `README.md`. Output: write `DOCTOR.md` at the worktree root with the checks and their real results, then findings, each with `file:line`, a concrete failure scenario and a severity (must-fix breaks behaviour, security or the build; should-fix breaks an acceptance point or an `AGENTS.md` rule; nit otherwise), then a line exactly `Counts: must-fix=N, should-fix=N, nit=N` and a line starting `Verdict:`. It must not modify any other file, commit, or use the question tool, and stops when `DOCTOR.md` is written. If nothing is wrong it says so plainly.
2. `packages/devtools/src/lead/doctor.ts`: (a) `startDoctorSession(deps, { head, since })`: the doctor worktree path is `path.join(path.dirname(path.resolve(repoRoot)), 'zilar-doctor')`; if it does not exist run `git worktree add --detach <path> <head>`; if it exists run `git -C <path> checkout --detach <head>` and remove a stale `DOCTOR.md`; refuse (throw) if the path exists but is not a git worktree of this repo; never touch any other worktree. Create the session like pre-review (model `meta/muse-spark-1.3-contributor`, directory = that path, title `doctor <short head>`), send the rendered prompt, return the session id. (b) `decideDoctor(input)`: a PURE function. Input: `now`, `mainHead`, `mainHeadCommitMs`, `doctor` (the state record or undefined), `sessionState` (`running | idle | unknown | none`), `reportFilePresent`, `counts` (or undefined), `verdict`. Output actions: `start { head, since }` when `mainHead` differs from `doctor.head` (or there is no doctor record: then `since` is the first parent of the commit 30 commits back or the root if shorter; the caller passes `sinceFallback`), the previous session is not running, and `now - mainHeadCommitMs >= 10 minutes` (so a burst of merges becomes one audit); `escalate` of one line `LEAD: DOCTOR must-fix N, should-fix M, nit K since <short since> (<verdict, 160 chars>)` once per audited head when the session is idle and the report exists (`[no counts line, read it]` in place of numbers when counts are missing); `escalate` `LEAD: DOCTOR STALLED (idle, no DOCTOR.md)` once per head when idle without a report; and `record` patches. No other behaviour.
3. State: add an optional top-level `doctor` object to the schema, the `StateFile` type, `emptyState` and the object `loadState` returns: `{ sessionId, head, since, startedAt, reportedForHead?: string, stalledReportedForHead?: string }`. An old state file without it must still load.
4. Autopilot: `AutopilotDeps` gains `repoRoot`; set it in `runAutopilotCommand`. After the task loop in `tickOnce`, gather the inputs (main HEAD and its commit time through `deps.runner` in `repoRoot`, the doctor session state through `client.listMessages`, the report file in the doctor worktree) and apply `decideDoctor`. Honour `dryRun` exactly like the task actions (print `DRY: would start the doctor`, change nothing). A failure of the doctor step must be logged and must never break the task loop.
5. CLI: `lead doctor [--since <sha>]` starts a doctor session for the current `main` HEAD now (ignores the debounce), records it in the state and prints `doctor <session id> <worktree>`. Add it to the usage text.
6. Tests (Vitest, same style as `decide.test.ts`): `decideDoctor` starts on a new quiet head; waits while the head is younger than 10 minutes; does not start while the session is running; does not start for an already audited head; escalates once with counts, once as `[no counts line, read it]`, once as STALLED; the state file round trip keeps `doctor` and loads an old file without it; the prompt renders every placeholder (no `{{` left); `startDoctorSession` with a fake runner and fake client creates the worktree with the exact git commands, refuses a non-worktree path, and never calls a git command on a path other than the doctor path.
7. Add a short "Doctor" paragraph to `docs/LEAD_HANDOFF.md` (what it is, `lead doctor`, where `DOCTOR.md` lives, what to do with findings: the lead writes a task, never fixes in place).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/start-prereview.ts`, `decide.ts`, `autopilot.ts`, `state.ts`, `types.ts`, `prompts.ts`, `cli.ts`, `packages/devtools/prompts/prereview.md`.

### Allowed files
`packages/devtools/src/lead/doctor.ts`, `doctor.test.ts`, `state.ts`, `state.test.ts`, `types.ts`, `autopilot.ts`, `autopilot.test.ts`, `cli.ts`, `prompts.ts`, `prompts.test.ts`, `packages/devtools/prompts/doctor.md`, `docs/LEAD_HANDOFF.md`, `work/T-0196-lead-doctor.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead
pnpm gate
```

### Acceptance
- `decideDoctor` is pure and fully covered; an old state file still loads; the new `doctor` field survives `loadState` then `saveState` (test it, this is the trap).
- `lead doctor` and the autopilot start exactly one session per audited head; nothing in the code deletes, resets or cleans any worktree except `zilar-doctor` itself.
- The prompt makes the doctor read-only (no edit, no commit) and asks for the `Counts:` and `Verdict:` lines.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Auto-fixing findings, creating tasks or board rows, merging, any change to the pre-review or to `decide.ts`, the dashboard, any new dependency.

---

## Report (written by the worker when done)

## Review (written by Claude)
