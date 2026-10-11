---
id: T-1142
title: "Push: GET /api/push/preview?messageId= returns the notification { title, body, chatId } for one archived message the signed-in user may see — the same resolver and preview rules as Web Push; 404 for unknown, muted, hidden or not-visible"
status: merged
milestone: M5
branch: task/T-1142-push-preview-route
model: auto
effort: default
depends_on: [T-1138]
estimate: 0.3 day
---

# T-1142: Notification preview route

## Spec (written by Claude, do not edit)

### Why
Android push (Julio, 2026-10-11) wakes the phone with ids only: `{ chatId, messageId, serverId }` (T-1135). The app must then build the notification text itself. Plan §4.4 (`docs/audit/native-push-plan.md`) does that through a full XMPP connection and a MAM query inside a killed-app background task, and names a small server route as the fallback. **The lead picks the route:**
- it is one HTTPS call from the background task instead of an XMPP login;
- it reuses the **exact** resolver and preview rules Web Push already uses, so mute, private topics and "Show previews" can't drift between web and phone.

**What the lead read:**
- **The scan's scope query:** `apps/server/src/push/archive-scan.ts` builds the user's archive scope with `allowedArchives(db, config, userId)` (`:53`, from `apps/server/src/search/service.ts`) and queries it with `buildNewestQuery(allowed)` (`:119-133`). The rows are `ArchiveCandidate`s (`:14-23`, with `originId`).
- **The resolver:** `apps/server/src/push/candidates.ts` `resolveCandidate(deps, userId, allowed, row)` (`:17`) returns `ok` with a `ResolvedPushMessage`, or `muted`, `hidden` or `skip`. From `deps` it uses only `db`, `config` and `now`.
- **The payload:** `apps/server/src/push/payload.ts` `buildPushPayload(message, { muted, visible, showPreviews })` gives `{ title, body, chatId, … }`, where `body` is `'New message'` when previews are off. The web side only shows that payload; its browser half is `apps/web/src/lib/push.ts:5-8`, and the server builds the text.
- **The setting:** `showPreviewsForUser` is in `apps/server/src/push/store.ts`.
- **The push API:** the contract group is in `packages/api-contract/src/push.ts` (`PushGroup`, `:89`); the handlers are in `apps/server/src/push/api-handlers.ts` (236 lines); the dependencies are `PushRoutesDependencies` in `apps/server/src/push/api.ts:43-55`, which have no archive yet.
- **Wiring:** `apps/server/src/app.ts` already holds the archive pool (`:146`, `:233`) and mounts the push API at `:367`.

### What to build
1. **The contract:** add `HttpApiEndpoint.get('preview', '/push/preview', { urlParams: { messageId: <1..256 string> }, success: PushPreview })` with `PushPreview = Schema.Struct({ title: Schema.String, body: Schema.String, chatId: Schema.String })`. Follow how other GET endpoints with query params are declared in `packages/api-contract/src/`.
2. **The query:** in `archive-scan.ts`, add an exported `readCandidateByOriginId(archive, allowed, originId)`: the same scope as `buildNewestQuery`, plus `AND origin_id = $n`, `ORDER BY timestamp DESC LIMIT 1`. Reuse the scope-building code; don't copy it.
3. **The resolver:** narrow `resolveCandidate`'s `deps` parameter (and its helpers) to `Pick<PushServiceDeps, 'db' | 'config' | 'now'>`, so the route can call it without the push component. **No body changes.**
4. **The handler** (in `api-handlers.ts`, or a new `apps/server/src/push/api-preview.ts` if `api-handlers.ts` would pass 400 lines):
   - it requires a session (401 otherwise), like the other push routes;
   - with no archive, it answers 503 with `xmppUnavailable()` (`apps/server/src/errors.ts:26`);
   - `allowedArchives`, then `readCandidateByOriginId`, then `resolveCandidate`;
   - on `ok`, it builds `buildPushPayload(message, { muted: false, visible: true, showPreviews })` and answers `{ title, body, chatId }`;
   - **unknown, `muted`, `hidden` and `skip` all answer the same 404 `not_found`,** so the route never reveals whether a message exists in a chat the user can't see;
   - add a rate limit like `settingsLimiter` in `api.ts`, with 120 per minute per user;
   - logs carry ids only.
5. **`api.ts` and `app.ts`:** add `archive?: ArchivePool` to `PushRoutesDependencies`, and pass `...(archive === undefined ? {} : { archive })` at `app.ts:367`.
6. **Tests** (permissions and the message pipeline), in a new `apps/server/src/push/api-preview.test.ts`, following `apps/server/src/push/api-subscribe.test.ts` and the fake archive used by `apps/server/src/files/routes.test.ts` (`ArchivePool`), with at most 4:
   - a visible DM message gives 200 with the sender as title and the text as body;
   - "Show previews" off gives the body `'New message'`;
   - a message in a room the user is not in gives 404;
   - signed out gives 401.

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §4.4, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/payload.ts`, `apps/server/src/push/api.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-subscribe.test.ts` and `apps/server/src/files/routes.test.ts`.

### Allowed files
`packages/api-contract/src/push.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-preview.ts`, `apps/server/src/push/api-preview.test.ts`, `apps/server/src/push/api.ts`, `apps/server/src/app.ts`, `work/T-1142-push-preview-route.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/api-preview.test.ts src/push/candidates.test.ts src/push/delivery.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file is at most 400 lines.
- The 404 is identical for "doesn't exist" and "can't see".

---

## Report (written by the worker when done)

