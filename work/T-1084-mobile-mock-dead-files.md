---
id: T-1084
title: "Mock cleanup: delete mobile mock/drafts.ts and mock/time.ts (no importers); trim web mock/ids.ts to currentUserId"
status: todo
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

## Review (written by Claude)
