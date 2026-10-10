---
id: T-0933
title: "Cut the mobile tests: delete every UI test and every non-crucial test; keep auth/session and the message-pipeline store tests"
status: todo
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

## Review (written by Claude)