### What I did
- **Contract** (`packages/api-contract/src/push.ts`): added `PushPreview` (`{ title, body, chatId }`, all `Schema.String`) plus a `PushPreviewQuery` struct (`messageId`, 1..256), and the `GET /push/preview` endpoint. The new route keeps the group's `/api` prefix and the shared `Session`/`SchemaErrors` middleware, so the 401 sweep covers it.
- **Query** (`apps/server/src/push/archive-scan.ts`): extracted the shared scope predicate and the column list into `scopePredicate`/`CANDIDATE_COLUMNS`/`binder()`, reused by `buildNewestQuery` and the new `buildOriginIdQuery`; added exported `readCandidateByOriginId(archive, allowed, originId)` (same scope, `AND origin_id = $n`, `ORDER BY timestamp DESC LIMIT 1`).
- **Resolver** (`apps/server/src/push/candidates.ts`): narrowed `resolveCandidate` and its helpers (`resolveRoomCandidate`, `resolveDmCandidate`, `isMuted`, `topicRoomGeneralJid`) to `CandidateDeps = Pick<PushServiceDeps, 'db' | 'config' | 'now'>`. No body changes.
- **Handler** (`apps/server/src/push/api-handlers.ts`): added the `preview` handler. Rate limit (120/min/user, `PUSH_PREVIEW_RATE_LIMIT_*`, injectable `previewLimiter`) → no archive = 503 `xmpp_unavailable` (`xmppUnavailable()`) → `allowedArchives` → `readCandidateByOriginId` → `resolveCandidate`; on `ok` builds `buildPushPayload(message, { muted: false, visible: true, showPreviews })` and returns `{ title, body, chatId: message.chatJid }`. Unknown id, `muted`, `hidden` and `skip` all answer the same 404 `not_found`. Archive read failures are mapped with `Effect.orDie` → the shared envelope renders the `HttpError`. No text is logged (ids only; the handler itself logs nothing).
- **Wiring** (`apps/server/src/push/api.ts`, `apps/server/src/app.ts`): added `archive?: ArchivePool` to `PushRoutesDependencies` and `previewLimiter?` to `PushApiDependencies`; `app.ts` now passes `...(archive === undefined ? {} : { archive })` to `createPushApi`.
- **Tests** (`apps/server/src/push/api-preview.test.ts`, 4 tests): visible DM → 200 `{ title: 'Bob', body: 'Hello there', chatId }`; previews off → body `'New message'`; message in a group room the caller is not in → 404 `not_found`; signed out → 401. Uses the PGlite `archive` fake from `files/routes.test.ts`.

### Files changed (all inside Allowed files)
`packages/api-contract/src/push.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api.ts`, `apps/server/src/app.ts`, `apps/server/src/push/api-preview.test.ts`, `work/T-1142-push-preview-route.md`.

### Commands and real results
- `pnpm install` — done, 14.3s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/api-preview.test.ts` — 1 file, 4 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts src/push/delivery.test.ts` — 2 files, 10 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` — 5 passed (new route answers 401 unauthenticated).
- Checks, command 1: `pnpm --filter @zilar/server exec vitest run src/push/api-preview.test.ts src/push/candidates.test.ts src/push/delivery.test.ts --reporter=dot` → `Test Files 3 passed (3)`, `Tests 14 passed (14)`.
- Checks, command 2: `pnpm gate` (summary lines):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (9.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (Two earlier `pnpm gate` runs failed on my own files — prettier formatting in `api-handlers.ts`, then an `oxlint unicorn/no-useless-spread` in the test — both fixed before the passing run above.)

### Deviations / decisions
- The spec wrote `urlParams`; Effect 4 has no such option. I used `query` (the spec also says "follow how other GET endpoints with query params are declared"), with `PushPreviewQuery` exported next to `PushPreview`.
- Kept the handler in `api-handlers.ts` (now 302 lines, under 400), so no `apps/server/src/push/api-preview.ts` was created.
- The route does not call `requirePush()`: the spec lists the session check, the no-archive 503, the resolver chain, the 404 and the limiter, and never mentions the push-enabled gate, so I read the omission as intentional (the preview only needs `db`, `config` and the archive).
- `apps/server/src/app.ts` is a pre-existing 626-line wiring file; the spec requires editing it (one added line), so the "≤ 400 lines" acceptance is not met for that pre-existing file only. Every other touched source file is ≤ 400 (largest: `api-handlers.ts` 302).

### Open questions
- None blocking. If the preview route should also answer 404 when push is disabled, that is a one-line `requirePush()` addition — say so and I will add it.


## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits, both accepted.**
- **`GET /api/push/preview?messageId=`** (contract `push.preview`): it requires a session, has a rate limit of 120 per minute, and answers 503 `xmpp_unavailable` without an archive.
  - It runs `allowedArchives`, then `readCandidateByOriginId`, then `resolveCandidate`, then `buildPushPayload` with the user's `showPreviews`.
  - It answers `{ title, body, chatId }`. Unknown, out-of-scope, muted, hidden and skipped all give the same 404 `not_found`.
- **`archive-scan.ts`:** one `scopePredicate` is shared by the newest-scan query and the origin-id query; the scope is not duplicated.
- **`candidates.ts`:** `resolveCandidate` takes `Pick<…, 'db' | 'config' | 'now'>`; the bodies are unchanged.
- **Tests:** the lead ran api-preview, candidates and delivery on the branch: 14 green.
- **Accepted nits:**
  - `app.ts` was already 626 lines, and the spec's one-line wiring there is waived from the 400 rule;
  - one comment wrongly says "like search" about the 503.
