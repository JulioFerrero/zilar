---
id: T-0858
title: "better-auth session cookie cache, 5 minutes — Julio approved"
status: todo
milestone: M5
branch: task/T-0858-session-cookie-cache
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0858: better-auth session cookie cache, 5 minutes — Julio approved

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Julio approved this on 2026-10-09 ("Yes, 5 minutes", D-3). Finding C-F7 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **Today:** every authenticated request calls `auth.api.getSession` (`apps/server/src/effect/http-core.ts:55`, `apps/server/src/auth/api.ts:273`).
- **No cache:** `apps/server/src/auth/auth.ts` (about lines 67-133) configures no `session: { cookieCache }`.
- **Two queries per request:** the custom adapter `apps/server/src/auth/sql-adapter.ts` implements no join, so each lookup is at least 2 queries.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Enable better-auth's session cookie cache with `maxAge` of 5 minutes. Read the installed better-auth version's types and docs in node_modules for the exact option and how it signs the cookie.
2. Check how the mobile **bearer** path (the bearer plugin) interacts with the cookie cache, and say in the Report whether mobile requests benefit or still hit the DB. Do not add a custom cache in this task.
3. **Behaviour to keep:** sign-out on this device must end the session at once (the cookie is cleared). A session revoked from another device may stay valid for up to 5 minutes; Julio accepted that. Add or adjust tests:
   - a cached session is served without a DB session read (count adapter calls if the tests allow);
   - sign-out clears it;
   - the existing auth tests pass.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/auth/auth.ts`, `apps/server/src/auth/*.test.ts`, `apps/server/src/effect/http-core.ts`, `work/T-0858-session-cookie-cache.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/auth
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio signs in on web and mobile, signs out, and signs in again.

---

## Report (written by the worker when done)

## Review (written by Claude)
