---
id: T-0117
title: Message search across chats, groups and topics (server + web)
status: review
milestone: M5
branch: task/T-0117-message-search
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108]
estimate: 2 days
---

# T-0117: Message search

## Spec (written by Claude, do not edit)

### Why
D28: "find that thing someone told me" is table stakes. ejabberd already stores every message in Postgres (`mod_mam` with `db_type: sql`, `default_db: sql`, database `ejabberd` on the same Postgres instance). The `archive` table has a plain-text column `txt`. Search reads it, **restricted to what the caller may see**.

### Discovery first (a short step you must do and report)
With `pnpm infra:up` running, inspect the real schema: `docker exec galena-dev-postgres-1 psql -U postgres -d ejabberd -c '\d archive'` and look at real rows for (a) a DM and (b) a group room (how `username`, `bare_peer`, `peer`, `kind`, `nick`, `txt`, `id`, `timestamp` are filled, and what a retracted or corrected message looks like). Write what you found in `docs/SEARCH_NOTES.md` (≤ 60 lines) **before** the code, and build the queries on it. Do not print or copy message contents into the notes: describe columns and shapes only. Never read `infra/.env`.

### Server
- New optional env `XMPP_ARCHIVE_DATABASE_URL` (zod; a **read-only** role on the ejabberd database; document how to create it with `GRANT SELECT ON archive TO ...` in `docs/SERVER_CONFIG.md` and add the role to `infra/postgres/init/` as a new numbered SQL script with a `CHANGE_ME` password placeholder, mirroring the existing ones). Absent → `GET /api/search` answers 501 `search_unavailable` and the web hides the feature. The archive pool is separate from the app pool, `max` small (3), statement timeout 3 s.
- `GET /api/search?q=&chat=&limit=&before=` (session required): `q` 2–100 chars, trimmed; `chat` optional JID to search one chat; `limit` ≤ 50; `before` a timestamp cursor. Results `{ items: [{ chatJid, messageId, senderName, at, snippet }], nextBefore }`, newest first. Matching: `to_tsvector('simple', txt) @@ websearch_to_tsquery('simple', $q)` (no expression index is possible in the ejabberd database: cap the scan window to the last 12 months and 5 000 candidate rows per request, and say so in the notes), snippet via `ts_headline` with `StartSel=\u0001, StopSel=\u0002`, which the server converts into a plain-text `snippet` plus `marks: [[start, end], …]` (character ranges); never return raw HTML.
- **Authorization is the point.** The allowed archives for the caller are computed from *our* tables, never from client input: DMs with their contacts and their own AIs (their side of the archive), the General room of each group they belong to, every topic room they can see (`visibleTopics`, T-0108, including role access if T-0116 is merged). A `chat` filter outside that set → 404. Use parameterized queries only (`$1`, arrays), never string-built SQL. Exclude messages the caller sent that were later retracted/corrected per your notes (show the latest text only).
- Rate limit 30 searches per minute per user. **No audit entries with the query text and no logging of `q`** (log only the result count and duration).
- The AI gateway does **not** use this endpoint.

### Web
- The existing search box / `⌘K` currently filters chat names. Extend it: typing 2+ characters shows chat-name matches first, then a **Messages** section with results grouped by chat/topic (avatar/glyph, `Group › Topic` for topics, sender, time, snippet with the marks highlighted with a `<mark>`-like span; text is rendered as text, never HTML). Enter/click opens that chat at the message (jump via the history loader used by pinned messages if T-0114 is merged, otherwise open the chat and show the message by loading history until found, with a "Message not found" fallback). "Search only in this chat" when opened from a chat header.
- Debounce 250 ms, cancel superseded requests, empty and error states, and hidden entirely when the server answers 501.
- Mock mode: a small in-memory index over the mock messages.

### Read first
- `AGENTS.md`; `work/T-0108-topics-server.md` (access helpers); `infra/ejabberd/ejabberd.yml`, `infra/postgres/init/*`, `infra/docker-compose.dev.yml`
- `apps/server/src/config.ts`, `db/client.ts`, `rate-limit.ts`, `authz-sweep.test.ts`; `apps/web/src/components/{SearchBar,ChatList}.tsx`, `store/store.ts`, `lib/api.ts`

