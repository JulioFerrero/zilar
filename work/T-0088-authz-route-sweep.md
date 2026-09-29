---
id: T-0088
title: Authorization sweep (server) — a test that every route answers 401 without a session unless it is on a reviewed public list
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**
