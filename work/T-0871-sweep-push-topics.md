---
id: T-0871
title: "Server sweep: push, topics, handles, media onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0871-sweep-push-topics
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0871: Server sweep: push, topics, handles, media onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/push/`, `apps/server/src/topics/`, `apps/server/src/handles/`, `apps/server/src/media/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- create at `topics/api.ts:419` sends 201

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
For each module, one commit per module:
1. Apply the T-0863 recipe, steps 1-6:
   - drop the local `runSql` copy;
   - use the shared `SchemaErrors`;
   - use `makeRateLimit` for the plain rate limits, keeping the tag strings and middleware order. Middlewares that are not plain limits, such as search `SearchGuards` and voice `TranscriptConfigured`/`VoiceSettingsOwnerLimit`, stay as they are;
   - write handlers with `handler(logger, ...)`;
   - end `createXApi` with `mountApi`;
   - move the old `*_API_ROUTES` array to `<module>/routes.expected.ts`.
2. **Truthful statuses** for the sites listed above:
   - for a 201, declare it with `HttpApiSchema.status(201)` or the 4.0.2 equivalent (check the .d.ts and how T-0864 did pins in `apps/server/src/pins/api.ts`), and return the value instead of `jsonUnsafe(…, { status: 201 })`;
   - for a 204, use `HttpApiSchema.NoContent` or its equivalent;
   - where a payload is decoded by hand, declare the payload schema. If the existing error order must stay (for example a 503 before decode), keep the hand decode but still declare the schema, and say so.

   Bodies, status codes and headers on the wire must stay byte-identical. The existing route tests assert them.
3. Count the lines removed per module (`git diff --numstat`).

The existing tests of these modules, `authz-sweep.test.ts` and `routes-manifest.test.ts` must pass unchanged. Use --testTimeout=120000 --hookTimeout=120000 because the machine is shared.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/server/src/push/**`, `apps/server/src/topics/**`, `apps/server/src/handles/**`, `apps/server/src/media/**`, `work/T-0871-sweep-push-topics.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/push src/topics src/handles src/media src/authz-sweep.test.ts src/routes-manifest.test.ts
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

### Commits (one per module)
- push `87a6167d`, handles `840530a8`, media `0580a30b`, topics `39331c9d`.

### Lines removed (git numstat, added/removed)
- push: api.ts +43/-109, service.ts +2/-13, store.ts +1/-11, plus a new routes.expected.ts.
- handles: api.ts +28/-72, store.ts +1/-8, plus a new routes.expected.ts.
- media: api.ts +15/-60, indexer.ts +1/-11, plus a new routes.expected.ts.
- topics: api.ts +78/-177, rooms.ts +2/-12, service.ts +2/-11, plus a new routes.expected.ts. `topics/access.ts` is not touched (T-0851 edits it), so its local `runSql` copy stays.

### Checks
- `vitest run src/push src/topics src/handles src/media src/authz-sweep.test.ts src/routes-manifest.test.ts` with 120 s timeouts: 19 files passed, 1 skipped; 157 tests passed, 1 skipped; 3 of 3 runs after the last commit. No tests added or edited.
- `pnpm --filter @zilar/server typecheck`, `oxlint` on the four folders and prettier: clean.
- Machine load 50 to 90 during the runs (uptime), so a run took 2 to 6 minutes. `pnpm gate` not run (wave mode).

### Truthful statuses
- topics create (`POST /api/groups/:id/topics`): success is now `TopicView.pipe(HttpApiSchema.status(201))` and the handler returns the view instead of `jsonUnsafe(..., { status: 201 })`. The existing route tests (status and body) pass.

### Behaviour differences
- none observed. Topics create now goes through the success-schema encode like the other endpoints; the schema has the same fields as the view.

### Unsure / notes
- handles keeps its own `HandlesSchemaErrors`: the shared `SchemaErrors` cannot express it (a Query decode failure answers a 200 `{ available: false, reason: 'invalid' }`, the payload message is fixed text). Replacing it would change the wire.
- push and media keep their limiter inside the handler (push: `requirePush()`, decode, then limiter; media: 501, limiter, decode, 404), so they use no `makeRateLimit`. They declare the shared `SchemaErrors`; the old local copies had a `|| 'Invalid request'` fallback for an empty message, the shared one has none. The framework only decodes the DELETE `:id` string param there, so it cannot fire.
- push, media: bodies and queries are still decoded by hand to keep the error order; no payload schema declared.
- Local `runSql` copies removed in push/service.ts, push/store.ts, handles/store.ts, media/api.ts, media/indexer.ts, topics/rooms.ts, topics/service.ts. Remaining: topics/access.ts (out of scope).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Push, topics, handles and media are converted, and the topics create declares 201. Handles keeps its own schema-error layer, because a bad query answers 200 `{available:false}`. `topics/access.ts` was left alone, so its local `runSql` copy is a follow-up. The combined wave 4 check passes.
