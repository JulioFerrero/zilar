---
id: T-0933
title: "Cut the mobile tests: delete every UI test and every non-crucial test; keep auth/session and the message-pipeline store tests"
status: merged
milestone: M5
branch: task/T-0933-cut-mobile-tests
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0933: Cut the mobile tests

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10:
- delete **all** UI tests;
- keep tests only for crucial code: auth and keys, permissions and money, and the message pipeline;
- cut everything else.

Today `apps/mobile/src` has 305 test files, about 59,400 lines:
- `components/` 158 files, 34,500 lines;
- `lib/` 86 files, 12,100 lines;
- `store/` 39 files, 10,800 lines;
- `auth/` 10 files, 1,250 lines;
- `mock/` 11 files, 650 lines.

### What to build
1. **Keep exactly these test files. Delete every other `*.test.ts` and `*.test.tsx` under `apps/mobile/src`:**
   - **auth and session:**
     - `apps/mobile/src/auth/guard.test.ts`
     - `apps/mobile/src/auth/otp.test.ts`
     - `apps/mobile/src/auth/secure-session-storage.test.ts`
     - `apps/mobile/src/auth/session-storage.test.ts`
     - `apps/mobile/src/auth/session-store.test.ts`
     - `apps/mobile/src/auth/session.test.ts`
     - `apps/mobile/src/lib/auth.test.ts`
     - `apps/mobile/src/lib/auth-api.test.ts`
     - `apps/mobile/src/lib/session-token.test.ts`
   - **the message pipeline:**
     - `apps/mobile/src/store/real-store.incoming.test.ts`
     - `apps/mobile/src/store/real-store.ledger.test.ts`
     - `apps/mobile/src/store/real-store.history.test.ts`
     - `apps/mobile/src/store/real-store.lifecycle.test.ts`
     - `apps/mobile/src/store/real-store.sign-out.test.ts`
     - `apps/mobile/src/store/effects/send.test.ts`
2. **Helpers:**
   - Keep `apps/mobile/src/test/` helpers that the kept files import, including `apps/mobile/src/test/native-mocks.ts` (registered in `apps/mobile/vitest.config.mts`).
   - Delete the other helpers and `apps/mobile/src/test/noRawTimeoutWaits.test.ts`.
   - If a kept test needs a helper from a deleted file, move it into `apps/mobile/src/test/`.
3. **No production file changes.** The vitest config changes only if a setup file it names was deleted.

### Read first
`AGENTS.md`, `apps/mobile/vitest.config.mts`, `apps/mobile/src/test/`.

### Allowed files
`apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/mobile/src/test/**`, `apps/mobile/vitest.config.mts`, `work/T-0933-cut-mobile-tests.md`.

T-0929 (the mobile send on the core) will add `apps/mobile/src/store/real-store.send.test.ts` later. Do not create it.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint apps/mobile/src
```

### Acceptance
- The Checks pass, and only test or test-helper files change.
- The Report gives:
  - the test files and lines before and after;
  - the mobile suite time before and after;
  - each helper deleted or moved.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0933-cut-mobile-tests`.

### What I did

- Kept exactly the 15 test files the spec lists and deleted the other 290 `*.test.ts` / `*.test.tsx` files under `apps/mobile/src` (`git rm`, 290 deletions).
- Deleted `apps/mobile/src/test/noRawTimeoutWaits.test.ts`.
- Added `apps/mobile/src/test/node-types.d.ts` containing `/// <reference types="node" />`. Reason below.
- No production file changed; `apps/mobile/vitest.config.mts` unchanged (its setup file `src/test/native-mocks.ts` still exists).

### The node-types shim (only addition beyond deletions)

Deleting every unlisted test also deleted `src/auth/integration.test.ts` and `src/store/integration.test.ts`, which were the only files in `apps/mobile/src` carrying `/// <reference types="node" />`. Because the mobile `tsconfig.json` includes `**/*.ts`, that reference supplied node types to the whole program. The untouched production file `src/lib/native-pitfalls-scan.ts` imports `node:fs` / `node:path`, so without the reference `pnpm --filter @zilar/mobile typecheck` failed with `TS2591: Cannot find name 'node:fs'` (2 errors). Moving the reference into `apps/mobile/src/test/node-types.d.ts` (Allowed: `apps/mobile/src/test/**`) restores it without touching production. Verified: typecheck failed without the shim, passed with it (see commands).

