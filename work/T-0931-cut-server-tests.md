---
id: T-0931
title: "Cut the server tests to the crucial ones (auth and keys, permissions and money): keep a fixed list, delete every other server test file"
status: todo
milestone: M5
branch: task/T-0931-cut-server-tests
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0931: Cut the server tests

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: tests only for crucial code, and the existing tests cut "to the max". Crucial means auth and keys, permissions and money, and the message pipeline (the pipeline lives in the client packages, not here).

Today `apps/server/src` has 200 test files, about 72,600 lines.

### What to build
1. **Keep exactly these test files. Delete every other `*.test.ts` under `apps/server/src`:**
   - **auth:**
     - `apps/server/src/auth/auth.test.ts`
     - `apps/server/src/auth/invites.test.ts`
     - `apps/server/src/auth/session-cache.test.ts`
     - `apps/server/src/auth/sql-adapter.test.ts`
     - `apps/server/src/invite-links/` (both files)
     - `apps/server/src/rate-limit.test.ts`
     - `apps/server/src/kdf-labels.test.ts`
     - `apps/server/src/xmpp/token.test.ts`
   - **keys:**
     - `apps/server/src/connections/crypto.test.ts`
     - `apps/server/src/setup/crypto.test.ts`
   - **permissions:**
     - `apps/server/src/authz-sweep.test.ts`
     - `apps/server/src/roles/` (both files)
     - `apps/server/src/groups/visibility.test.ts`
     - `apps/server/src/approvals/service.test.ts`
     - `apps/server/src/approvals/rules.test.ts`
     - `apps/server/src/approvals/sweeper.test.ts`
     - `apps/server/src/files/routes.test.ts` (upload auth)
   - **money and limits:**
     - `apps/server/src/ais/usage.test.ts`
     - `apps/server/src/sandbox/run-tool.test.ts`
     - `apps/server/src/sandbox/host-fetch.test.ts`
     - `apps/server/src/sandbox/ip-guard.test.ts`
2. **Test helpers:**
   - Keep `apps/server/src/test-support.ts` and `apps/server/src/test-support/` (`wait.ts`, `seed.ts`).
   - Delete `apps/server/src/test-support/noRawTimeoutWaits.test.ts` and `apps/server/src/test-support/seed.test.ts`.
   - After the deletion, delete any non-test helper file that only deleted tests imported (for example a fake used only by them). Check each with grep before deleting it, and list it in the Report.
   - `apps/server/src/test-global-setup.ts` stays if the kept tests still use the DB snapshot.
3. **Inside the kept files,** delete only `it` blocks that test something outside the crucial areas, for example a pure formatting case in `auth.test.ts`. If unsure, keep it.
4. **No production file changes.** The server's vitest config, `apps/server/vitest.config.ts`, changes only if a setup file it names was deleted.

### Read first
`AGENTS.md`, `apps/server/vitest.config.ts`, `apps/server/src/test-support.ts`.

### Allowed files
`apps/server/src/**/*.test.ts`, `apps/server/src/test-support/**`, `apps/server/src/test-support.ts`, `apps/server/src/test-global-setup.ts`, `apps/server/vitest.config.ts`, `apps/server/src/**/testing.ts`, `apps/server/src/**/fakes.ts`, `work/T-0931-cut-server-tests.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot
pnpm --filter @zilar/server typecheck
pnpm exec oxlint apps/server/src
```

### Acceptance
- The Checks pass, and only test or test-helper files change.
- The Report gives:
  - the test files and lines before and after;
  - the server suite time before and after;
  - each non-test helper deleted;
  - each `it` deleted inside a kept file.

---

## Report (written by the worker when done)

## Review (written by Claude)
