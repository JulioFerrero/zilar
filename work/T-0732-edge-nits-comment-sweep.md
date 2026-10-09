---
id: T-0732
title: "sweep after the edge flip: the T-0730 edge nits (CORS allow-methods = Hono default, empty Origin not 403, raw request to better-auth, dead code), errors.ts off hono's ContentfulStatusCode, the stale 'drizzle service' / 'under Hono' header comments in the module api.ts files, and the T-0727 call-count assertion"
status: merged
milestone: M5
branch: task/T-0732-edge-nits-comment-sweep
model: auto
effort: low
depends_on: [T-0730]
estimate: 0.15 day
---

# T-0732: sweep after the edge flip

## Spec (written by Claude, do not edit)

### Why
The Effect edge (T-0730) replaced Hono in `createApp`, and every module is on effect/sql. Small items are left from the reviews, and many header comments now describe the old setup ("Handlers keep calling the drizzle service", "mounted under Hono by `effect/http.ts`"). **This task fixes them. Behaviour stays the same, apart from the two edge parity nits below.**

### Verified facts (do not re-derive)
- **`apps/server/src/effect/edge.ts`:**
  - line 40: `CORS_ALLOW_METHODS = 'GET, HEAD, PUT, POST, DELETE, PATCH'`. Hono's default is `['GET','HEAD','PUT','POST','DELETE','PATCH','QUERY'].join(',')` (`apps/server/node_modules/hono/dist/middleware/cors/index.js:5`);
  - line 364: the origin guard tests `origin !== undefined`. The old Hono guard was `if (origin && …)`, so an empty `Origin` header passed;
  - lines 374-377: the better-auth passthrough sends `forwardEdgeRequest(webRequest, …)` (with the stamped `x-request-id` and `x-zilar-socket-address`). The old edge passed the raw request (`c.req.raw`);
  - line 237: `void origin;` in `applyCors`, an unused parameter;
  - line 486: `export type { EffectApiRoute };`, which nothing imports from `./effect/edge`.
- **`apps/server/src/errors.ts:1`** imports `ContentfulStatusCode` from `hono/utils/http-status` and uses it at lines 4 and 10.
- **`apps/server/src/approvals/routes.test.ts`** (about lines 612-630): the audit-failure test fails the 4th `sqlRuntimeFor` call with a `calls` counter but never asserts the count. `apps/server/src/setup/routes.test.ts` asserts `expect(calls).toBe(3)` (about line 275).
- **36 module `api.ts` files** have header comments that mention drizzle or Hono (the list is under Allowed files). Since T-0730 they are mounted by `createEdge` (`apps/server/src/effect/edge.ts`). Since T-0684 to T-0688 their services run on effect/sql.

### What to build
1. **`edge.ts`:**
   - set `CORS_ALLOW_METHODS` to Hono's exact default string;
   - make the guard treat an empty `Origin` like a missing one (`origin` truthy);
   - send the raw `webRequest` to `auth.handler`;
   - remove the unused `origin` parameter and the `void`;
   - remove the unused re-export;
   - fix any comment that still names `effect/http.ts` as the bridge.

   Add one test in `apps/server/src/effect/edge.test.ts`: a `POST` with an empty `Origin` header is not refused with 403.
2. **`errors.ts`:** replace the hono type with a local one, `type ContentfulStatusCode = 200 | 201 | … `. List exactly the statuses `HttpError` is built with across `apps/server/src` (`git grep -n "new HttpError("`), or use `number` if a call site needs it. Typecheck must pass, and no call site changes.
3. **Header comments in each `api.ts`:** rewrite only the sentences that describe drizzle or Hono, so they say what is true now: the module is an Effect `HttpApi` mounted by the edge (`effect/edge.ts`), and its services run on effect/sql. **Do not touch code.** Keep each comment's other content.
4. **`approvals/routes.test.ts`:** add `expect(calls).toBe(4)` (or the count the comment states) before the mock is restored.

### Read first
`AGENTS.md`, `apps/server/src/effect/edge.ts`, `apps/server/src/errors.ts`, `apps/server/src/approvals/routes.test.ts` (lines 600-640), `apps/server/src/setup/routes.test.ts` (lines 255-280), and the head of each `api.ts`.

### Allowed files
`apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge.test.ts`, `apps/server/src/errors.ts`, `apps/server/src/approvals/routes.test.ts`, `apps/server/src/agents/memory/api.ts`, `apps/server/src/ais/api.ts`, `apps/server/src/approvals/api.ts`, `apps/server/src/audit/api.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/avatars/api.ts`, `apps/server/src/backgrounds/api.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/chat-folders/api.ts`, `apps/server/src/chat-prefs/api.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/connections/api.ts`, `apps/server/src/contact-requests/api.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/directory/api.ts`, `apps/server/src/drafts/api.ts`, `apps/server/src/files/api.ts`, `apps/server/src/gifs/api.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/integrations/api.ts`, `apps/server/src/invite-links/api.ts`, `apps/server/src/machines/api.ts`, `apps/server/src/media/api.ts`, `apps/server/src/pins/api.ts`, `apps/server/src/push/api.ts`, `apps/server/src/roles/api.ts`, `apps/server/src/routines/api.ts`, `apps/server/src/search/api.ts`, `apps/server/src/setup/api.ts`, `apps/server/src/stickers/api.ts`, `apps/server/src/tools/api.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice/api.ts`, `apps/server/src/xmpp/api.ts`, `work/T-0732-edge-nits-comment-sweep.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/edge.test src/approvals/routes.test src/app.test
pnpm gate
```

