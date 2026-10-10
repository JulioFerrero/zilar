---
id: T-0926
title: "Mobile tests: the three most-copied native mocks (reanimated, safe-area insets, ui/text) move to one vitest setup file; identical local copies deleted (simplify plan 5.4, F-F6)"
status: todo
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

## Review (written by Claude)
