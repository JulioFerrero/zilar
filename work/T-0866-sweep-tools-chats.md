---
id: T-0866
title: "Server sweep: tools, chats, contacts, drafts, xmpp onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0866-sweep-tools-chats
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0866: Server sweep: tools, chats, contacts, drafts, xmpp onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/tools/`, `apps/server/src/chats/`, `apps/server/src/contacts/`, `apps/server/src/drafts/`, `apps/server/src/xmpp/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- `tools/api.ts:258` and `:565` declare `Void` but send 204

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
`apps/server/src/tools/**`, `apps/server/src/chats/**`, `apps/server/src/contacts/**`, `apps/server/src/drafts/**`, `apps/server/src/xmpp/**`, `work/T-0866-sweep-tools-chats.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/tools src/chats src/contacts src/drafts src/xmpp src/authz-sweep.test.ts src/routes-manifest.test.ts
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

- One commit per module: contacts `9b3749e3`, chats `ac4be06d`, drafts `53a97a45`, xmpp `f92bb635`, tools `f7f7301f`.
- Lines (git numstat, added/removed): contacts +12/-43, chats +10/-30, drafts +12/-31, xmpp +22/-74, tools +78/-162. Total +134/-340 (net -206). The `routes.expected.ts` files are included in the added counts.
- Recipe applied: shared `runSql` (also in `contacts/service.ts`, `xmpp/provisioning.ts`, `tools/service.ts`, `tools/adapters.ts`, `tools/api.ts`), `handler(logger, ...)`, `mountApi`, `<module>/routes.expected.ts` for all five. `routes-manifest.test.ts` not edited.
- xmpp: `XmppTokenRateLimit` is now `makeRateLimit('zilar/effect/http/XmppTokenRateLimit', 'Too many token requests')`, same tag and message.
- tools: local `ToolsSchemaErrors` replaced by the shared `SchemaErrors`. The run limiter stays inside the `run` handler (it runs after decode and the access check, so it is not a plain limit).
- `SchemaErrors` was not added to contacts, chats, drafts and xmpp: they have no params or payload to decode.
- Truthful status: `tools/api.ts` `remove` declared `Schema.Void` and sent 204 (cited lines :258 and :565 were right). Now `HttpApiSchema.NoContent` and the handler returns nothing, as in roles. The 204 tests (`tools/routes.test.ts:496,584,589`) pass unchanged.
- Not done: no payload schema declared for `revert` and `run`. Declaring one makes the framework decode before the handler, which would change the error order (400 before the 404 access check) and the messages (`Invalid JSON body`, `Invalid revert body`, `Invalid run body`). Kept the hand decode so the wire stays identical. Lead decides if a later task should change this.
- Checks: `vitest run` on src/tools, chats, contacts, drafts, xmpp, authz-sweep.test.ts, routes-manifest.test.ts: 14 files, 185 tests passed, 3 of 3 runs after the last commit (run 1 295 s, load ~70; runs 2 and 3 at load ~60). Server typecheck clean. oxlint clean on the changed folders.
- Behaviour differences: none observed.
- Unsure: ran with 120 s timeouts because the machine load was 60 to 117, not with the spec's 30 s.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** The five modules (tools, chats, contacts, drafts, xmpp) are on the shared helpers, with each `routes.expected.ts` in place, for a net −206 lines. The tools remove now declares 204. Hand decodes stay where declaring the payload would move a 400 ahead of the 404 access check, which keeps the wire identical; that is accepted. The combined wave 4 check passes.
