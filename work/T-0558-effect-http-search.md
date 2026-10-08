---
id: T-0558
title: "Effect C (HTTP): message search route (GET /search) onto the HttpApi adapter, zod query schema to Effect Schema; 501/429/400 order and texts kept; the archive query helpers stay exported from routes.ts; tests unchanged"
status: merged
milestone: M5
branch: task/T-0558-effect-http-search
model: auto
effort: low
depends_on: [T-0548]
estimate: 0.5 day
---

# T-0558: message search on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"**, items 8-11. The worked example is `apps/server/src/topics/api.ts`. Search returns message snippets, so **no message text may appear in a log line**, the same as today.

### Verified facts (do not re-derive; read the whole handler for its exact order and texts)
- **`apps/server/src/search/routes.ts`** (533 lines):
  - `SearchRoutesDependencies` (line 38) holds `auth`, `db`, `config`, `logger`, `archive?` and `now?`;
  - `querySchema` (48) is a strict zod object `{ q: 1..100, chat?: 1..256, limit?: coerced int 1..SEARCH_MAX_LIMIT, before?: coerced positive int }`;
  - `createSearchRoutes(deps): Hono` (302) has one limiter and one route, `GET /search` (310).
- **The handler's order:**
  1. session;
  2. no archive gives **501** `search_unavailable` "Message search is not configured";
  3. the **limiter** gives 429 "Too many searches, try again later";
  4. decode the **query string** (400 `invalid_request` "Invalid search query");
  5. trim `q`, where a length below 2 or above 100 gives the same 400;
  6. `allowedArchives`, then the chat filter, then the archive queries.
  
  Keep this order. Coerced numbers stay coerced: `limit=5` arrives as a string. Unknown query keys still fail, because the schema is strict.
- **Pure helpers that other modules import, which stay exported from `routes.ts`:**
  - `headlineToSnippet`, `stanzaFrom`, `correctionTarget` and `retractTarget`, imported by `apps/server/src/agents/memory/indexer.ts:10`, `apps/server/src/media/indexer.ts:6`, `apps/server/src/push/service.ts:7` and `apps/server/src/search/search.test.ts:6`;
  - `buildArchiveQuery`, `buildArchiveEditsQuery`, `buildFuzzyCandidatesQuery`, the `SEARCH_*` constants and the types.
  
  **Only the Hono factory and the zod schema leave `routes.ts`.**
- **`apps/server/src/app.ts`** (around line 422) mounts `createSearchRoutes({ auth, db, config, logger, ...archive, ...now })`. Keep it at the same position. `app.ts:45` imports `type SearchRoutesDependencies`; keep that type exported.
- **Tests (all unchanged):** `apps/server/src/search/search.test.ts` builds the app with `createApp` (line 131), plus `apps/server/src/search/match.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/search/api.ts`** with `GET /search` on `HttpApi`:
   - the same order, statuses and texts;
   - an injectable `now` and limiter;
   - an Effect Schema for the query string (`HttpApiSchema` URL params), with the same rules, coercion and strictness;
   - a success schema that lists every field of the response (item 8; read the `c.json` at the end of the handler and the `SearchItem` type at line 58).
   
   Export `SEARCH_API_ROUTES`.
2. **`routes.ts`:** remove `createSearchRoutes` and `querySchema`, and keep everything else exported. Move the handler body into `api.ts`, or have `api.ts` import the helpers from `routes.ts`, whichever keeps the diff smallest. Report which you chose.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/search/routes.ts` (all of it), and the search mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/search/api.ts`, `apps/server/src/search/routes.ts`, `apps/server/src/app.ts`, `work/T-0558-effect-http-search.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot search authz-sweep app.test
pnpm gate
```

### Acceptance
- Search is served by Effect `HttpApi`, with the same answers and order, the helpers still exported, and no zod in the route module.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Done. `GET /api/search` is served by Effect `HttpApi`; all listed tests pass
unchanged; `pnpm gate` ends with GATE PASS and no file outside the Allowed files.

