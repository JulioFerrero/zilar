---
id: T-1120
title: "Size split: apps/server/src/setup/api.ts (441) — the body schemas to setup/schema.ts and the invite/mail helpers to setup/mail.ts, moved unchanged"
status: merged
milestone: M5
branch: task/T-1120-split-setup-api
model: auto
effort: default
depends_on: [T-1116]
estimate: 0.1 day
---

# T-1120: Split `setup/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` #97. `apps/server/src/setup/api.ts` has 441 lines (read by the lead).

**The schemas and decode helpers:**
- `EMAIL_PATTERN` (`:82`), `lengthChecked` (`:89`), `ResendApiKey` (`:101`), `From` (`:105`), `Lowercased` (`:109`), `AdminEmail` (`:118`);
- `SetupBody` (`:135`), `SetupStatus` (`:141`), `SetupResult` (`:146`), `firstMessage` (`:155-172`).

**The helpers after `createSetupApi`** (`:192`): `mailConfigured` (`:390`), `createSetupInvite` (`:400`) and `sendSetupTestCode` (`:430`).

**This is the first-run setup, which handles the Resend key and the first invite**, so it is a keys and auth area.

### What to build
1. **A new `apps/server/src/setup/schema.ts`** holds `:82-172`, **moved byte-for-byte** and exported where `api.ts` uses them.
2. **A new `apps/server/src/setup/mail.ts`** holds `mailConfigured`, `createSetupInvite` and `sendSetupTestCode`, moved byte-for-byte and exported.
3. **`api.ts`** keeps the rate-limit constants, `SetupApiDependencies`, `SetupGroup`, `SetupApi`, `notFound` and `createSetupApi`, and imports the rest. Keep the existing exports of `api.ts` (re-export a moved name if another file imports it from `./api`; check with grep).
4. **No behaviour change.** Every validation message, status and code is identical.
5. **Line counts:** each file stays at most 400 lines. Paste `wc -l` in the Report.
6. **Tests:** run `apps/server/src/setup/crypto.test.ts` and any test that imports `setup/api` (`grep -rln "setup/api" apps/server/src`), and paste the results.

### Read first
`AGENTS.md`, and `apps/server/src/setup/api.ts`.

### Allowed files
`apps/server/src/setup/api.ts`, `apps/server/src/setup/schema.ts`, `apps/server/src/setup/mail.ts`, `work/T-1120-split-setup-api.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/setup/crypto.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every file is at most 400 lines.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/setup/api.ts` (441 lines) with no behaviour change:

- New `apps/server/src/setup/schema.ts`: the body-schema block (`EMAIL_PATTERN`,
  `lengthChecked`, `ResendApiKey`, `From`, `Lowercased`, `AdminEmail`,
  `SetupBody`, `SetupStatus`, `SetupResult`, `firstMessage`), moved
  byte-for-byte. `SetupBody`, `SetupStatus`, `SetupResult` and `firstMessage`
  are exported (the only names `api.ts` imports); the rest stay module-private.
- New `apps/server/src/setup/mail.ts`: `mailConfigured`, `createSetupInvite`
  and `sendSetupTestCode`, moved byte-for-byte and exported.
- `api.ts` now keeps the rate-limit constants, `SetupApiDependencies`,
  `SetupGroup`, `SetupApi`, `notFound` and `createSetupApi`, and imports the
  moved names instead. Its imports were trimmed to what is still used.

No other file imports `setup/api` or any moved name: `grep -rln "setup/api"
apps/server/src` matches only `app.ts` (which imports `createSetupApi` and
`SetupApiDependencies`) and a comment in `setup/settings.ts`. So no re-exports
were needed.

### Files changed (all inside the Allowed files)

- `apps/server/src/setup/api.ts` (441 -> 284 lines)
- `apps/server/src/setup/schema.ts` (new, 98 lines)
- `apps/server/src/setup/mail.ts` (new, 75 lines)
- `work/T-1120-split-setup-api.md` (status + this report)

### Evidence that the move is byte-for-byte

Diffs against `main:apps/server/src/setup/api.ts` (only the added `export`
keyword and the new file headers/imports differ):

- `schema.ts` body vs `api.ts` lines 80-172: identical.
- `mail.ts` body vs `api.ts` lines 385-441: identical.
- the rest of `api.ts` (`SetupGroup`..end) vs `api.ts` lines 174-383: identical.

Line counts (`wc -l`):

```
284 apps/server/src/setup/api.ts
 98 apps/server/src/setup/schema.ts
 75 apps/server/src/setup/mail.ts
```

### Commands run (real results)

- `pnpm install`: `Done in 11.4s using pnpm v10.32.1`, no changes.
- `pnpm --filter @zilar/server exec vitest run src/setup/crypto.test.ts --reporter=dot`:
  1 test file passed, 7 tests passed. No test imports `setup/api`, so none
  besides this one applies.
- `pnpm gate` from the repo root, final lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/server
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- Added a short header comment to each new file and the `export` keyword on the
  four names `api.ts` imports; the moved bodies themselves are unchanged.
- Two intermediate `pnpm gate` runs failed and I fixed both inside scope:
  prettier reformatting in `api.ts`, and a missing `Schema` import (`api.ts`
  still calls `Schema.decodeUnknownResult(SetupBody)`).

### Blocked / needs a decision

None.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The split:** `setup/api.ts` goes from 441 to 283 lines. The body schemas and `firstMessage` move to `setup/schema.ts` (98), and `mailConfigured`, `createSetupInvite` and `sendSetupTestCode` move to `setup/mail.ts` (75).
- **The lead's check:** a line diff of the lines removed from `api.ts` against the two new files leaves only the declaration lines (now `export`) and the import lines. Every body moved unchanged.
- **The gate passed.**
