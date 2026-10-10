---
id: T-0926
title: "Mobile tests: the three most-copied native mocks (reanimated, safe-area insets, ui/text) move to one vitest setup file; identical local copies deleted (simplify plan 5.4, F-F6)"
status: merged
milestone: M5
branch: task/T-0926-mobile-native-mocks
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0926: Mobile native mocks in one setup file

## Spec (written by Claude, do not edit)

### Why
This is simplify plan item 5.4, report F6 (`docs/audit/simplify-2026-10-09/F-tests.md`). `apps/mobile/vitest.config.mts` sets only aliases and says "native primitives stay mocked per test", so each test file mocks them again.

The lead grouped the mock bodies on main on 2026-10-10:
- **`react-native-reanimated`:** mocked in 50 files. **41** use exactly this body, e.g. `apps/mobile/src/auth/AuthFlow.test.tsx`:
  `vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));`
- **`react-native-safe-area-context`:** mocked in 66 files. **40** use exactly this body, e.g. `apps/mobile/src/components/ais/ai-memory-sheet.test.tsx`:
  `vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));`
- **`@/components/ui/text`:** mocked in 109 files, with two common bodies:
  - **39** files: `{ Text: 'Text', TextClassContext: { Provider: 'TextClassContextProvider' } }` (e.g. `apps/mobile/src/auth/AuthFlow.test.tsx`);
  - **33** files: `{ Text: 'Text' }` (e.g. `apps/mobile/src/components/ais/ai-activity.test.tsx`).

  The first body is a superset of the second.

### What to build
1. **A new `apps/mobile/src/test/native-mocks.ts`** with those three mocks; for ui/text, use the superset body. Register it in `apps/mobile/vitest.config.mts` as `test.setupFiles`, and update the config comment.
2. **Before deleting anything,** prove two things on one or two files, and record the result in the Report:
   - a test file's own `vi.mock` of the same module still wins over the setup file;
   - a test file that does not mock the module today still passes when the setup mock applies.
   - If either fails, stop and report. Do not work around it.
3. **Delete the identical local copies** only: the 41, 40, 39 and 33 files above. Files with a different body keep their own mock.
4. **Run the whole mobile suite** before and after: the same number of files and tests pass. If a file that did not mock the module breaks because the global mock now applies, add a local `vi.unmock` or `vi.mock(..., importOriginal)` in that file and list it in the Report.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `apps/mobile/vitest.config.mts`, `apps/mobile/src/test/` (`wait.ts`), and the two example files above.

### Allowed files
`apps/mobile/vitest.config.mts`, `apps/mobile/src/test/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `work/T-0926-mobile-native-mocks.md`.

T-0922 adds new mobile store test files in parallel. Do not touch `apps/mobile/src/store/real-store.send.test.ts`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass, with the same test count as before.
- Only test files and the vitest config change.
- The Report gives:
  - the two proofs from item 2;
  - the number of copies deleted per module;
  - the lines removed;
  - any file that needed `vi.unmock`;
  - the mobile suite time before and after.

---

## Report (written by the worker when done)

Status: review.

### What I did
- Added `apps/mobile/src/test/native-mocks.ts`: `vi.mock` for `react-native-reanimated` (`useReducedMotion: () => false`), `react-native-safe-area-context` (`useSafeAreaInsets` zeros) and `@/components/ui/text` (superset body with `TextClassContext`).
- Registered it in `apps/mobile/vitest.config.mts` as `test.setupFiles: ['./src/test/native-mocks.ts']` and updated the config comment (it no longer says native primitives stay mocked per test).
- Deleted only the exact shared mock bodies, identified by exact-substring match across `apps/mobile/src/**/*.test.ts(x)`.

### Proofs (item 2), done before deleting anything
- Temporary `apps/mobile/src/test/native-mocks.probe.test.ts` (deleted after use) with a file-local `vi.mock('@/components/ui/text', () => ({ Text: 'LocalText' }))`:
  - **local mock wins:** `expect((await import('@/components/ui/text')).Text).toBe('LocalText')` passed with the setup mock registered. `1 passed (1), 2 tests passed`.
  - **setup mock applies where the file does not mock:** the same probe asserted `react-native-reanimated`.`useReducedMotion()` === `false` and safe-area `useSafeAreaInsets()` === `{top:0,bottom:0,left:0,right:0}`. Passed.
- Real existing file with no local `@/components/ui/text` mock: `src/lib/chat-header.test.tsx` → `4 passed` with the setup mock active.

### Copies deleted
- `react-native-reanimated` (exact body): **41** files.
- `react-native-safe-area-context` (exact `useSafeAreaInsets` body): **40** files.
- `@/components/ui/text` superset body: **39** files; simple `{ Text: 'Text' }` body: **33** files.
- Total **153** mock calls across **88** test files. Files with a different body kept their own mock.

### Lines removed
- Mock bodies: 498 lines (41×3 + 40×3 + 39×4 + 33×3). Prettier then collapsed the 153 leftover double blank lines. `git diff --stat`: 90 tracked files changed, 6 insertions, 653 deletions (including the task-file status line; excludes the new untracked `native-mocks.ts`).

### Files needing `vi.unmock`
- None.

### Mobile suite, before / after
- Before: `307 passed | 2 skipped (309)` files, `2747 passed | 2 skipped (2749)` tests, **61.86s**.
- After: `307 passed | 2 skipped (309)` files, `2747 passed | 2 skipped (2749)` tests, **76.45s** (same counts; the box was busier for the after run). Both with `--maxWorkers=2 --reporter=dot`.

### Commands run
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/test/native-mocks.probe.test.ts` → 2 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/chat-header.test.tsx` → 4 passed.
- `pnpm --filter @zilar/mobile exec vitest run --maxWorkers=2 --reporter=dot` (before and after) → counts above.
- `pnpm gate` (repo root) summary:
  ```
  gate: 91 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.3s)
  SKIP effect (no source files changed)
  PASS  tests @zilar/mobile  (12.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes / deviations
- Ran the whole mobile suite twice (one baseline before edits, one after) as the task's item 4 and Acceptance require the before/after count and time; gate runs it a third time.
- `apps/mobile/src/store/real-store.send.test.ts` (T-0922) was not touched.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The change:** the three common mocks are in `apps/mobile/src/test/native-mocks.ts`, registered as `setupFiles`, and 153 identical copies are deleted. That is 653 lines removed, with only test files and the config touched.
- **Proofs before deleting:**
  - a local `vi.mock` still wins;
  - a file without a mock passes under the setup mock.
- **Suite:** 307 files and 2,747 tests pass, before and after.
- **Nit for later:** 7 one-line `{ Text: 'Text' }` copies were left in place; they are harmless.
- **Check:** the combined check passes.
