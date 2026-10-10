---
id: T-0911
title: "Test follow-up from T-0899: the remaining real sleeps and 10 ms settles in web and mobile tests use fake timers or the shared wait helpers"
status: todo
milestone: M5
branch: task/T-0911-test-sleeps-followup
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0911: Remaining real sleeps in tests

## Spec (written by Claude, do not edit)

### Why
T-0899 added one wait-helper module per package (`apps/web/src/test/wait.ts`, `apps/mobile/src/test/wait.ts`). Its Report listed real waits it left alone:
- **Web real sleeps:** in the `ExplorePage`, `MessageSearch`, `ChatBackgroundDialog`, `MachinesPage` and `reload` tests.
- **Mobile 10 ms real settles:** in the screen tests `settings-machines`, `settings-profile`, `group-id` and `ais-id`, plus `NameForm` and `use-people-search`.
- **Mobile timed waits of 10-20 ms:** in the new T-0898 tests `gif-panel-paging`, `group-screen-sheets`, `composer-layout` and `voice-hold-gesture`.

### What to build
1. Find each wait with grep (`setTimeout(`, `sleep(`, `new Promise((r`) in those test files.
2. Replace each with the shared helper that waits for the visible state (`waitFor` or `findBy*`), or with fake timers where the code under test uses a timer.
3. Do not change what any test asserts.
4. Leave a wait alone if you cannot prove a replacement keeps the test meaningful, and say why in the Report.
5. Report the web and mobile suite wall times before and after, one run each.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), the Report of `work/T-0899-test-wait-helpers.md`, and `apps/web/src/test/wait.ts` and `apps/mobile/src/test/wait.ts`.

### Allowed files
`apps/web/src/**/*.test.tsx`, `apps/web/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/mobile/src/**/*.test.ts`, `work/T-0911-test-sleeps-followup.md`.

Do not edit the store tests: T-0906 and T-0907 add new ones in parallel. That means `apps/web/src/store/**` and `apps/mobile/src/store/**`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run each changed test file 3 times.

### Acceptance
- The Checks pass.
- The Report lists each replaced wait, each one left alone with its reason, and the wall times.
- No production code changes.

---

## Report (written by the worker when done)

## Review (written by Claude)
