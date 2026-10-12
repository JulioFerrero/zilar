---
id: T-1262
title: "Account export T-C (server): a streamed JSON download of my profile, contacts and my own MAM archive (paged by timestamp, caps 200k messages / 250 MB, fresh session ≤30 min, 1 per hour), on the auth API at /me/export; logs counts only"
status: merged
milestone: M5
branch: task/T-1262-account-export
model: auto
effort: default
depends_on: [T-1261]
estimate: 0.5 day
---

# T-1262: Export my messages (server)

## Spec (written by Claude, do not edit)

### Why
This is task T-C of `docs/audit/account-deletion-plan.md` §9 (`:479-484`). The design is §6 (`:293-360`); read it all. The export only reads, so the lead starts it on the plan's recommendations (decisions 8-10 in §8):
- a direct streamed download;
- a fresh session of at most 30 minutes;
- caps of 200k messages / 250 MB / 1 per hour.

### What to build
1. **The route:** a new GET at `/me/export` on the auth group (`packages/api-contract/src/auth.ts`), so `apps/server/src/app.ts` doesn't change.
   - The success is a raw streamed body: follow how the files route streams (`apps/server/src/files/api.ts:308-315`), and cite how its contract declares a raw response.
   - Headers: `Content-Type: application/json; charset=utf-8` and `Content-Disposition: attachment; filename="zilar-export-<YYYY-MM-DD>.json"`.