Choice: the handler core moved into `routes.ts` as exported `runSearch(deps,
userId, query)`; `api.ts` owns the Effect schema, the 501/429 guards and the
adapter wiring. This kept the archive-query diff to a re-indent instead of a
file move.

What changed:
- `apps/server/src/search/api.ts` (new): `GET /search` on `HttpApi`
  (`SEARCH_API_ROUTES`, `createSearchApi`). Effect Schema replaces the zod
  `querySchema`: `q` 1..100 chars, optional `chat` 1..256, optional `limit` /
  `before` via `Schema.NumberFromString` (coerced, int, `1..SEARCH_MAX_LIMIT`
  / positive) — strict via `HttpApi.QueryParseOptions { onExcessProperty:
  'error' }`. A `SearchGuards` endpoint middleware (`requires: CurrentUser`,
  satisfied by `Session`) answers 501 `search_unavailable` "Message search is
  not configured" then 429 `rate_limited` "Too many searches, try again
  later", before query decode — the same order as the old route (session via
  `Session`, 501, limiter, decode). Decode failures map to 400
  `invalid_request` "Invalid search query" (byte-identical). Success schema
  `SearchResultView` lists every `SearchItem` field (`chatJid`, `messageId`,
  `senderName`, `at`, `snippet`, `marks` as number-pair tuples, optional
  `match: 'exact' | 'fuzzy'`) plus optional `nextBefore`; compared side by
  side with `SearchItem` in `routes.ts:52`. Router logger off
  (`disableLogger: true`), so no full-URL log bypasses Hono's redacted path
  log; the result-count log still carries no query text.
- `apps/server/src/search/routes.ts`: removed `createSearchRoutes` and the
  zod `querySchema` (no zod/Hono imports left); the handler body is now
  `runSearch` with the trim/`q` 2..100 400, `allowedArchives`, chat filter
  404, and archive queries untouched. Still exported: `headlineToSnippet`,
  `stanzaFrom`, `correctionTarget`, `retractTarget`, `buildArchiveQuery`,
  `buildArchiveEditsQuery`, `buildFuzzyCandidatesQuery`, all `SEARCH_*`
  constants, all types, `SearchRoutesDependencies` (still includes `auth`,
  used by `api.ts`'s session layer), plus new `SearchQuery`/`SearchResult`
  and `runSearch`.
- `apps/server/src/app.ts`: `mountEffectRoutes(app, searchApi.routes,
  searchApi.handler)` at the same position (exact `GET /api/search` pair, so
  the authz sweep still sees it).

Old texts vs new: 400 decode-failure text unchanged (`Invalid search query`,
fixed string, not Schema's message); 501/429/404/502 texts unchanged; 401
comes from the shared `Session` middleware (same body as `requireSession`).

Checks (real results):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/search/search.test.ts`: 27 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/search/match.test.ts src/authz-sweep.test.ts src/app.test.ts`: 3 files,
  23 tests, all passed.
- Single-test hiccup fixed during work: `Schema.Tuple(a, b)` does not exist
  in Effect 4.0.2 (`elements.map is not a function`); used
  `Schema.Tuple([a, b])` per `apps/web/src/lib/api.ts:1583`.
- `pnpm gate` summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS install (frozen) (3.9s)`, `PASS format (31.7s)`, `PASS lint
    (0.9s)`, `PASS typecheck (0.8s)`, `PASS tests @zilar/server (1002.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  (Two earlier gate runs failed on formatting and three unused type imports
  in `api.ts`; both fixed, then the final run passed.)

Security checklist: no query/message text in logs (count + durationMs only,
asserted by the `never logs the query text` test); session before any effect;
limiter charged before decode; 501 before limiter, same as before; exact
route pair keeps the 401 sweep coverage (sweep passes unchanged).

No deviations from the spec; no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-08). GET /search is served by Effect HttpApi at the same mount position, with the same order (session, 501, limiter, then a strict decode of the coerced query string), the fixed 400 text and the q trim check. The archive helpers stay exported from routes.ts. Lead check: SearchItemView lists every SearchItem field (match optional), and nextBefore stays optional as in the old c.json. Pre-review clean; GATE PASS.
