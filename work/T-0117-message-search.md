---
id: T-0117
title: Message search across chats, groups and topics (server + web)
status: planned
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
pnpm --filter @galena/server test -- --maxWorkers=2
pnpm --filter @galena/web test -- --maxWorkers=2
pnpm build
```

### Out of scope
- Searching attachments' contents, semantic/vector search, mobile UI, a search index of our own, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
