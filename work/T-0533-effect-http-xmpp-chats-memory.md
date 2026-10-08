---
id: T-0533
title: "Effect C (HTTP): xmpp token, chats list and AI memory routes onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; every route test unchanged"
status: merged
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

### What I did
Moved the three modules onto the Effect `HttpApi` adapter following the T-0498 recipe and `apps/server/src/handles/api.ts` / `apps/server/src/chat-prefs/api.ts`, with the same paths, methods, step order, status codes, bodies and logs.

- **`apps/server/src/xmpp/api.ts` (new)** — `POST /api/xmpp/token`. Session middleware first, then the token budget (`TOKEN_RATE_LIMIT_MAX` = 120 / 10 min, 429 `rate_limited` `'Too many token requests'`) as an endpoint middleware so it runs before provisioning, then `ensureXmppAccount` (503 `xmpp_unavailable`), `syncRoster` and `issueXmppToken`. Both `logger.warn` calls keep their exact objects (`{ userId }` and `{ userId, pending }`) and the token is never logged. Exports `TOKEN_TTL_SECONDS`, `TOKEN_RATE_LIMIT_MAX`, `TOKEN_RATE_LIMIT_WINDOW_MS`, `XmppApiDependencies`, `XMPP_API_ROUTES`, `createXmppApi`.
- **`apps/server/src/chats/api.ts` (new)** — `GET /api/chats`, same service calls, same order (list, then avatars, then per-group visible topics, then sort by title), same `ChatListEntry` shape.
- **`apps/server/src/agents/memory/api.ts` (new)** — `GET /api/ai-memory`, `DELETE /api/ai-memory/facts/:id`, `POST /api/ai-memory/clear`; zod (`memoryQuerySchema`, `clearBodySchema`) replaced by Effect `Schema` (`MemoryQuery`, `ClearBody`), both strict via `HttpApi.QueryParseOptions` / `HttpApi.PayloadParseOptions` `{ onExcessProperty: 'error' }`. A schema-error middleware maps a decode failure to the old `400 invalid_request`. The write budget (429 `'Too many memory changes, try again later'`) is an endpoint middleware on the two writes, so it runs before the query/body decode like the old `requireWriteBudget` -> `safeParse` order. `resolveMemoryChat`, `ResolvedMemoryChat`, `toForbiddenChange`/`toMissingMemoryChat` and the module constants are kept.
- **`app.ts`** — the three `app.route('/api', …)` lines became `create…Api(...)` plus `mountEffectRoutes(...)`; imports updated.
- **Deleted** `apps/server/src/chats/routes.ts` and `apps/server/src/agents/memory/routes.ts` (no file outside the Allowed files imports them).
- **Kept** `apps/server/src/xmpp/routes.ts` as a re-export-only file because `apps/server/src/xmpp/routes.test.ts` (a test, unchanged) imports `TOKEN_RATE_LIMIT_MAX` and `TOKEN_TTL_SECONDS` from `./routes`. It now re-exports those plus `TOKEN_RATE_LIMIT_WINDOW_MS` from `./api`.

### Commands and real results
- `pnpm install` (as instructed): `Done in 31.1s`; no lockfile change.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot xmpp chats agents/memory contacts groups topics authz-sweep app.test`: **20 test files passed, 271 tests passed** (93.2s). Includes the authz sweep, which prints `POST /api/xmpp/token -> 401` and the same 401 for the chats and ai-memory routes.
- `pnpm gate` from the repo root:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (21.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (9.7s)
  PASS  tests @zilar/server  (779.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / decisions worth a look
- **`XmppLogger` and `XmppRoutesDependencies` are gone.** The Effect path needs the full pino `Logger` for `sessionLayer` and `withErrorEnvelope`, not the old `{ warn }` slice; nothing outside the old `routes.ts` imported those two types. `createXmppApi` takes `XmppApiDependencies` (`auth`, `db`, `adminClient`, `xmppConfig`, `logger: Logger`, optional `now`). Same pattern for the new `ChatsApiDependencies`/`AiMemoryApiDependencies`.
- **Changed generic message:** an invalid memory query/body now reports the Effect `Schema` message (`error.cause.message || 'Invalid request'`) instead of the old zod `issues[0].message`. No test asserts that text (only the 400 status), and the fallback text is unchanged.
- **No zod in these modules.** The three new `api.ts` files have no `zod` import (the memory file only mentions zod in a comment noting the schemas it replaces).
- **Chats response schema is a pass-through:** `Schema.Array(Schema.Unknown)` inside `{ chats }`. The chat list is a large discriminated union already typed by `ChatListEntry`, and a named Effect `Struct` drops any key it does not list (verified: `Schema.encodeUnknownSync` on a Struct omits unknown keys), which would change the wire body. The pass-through keeps it byte-identical.
- `resolveMemoryChat` stays exported from the new file even though nothing currently imports it (the spec asked to keep it if anything did; grep found no other importer, so this is to preserve the old module surface).

### Security checklist
- The XMPP token and the JWT secret are never logged; the two `warn` objects stay ids-only.
- Every route answers 401 before any decode (session middleware first); the authz sweep is green.
- Both write routes keep their per-user rate limit, now charged before decode exactly as before.
- Memory 404s stay identical for an unknown chat, an unknown AI and one the caller may not see; forbidden changes stay 403.

### Open questions / blocked
None.

## Review (written by Claude)

Approved (lead, 2026-10-08). The xmpp token, chats list and AI memory routes are served by Effect HttpApi through the adapter, with the same step order, statuses and id-only logs; the token is never logged. No zod is left in the modules. xmpp/routes.ts stays as a re-export for its test. Pre-review clean, 0 nits.