2. **The document,** exactly the shape in plan §6a (`:299-308`):
   - `exportedAt`;
   - `profile` (id, name, handle, bio);
   - `contacts`;
   - `chats[]` with `messages[]` (`id`, `at`, `from: "me" | "them"` for DMs or the sender's JID for rooms, `body`, `kind`).
3. **The sources:**
   - **Profile and contacts:** our tables. Reuse the bio from `apps/server/src/auth/profile-bio.ts`.
   - **Messages:** the ejabberd `archive` table **scoped to the caller's own `username` only**. Reuse `allowedArchives` and the scope from `apps/server/src/search/service.ts:74-143` and `apps/server/src/search/archive-query.ts:128`.
     - Page keyset-style by `timestamp`, so memory stays flat.
     - Turn each row's `xml` into body and kind with the existing extractor (`apps/server/src/media/extract.ts`), reused and not copied.
   - **Stream** chat by chat, page by page, as you write: never build the whole document in memory.
4. **Limits:**
   - **Freshness:** require a session at most 30 minutes old. Reuse `DELETION_FRESH_SESSION_MS` and the check from `apps/server/src/auth/deletion-request.ts`, generalised if needed. Otherwise answer 403 `reauth_required` ("Sign in again to export your messages.").
   - **Rate:** 1 export per hour per user (`createRateLimiter`, as in `apps/server/src/auth/api.ts:120-125`), else 429.
   - **Size:** count messages and bytes. Before streaming, run a `count(*)` on the scoped archive; over 200,000 messages answers 413 `export_too_large` ("Export too large. Contact the operator."). If the byte cap (250 MB) is hit mid-stream, stop and end the JSON with `"truncated": true`, and say so in the Report.
5. **Audit and logs:**
   - audit `account.exported` with `subject_id = userId` (`apps/server/src/audit/recorder.ts:41`);
   - log only `{ userId, messageCount, byteSize }`, never rows, XML or bodies.
6. **Mock:** a GET `/me/export` in `packages/mock-backend/src/domains/me/` that returns a small JSON of the seed with the same shape.
7. **Tests** (permissions), in a new `apps/server/src/auth/export.test.ts`, up to 4:
   - the export contains only the caller's archive rows, never another user's (two users with archives);
   - a stale session gets 403 `reauth_required`;
   - a second export within an hour gets 429;
   - the JSON parses and has the §6a keys, with DM `from` mapped to me/them.

Keep every file at most 400 lines: put the code in new `apps/server/src/auth/export.ts` and `apps/server/src/auth/export-stream.ts`.

### Out of scope
The web and mobile buttons (T-D, T-E).

### Read first
`AGENTS.md`, `docs/audit/account-deletion-plan.md` §6 and §9, `apps/server/src/search/service.ts`, `apps/server/src/search/archive-query.ts`, `apps/server/src/media/extract.ts`, `apps/server/src/files/api.ts:280-330`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/deletion-request.ts` and `packages/api-contract/src/auth.ts`.

### Allowed files
`packages/api-contract/src/auth.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/export.ts`, `apps/server/src/auth/export-stream.ts`, `apps/server/src/auth/export.test.ts`, `apps/server/src/auth/deletion-request.ts`, `apps/server/src/media/extract.ts`, `apps/server/src/search/service.ts`, `packages/mock-backend/src/domains/me/**`, `work/T-1262-account-export.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth/export.test.ts src/auth/deletion-request.test.ts src/search --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's live check after deploy:** none with Julio's data. The lead only checks that the route answers 401 without a session.

---

## Report (written by the worker when done)

### What I did
- **Contract** (`packages/api-contract/src/auth.ts`): added `GET /me/export` to the auth group with no `success` schema — a raw response, the same way the files route (`apps/server/src/files/api.ts:176-182`) and the GIF media route (`gifs.ts:52-54`) declare one. `app.ts` is untouched; the route is served by `createAuthApi`.
- **Extractor** (`apps/server/src/media/extract.ts`): added `extractMessageContent(row)` returning `{ body, kind }`, reusing `extractMediaItems` so the XML is parsed in one place. `kind` collapses the media kinds to the §6a four (`gif`→`image`, `link`→`text`); `body` is the row's `txt`.
- **Stream** (`apps/server/src/auth/export-stream.ts`, new): `exportMessage(row, ownBareJid, chatKind)` maps one row to the §6a message (`from` = `me`/`them` for a DM by comparing the stanza `from` to the caller's bare JID, the sender's JID for a room; `at` via `timestampToIso`). `createExportStream` bridges an async generator to a web `ReadableStream` with Effect's `Stream.toReadableStream` (the Effect gate requires it); the generator writes the header, then one chat at a time, page by page, tracks message count and bytes, and on the 250 MB cap stops and closes the JSON with `"truncated": true`.
- **Service** (`apps/server/src/auth/export.ts`, new): `runExport` runs the gates in order — archive configured (501), fresh session (403 `reauth_required`), one-per-hour limiter (429 `rate_limited`), scoped `count(*)` (413 `export_too_large` over 200 000) — then reads profile (name from `user`, handle from `handles`, bio from `profile-bio.ts`), the caller's non-blocked contacts, and streams `allowedArchives`' DM peers then rooms, keyset by `timestamp ASC`. Headers: `Content-Type: application/json; charset=utf-8` and `Content-Disposition: attachment; filename="zilar-export-<YYYY-MM-DD>.json"`. On completion (or client disconnect) it logs only `{ userId, messageCount, byteSize }` and audits `account.exported` with `subject_id = userId` and no detail. `createExportHandler` owns the limiter and resolves the pool.
- **Wiring** (`apps/server/src/auth/api.ts`): `AuthApiDependencies` gained an optional `archive`; `createAuthApi` builds the export handler and registers it. `createExportHandler` falls back to `createExportArchivePool(config)`, which builds a read-only pool from `XMPP_ARCHIVE_DATABASE_URL`, so `app.ts` needs no change.
- **Freshness** (`apps/server/src/auth/deletion-request.ts`): generalised the check into `FRESH_SESSION_MS` + `assertFreshSession(...)`; `DELETION_FRESH_SESSION_MS` stays as an alias, so the deletion path and its tests are unchanged.
- **Mock** (`packages/mock-backend/src/domains/me/export.ts` + `routes.ts`): `GET /me/export` answers a small §6a document built from the seed (profile, human contacts, chats with me/them for DMs and the sender JID for rooms).
- **Tests** (`apps/server/src/auth/export.test.ts`, new): 4 tests — only the caller's rows; stale session 403 `reauth_required`; second export 429 `rate_limited`; JSON parses with the §6a keys and DM `from` mapped to me/them.

### Files changed
`packages/api-contract/src/auth.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/export.ts` (new), `apps/server/src/auth/export-stream.ts` (new), `apps/server/src/auth/export.test.ts` (new), `apps/server/src/auth/deletion-request.ts`, `apps/server/src/media/extract.ts`, `packages/mock-backend/src/domains/me/export.ts` (new), `packages/mock-backend/src/domains/me/routes.ts`, `work/T-1262-account-export.md`. `apps/server/src/search/service.ts` was in the Allowed list but needed no change (only imported). Every file is ≤400 lines (largest: `apps/server/src/auth/api.ts`, 386).

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/export.test.ts` → **4 passed (1 file)**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/deletion-request.test.ts src/search` → **4 passed (1 file)**; `src/search` has no test files, so only deletion-request ran.
- `pnpm gate` (from the repo root):
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (2.2s)
PASS  effect  (0.4s)
SKIP tests @zilar/api-contract (no nearby test files)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (12.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations / decisions
- **The archive pool for the route.** Because `app.ts` may not change, `createAuthApi` (which `app.ts` already builds with `config`) resolves the export's read-only pool from `XMPP_ARCHIVE_DATABASE_URL` when no pool is injected. In production that is a second small pool to the same archive database (the app's own pool is created in `main.ts` and passed to search/files/push); tests inject a fake pool. If the lead prefers sharing the one pool, `app.ts` would have to pass `archive` to `createAuthApi` (a file outside this task's scope).
- **Unconfigured archive → 501 `export_unavailable`** (message "Account export is not configured"), matching the search route's 501 when the pool is absent. The spec did not name a code for this case.
- **Corrections/retractions** are exported as their own archive rows (a correction carries its new body; a retraction is an empty text row). The spec did not ask to collapse them as search does; I did not.
- **Byte cap.** It is checked per message while writing; a truncation closes the open `messages` array and the root object and appends `"truncated": true`, so the JSON stays valid. The header/profile/contacts alone are never capped (they are tiny).
- **Keyset by `timestamp > cursor`** as the spec asked; rows sharing the exact boundary timestamp could in theory be skipped if a page ends on it. The `timestamp` column is microseconds, so this is not expected in practice.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (5 nits, 1 follow-up). The lead restarted the pre-review and switched it to the paid Muse, because the free Muse answered 401.**
- **What the lead read in `export.ts`:**
  - DM rows come only from `username = <own localpart> AND bare_peer = <peer>`, and rooms only from the caller's `allowed` set, the same rule search uses;
  - pages are keyset by `timestamp > cursor ORDER BY timestamp ASC LIMIT`;
  - `count(*)` runs first and over 200,000 answers 413;
  - a 250 MB byte cap ends the JSON with `"truncated": true`;
  - the session must be at most 30 min old (the check shared with `deletion-request.ts`), otherwise 403 `reauth_required`;
  - 1 export per hour;
  - the log carries counts only.
- **Follow-up F1:** without an injected pool, the export opens its own archive pool instead of sharing `main.ts`'s. It's a small fix in `main.ts`; queue it with the next server task.
- **Lead's checks after rebasing onto main:**
  - auth `export` + `deletion-request` tests: 8 passed;
  - server tsc: 0 errors;
  - `api.ts` is 386 lines.
- **Next:** live after deploy, read-only: the export route answers 401 without a session. The lead never downloads Julio's export.