### Acceptance
- `git grep -n -i "drizzle\|hono" -- 'apps/server/src/*/api.ts' 'apps/server/src/*/*/api.ts' apps/server/src/errors.ts` prints nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** All four parts of the spec are in; behaviour is unchanged apart from the two edge parity nits.

**Files changed (41):** `apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge.test.ts`, `apps/server/src/errors.ts`, `apps/server/src/approvals/routes.test.ts`, the 36 module `api.ts` files on the Allowed list, and this task file (Report and status only).

**What changed**
- `edge.ts`: `CORS_ALLOW_METHODS` is now `'GET,HEAD,PUT,POST,DELETE,PATCH,QUERY'` (Hono's exact default; Hono joins with `,`). The unsafe-method guard tests `origin` truthy, so an empty Origin is treated as missing. The better-auth passthrough sends the raw `webRequest` to `auth.handler`. The unused `origin` parameter of `applyCors` and its `void` are gone, with both call sites. The unused `export type { EffectApiRoute }` and its now-unused import are removed. No comment named `effect/http.ts` as the bridge, so none was changed there.
- `edge.test.ts`: new test "does not answer 403 to a POST with an empty Origin header" (`POST /api/me`, `origin: ''`, expects `status` not 403).
- `errors.ts`: the hono import is replaced by a local `type ContentfulStatusCode` listing the 14 statuses found in `HttpError(` call sites: 400 401 403 404 409 410 413 415 422 429 500 501 502 503. The non-literal sites (`approvals/api.ts` `status` = 400/403/409; the `INVALID_LINK`, `GROUP_NOT_FOUND`, `ROLE_NOT_FOUND`, `TOPIC_NOT_FOUND` constants with `as const` 404s) are covered by that union. No call site changed.
- `approvals/routes.test.ts`: `expect(calls).toBe(4);` added right after the 200 assertion, before the mock is restored.
- 36 `api.ts` files: comment lines only (verified with `git diff -U0` filter). Every header that said "mounted under Hono by `effect/http.ts`" and "Handlers keep calling the drizzle service; the DB rewrite is a separate lane" now says "mounted by the Effect edge (`apps/server/src/effect/edge.ts`)" and "its service runs on effect/sql". The per-file "The adapter forwards `c.req.raw`" line became "The edge forwards the full request path, so the router keeps the `/api` prefix", and "Hono keeps the request log" became "The edge keeps the request log". The other Hono/drizzle comment mentions were reworded the same way.

**Commands run (real results)**
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/edge.test`: 12 passed (12).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/routes.test`: 20 passed (20).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/app.test`: 10 passed (10).
- `git grep -n -i "drizzle\|hono" -- 'apps/server/src/*/api.ts' 'apps/server/src/*/*/api.ts' apps/server/src/errors.ts`: no output (acceptance met).
- `pnpm exec prettier --write` on the changed `.ts` files: reflowed `edge.ts` and `errors.ts` only (the union is now one line in `errors.ts`).
- `pnpm gate` (from the worktree root): exit 0. Summary lines:
  - `gate: 41 changed file(s) against main`
  - `PASS install (frozen) (1.1s)`
  - `PASS format (12.5s)`
  - `PASS lint (0.9s)`
  - `PASS typecheck (3.3s)`
  - `PASS tests @zilar/server (243.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Deviations and open points**
- I reworded every "Hono"/"drizzle" comment mention, not only the sentences about the setup. The acceptance grep requires zero matches, so these had to go too. Each change is a comment; no code changed.
- `files/api.ts`: I dropped "the rest of the DB rewrite is a separate lane" without checking which other calls still use drizzle. The file has no drizzle import in `files/` now, but I did not audit `search/service`, which `allowedArchives` comes from. Lead may want to confirm.
- `routines/api.ts` and `media/api.ts` had "stays drizzle" / "drizzle gallery read" wording. No drizzle import remains in either module's non-test files, so I wrote "runs on effect/sql" for both.
- `effect/http.ts` still exists in the tree (it is used by tests such as `blocks.test.ts`); I did not touch it.
- I wrote the gate output to a log file inside the worktree by mistake, and deleted it before the commit. No other scratch files exist.

## Blocked / needs a decision

None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 9.8 min). The lead reviewed the diff directly.
- **Edge nits:** CORS methods now equal Hono's default, an empty `Origin` passes, better-auth gets the raw request, and the dead code is gone.
- **errors.ts:** a local status union replaces the Hono type.
- **Comments:** the 36 `api.ts` changes are comments only (the lead checked that no code line changed). The `files/api.ts` wording is right, because every module is on effect/sql.
- **Tests:** the approvals call-count assertion is added, and the gate passed.