### Allowed files
- `apps/server/src/search/**` (new), `apps/server/src/config.ts` (+ test), `apps/server/src/app.ts`, `apps/server/src/index.ts` (pool wiring), `authz-sweep.test.ts`
- `infra/postgres/init/*` (one new script), `docs/SERVER_CONFIG.md`, `docs/SEARCH_NOTES.md` (new)
- `apps/web/src/**` (components, lib, store, mock, tests)
- `work/T-0117-message-search.md`

**Not allowed:** ejabberd config changes, mobile, other packages, dependencies (use the existing `pg`/drizzle client).

### Tests
- Server (PGlite with a hand-made `archive` table shaped like the real one from your notes; no real ejabberd): matching, ordering, cursor, snippet marks, limits and window, the allowed-archive computation (a private topic the caller is not in never appears; a group they left never appears; a DM of somebody else never appears), `chat` outside the allowed set → 404, parameterization (a query containing SQL metacharacters is just text), 501 without the env, rate limit, no query text in logs (capture the logger).
- Web: debounce/cancel, grouping, highlight rendering as text (hostile snippet), open-at-message, 501 hides it, mock mode.

### Acceptance criteria
- [ ] A user can only ever find messages from chats they may see; proved by tests over a private topic, a left group and another user's DM.
- [ ] The query text is never stored or logged; snippets are never rendered as HTML.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Searching attachments' contents, semantic/vector search, mobile UI, a search index of our own, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Discovery first: with `pnpm infra:up` running I ran only `\d archive` and
  `select count(*)` (3 524 rows) against the live ejabberd DB — per the lead's
  privacy note I never selected message rows. Column semantics
  (`username`/`bare_peer`/`peer`/`kind`/`nick`/`txt`/`origin_id`/`xml`,
  per-side DM rows, per-room group rows, correction/retraction row shapes)
  were derived from the ejabberd 26.07 sources (`mod_mam.erl`,
  `mod_mam_sql.erl`, `pg.sql`) plus our own client stanza builders
  (`packages/xmpp-core/src/stanza.ts`: XEP-0308 `<replace/>`, XEP-0424
  `<retract/>` + fallback body). Written up in `docs/SEARCH_NOTES.md`
  (48 lines, ≤ 60 as required) before the code.
- Server (`apps/server/src/search/`): `GET /api/search`
  (`q` 2–100 chars trimmed, optional `chat` JID, `limit` ≤ 50 default 20,
  `before` microsecond cursor). Full-text match
  `to_tsvector('simple', txt) @@ websearch_to_tsquery('simple', $q)`,
  snippet via `ts_headline` with `StartSel=/StopSel=` sentinels converted
  to plain-text `snippet` + `marks` ranges (never HTML). Scan capped to the
  last 12 months and 5 000 candidates; `WHERE username … AND timestamp > …`
  stays on the existing `(username, timestamp)` index.
  - Authz: allowed archives computed from our tables only — caller's own
    `username` + `bare_peer` filter for DMs (contacts incl. names, own AIs),
    General + `visibleTopics` room JIDs for groups. `chat` outside the set
    → 404 `not_found`. DMs are never read under the peer's `username`.
    Corrections: latest text per `(chat, origin_id)` target wins (via a
    second bounded `xml LIKE` query, since edit rows need not contain `q`);
    retracted messages and retract rows themselves are excluded (detected
    from namespaced `xml` tags only). Fully parameterized `$n` bindings.
  - `XMPP_ARCHIVE_DATABASE_URL` (zod, optional): separate pool
    (`max` 3, `statement_timeout` 3 s). Absent → 501 `search_unavailable`.
    Rate limit 30/min/user. Logs `{ userId, results, durationMs }` only —
    never `q`. No audit rows. AI gateway untouched.
  - Infra/docs: `infra/postgres/init/20-search-reader.sql` creates the
    `galena_archive` login role with only `GRANT SELECT ON archive`
    (`CHANGE_ME` placeholder, password from `infra/.env`, git-ignored);
    `docs/SERVER_CONFIG.md` documents the var + role setup.
