---
id: T-0536
title: "Effect C (HTTP): groups routes (create, read, members, roles change, AIs, patch, join) onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; mount order kept; every route test unchanged"
status: merged
milestone: M5
branch: task/T-0536-effect-http-groups
model: auto
effort: low
depends_on: [T-0525]
estimate: 1 day
---

# T-0536: groups on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".** Worked examples:
- `apps/server/src/chat-folders/api.ts` (T-0520): strict bodies, defaults, refine texts and 201;
- `apps/server/src/roles/api.ts` (T-0525): `/groups/:id/...` paths and 204.

Do not touch `groups/service.ts`, `groups/join.ts` or `groups/visibility.ts`.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/routes.ts`** (401 lines) has two limiters: `roleLimiter` (line 136) and `joinLimiter` (line 141). Its ten routes:
  - `POST /groups` (147), with `createGroupSchema`;
  - `GET /groups/:id` (173);
  - `GET /groups/:id/members` (197);
  - `PUT /groups/:id/members/:userId/role` (214): **the limiter before the decode** (`changeRoleSchema`);
  - `POST /groups/:id/members` (240), with `addMembersSchema`;
  - `DELETE /groups/:id/members/:userId` (262);
  - `POST /groups/:id/ais` (274), with `addAiSchema`;
  - `DELETE /groups/:id/ais/:aiId` (296);
  - `PATCH /groups/:id` (318), with `patchGroupSchema`;
  - `POST /groups/:id/join` (381): **the limiter first.**
  
  Read each route for its exact step order, status codes, bodies, audit calls and error texts.
- **Mount order matters.** In `apps/server/src/app.ts`, the directory module (with `GET /groups/by-handle/:handle`) is mounted before groups (`app.route('/api', createGroupsRoutes({ auth, db, config, adminClient, logger, audit: auditRecorder }))`, around lines 361-364), and so are roles and invite-links (`/groups/:id/roles`, `/groups/:id/invite-links`). **Keep the groups mount at the same position**, so `/groups/by-handle/...` still reaches directory and not `GET /groups/:id`.
- `CHAT_BACKGROUND_PRESET_IDS` is imported from `../chat-prefs/service` (for the group background patch).
- **Tests (all unchanged):**
  - `apps/server/src/groups/groups.test.ts` and `apps/server/src/groups/visibility.test.ts`;
  - `apps/server/src/topics/*.test.ts`, `apps/server/src/roles/roles.test.ts` and `apps/server/src/invite-links/*.test.ts` (they create groups through the API);
  - `apps/server/src/agents/gateway.test.ts` only if it calls the HTTP routes (check with grep);
  - the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/groups/api.ts`** following the recipe:
   - the same paths, methods, status codes, bodies and audit calls;
   - **the same step order per route** (session, then limiter or decode exactly as today, then the service);
   - injectable limiters and `now` where they exist;
   - exact-route mounts at the same position in `app.ts`.
2. **Effect Schema for the five bodies,** with the same rules (lengths, enums, strictness, defaults, refines) and no zod left in the module. Keep every text a test asserts; list any changed generic message in the Report.
3. **`app.ts`:** replace the groups `app.route(...)` and its import with `mountEffectRoutes(...)` at the same position. Delete `groups/routes.ts`, unless a file outside the Allowed files imports from it; then keep it as a re-export-only file and say so.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/chat-folders/api.ts`, `apps/server/src/roles/api.ts`, `apps/server/src/groups/routes.ts` (all of it), and the mount block of `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/groups/api.ts`, `apps/server/src/groups/routes.ts`, `apps/server/src/app.ts`, `work/T-0536-effect-http-groups.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups topics roles invite-links authz-sweep app.test
pnpm gate
```

### Acceptance
- Groups is served by Effect `HttpApi` through the adapter, with the same answers and mount order, and has no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/groups/api.ts`** (new): the groups module on the Effect `HttpApi` adapter, following the T-0498 recipe (`chat-folders/api.ts` and `roles/api.ts`). The same ten routes, methods, paths, status codes, bodies and audit calls as the deleted Hono router:
  - five Effect body schemas replacing the zod ones: `CreateGroupBody` (trimmed 1..100 title, `memberIds` 1..50 non-empty strings defaulting to `[]`, optional `kind`/`description`/`visibility`/`handle`), `AddMembersBody` (1..50 non-empty ids), `AddAiBody` (non-empty `aiId`), `ChangeRoleBody` (strict, `admin`/`member`), `PatchGroupBody` (strict, with the strict nested `background` object: preset enum from `CHAT_BACKGROUND_PRESET_IDS`, 1..64 image id, int dim 0..80, all nullable/optional; plus `membersCanCreateTopics`, `visibility`, `handle`, `listenerEnabled`, `listenerEagerness`). `onExcessProperty: 'error'` on the two zod-strict routes only.
  - step order per route preserved: `Session` first, then the module-local rate-limit middleware before the decode for `PUT .../role` and `POST .../join`, then the service. The two limiters are injectable (`roleLimiter`/`joinLimiter`) and keep the `now` seam.
  - output schemas for every JSON body, including `GroupDetailView` with `createdAt: Schema.Date` (JSON-stringifies to the same ISO string Hono produced).
  - `GroupsSchemaErrors` maps decode failures to the same `400 invalid_request`; `GroupsRoleRateLimit` answers `429 rate_limited` "Too many role changes, try again later" and `GroupsJoinRateLimit` "Too many join attempts, try again later", byte-identical to the old texts.
- **`apps/server/src/app.ts`**: replaced the `createGroupsRoutes` import and the `app.route('/api', ...)` call with `createGroupsApi(...)` + `mountEffectRoutes(...)` **at the same position** (after the directory mount, before invite-links), so `/api/groups/by-handle/:handle` still reaches the directory module.
- **`apps/server/src/groups/routes.ts`**: deleted. Grep confirmed the only importer was `app.ts` (mobile has a comment pointing at the path, not an import).
- **No test changed.** `groups/service.ts`, `groups/join.ts` and `groups/visibility.ts` untouched.

### Commands run

- `pnpm install` — done (49.2s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups` — **2 test files passed, 80 passed** (`groups.test.ts`, `visibility.test.ts`).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot topics roles invite-links authz-sweep app.test` — **6 test files passed, 90 passed**.
- `pnpm gate` (from repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (16.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (12.8s)
  PASS  tests @zilar/server  (598.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed

`apps/server/src/groups/api.ts` (new), `apps/server/src/groups/routes.ts` (deleted), `apps/server/src/app.ts`, `work/T-0536-effect-http-groups.md`.

### Deviations / notes

- **Changed generic decode message:** the old zod path used `parsed.error.issues[0]?.message ?? 'Invalid request'`; the Effect path uses `error.cause.message || 'Invalid request'`, so a malformed/absent body now carries the Effect Schema message instead of the first zod issue. Grep found no test asserting those texts (only service-level messages like "Unknown background image" are asserted, and those are unchanged). The two rate-limit messages and all service-facing messages are unchanged.
- I added optional `roleLimiter`/`joinLimiter` injection in addition to the existing `now` seam, like `blocks/api.ts` and `pins/api.ts` do; production (`app.ts`) passes neither, so behavior is unchanged.
- `agents/gateway.test.ts` does not call these HTTP routes (it inserts rows directly), per grep, so it needed no run.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-08). Groups is served by Effect HttpApi at the same mount position, so by-handle still reaches directory. The ten routes keep their step order (limiter before decode on role and join), statuses and texts; strictness matches zod per route, and no zod is left. Lead check: the GroupDetailView output schema lists every GroupDetail field, so no field is stripped. Pre-review clean, 0 nits.
