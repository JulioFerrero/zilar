---
id: T-0869
title: "Server sweep: groups, invite-links, chat-folders, chat-prefs, roles onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0869-sweep-groups
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0869: Server sweep: groups, invite-links, chat-folders, chat-prefs, roles onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/groups/`, `apps/server/src/invite-links/`, `apps/server/src/chat-folders/`, `apps/server/src/chat-prefs/`, `apps/server/src/roles/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- create at `groups/api.ts:412` sends 201
- create at `invite-links/api.ts:306` sends 201; `:208` and `:337` declare `Schema.Void` but send 204
- create at `chat-folders/api.ts:238` sends 201 via `jsonUnsafe`
- create at `roles/api.ts` (about :202 before T-0863) sends 201 via `jsonUnsafe`

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
`apps/server/src/groups/**`, `apps/server/src/invite-links/**`, `apps/server/src/chat-folders/**`, `apps/server/src/chat-prefs/**`, `apps/server/src/roles/**`, `work/T-0869-sweep-groups.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/groups src/invite-links src/chat-folders src/chat-prefs src/roles src/authz-sweep.test.ts src/routes-manifest.test.ts
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

Commits: roles `71c1c20b`, invite-links `426eadc9`, chat-folders `d06c353e`, chat-prefs `18ee5667`, groups `9a30e86d`.

Lines (`git diff --numstat`, api.ts added/removed; routes.expected.ts is new):
- roles: +3 / -7 (T-0863 had already converted it; only the 201 remained)
- invite-links: +69 / -161 (+9 routes.expected.ts)
- chat-folders: +93 / -165 (+9)
- chat-prefs: +70 / -146 (+8)
- groups: +193 / -341 (+14)

Truthful statuses: declared `HttpApiSchema.status(201)` on groups create, invite-links create, chat-folders create, roles create; invite-links revoke is now `HttpApiSchema.NoContent` and the handler returns nothing (204). The handlers return the value, no `jsonUnsafe`/`HttpServerResponse.empty`. All cited lines matched (groups create, invite-links create/revoke, chat-folders create, roles create).

Checks (the spec's command, 3 runs after the last commit): 9 files, 162 tests passed, 3 of 3 (load average 48 to 77, 120 s timeouts). `pnpm --filter @zilar/server typecheck` clean, oxlint clean on the five folders. Did not run `pnpm gate` (wave mode).

Behaviour differences:
- Schema error message: the five local layers used `error.cause.message || 'Invalid request'`; the shared `SchemaErrors` uses `error.cause.message`. Differs only if a decode error has an empty message (no test hits it).
- None else. Wire statuses unchanged.

Decisions to flag:
- chat-folders and chat-prefs keep their write limit inside the handlers (not `makeRateLimit`). In the old code the limit runs after the payload decode (chat-prefs `putPref` even after the chat-access check), so a middleware would change the 400/404/429 order and spend budget on invalid bodies. I kept the order; `handler` returns the 429 response as before. chat-prefs got a small `tooManyChanges()` helper.
- groups (role, join) and invite-links (preview) use `makeRateLimit` with the same tag strings and messages. invite-links join keeps its in-handler limiters (they run after the token check).
- Wrote `routes.expected.ts` for the four modules; roles already had one. `routes-manifest.test.ts` untouched.
- groups create now encodes through the declared success schema (Date to ISO string) like the other groups endpoints; the existing tests pass unchanged.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Groups, invite-links, chat-folders, chat-prefs and roles are converted, with about −430 lines in the `api.ts` files. The creates declare 201 and the invite revoke declares 204. The chat-folders and chat-prefs write limits stay in their handlers, because a middleware would change the 400/404/429 order; that is accepted. The groups create now encodes its Date as ISO, like the other groups endpoints, and the tests pass unchanged. The combined wave 4 check passes.
