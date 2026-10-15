---
id: T-1559
title: "Split apps/server/src/auth/api.ts (399 lines): the /me view (meView, sessionUserById and their row types) moves to auth/me-view.ts; api.ts keeps the routes and every export; no behaviour change"
status: merged
milestone: M5
branch: task/T-1559-split-auth-api
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1559: Split auth/api.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/auth/api.ts` is 399 lines. It is auth (crucial code), so the move must be exact. **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **Exports:** the four rate-limit constants (`:53-56`), `AuthApiDependencies` (`:58`) and `createAuthApi` (`:127`).
- **Internal:**
  - `HandleLookupRow` (`:74`) and `SessionUserLookupRow` (`:78`);
  - `UpdateMeBody` (`:88`) and `updateMeMessage` (`:97`);
  - `AuthApi` (`:125`).
- **The `/me` helpers:**
  - `meView(deps, userId)` (`:333-378`), called by the `me` handler at `:147`;
  - `sessionUserById(deps, userId)` (`:380-399`), called by `meView` (`:348`).

### Steps
1. **New `apps/server/src/auth/me-view.ts`:** move `meView`, `sessionUserById` and the row interfaces only they use (check `HandleLookupRow` and `SessionUserLookupRow`) unchanged. Export `meView` (and `sessionUserById` if `api.ts` still uses it). Import `AuthApiDependencies` as a **type** from `./api`, so there is no runtime cycle.
2. **`api.ts`** imports `meView` and keeps every export. Remove the imports only the moved code used.
3. **No behaviour change.** The auth tests must pass in the gate.

### Allowed files
- `apps/server/src/auth/api.ts`
- `apps/server/src/auth/me-view.ts` (new)
- `work/T-1559-split-auth-api.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `api.ts` before and after (identical);
  - the gate summary.
- `/api/auth/me` (or the route the `me` handler serves) still answers 401 signed out after the deploy (the lead checks).

---

## Report (written by the worker when done)

### What I did

Moved the `/me` view out of `apps/server/src/auth/api.ts` into the new
`apps/server/src/auth/me-view.ts`, unchanged, per the spec:

- **New `apps/server/src/auth/me-view.ts`** holds `meView` (exported), its private
  helper `sessionUserById`, and the two row interfaces only they use
  (`HandleLookupRow`, `SessionUserLookupRow`). It imports `AuthApiDependencies` as a
  **type** from `./api`, so there is no runtime cycle.
- **`api.ts`** now imports `meView` from `./me-view` and keeps all of its exports
  (`AUTH_INVITE_RATE_LIMIT_MAX`, `AUTH_INVITE_RATE_LIMIT_WINDOW_MS`,
  `AUTH_ME_RATE_LIMIT_MAX`, `AUTH_ME_RATE_LIMIT_WINDOW_MS`,
  `AuthApiDependencies`, `createAuthApi`). Removed the imports only the moved code
  used (`SqlClient`, `runSql`, `findXmppAccount`, `bioForUser`, `timeZoneFor`,
  `avatarIdsByOwner`, `avatarUrlFor`); kept `HttpError` (still used by `updateMe`,
  `revokeInvite`) and the rest.
- No behaviour change: the moved function bodies, texts, SQL and status codes are
  byte-identical. No test was added or edited; no importer changed.

### Checks run

- `wc -l` (after): `apps/server/src/auth/api.ts` **316**, `apps/server/src/auth/me-view.ts` **92**.
  Before: `apps/server/src/auth/api.ts` **399**. Both are under 400 lines and the
  `max-lines` warning is gone.
- Export list `api.ts` before/after (`grep -E "^export"`), identical:
  - `export const AUTH_INVITE_RATE_LIMIT_MAX`
  - `export const AUTH_INVITE_RATE_LIMIT_WINDOW_MS`
  - `export const AUTH_ME_RATE_LIMIT_MAX`
  - `export const AUTH_ME_RATE_LIMIT_WINDOW_MS`
  - `export interface AuthApiDependencies`
  - `export function createAuthApi(deps: AuthApiDependencies): EffectApiMount`
  - `me-view.ts` adds one new export: `export async function meView`.
- Single test run: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts`
  → `Test Files 1 passed (1)`, `Tests 37 passed (37)`.
- `pnpm gate` (repo root), real summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (7.8s)
  PASS  format  (7.0s)
  PASS  lint  (9.8s)
  PASS  typecheck  (9.8s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/server  (45.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 3 changed files are `apps/server/src/auth/api.ts`, `apps/server/src/auth/me-view.ts`
  and `work/T-1559-split-auth-api.md`, all in the Allowed files.

### Notes for the lead

- Effect ratchet: `me-view.ts` imports `effect` (`Effect`) and `effect/sql`
  (`SqlClient`) as values, so it classifies as `effect`, not `needs-effect`.
  No `// effect-plain:` marker was added; gate printed `PASS effect`.
- `me-view.ts` carries a one-line header comment naming the split; every other line
  is moved text unchanged.
- The security checklist is untouched by this task: route set, permission checks,
  rate limits and SQL are unchanged, only relocated. The 401 signed-out behaviour is
  a deploy-time check for the lead.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `api.ts` 316 and `me-view.ts` 92 lines (was 399).
  - **Exports:** the `^export` lines of `api.ts` are identical to main's.
  - **No cycle:** `me-view.ts` imports only the **type** `AuthApiDependencies` from `./api`.
- **Tests:** the auth tests passed in the worker's gate.
- **After the deploy,** the lead checks that the `/me` route answers 401 signed out.

