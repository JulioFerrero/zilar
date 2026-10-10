---
id: T-1084
title: "Mock cleanup: delete mobile mock/drafts.ts and mock/time.ts (no importers); trim web mock/ids.ts to currentUserId"
status: merged
milestone: M5
branch: task/T-1084-mobile-mock-dead-files
model: auto
effort: default
depends_on: [T-1082]
estimate: 0.1 day
---

# T-1084: Delete the dead mock files

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §1 (T-1082), checked by the lead with `grep` on main (2026-10-11):
- **mobile `apps/mobile/src/mock/drafts.ts`** (62 lines) has no importer;
- **mobile `apps/mobile/src/mock/time.ts`** (14) is imported only by `mock/drafts.ts:11`;
- **web `apps/web/src/mock/ids.ts`** (30) is imported only by `apps/web/src/auth/AuthProvider.tsx:9`, for `currentUserId`. Its `PEOPLE`, `ME`, `AI_JIDS` and `ROOMS` exports have no importer.

Mobile `mock/load.ts` is also unimported, but the mock plan keeps it for screenshot scenarios, so it stays.

### What to build
1. **Before each deletion,** run `grep -rn` across the app (`src`, `app`, `test`, `e2e`, config files), including `require(` and `import(` forms. Show the results in the Report.
2. **Delete** `apps/mobile/src/mock/drafts.ts` and `apps/mobile/src/mock/time.ts`.
3. **In `apps/web/src/mock/ids.ts`,** keep only `currentUserId` and what it needs. Delete the exports nothing imports, after a grep for each one. If one turns out to be used, keep it and say so.
4. **No other changes,** and no tests.

### Read first
`AGENTS.md` and `docs/audit/mock-sweep-status.md` §1.

### Allowed files
`apps/mobile/src/mock/drafts.ts`, `apps/mobile/src/mock/time.ts`, `apps/web/src/mock/ids.ts`, `work/T-1084-mobile-mock-dead-files.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the greps.

---

## Report (written by the worker when done)

### What I did
1. Ran `pnpm install` (frozen lockfile semantics) — completed, 13.3s, only the usual `@types/react-dom` peer warning.
2. Ran the pre-deletion greps required by the spec, over `apps/mobile/{src,app,test,e2e}` and repo-wide (excluding `node_modules`/`.git`), including `from`, `require(` and dynamic `import(` forms.
3. Deleted `apps/mobile/src/mock/drafts.ts` and `apps/mobile/src/mock/time.ts` with `git rm`.
4. Grepped each export of `apps/web/src/mock/ids.ts` and trimmed the file to only `currentUserId` (the sole exported symbol with an importer). No test was added (spec says no tests).

### Greps (spec step 1 and 3)

Mobile importers of `mock/drafts` (`from`, `require(`, `import(`):
```
apps/mobile/src/store/effects/ports.ts:15:import { ... } from '../../lib/drafts'
```
That is `lib/drafts.ts`, **not** `mock/drafts.ts` (`mock/drafts` had no importer). Nothing else matched.

Mobile importers of `mock/time`:
```
apps/mobile/src/mock/drafts.ts:11:import { at } from './time';
```
Only the file being deleted. Repo-wide `mock/drafts` / `mock/time` matches were docs/task files (`docs/audit/*`, `work/T-*.md`) only — no code importers. `hoursFromNow` had no importer anywhere.

Web `ids.ts` exports (excluding `ids.ts` itself):
- `currentUserId` — imported by `apps/web/src/auth/AuthProvider.tsx:9` (used at `:100`). Kept.
- `MockPerson` — none. Deleted.
- `PEOPLE` — none. Deleted.
- `ME` — none (the only other `ME` is a local `const ME` in `realStore.echo-edit.test.tsx`, unrelated). Deleted.
- `AI_JIDS` — none. Deleted.
- `ROOMS` — none. Deleted.

`ids.ts` now contains a single line: `export const currentUserId = 'u-you';`.

Note: many `currentUserId` hits across `apps/web/src` are the chat-store selector `s.currentUserId`, not this mock export; the only importer of the mock export is `AuthProvider.tsx`.

### Files changed
- `apps/mobile/src/mock/drafts.ts` — deleted.
- `apps/mobile/src/mock/time.ts` — deleted.
- `apps/web/src/mock/ids.ts` — trimmed to `currentUserId` only (`29 deletions`).
- `work/T-1084-mobile-mock-dead-files.md` — status/report.

No deviations from the spec. No other files touched.

### Commands and real results
- `pnpm install` → `Done in 13.3s` (one peer-dep warning: `@types/react-dom 19.3.0` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm gate` (from repo root) summary:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.6s)
PASS  format  (1.3s)
PASS  lint  (1.5s)
PASS  typecheck  (5.5s)
PASS  effect  (1.2s)
SKIP tests @zilar/mobile (no nearby test files)
PASS  tests @zilar/web  (2.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```
No single test files were run while working (pure deletions plus a constant-only file), so the gate's nearest-tests run is the only test run.

### Open questions / problems
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 follow-up.**
- **The change:**
  - deleted mobile `mock/drafts.ts` (62 lines) and `mock/time.ts` (14), which nothing imports;
  - web `mock/ids.ts` is trimmed to `currentUserId` (29 lines removed).
  - The Report shows the worker's greps.
- **The follow-up:** a stale comment in mobile `mock/load.ts`, which is outside this task's files.
- **Check:** the gate passed, including typecheck on both apps and the `@zilar/web` tests. These are pure deletions, so the lead ran no UI check.
