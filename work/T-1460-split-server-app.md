---
id: T-1460
title: "400-line rule: split apps/server/src/app.ts (588) by route area into app/ modules with one base deps object and an opt() helper; same exports, same routes, no behaviour change"
status: merged
milestone: M5
branch: task/T-1460-split-server-app
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1460: Split server app.ts

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10): at most 400 lines per source file. The plan is `docs/audit/size-plan.md` item #48 (line 147). Its line numbers are older, so split by the sections it names.

**This file wires every route, and every merge auto-deploys, so behaviour must stay identical.**

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/app.ts`** is 588 lines. Its exports:
  - `export type { EdgeHealth, ZilarEdge }` (`:65`);
  - `setTestAppInviteLinks` (`:72`);
  - `interface AppDependencies` (`:76-208`);
  - `effectMountsOf` (`:212`), with a module `WeakMap` `mountsByApp` (`:209`);
  - `createApp({...})` (`:216-588`), which mounts every Effect HTTP API group.
- **There is no `apps/server/src/app/` folder yet.** `apps/server/src/health.ts` already exists and is unrelated to the split names.

### What to build
1. **Move the route mounting** out of `createApp` into area modules under `apps/server/src/app/`: `routes-messaging.ts`, `routes-media.ts`, `routes-ai.ts` and `routes-health.ts` (plan #48; use whichever grouping keeps each file at 300 lines or fewer). Each exports one function that takes the shared deps and returns its mounts, so `createApp` collects them **in today's order**.
2. **Dedup** (plan):
   - one `opt(key, value)` helper for the repeated `...(v === undefined ? {} : { k: v })` guards;
   - one `base` deps object (`db`, `config`, `logger`, `auth`) passed to each area, instead of repeating it per mount.
3. **Same surface.** `app.ts` keeps every export name and signature: `AppDependencies` may move to `app/deps.ts` and be re-exported. Route paths, middleware order, mount order and error handling don't change. `app.ts` ends at 300 lines or fewer.
4. **No test changes** are needed. If an existing test imports a moved private helper, keep that import working through `app.ts`.

### Tests
None new. All server tests must pass. Run the full server suite once: it is a refactor of the central wiring.

### Allowed files
- `apps/server/src/app.ts`
- new files under `apps/server/src/app/`
- `work/T-1460-split-server-app.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate and the full server suite pass.
- After deploy, the lead checks `/health` and calls a handful of routes live: `/api/me` and `/api/chats` answer 401 without a session, and `/install.sh` is served.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-1460-split-server-app`.

### What I did
- Split `apps/server/src/app.ts` (588 lines) into area modules under `apps/server/src/app/`, keeping every export, route path, middleware order and mount order identical.
- `app.ts` (84 lines) now only builds the shared state (`registerSqlRuntime`, audit recorder, action gateway, live mailer, `base` deps) and collects the area mounts in today's order.
- Moved `AppDependencies` to `app/deps.ts` and re-export it from `app.ts`. Added `BaseDeps` (`db`/`config`/`logger`/`auth`) and `RouteWiring` (deps + base + audit + mailer + gateway + the invite-links test seam).
- New `app/opt.ts` with the single `opt(key, value)` helper, used for every `...(v === undefined ? {} : { k: v })` guard.
- New `app/routes-messaging.ts` (143), `app/routes-media.ts` (61), `app/routes-ai.ts` (118) and `app/routes-health.ts` (10), one exported function each returning its mounts (health returns the probe).

### Mount order and grouping
Mount order is unchanged. `createApp` concatenates `messagingRoutes` + `mediaRoutes` + `aiRoutes`, then builds health.
- `routes-messaging.ts` (first 23 mounts): auth, setup, contacts, handles, contact-requests, blocks, directory, machines, groups, invite-links, roles, ai-memory, agent-tasks, pins, topics, chats, chat-prefs, chat-folders, push, search, media, files, drafts.
- `routes-media.ts` (next 3): stickers, avatars, backgrounds.
- `routes-ai.ts` (last 11): integrations, audit, gifs, approvals, tools, routines, xmpp, voice, voice-transcription, connections, ais.
- `routes-health.ts`: the `/health` probe.
The plan's line ranges (`docs/audit/size-plan.md` #48) are older and interleaved across the file, so a purely semantic grouping cannot preserve mount order with one array per area. I chose contiguous blocks so the concatenation reproduces today's order exactly.

### Files changed
- `apps/server/src/app.ts` (modified, 84 lines)
- `apps/server/src/app/deps.ts` (new, 177 lines)
- `apps/server/src/app/opt.ts` (new, 9 lines)
- `apps/server/src/app/routes-messaging.ts` (new, 143 lines)
- `apps/server/src/app/routes-media.ts` (new, 61 lines)
- `apps/server/src/app/routes-ai.ts` (new, 118 lines)
- `apps/server/src/app/routes-health.ts` (new, 10 lines)
- `work/T-1460-split-server-app.md` (Report + status)

All paths are inside the Allowed files (`apps/server/src/app.ts`, new files under `apps/server/src/app/`, this task file). No test files changed.

### Commands and results
- `pnpm install`: done (1137 packages added).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts`: 1 file, 5 tests passed.
- `pnpm gate` (final run):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.5s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (5.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot` (full server suite, per the task's Checks): 102 test files, 717 tests passed.

### Deviations and notes
- `routes-health.ts` returns the `createHealthCheck` handler, not a mount: the edge serves `/health` directly.
- Grouping is contiguous rather than the plan's semantic line ranges, to keep mount order identical (see above).
- `setTestAppInviteLinks` and its module state stay in `app.ts` (unchanged surface); the value is threaded to the invite-links route through `RouteWiring.inviteLinksOverrides`.
- The first `pnpm gate` failed the typecheck on one reference (`adminClient` read off `RouteWiring` instead of `deps`); fixed and re-run to GATE PASS.

### Open questions
None.

### Security checklist
No new routes (the 401 authz sweep passes); no secrets, logs, deletes or caps touched — this is a pure wiring move.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1.
- `app.ts` drops from 588 to 84 lines.
- The new `app/` modules are `deps`, `opt`, `routes-ai`, `routes-health`, `routes-media` and `routes-messaging`, each at 177 lines or fewer.
- The worker ran the full server suite: 102 files, 717 tests.
- After the deploy, the lead calls `/health`, `/api/me`, `/api/chats` and `/install.sh` live.
