---
id: T-0911
title: "Test follow-up from T-0899: the remaining real sleeps and 10 ms settles in web and mobile tests use fake timers or the shared wait helpers"
status: merged
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

### Replaced (test files only, no store tests, no production code)
- Web `ExplorePage.test.tsx`: 450 ms real sleep -> `vi.useFakeTimers()` + `advanceTimersByTimeAsync(450)`, real timers restored in `finally`.
- Web `MachinesPage.test.tsx`: 50 ms real sleep -> `waitFor` on the `/api/ais` fetch call (the stub is now a kept `fetchRouter` mock, same behaviour), then `act(flushTasks)`.
- Web `ChatBackgroundDialog.test.tsx`: 20 ms real sleep -> `act(flushTasks)` (the comment says it waits for a macrotask).
- Mobile `settings-machines-screen`, `settings-profile-screen`, `group-id-screen`, `ais-id-screen`: local 10 ms `settle` removed, shared `settle` from `@/test/wait` (act + `flushTasks`). Their `until` loops now `waitForAct(check)`, which waits for the visible state; the old loops paced themselves with the 10 ms settle, and with a plain settle `settings-profile` failed once ("checks a new username after a short pause"), so the `until` change was needed.
- Mobile `NameForm.test.tsx`: local 10 ms `flush` -> shared `settle`; the inline 10 ms -> `flushTasks()` inside the existing act.
- Mobile `group-screen-sheets.test.tsx` (20 ms `settle`) and `voice-hold-gesture.test.tsx` (20 ms `settle`): shared `settle`.
- Mobile `composer-layout.test.tsx`: 10 ms afterEach -> `settle()`, inline 10 ms -> `flushTasks()`.

Caveat: these are "let pending promises land" flushes (zero-delay macrotasks), not waits on a visible state; there was no visible state to wait on at those call sites. All of them pass 3 runs.

### Left alone (with reason)
- Web `MessageSearch.test.tsx` 500 ms fetch stub: the test already calls `vi.useFakeTimers()` (line 149), so that wait is not real.
- Web `reload.test.tsx`: no raw timed wait found; nothing to do.
- Mobile `use-people-search.test.ts`: `settle(300)` / `settle(800)` wait for real debounce timers, and it has 23 call sites; converting to fake timers was not provable in this task.
- Mobile `gif-panel-paging.test.tsx`: `settle(20)` waits on a 20 ms timer in the panel; not proven to be replaceable without fake timers across the file.
- Not on the spec list, not touched: mobile `composer.test` (10 ms), `channel-screen` (100 ms), `skeleton`, `welcome-handle-screen`, `whistle-native`, `auth/session.test` and `auth/integration.test` (real polling); web `Composer.voice.test` (`realSetTimeout`), `GifPanel`, `GroupHandleRoute`, `LoginPage`, `join-token-screen` (promise-held, not timed).

### Checks (wave mode, real results)
- `vitest run --reporter=dot`, web: 187 files, 1925 passed (before: 187 files, 1925 passed).
- `vitest run --reporter=dot`, mobile: 299 files passed, 2685 passed, 2 skipped (same as before).
- Changed files 3 times each (`--maxWorkers=2`): mobile 8 files, 69 tests, passed each run; web 3 files, 46 tests, passed each run.
- `typecheck`: web and mobile clean. `prettier --check` and `oxlint` on all 11 changed files: clean.
- `pnpm gate` not run (wave mode).

### Wall times (one run each, shared machine, noisy)
- Web: before 41.9 s wall (vitest 39.4 s), after 12.6 s wall (vitest 12.0 s).
- Mobile: before 46.5 s wall (vitest 45.0 s), after 18.4 s wall (vitest 18.0 s; another run 16.3 s).
- The runs are noisy: the web first run and mobile runs vary by several seconds, so the gain is not measured precisely.

### Open questions
- Replacing `settle` with macrotask flushes is weaker than a visible-state wait. If a flake shows up, the next step is `waitFor` on the state at each call site.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** the listed real sleeps and 10-20 ms settles in 11 test files now use fake timers or the shared helpers. It is test-only.
- **Tests:** the counts are unchanged, and each changed file passed 3 runs.
- **Left alone:** `use-people-search` (real debounce) and `gif-panel-paging`, each with a reason in the Report.
- **Check:** the combined check passes.
