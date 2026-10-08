---
id: T-0533
title: "Effect C (HTTP): xmpp token, chats list and AI memory routes onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; every route test unchanged"
status: todo
milestone: M5
branch: task/T-0533-effect-http-xmpp-chats-memory
model: auto
effort: low
depends_on: [T-0520]
estimate: 0.5 day
---

# T-0533: xmpp token, chats and AI memory on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".** Worked examples: `apps/server/src/handles/api.ts`, `apps/server/src/blocks/api.ts`, and `apps/server/src/chat-prefs/api.ts` (T-0520). Do not touch any service file.

### Verified facts (do not re-derive)
- **`apps/server/src/xmpp/routes.ts`** (90 lines): `POST /xmpp/token`.
  - A limiter (`TOKEN_RATE_LIMIT_MAX` = 120 per 10 minutes) gives 429 `rate_limited` `'Too many token requests'` (line 53).
  - Provisioning failure gives 503 `xmpp_unavailable` (line 67).
  - It logs `logger.warn({ userId }, …)` with ids only (lines 66 and 74). Keep those logs and their objects identical. **Never log the token.**
  - It exports `TOKEN_TTL_SECONDS`, `TOKEN_RATE_LIMIT_MAX`, `TOKEN_RATE_LIMIT_WINDOW_MS`, `XmppRoutesDependencies` and `XmppLogger`.
  - `app.ts:545`: `createXmppRoutes({ auth, db, adminClient, xmppConfig: config.xmpp, logger })`.
- **`apps/server/src/chats/routes.ts`** (146 lines): `GET /chats` gives `{ chats }`, built from `listContacts`, `listGroupsForUser`, `listAis` and `avatarIdsByOwner` (from line 59). It exports the `ChatListEntry` type. `app.ts:387`.
- **`apps/server/src/agents/memory/routes.ts`** (196 lines):
  - `GET /ai-memory`, `DELETE /ai-memory/facts/:id` and `POST /ai-memory/clear`;
  - it uses zod (`memoryQuerySchema`, `clearBodySchema`); a bad input gives 400 `invalid_request` with the zod message `?? 'Invalid request'`;
  - a write limiter gives 429 `'Too many memory changes, try again later'`;
  - 404 `'Chat not found'` and `'Fact not found'`, and a forbidden-change error (`toForbiddenChange`, line 45);
  - it exports `AI_MEMORY_WRITE_RATE_LIMIT_MAX`/`_WINDOW_MS`, `AiMemoryRoutesDependencies`, `ResolvedMemoryChat` and **`resolveMemoryChat`** (line 61). Keep `resolveMemoryChat` exported from the new file if anything imports it (grep).
  
  `app.ts:381`: `createAiMemoryRoutes({ auth, db, config })`.
- **Tests (all unchanged):**
  - `apps/server/src/xmpp/routes.test.ts` and `apps/server/src/xmpp/token.test.ts`;
  - `apps/server/src/chats/chats.test.ts` and `apps/server/src/agents/memory/routes.test.ts`;
  - `apps/server/src/contacts/contacts.test.ts`, `apps/server/src/groups/groups.test.ts` and `apps/server/src/topics/topics.test.ts` (they call `/api/chats`);
  - the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **One `api.ts` per module** (`apps/server/src/xmpp/api.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/agents/memory/api.ts`) following the recipe, with:
   - the same paths, methods, status codes and bodies;
   - the same step order per route;
   - injectable limiters and `now` where the routes had them;
   - the same log calls;
   - exact-route mounts.
2. **Effect Schema for the memory query and body,** with no zod left in these modules. Keep every text a test asserts; list any changed generic message in the Report.
3. **`app.ts`:** replace the three `app.route(...)` lines and their imports with `mountEffectRoutes(...)`, Delete each old `routes.ts`, **unless** a file outside the Allowed files (a test, `token.ts`, the gateway) imports from it. In that case, keep that `routes.ts` as a re-export-only file (`export { … } from './api'`), and list it in the Report.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/chat-prefs/api.ts`, and the three `routes.ts` files.

### Allowed files
`apps/server/src/xmpp/api.ts`, `apps/server/src/xmpp/routes.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/chats/routes.ts`, `apps/server/src/agents/memory/api.ts`, `apps/server/src/agents/memory/routes.ts`, `apps/server/src/app.ts`, `work/T-0533-effect-http-xmpp-chats-memory.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot xmpp chats agents/memory contacts groups topics authz-sweep app.test
pnpm gate
```

### Acceptance
- The three modules are served by Effect `HttpApi` through the adapter, with the same answers and logs, and have no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
