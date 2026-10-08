---
id: T-0539
title: "Effect C (HTTP): topics routes (12) onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; mount order kept; every route test unchanged"
status: merged
milestone: M5
branch: task/T-0539-effect-http-topics
model: auto
effort: low
depends_on: [T-0536]
estimate: 1 day
---

# T-0539: topics on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".** Worked examples: `apps/server/src/groups/api.ts` (T-0536) and `apps/server/src/roles/api.ts` (T-0525), both with `/groups/:id/...` paths. Do not touch `topics/service.ts`, `topics/access.ts` or any other service file.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies, audit calls and texts)
- **`apps/server/src/topics/routes.ts`** (240 lines) has one `createLimiter` (line 65). Its twelve routes:
  - `GET /groups/:id/topics` (71);
  - `POST /groups/:id/topics` (81), with `createTopicBodySchema`; it answers **201** with `toTopicView(...)`;
  - `GET /topics/:id` (103);
  - `PATCH /topics/:id` (109), with `patchTopicBodySchema`;
  - `POST /topics/:id/archive` (128);
  - `GET /topics/:id/members` (134);
  - `POST /topics/:id/members` (141), with `memberBodySchema`;
  - `DELETE /topics/:id/members/:userId` (161);
  - `PUT /topics/:id/roles` (180), with `setTopicRolesBodySchema`;
  - `GET /topics/:id/ais` (202);
  - `POST /topics/:id/ais` (209), with `addTopicAiBodySchema`;
  - `DELETE /topics/:id/ais/:aiId` (228).
- **`apps/server/src/app.ts`** (around line 384): `createTopicsRoutes({ auth, db, config, adminClient, logger, audit: auditRecorder })`. **Keep the mount at the same position** relative to the other `/groups/:id/...` modules.
- **Tests (all unchanged):** `apps/server/src/topics/topics.test.ts`, `apps/server/src/topics/backfill.test.ts`, `apps/server/src/groups/*.test.ts`, the agents tests that create topics through HTTP (check with grep), the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/topics/api.ts`** following the recipe:
   - the same paths, methods, status codes (201 on create), bodies and audit calls;
   - **the same step order per route;**
   - injectable limiter and `now` where they exist;
   - exact-route mounts at the same position in `app.ts`.
2. **Effect Schema for the five bodies,** with the same rules and no zod left in the module. Keep every text a test asserts; list any changed generic message in the Report.
3. **`app.ts`:** replace the topics `app.route(...)` and its import with `mountEffectRoutes(...)`. Delete `topics/routes.ts`, unless a file outside the Allowed files imports from it; then keep it as a re-export-only file and say so.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/topics/routes.ts` (all of it), and the mount block of `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/topics/api.ts`, `apps/server/src/topics/routes.ts`, `apps/server/src/app.ts`, `work/T-0539-effect-http-topics.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot topics groups authz-sweep app.test
pnpm gate
```

### Acceptance
- Topics is served by Effect `HttpApi` through the adapter, with the same answers and mount order, and has no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- Added `apps/server/src/topics/api.ts`: the twelve topics routes on the Effect `HttpApi` adapter, following the T-0498 recipe and the `groups/api.ts` / `roles/api.ts` worked examples.
  - Same paths, methods, statuses (201 on create), success bodies, audit calls and per-route step order as `routes.ts`.
  - Five payloads are Effect Schemas replicating the zod rules: `CreateTopicBody`, `PatchTopicBody`, `MemberBody`, `AddTopicAiBody`, `SetTopicRolesBody`. Strict bodies carry `HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }` (zod `.strict()`); `name`/`linkUrl`/`linkLabel` use `Schema.Trim`; duplicate the control-character, glyph, https-URL and length filters. No zod is imported in the module.
  - The create budget is an endpoint middleware (`TopicsCreateRateLimit`) so it runs after `Session` and before the payload decode, matching the old `limiter.allow` → decode order; `now` stays injectable. `createLimiter` is built exactly as before (`30 / 60 min`).
  - Session + schema-error middleware on the group (`401` before decode; decode failure → `400 invalid_request` via the shared envelope). The router logger stays off.
- `apps/server/src/app.ts`: replaced the `createTopicsRoutes` import and the `app.route('/api', …)` mount with `createTopicsApi(...)` + `mountEffectRoutes(...)` at the **same position** (after `pinsApi`, before `createChatsRoutes`).
- Deleted `apps/server/src/topics/routes.ts`. Only `app.ts` imported it (verified with grep), so no re-export shim was needed. `TOPIC_CREATE_RATE_LIMIT_MAX` / `_WINDOW_MS` moved to `api.ts` and are not imported anywhere else.

### Deviations / notes

- The generic `400` message for an invalid body is now the Effect Schema message instead of the first zod issue text (e.g. `name must be at least 1 character(s)` instead of `name must not be empty`). No listed test asserts those strings (grep for the old texts in `topics/*.test.ts` found none), so behavior a test can see is unchanged. The `404` text is untouched (`TopicServiceDeps`/`toMissingTopic`).
- `TopicsApiDependencies.logger` is typed `Logger` (like `groups/api.ts`) instead of `InviteLogger`, because `withErrorEnvelope`/`sessionLayer`/`failureResponse` need pino's `Logger`. `AppDependencies.logger` already is `Logger`.

### Commands run (real results)

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot topics.test.ts` → 1 file, **32 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot backfill groups authz-sweep app.test` → 6 files, **96 passed**.
- `pnpm gate` (first run): `PASS install`, `FAIL format` (`apps/server/src/topics/api.ts`), scope clean. After `prettier --write` on that one file, second run: `PASS format`, `PASS lint`, `FAIL typecheck` (`InviteLogger` not assignable to `Logger`). Fixed by typing the dep as `Logger`. Final run:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (27.9s)
PASS  lint  (0.8s)
PASS  typecheck  (19.1s)
PASS  tests @zilar/server  (409.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Files changed

- `apps/server/src/topics/api.ts` (new)
- `apps/server/src/topics/routes.ts` (deleted)
- `apps/server/src/app.ts` (mount)
- `work/T-0539-effect-http-topics.md` (this report)

### Security checklist

- Nothing new is logged; the audit calls and their id-only detail are unchanged. No secrets reach errors or URLs.
- Every route is covered by the `authz-sweep` 401 test (passed); the create write keeps its per-user rate limit. Delete/update scoping is untouched (service layer unchanged).

## Review (written by Claude)

Approved (lead, 2026-10-08). Topics (12 routes) is served by Effect HttpApi at the same mount position, with the same step order (limiter before decode), statuses (201 on create), strictness and texts, and no zod. Lead check: the TopicView, owner, role, AI and members output schemas list every field of the service types, so nothing is stripped. Pre-review clean.
