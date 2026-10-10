---
id: T-0932
title: "Cut the web tests: delete every UI test and every non-crucial test; keep the auth provider and the message-pipeline store tests"
status: merged
milestone: M5
branch: task/T-0932-cut-web-tests
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0932: Cut the web tests

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10:
- delete **all** UI tests (components, routes, screens);
- keep tests only for crucial code: auth and keys, permissions and money, and the message pipeline;
- cut everything else.

Today `apps/web/src` has 196 test files, about 43,200 lines:
- `components/` 97 files, 21,000 lines;
- `routes/` 21 files, 5,000 lines;
- `lib/` 41 files, 7,200 lines;
- `store/` 26 files, 8,200 lines;
- `mock/` 7 files, 1,600 lines;
- plus `App.test.tsx`, `shots.test.ts` and `auth/`.

### What to build
1. **Keep exactly these test files. Delete every other `*.test.ts` and `*.test.tsx` under `apps/web/src`:**
   - `apps/web/src/auth/AuthProvider.test.tsx`
   - `apps/web/src/store/realStore.send.test.tsx`
   - `apps/web/src/store/realStore.incoming.test.tsx`
   - `apps/web/src/store/realStore.echo-edit.test.tsx`
   - `apps/web/src/store/realStore.ledger.test.tsx`
   - `apps/web/src/store/realStore.history.test.tsx`
   - `apps/web/src/store/realStore.lifecycle.test.tsx`
   - `apps/web/src/store/effects/sendFailure.test.ts`
2. **Helpers:**
   - Keep `apps/web/src/test/setup.ts` and the helpers in `apps/web/src/test/` that the kept files import.
   - Delete the helpers no kept file imports, and `apps/web/src/test/noRawTimeoutWaits.test.ts`.
   - If a kept test needs an edit only because a deleted file exported a helper it used, move that helper into `apps/web/src/test/` rather than keeping the deleted test.
3. **No production file changes.** `apps/web/vite.config.ts` changes only if a setup file it names was deleted. T-0930 may change its pool settings in parallel; leave those lines alone.

### Read first
`AGENTS.md`, `apps/web/vite.config.ts` (the `test` block), `apps/web/src/test/`.

### Allowed files
`apps/web/src/**/*.test.ts`, `apps/web/src/**/*.test.tsx`, `apps/web/src/test/**`, `apps/web/src/mock/**/*.test.ts`, `work/T-0932-cut-web-tests.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm exec oxlint apps/web/src
```

### Acceptance
- The Checks pass, and only test or test-helper files change.
- The Report gives:
  - the test files and lines before and after;
  - the web suite time before and after;
  - each helper deleted or moved.

---

## Report (written by the worker when done)

### What I did
- Deleted every `*.test.ts` / `*.test.tsx` under `apps/web/src` except the 8 the spec keeps.
- Deleted the test-only helper `apps/web/src/test/renderApp.tsx` (only deleted tests imported it; no kept file does).
- Kept `apps/web/src/test/setup.ts`, `storeHarness.ts`, `wait.ts` (imported by the kept store tests / named by `vite.config.ts`).
- No production file changed. `apps/web/vite.config.ts` is untouched (its setup file `setup.ts` still exists, and T-0930's pool lines were left alone).
- Trimmed a stale reference in the kept `wait.ts` header comment that pointed at the deleted `noRawTimeoutWaits.test.ts`.

### Test files and lines, before and after
Before (196 test files, 43,178 lines):
- `components/` 97 files, 21,012 lines
- `routes/` 21 files, 4,970 lines
- `lib/` 41 files, 7,157 lines
- `store/` 26 files, 8,176 lines
- `mock/` 7 files, 1,622 lines
- `auth/` 1 file, 151 lines
- root `App.test.tsx` 33 lines, `shots.test.ts` 25 lines, `test/noRawTimeoutWaits.test.ts` 32 lines

After (8 test files, 1,406 lines):
- `apps/web/src/auth/AuthProvider.test.tsx`
- `apps/web/src/store/realStore.send.test.tsx`
- `apps/web/src/store/realStore.incoming.test.tsx`
- `apps/web/src/store/realStore.echo-edit.test.tsx`
- `apps/web/src/store/realStore.ledger.test.tsx`
- `apps/web/src/store/realStore.history.test.tsx`
- `apps/web/src/store/realStore.lifecycle.test.tsx`
- `apps/web/src/store/effects/sendFailure.test.ts`

So 188 test files (41,772 lines) deleted, plus `renderApp.tsx`. `git status --short` after: 189 deletions, 2 modifications (`wait.ts`, this task file).

### Web suite time before and after
- Before (196 files): 196 passed, 1989 tests passed, **216.09s** (with `--maxWorkers=2`).
- After (8 files): 8 passed, **45 tests passed, 4.66s**.
- Logs: `.../opencode/T-0932-before.log`, `.../opencode/T-0932-after.log`.

### Helpers deleted or moved
- Deleted `apps/web/src/test/renderApp.tsx`: imported only by deleted UI tests (`App.test.tsx`, `ChatHeader.menu`, `TopicsMockE2E`, `MessageContent`, `PeopleSearchResult`, `ReactionChips`, `UnreadDivider`, `Composer.voice`, …). No kept test imports it.
- Deleted `apps/web/src/test/noRawTimeoutWaits.test.ts`: a test file the spec explicitly cut.
- Moved: none. The only test helpers the kept files import are `storeHarness.ts` and `wait.ts`, both kept as-is in `apps/web/src/test/`, so no helper needed to move out of a deleted file.

### Commands run (real results)
- `pnpm install` → done, 1172 packages.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot --maxWorkers=2` → exit 0, 8 files / 45 tests passed, 4.66s.
- `pnpm --filter @zilar/web typecheck` → exit 0, no errors.
- `pnpm exec oxlint apps/web/src` → exit 0, no diagnostics.
- `pnpm gate` → exit 0, `GATE PASS`. Summary lines:
  ```
  gate: 191 changed file(s) against main
  PASS  install (frozen)  (3.7s)
  PASS  format  (1.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (7.3s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- I added `--maxWorkers=2` to the vitest check command to honour AGENTS.md's shared-machine rule (the spec's Checks line omitted it).
- The gate reported `SKIP tests @zilar/web (no nearby test files)` because every changed file is itself a test or a `src/test/` helper, so its source→test mapping finds nothing to run. The suite was therefore verified by the explicit vitest Check above (8/45 passing), not by the gate's test step.
- I edited the `wait.ts` comment (allowed file `apps/web/src/test/**`) to drop the reference to the deleted `noRawTimeoutWaits.test.ts`; no behavior change.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The cut:** 188 test files deleted (41,772 lines), plus `renderApp.tsx`. 8 files remain: the auth provider and the message-pipeline store tests.
- **The web suite:** from 196 files, 1,989 tests and 216 s, to 8 files, 45 tests and 4.7 s.
- **No production file changed.**
- **Check:** the worker's gate passed, and the change only deletes tests, so the lead merged on it.
