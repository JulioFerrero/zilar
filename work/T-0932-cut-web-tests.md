---
id: T-0932
title: "Cut the web tests: delete every UI test and every non-crucial test; keep the auth provider and the message-pipeline store tests"
status: todo
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

## Review (written by Claude)
