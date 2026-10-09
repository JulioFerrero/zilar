---
id: T-0732
title: "sweep after the edge flip: the T-0730 edge nits (CORS allow-methods = Hono default, empty Origin not 403, raw request to better-auth, dead code), errors.ts off hono's ContentfulStatusCode, the stale 'drizzle service' / 'under Hono' header comments in the module api.ts files, and the T-0727 call-count assertion"
status: todo
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

## Review (written by Claude)
