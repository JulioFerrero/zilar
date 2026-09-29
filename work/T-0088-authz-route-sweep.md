---
id: T-0088
title: Authorization sweep (server) — a test that every route answers 401 without a session unless it is on a reviewed public list
status: merged
milestone: M4
branch: task/T-0088-authz-route-sweep
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0079]
estimate: 0.5 day
---

# T-0088: Every route needs a session

## Spec (written by Claude, do not edit)

### Goal

Each server route calls `requireSession` by hand. A new route that forgets it would be open to the world, and nothing would notice. Add a **guard test** that lists every route the app registers and proves that, called with **no session at all**, it answers `401` (or is on a short, reviewed allowlist of public routes). It fails loudly when someone adds a route without auth. It also produces the table of routes for the Report, which is useful for security review.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/app.ts` (how the app is composed and mounted, including the routes that are only mounted when optional services are configured: connections, AIs, voice) and `apps/server/src/test-support.ts` (`createTestContext`, `bootstrapUser`)
- `apps/server/src/auth/session.ts` (`requireSession`) and `auth/routes.ts`, `errors.ts` (the error shape)
- Hono's route list: a `Hono` instance exposes `app.routes` (array of `{ method, path, handler }`, including `ALL` and wildcard entries). Check the installed Hono version's behavior in a scratch test before relying on it.
- Existing route tests in `apps/server/src/**/routes.test.ts` for how apps are built with the optional services (fake LiteLLM, key cipher) so that **all** routes are mounted in the sweep

### Allowed files
- `apps/server/src/authz-sweep.test.ts` (new)
- `apps/server/src/test-support.ts` **only** if a small helper is needed to build the fully configured app
- `work/T-0088-authz-route-sweep.md`

**Not allowed:** changes to any route or to production code. If the sweep finds a route that is open without a session, **do not fix it**: put it in the Report under "Blocked / needs a decision" with the method and path, mark the test for that route with the allowlist entry **only if** the route is genuinely meant to be public (see below), and otherwise leave the test failing on purpose is **not** acceptable either: use `it.fails`/a documented `KNOWN_OPEN` list with a `TODO` naming the route and say so prominently in the Report so the lead can fix it in a separate task.

### What to build
1. Build the app with **everything mounted** (connections, AIs, voice, the runner hub's `isMachineOnline` not needed) using the test helpers, so no route is skipped because a service is unconfigured. If a route group cannot be mounted in tests, list it in the Report.
2. Enumerate `app.routes`, drop duplicates and the internal `ALL` middleware entries, and for each `(method, path)` under `/api` build a concrete URL (replace `:id`-style params with a dummy like `probe`; wildcards with `x`) and call it **without cookies**. Use a valid-looking body only where the method needs one; do not send credentials.
3. Expected result for each: `401`. **Public allowlist** (exact `(method, path)` pairs, each with a one-line reason in a comment): the Better Auth handler under `/api/auth/*` (sign-in, sign-up, session lookups are public by design), `GET /api/invites/:code` (validity check for a signup link) and `POST /api/runner/pair` (the pairing code and a signature are its credentials; expect `400 invalid_code`, not 401), and `GET /health`. Anything else that is public must be added to the list deliberately in the Report, not silently.
4. The test also asserts that the allowlist has **no stale entries** (every allowlisted pair really exists in `app.routes`), so it cannot rot.
5. Print nothing sensitive; no secrets in the test.

### Tests
The sweep itself is the test. Add one negative control: register a throwaway route without auth on a **local** Hono instance and show that the sweep helper flags it (so the helper is proven to detect a missing guard).

### Live check (the lead does it)
Not needed.

### Acceptance criteria
- [ ] Every `/api` route is covered; the public allowlist is explicit, commented and free of stale entries.
- [ ] The sweep fails if a route without auth is added (proven by the negative control).
- [ ] No production code changed. Any open route found is listed prominently in the Report with method and path.
- [ ] No `any`, no `@ts-ignore`, no lint disables, no new dependencies; lint passes (re-run it after your last edit).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Cross-user (stranger) checks per resource, rate limits, CSRF, fixing anything the sweep finds.

---

## Report (written by the worker when done)

### What I did
- Added a single new file `apps/server/src/authz-sweep.test.ts` (no production code touched, `test-support.ts` unchanged).
- Built a small sweep helper that enumerates `app.routes`, deduplicates entries, drops the two known top-level middleware paths (`/*` and `/api/*` from `app.use('*', ...)` / `app.use('/api/*', ...)` in `app.ts`), and probes every endpoint under `/api` without cookies. `:id`-style params are replaced with `probe` and `*` wildcards with `x`. `ALL` entries (the Better Auth handler) are probed with `GET`.
- Defined `PUBLIC_ALLOWLIST` with one comment per entry covering exactly the four entries the spec lists: `ALL /api/auth/*`, `GET /api/invites/:code`, `POST /api/runner/pair`, `GET /health`.
- Wrote five tests:
  1. `returns 401 on every /api route not on the public allowlist` — the main sweep. Prints the route table to stderr for the Report.
  2. `sweeps every endpoint under /api (no route is silently skipped)` — guards against a future filter bug silently dropping a route from the sweep.
  3. `does not have stale entries on the public allowlist` — every allowlisted `(method, path)` must still exist in `app.routes`, so the list cannot rot.
  4. `verifies each allowlisted route is actually reachable without a session` — proves an allowlisted entry really is public (status ≠ 401), so a refactor that breaks a public route is caught.
  5. `flags a throwaway route without auth on a local instance` — the required negative control: a local Hono with `/api/open-route` (no guard, returns 200) and `/api/guarded-route` (throws `HttpError(401)`). The sweep helper flags the open one as not-401 and the guarded one as 401, proving the helper detects a missing guard.
- Did **not** add any dependencies; did **not** change `test-support.ts` (the existing `testApp(context)` already builds the app with every route group mounted; the cipher/probe/litellm/voice-engine are all optional and every endpoint calls `requireSession` first, so a missing optional dependency does not change the 401 outcome).

### Files changed
- `apps/server/src/authz-sweep.test.ts` (new, 222 lines).
- `work/T-0088-authz-route-sweep.md` (status: in-progress → review, and this Report).

### Commands run and real results
- `pnpm install` — `Done in 6.2s using pnpm v10.32.1`, 1010 packages added.
- `pnpm --filter @galena/server exec vitest run --testTimeout=30000 --hookTimeout=30000 authz-sweep` — `Test Files 1 passed (1) | Tests 5 passed (5)`. The route table printed to stderr (see below).
- `pnpm --filter @galena/server exec vitest run --testTimeout=30000 --hookTimeout=30000` — full server suite: `Test Files 47 passed | 5 skipped (52) | Tests 682 passed | 7 skipped (689)`. The five new tests in `authz-sweep.test.ts` bring the total to 682 (up from 677 before this task).
- `pnpm format:check` — `All matched files use Prettier code style!` (after one initial `pnpm exec prettier --write` to fix a line-break).
- `pnpm lint` — `oxlint .` clean (no errors).
- `pnpm typecheck` — all 10 turbo tasks `successful` (`tsc --noEmit` for every package).
- `pnpm exec turbo test --force --filter=@galena/server` — `Test Files 47 passed | 5 skipped (52) | Tests 682 passed | 7 skipped (689)` in 182 s.
- `pnpm build` — both turbo build tasks `successful`.

### Route table (printed by the sweep, every route answered exactly as expected)

```
=== authz sweep: 40 /api routes ===
  ALL     /api/auth/*                              -> 404 [allowlisted]
  GET     /api/me                                  -> 401
  PATCH   /api/me                                  -> 401
  POST    /api/invites                             -> 401
  GET     /api/invites/:code                       -> 200 [allowlisted]
  DELETE  /api/invites/:code                       -> 401
  GET     /api/contacts                            -> 401
  POST    /api/machines/pairing-codes              -> 401
  GET     /api/machines                            -> 401
  POST    /api/machines/:id/approve                -> 401
  POST    /api/machines/:id/deny                   -> 401
  POST    /api/machines/:id/revoke                 -> 401
  PATCH   /api/machines/:id                        -> 401
  DELETE  /api/machines/:id                        -> 401
  POST    /api/runner/pair                         -> 400 [allowlisted]
  POST    /api/groups                              -> 401
  GET     /api/groups/:id                          -> 401
  POST    /api/groups/:id/members                  -> 401
  DELETE  /api/groups/:id/members/:userId          -> 401
  POST    /api/groups/:id/ais                      -> 401
  DELETE  /api/groups/:id/ais/:aiId                -> 401
  GET     /api/chats                               -> 401
  GET     /api/drafts/stream                       -> 401
  GET     /api/audit                               -> 401
  GET     /api/approvals                           -> 401
  GET     /api/approvals/:id                       -> 401
  POST    /api/approvals/:id/decision              -> 401
  POST    /api/xmpp/token                          -> 401
  POST    /api/voice                               -> 401
  GET     /api/connections                         -> 401
  POST    /api/connections                         -> 401
  POST    /api/connections/:id/test                -> 401
  DELETE  /api/connections/:id                     -> 401
  GET     /api/ais                                 -> 401
  GET     /api/ais/:id                             -> 401
  POST    /api/ais                                 -> 401
  PATCH   /api/ais/:id                             -> 401
  DELETE  /api/ais/:id                             -> 401
  POST    /api/ais/:id/stop                        -> 401
  POST    /api/ais/:id/resume                      -> 401
```

(`/health` is also registered and allowlisted but is not under `/api`, so the sweep skips it; the "no stale entries" assertion confirms `GET /health` is in `app.routes`.)

### Problems, deviations from the spec, open questions
- **Detecting middleware vs endpoint entries**: Hono stores both `app.use(...)` middleware and endpoint routes in `app.routes`, and both can have `method='ALL'` and a wildcard path (the Better Auth handler is `ALL /api/auth/*` while the two `app.use` calls produce `ALL /*` and `ALL /api/*`). There is no marker on `RouterRoute` to distinguish them. I filter the two exact paths the middleware uses in `app.ts` (`/*` and `/api/*`). The filter is documented in a comment above `isMiddlewareEntry` with the warning "If a future change adds another `app.use(...)` pattern, this filter must be updated too." The sweep prints all 40 endpoint routes; the alternative would have been to introspect each handler for `next()` (fragile and undocumented).
- **`ALL /api/auth/*` probing**: the Better Auth entry is one `ALL` route; the sweep sends one `GET` to `/api/auth/x`. Better Auth returns 404 (unknown sub-path), not 401. I also probed `POST` against several real Better Auth paths during scratch testing — none returns 401 — so a single GET probe is sufficient to prove "Better Auth is public". The "no stale entries" assertion independently confirms `ALL /api/auth/*` is still registered.
- **Negative control**: the local Hono uses a hand-rolled `onError` to translate `HttpError` to the right status. Without it, the unguarded route would still surface correctly (200), but the "guarded route should answer 401" assertion would receive 500 because Hono propagates uncaught throws as 500. The `onError` is a one-time setup mirroring what `createApp` already does.
- **Type variance for Hono generics**: `createApp` returns `Hono<{ Variables: RequestIdVariables }, ...>` while a local `new Hono()` has the default `BlankEnv`. They are not assignable to each other even though both are valid Hono instances. I introduced `type SweepEnv = { Variables: RequestIdVariables }` and used `Hono<SweepEnv>` for both, which compiles without `any` or `@ts-ignore`.

### Blocked / needs a decision
- None. The sweep found **zero** routes reachable without a session. All 40 endpoints either require a session (return 401) or are on the reviewed allowlist.

---

## Review (written by Claude)

**Verdict:** approved and merged. Tests only, no production code touched.

Rebased onto main, format, lint, typecheck and the new test file pass (5 tests); the worker's full server run was 682 passed. No lint or ts disable comments.

- The sweep enumerates `app.routes` and probes every `/api` route without a session. 40 routes: all answer 401 except the four allowlisted ones (Better Auth, invite check, runner pairing, health). **No open route found.**
- The allowlist is explicit and commented, has a stale-entry check, and a check that allowlisted routes really are public. The negative control proves the helper flags an unguarded route.
- Known limits (accepted): the sweep only covers paths under `/api` (routes outside it, apart from `/health`, are not probed), and the two middleware paths `/*` and `/api/*` are filtered by name.
