---
id: T-0559
title: "Effect C (HTTP): tools routes (lists per AI/group/topic, detail, versions, runs, revert, delete, run) onto the HttpApi adapter, zod to Effect Schema; 16 KiB input refine and run order kept; createToolsRoutes stays as a thin Hono wrapper; tests unchanged"
status: todo
milestone: M5
branch: task/T-0559-effect-http-tools
model: auto
effort: low
depends_on: [T-0554]
estimate: 1 day
---

# T-0559: tools routes on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"**, items 8-11. The worked examples are `apps/server/src/routines/api.ts` (T-0554, the neighbouring module, with the item-11 wrapper) and `apps/server/src/topics/api.ts`. **Do not touch** the tools service, runner, adapters or sandbox files.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies, audit calls and texts)
- **`apps/server/src/tools/routes.ts`** (597 lines):
  - `TOOL_RUN_RATE_LIMIT_MAX` and `TOOL_RUN_RATE_LIMIT_WINDOW_MS` (lines 27-28);
  - `ToolsRoutesDependencies` (30) holds `auth`, `db`, `audit?`, `toolRunner?` (absent means run answers **501** `runner_unavailable`) and `now?`;
  - `revertBodySchema` (40), a strict `{ version: int >= 1, message?: 1..200 }`;
  - `MAX_TOOL_RUN_INPUT_BYTES = 16 * 1024` (49, exported);
  - `runBodySchema` (51), a strict `{ input?: unknown, version?: int >= 1 }`. Its refine requires `JSON.stringify(input)` to be at most 16 KiB in UTF-8 bytes, and a value that cannot be stringified fails;
  - `createToolsRoutes` (75), with `runLimiter` (83).
- **The ten routes:**
  - `GET /ais/:id/tools` (89), `GET /groups/:id/tools` (112) and `GET /topics/:id/tools` (127);
  - `GET /tools/:id` (156), `GET /tools/:id/versions` (162), `GET /tools/:id/versions/:n` (168) and `GET /tools/:id/runs` (174);
  - `POST /tools/:id/revert` (180);
  - `DELETE /tools/:id` (223), which answers **204**;
  - `POST /tools/:id/run` (252). Its order: session, then **decode** (400 "Invalid run body"), then access (404 "Tool not found" unless the caller is a manager), then the **limiter** (429 "Too many tool runs, try again in a minute"), then the runner check (501), then `runToolVersion`.
  
  Keep each route's order.
- **`apps/server/src/app.ts`** (around line 557) does `app.route('/api', createToolsRoutes(toolsDeps))` right before routines. Keep it at the same position. `app.ts:57` imports `type ToolsRoutesDependencies`; keep it exported.
- **The test mounts the Hono factory directly:** `apps/server/src/tools/routes.test.ts:26` imports `createToolsRoutes` and `TOOL_RUN_RATE_LIMIT_MAX` from `./routes`, and mounts the factory (line 119). **Keep `createToolsRoutes(deps): Hono` exported as the thin wrapper (item 11).**
- **Other tests (all unchanged):** every `apps/server/src/tools/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/tools/api.ts`** with the ten routes on `HttpApi`:
   - the same statuses (204, 501), bodies, audit calls, texts and step order;
   - an injectable `now` and limiter;
   - Effect Schema for both bodies, with the same rules, strictness and the 16 KiB check;
   - success schemas listing every field of each view (item 8; list each comparison in the Report).
   
   Export `TOOLS_API_ROUTES`.
2. **`routes.ts`:** keep the constants, `MAX_TOOL_RUN_INPUT_BYTES`, the dependency type and the `createToolsRoutes` wrapper. Remove the zod schemas and the old handlers.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tool run output and input** never appear in a log line, as today.
5. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/routines/api.ts`, `apps/server/src/tools/routes.ts` (all of it), `apps/server/src/tools/routes.test.ts` (lines 100-140), and the tools mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/tools/api.ts`, `apps/server/src/tools/routes.ts`, `apps/server/src/app.ts`, `work/T-0559-effect-http-tools.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot tools authz-sweep app.test
pnpm gate
```

### Acceptance
- Tools are served by Effect `HttpApi`, with the same answers, order and 16 KiB check, and no zod.
- The tests are unchanged and green through the wrapper.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