### Metrics (before → after)

Test files/line counts are for `apps/mobile/src`; suite numbers are for the whole `@zilar/mobile` package (which also contains 4 test files outside `src`: `scripts/pods.test.ts`, `scripts/log-watch.test.ts`, `modules/zilar-whistle/src/download.test.ts`, `modules/zilar-whistle/src/transcribe.test.ts` — kept, since the spec scopes deletion to `apps/mobile/src`).

- test files under `apps/mobile/src`: **305 → 15**
- test lines under `apps/mobile/src`: **59,366 → 2,283** (57,083 lines removed)
- mobile suite: **309 files / 2,749 tests / 197.97s** → **19 files / 169 tests / 18.89s** first run (20.99s wall), 6.23s warm rerun

### Helpers

- Kept: `apps/mobile/src/test/native-mocks.ts` (registered in `vitest.config.mts`), `apps/mobile/src/test/wait.ts` (imported by the kept `lib/auth-api.test.ts` and the 5 kept `store/real-store.*` tests plus `store/effects/send.test.ts`).
- Deleted: `apps/mobile/src/test/noRawTimeoutWaits.test.ts`.
- Moved into `apps/mobile/src/test/`: none.
- Added: `apps/mobile/src/test/node-types.d.ts` (the shim above).
- Left in place: `apps/mobile/src/store/test-support.ts`. It is a test-only helper (`// Shared fakes for the store tests. Not imported by app code.`) that the kept store tests import, so it cannot simply be deleted. It is not a `*.test.ts` file and is outside the Allowed files (`apps/mobile/src/**/*.test.ts(x)` and `apps/mobile/src/test/**`), so I did not move it; moving it would have made `pnpm gate` report an out-of-scope change. If you want it consolidated into `apps/mobile/src/test/`, please widen the Allowed files and I will do the move in a follow-up.

### Commands and real results

- `pnpm install` — 1172 packages, done in 20.9s (1 deprecated subdep `uuid@7.0.3`, one unmet peer `@types/react`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot` (BEFORE, after temporarily restoring the 290 deleted files from HEAD) — `Test Files 307 passed | 2 skipped (309)`, `Tests 2747 passed | 2 skipped (2749)`, `Duration 197.97s`.
- `pnpm --filter @zilar/mobile typecheck` (final tree, after adding the shim) — exit 0, no errors.
- `pnpm --filter @zilar/mobile typecheck` (test files deleted, before the shim) — failed: `src/lib/native-pitfalls-scan.ts(2,39): TS2591 Cannot find name 'node:fs'` and `(3,22): node:path`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot` (AFTER, final tree) — `Test Files 19 passed (19)`, `Tests 169 passed (169)`, `Duration 6.23s`.
- `pnpm gate` (repo root) — `GATE PASS`:
  - `gate: 292 changed file(s) against main`
  - `PASS  install (frozen)  (1.4s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (3.6s)`
  - `SKIP effect (no source files changed)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`

### Notes / deviations

- `pnpm gate` skipped the mobile tests because every changed test file was a deletion (the gate's nearest-test selection only runs changed test files that still exist). I ran the mobile suite directly to cover the task's Checks, and all 15 kept `src` test files are in the 19 that passed.
- The task's Checks name `pnpm --filter @zilar/mobile exec vitest run --reporter=dot`; I ran the equivalent `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot`, honoring AGENTS.md's mandatory `--maxWorkers=2` worker cap.
- Changed-file set: 290 deletions, all matching `apps/mobile/src/**/*.test.ts(x)`; plus `work/T-0933-cut-mobile-tests.md` and the new `apps/mobile/src/test/node-types.d.ts`. Nothing else.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 follow-up.**
- **The cut:** 57,084 lines deleted. Exactly the 15 listed test files remain (the lead listed them).
- **The mobile suite:** from 2,749 tests and 198 s, to 169 tests and 19 s on the first run (6 s warm).
- **`apps/mobile/src/test/node-types.d.ts`:** added because the deleted integration tests were the only files carrying the node types reference. It is a test-support types file only.
- **Follow-up for later:** move `apps/mobile/src/store/test-support.ts` into `src/test/`.
- **Check:** the worker's gate passed, and the change only deletes tests, so the lead merged on it.