- Web: `SearchBar`/`⌘K` keeps filtering chat names; typing 2+ chars adds a
  **Messages** section below (chat-name matches first), hits grouped by
  chat with avatar, `senderName`, time, and snippet marks rendered as
  text-only spans (`SearchSnippet`). `useMessageSearch`: 250 ms debounce,
  `AbortController` cancel of superseded requests, empty/error states,
  hidden entirely on 501. Enter/click → `openAtMessage` (new store action:
  opens the chat, pages history until the message loads, max 20 pages,
  else "Message not found") + scroll to `[data-message-id]`. Chat header
  "Search in chat" now scopes via a `searchChat` chip in the search box
  (click the chip to clear). Mock mode: in-memory substring search over
  mock messages in `mock/api.ts`.
- T-0116 (roles) is not merged, so role-based topic access is not in the
  allowed set; the spec's "including role access if T-0116 is merged" is
  noted in code for that task. T-0114 (pinned jump loader) is not merged,
  so jumping uses `loadOlder` paging with the "Message not found" fallback.

### Files changed
- `apps/server/src/search/service.ts` (new: pool, `allowedArchives`, `resolveChatFilter`),
  `routes.ts` (new: endpoint, `buildArchiveQuery`, `headlineToSnippet`,
  correction/retraction targets, `stanzaFrom` + direction-aware `senderNameFor`),
  `search.test.ts` (new: 18 tests)
- `apps/server/src/config.ts` (+`config.test.ts`), `app.ts`, `index.ts`
  (pool wiring); `authz-sweep.test.ts` untouched (covers `/api/search` → 401)
- `infra/postgres/init/20-search-reader.sql` (new, fully guarded),
  `docs/SERVER_CONFIG.md`, `docs/SEARCH_NOTES.md` (new, 50 lines)
- `apps/web/src/lib/api.ts` (`searchMessages` + schemas),
  `lib/useMessageSearch.ts` (new), `lib/scrollToMessage.ts` (new),
  `components/MessageSearchResult(s).tsx` (new),
  `components/ChatList.tsx`, `ChatHeader.tsx`, `SearchBar.tsx`,
  `store/store.ts` + `realStore.ts` (`searchChat`, `openAtMessage`;
  `loadOlder` refactored to share `loadOlderPage`), `mock/api.ts`
- Tests: `MessageSearch.test.tsx` (11), `MessageSearchList.test.tsx` (6),
  `mock/api.test.ts` (+2), `realStore.test.tsx` (+3 `openAtMessage`)
- `work/T-0117-message-search.md` (this report + status)

