---
id: T-0539
title: "Effect C (HTTP): topics routes (12) onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; mount order kept; every route test unchanged"
status: todo
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

## Review (written by Claude)
