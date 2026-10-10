---
id: T-0931
title: "Cut the server tests to the crucial ones (auth and keys, permissions and money): keep a fixed list, delete every other server test file"
status: merged
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
`apps/server/src/**/*.test.ts`, `apps/server/src/test-support/**`, `apps/server/src/test-support.ts`, `apps/server/src/test-global-setup.ts`, `apps/server/vitest.config.ts`, `apps/server/src/**/testing.ts`, `apps/server/src/**/fakes.ts`, `apps/server/src/**/routes.expected.ts`, `apps/server/src/push/test-tables.ts` (lead: both are only imported by deleted tests), `work/T-0931-cut-server-tests.md`.

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

### What I did

1. Kept exactly the 23 test files listed in the spec and deleted the other 177 `*.test.ts` under `apps/server/src` (the whole list below).
2. Kept `test-support.ts`, `test-support/wait.ts`, `test-support/seed.ts`, `test-global-setup.ts`; deleted `test-support/noRawTimeoutWaits.test.ts` and `test-support/seed.test.ts`.
3. Deleted every non-test helper that only deleted tests imported, after grepping each: `apps/server/src/push/test-tables.ts` and all 35 `routes.expected.ts` fixtures (full list below). `agents/gateway.test-harness.ts` and `contract-smoke-support.ts` stay: the kept `ais/usage.test.ts` and the kept `invite-links`/`roles` contract-smoke tests still import them.
4. Inside kept files, deleted two `it` blocks that test only formatting, outside auth/keys/permissions/money:
   - `auth.test.ts`: `sets a trimmed display name and returns it` (display-name formatting on `PATCH /api/me`).
   - `files/routes.test.ts`: `encodes a tricky filename per RFC 5987` (pure filename encoding).
   Everything else in the kept files tests auth, keys, permissions, limits or money, so I kept it ("if unsure, keep it").
5. No production files changed. `apps/server/vitest.config.ts` is unchanged because the setup file it names (`.src/test-global-setup.ts`) is kept. `work/T-0931-cut-server-tests.md` is the only non-test/helper file touched (Report + status). The lead's follow-up commit added `apps/server/src/**/routes.expected.ts` and `apps/server/src/push/test-tables.ts` to the Allowed files.

### Test files and lines

| | before | after |
|---|---|---|
| `apps/server/src/**/*.test.ts` | 200 | 23 |
| lines | 72,607 | 10,353 |

The after count includes the two `it` blocks I deleted inside `auth.test.ts` (9 lines + blank) and `files/routes.test.ts` (11 lines + blank).

### Server suite time

Both timed the same way: `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot`.

| | before | after |
|---|---|---|
| files | 200 (193 passed, 7 skipped) | 23 passed |
| tests | 2,349 passed, 10 skipped (2,359) | 380 passed |
| duration | 645.58s (real 647.82s) | 196.58s (real 197.99s) |

### Non-test helpers deleted (36)

- `apps/server/src/push/test-tables.ts`
- `apps/server/src/agents/memory/routes.expected.ts`
- `apps/server/src/ais/routes.expected.ts`
- `apps/server/src/approvals/routes.expected.ts`
- `apps/server/src/audit/routes.expected.ts`
- `apps/server/src/auth/routes.expected.ts`
- `apps/server/src/avatars/routes.expected.ts`
- `apps/server/src/backgrounds/routes.expected.ts`
- `apps/server/src/blocks/routes.expected.ts`
- `apps/server/src/chat-folders/routes.expected.ts`
- `apps/server/src/chat-prefs/routes.expected.ts`
- `apps/server/src/chats/routes.expected.ts`
- `apps/server/src/connections/routes.expected.ts`
- `apps/server/src/contact-requests/routes.expected.ts`
- `apps/server/src/contacts/routes.expected.ts`
- `apps/server/src/directory/routes.expected.ts`
- `apps/server/src/drafts/routes.expected.ts`
- `apps/server/src/files/routes.expected.ts`
- `apps/server/src/gifs/routes.expected.ts`
- `apps/server/src/groups/routes.expected.ts`
- `apps/server/src/handles/routes.expected.ts`
- `apps/server/src/integrations/routes.expected.ts`
- `apps/server/src/invite-links/routes.expected.ts`
- `apps/server/src/machines/routes.expected.ts`
- `apps/server/src/media/routes.expected.ts`
- `apps/server/src/push/routes.expected.ts`
- `apps/server/src/roles/routes.expected.ts`
- `apps/server/src/routines/routes.expected.ts`
- `apps/server/src/search/routes.expected.ts`
- `apps/server/src/setup/routes.expected.ts`
- `apps/server/src/stickers/routes.expected.ts`
- `apps/server/src/tools/routes.expected.ts`
- `apps/server/src/topics/routes.expected.ts`
- `apps/server/src/voice-transcription/routes.expected.ts`
- `apps/server/src/voice/routes.expected.ts`
- `apps/server/src/xmpp/routes.expected.ts`

Every one was grepped after the test deletions and had no remaining importer.

### `it` blocks deleted inside kept files (2)

- `apps/server/src/auth/auth.test.ts`: `it('sets a trimmed display name and returns it')`
- `apps/server/src/files/routes.test.ts`: `it('encodes a tricky filename per RFC 5987')`

### Commands run (real results)

- `pnpm install`: done in 16.2s.
- Baseline full suite (above): 200 files, 2,349 passed | 10 skipped, duration 645.58s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts src/files/routes.test.ts`: 2 files passed, 48 tests passed, 15.38s.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 216 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.3s)
  SKIP effect (no source files changed)
  PASS  tests @zilar/server  (97.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate's `tests @zilar/server` step runs only the nearest tests, so the after full-suite number above is a separate timed run.

### Notes / deviations

None. The `it`-block deletions are the only judgment call in point 3; I removed the two clearly formatting-only cases and kept every test that touches auth, keys, permissions, limits or money.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The cut:** 200 → 23 test files, and 72,607 → 10,353 lines. The kept list matches the spec.
- **Helpers deleted:** the 36 helpers that only deleted tests imported (`push/test-tables.ts` and 35 `routes.expected.ts`), each grepped.
- **Inside kept files:** 2 formatting-only `it` blocks deleted.
- **The full server suite:** from 2,349 tests and 646 s, to 380 tests and 197 s.
- **No production file changed.** The worker's gate passed, so the lead merged on it.