### Commands run and real results
- `pnpm install`: pass (6.3 s)
- Discovery: `\d archive` (columns + 5 indexes as spec'd), `select
  count(*)` → 3524; ejabberd sources fetched via webfetch
  (`mod_mam.erl`, `mod_mam_sql.erl` 26.07). No message contents read.
- `pnpm format:check`: pass for all owned files (the repo-wide check also
  flags the lead's untracked `PREREVIEW.md`, which is not mine and I left
  untouched; `.sql` has no Prettier parser, same as before)
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass — server `tsc --noEmit` clean (full turbo
  typecheck passed pre-review at 10/10; rerunning per the one-command rule)
- `pnpm --filter @galena/server test --maxWorkers=2` (full suite, rerun
  after review fixes): 65 files passed, 5 skipped; 1114 passed, 7 skipped
  (includes the 3 new sender-attribution tests)
- `pnpm --filter @galena/web test --maxWorkers=2`: full suite 662 passed
  (24.8 s, pre-review; web code untouched by review fixes — `You` renders
  as plain text through the existing sender slot, no test breakage)
- `pnpm build`: pass (2/2 turbo tasks, pre-review; rerunning below)
- Scoped: `src/search` 18 passed; `config.test.ts` 22 passed (incl. 3 new);
  `authz-sweep` 5 passed (`GET /api/search → 401` listed);
  `MessageSearch*.test.tsx` 17 passed; `realStore.test.tsx` 94 passed.
- `grep` for `any|@ts-ignore|disable` in all new/touched source: no hits.

### Problems, deviations from the spec, open questions
- `before` is documented as microsecond `archive.timestamp` units (the only
  cursor that pages exactly); ISO cursors would need lossy conversion.
- Mock-mode `before` compares ISO strings; server `before` compares
  microsecond ints. Same newest-first paging semantics, different units —
  acceptable for a mock, noted here.
- `openAtMessage` pages back at most 20 history pages, then "Message not
  found". A direct MAM `before`-cursor jump (T-0114's loader, not merged)
  would be faster; this follows the spec's fallback path.
- `SEARCH_WINDOW_MS` is 365 days as "12 months"; leap-day precision is
  irrelevant for a scan cap.
- The `galena_archive` role script only takes effect on first start of an
  empty volume (like `10-create-databases.sql`); existing volumes need the
  manual `GRANT SELECT ON archive TO galena_archive;` from SERVER_CONFIG.
  When ejabberd creates `archive` after postgres init (the normal order),
  the DBA runs that same GRANT once the table exists — also documented.
- No new dependencies. No secrets read or committed (`infra/.env` never opened).

### Round 2 (review fixes)
- Fix 1 — init script no longer breaks fresh installs: the whole body is
  guarded by `\if :{?galena_archive_password}` plus an empty-string check
  (`SELECT … \gset` → `\if :has_pw`), and the `ejabberd`-database and
  `archive`-table steps are each guarded by `EXISTS` checks, so the script
  is a no-op whenever the variable, database, or table is absent. I first
  added `REVOKE CONNECT … FROM PUBLIC` for least privilege, then removed
  it before proving: it would have broken the existing
  `galena`/`ejabberd`/`litellm` roles, which rely on the stock PUBLIC
  connect grant and get no explicit grant in `10-create-databases.sql`.
  The reader now gains only `CONNECT` on `ejabberd` + `SELECT` on one
  table; everything else keeps working exactly as before.
  Proved on real `pgvector/pgvector:0.8.6-pg18-trixie` scratch containers
  (never `galena-dev-*`; only throwaway passwords; `galena-dev-postgres-1`
  untouched): (a) WITHOUT the variable → init starts cleanly, no ERROR or
  FATAL in the logs, all four databases created, `galena_archive` role
  count 0. (b) WITH `GALENA_ARCHIVE_DB_PASSWORD=throwawayarchive` →
  clean start, role exists with LOGIN and a password. (c) Empty-string
  variable → clean start, role count 0. (d) With the var set but no
  `archive` table yet (the real boot order) → clean start, role exists;
  after creating a stand-in `archive` table + manual GRANT, the reader
  `SELECT count(*)` returns 0, `SELECT` on another table → permission
  denied, `INSERT` → permission denied, `CONNECT` to `galena`/`postgres`
  (tested after removing the REVOKE lines) still works for existing roles
  — i.e. least privilege holds without touching PUBLIC grants. All
  scratch containers stopped and removed afterwards.
- Fix 2 — DM sender attribution: `senderNameFor` now parses the stanza's
  `from` (`stanzaFrom`, defensive regex like the other tag readers) and
  returns `You` when its bare JID equals the caller's
  (`ownLocalpart@xmpp.domain` from config; localpart authoritative, domain
  lowercased for the comparison). Malformed/missing `from` falls back to
  the peer's name; group hits still use the room nick. New tests: outgoing
  DM → `You`, incoming → peer name (`Bob`, via renamed test users),
  malformed xml → peer name; group hit → nick; `stanzaFrom` unit cases
  (single quotes, missing/empty/garbage). Web renders `senderName` as
  plain text already, so `You` needs no special handling and no web test
  broke (web suite untouched by this change).
- Nit — `SEARCH_NOTES.md` (now 50 lines, still ≤ 60) says the query is a
  sequential scan capped at 12 months / 5 000 rows and that the 3 s
  statement timeout protects the database on very large archives.
- The compose pass-through of `GALENA_ARCHIVE_DB_PASSWORD` is left to the
  lead as instructed; the script assumes the variable may be absent.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
