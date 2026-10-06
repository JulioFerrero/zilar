---
id: T-0410
title: "Media gallery step 1a (server): media_items and media_index_state tables, and an incremental indexer that fills them from the message archive"
status: todo
milestone: M5
branch: task/T-0410-server-media-index
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0410: media index tables and indexer

## Spec (written by Claude, do not edit)

### Why
Julio approved the media gallery plan on 2026-10-06 (`docs/audit/media-gallery-plan.md` §5: every recommendation accepted). This is Task 1a of that plan:
- the schema, one migration, and a bounded incremental indexer that reads the ejabberd archive and stores one row per media item or link;
- **no HTTP route yet** (that is the next task, 1b).

**This is the only schema task running. Do not touch any other table.**

### Verified facts (do not re-derive)
- **Plan:** §3a says what the indexer extracts, §3c gives the access and deletion rules, and §4 has Task 1. Read all three.
- **Archive access:** `apps/server/src/search/service.ts`.
  - `ArchivePool` (line 14) has `query(text, values) => Promise<ArchiveRow[]>`.
  - `ArchiveRow` (line 19) has the fields `owner`, `peer`, `barePeer`, `kind`, `nick`, `originId`, `timestamp` (microseconds, as number, string or bigint), `xml` and `body?`.
  - `createArchivePool` (line 36) sets a 3 s statement timeout and `max: 3`.
- **Search's bounds** (`apps/server/src/search/routes.ts:28-36`): `SEARCH_WINDOW_MONTHS = 12`, `SEARCH_WINDOW_MS` and `SEARCH_MAX_CANDIDATES = 5000`.
- **Archive scope** (`routes.ts:202-206`):
  - a room is `username = <room>`;
  - a DM is `username = <ownLocalpart> AND bare_peer = <peer>`.
  - The full-row query is `routes.ts:273` (`SELECT username AS owner, peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, xml, txt AS "body" FROM archive WHERE … ORDER BY timestamp DESC LIMIT …`).
- **Edits and retractions:**
  - `correctionTarget(xml)` (line ~519) and `retractTarget(xml)` (line ~528) are exported from `routes.ts` and return the target origin id;
  - `stanzaFrom(xml)` (line ~133) gives the sender;
  - `chatJidFor` (line ~139) is `row.kind === 'groupchat' ? row.owner : row.barePeer`.
- **Payloads:**
  - the message payload is JSON text inside the `<agent>` child in `AGENT_NAMESPACE` (`packages/xmpp-core/src/stanza.ts:985-990`), decoded with `decodePayload` from `@zilar/protocol` (`packages/protocol/src/payload.ts:71`);
  - the `attachment` and `voice` payload shapes are in `packages/protocol/src/attachment.ts` and `packages/protocol/src/voice.ts`;
  - for the GIF rule (an attachment whose name starts with `gif-` and whose mime is `video/*`), see plan §3a.
- **Links:** the rule is `URL_PATTERN = /https?:\/\/[^\s<]+/gi` plus trailing-punctuation trimming (`packages/chat-core/src/links.ts:4-60`).
  - The server depends on `@zilar/protocol` and `@zilar/xmpp-core` (`apps/server/package.json:15,17`) but **not** on `@zilar/chat-core`.
  - Copy the pattern and the trim rule into a small local helper with a comment naming `links.ts`. Do not add a dependency.
- **Schema style:** see `routines` at `apps/server/src/db/schema.ts:1181` (`text` ids, `timestamp(…, { withTimezone: true })`, `jsonb(…).$type<…>()`, index callbacks).
  - Migrations: `pnpm --filter @zilar/server db:generate` (drizzle-kit). The current head is `apps/server/drizzle/0040_majestic_legion.sql`.
- **Test fake:** `apps/server/src/search/search.test.ts:61-80` builds `pgliteArchivePool`, a fake `ArchivePool` on a second PGlite shaped like the real `archive` table (lines 21-60). Reuse that approach. Copy the helper into your test, since it is not exported.

### What to build
1. **Schema** (`apps/server/src/db/schema.ts`), two tables:
   - **`mediaItems` (`media_items`):**
     - columns:
       - `id` text pk;
       - `archiveOwner` text (the archive `username`: the room localpart, or the DM owner's localpart);
       - `chatJid` text;
       - `messageId` text (the origin id);
       - `atMicros` bigint (mode number);
       - `senderJid` text;
       - `kind` text enum `image | file | gif | voice | link`;
       - `url`, `name`, `mime` text, nullable;
       - `size`, `width`, `height`, `durationMs` integer, nullable;
       - `waveform` jsonb `number[]`, nullable;
       - `linkUrl`, `linkHost` text, nullable;
       - `deleted` boolean, not null, default false;
       - `createdAt`.
     - a unique index on `(archiveOwner, chatJid, messageId, kind, coalesce(url, link_url))`. If drizzle cannot express the coalesce, add a not-null `ref` text column, set to the URL or link URL, and make the index unique on `(archiveOwner, chatJid, messageId, kind, ref)`.
     - an index on `(archiveOwner, chatJid, kind, atMicros)`.
   - **`mediaIndexState` (`media_index_state`):**
     - `archiveOwner` and `chatJid`, with a composite pk;
     - `indexedThroughMicros` bigint, not null;
     - `updatedAt`.
2. **Migration:** generate one with `db:generate` (the next number after 0040), and commit the SQL, journal and snapshot.
3. **`apps/server/src/media/indexer.ts`:**
   - **`extractMediaItems(row: ArchiveRow)`** is pure. It returns the items of one archive row:
     - an attachment gives `image` or `file`, or `gif` under the GIF rule;
     - a voice payload gives `voice`;
     - each http(s) link in `body` gives a `link`, with `linkHost` taken from `new URL(...)`; invalid URLs are dropped.
     - A row whose XML fails to parse, or whose payload is invalid, gives only its links, or nothing. It never throws.
   - **`indexChat({ archive, db, archiveOwner, chatJid, scope, now })`:**
     - it reads rows newer than the stored cursor and inside the 12-month window, ascending, at most 5000 rows per call, with the same scope SQL as search;
     - it upserts the items with `ON CONFLICT DO NOTHING` on the unique key;
     - correction rows (`correctionTarget`) replace the target's link rows. Delete the target's old `link` rows, then insert the links from the new text;
     - retraction rows (`retractTarget`) set `deleted = true` on every row of the target message;
     - it advances `indexedThroughMicros` to the last row read;
     - it returns `{ read, inserted, done }`, where `done` means fewer than 5000 rows were read.
   - **Cap:** after indexing, if the chat has more than 20 000 rows, delete the oldest down to 20 000. Export the constants `MEDIA_INDEX_MAX_ROWS = 5000`, `MEDIA_ITEMS_CAP_PER_CHAT = 20000` and `MEDIA_WINDOW_MONTHS = 12`.
4. **Tests** in `apps/server/src/media/indexer.test.ts`:
   - extraction of image, file, gif, voice and links, plus invalid JSON and malformed XML;
   - `indexChat` inserts the items, is idempotent on a second run (no duplicates; the cursor advances), applies a correction to links, and marks a retraction deleted;
   - the cap prunes the oldest rows (lower the cap through a parameter in the test, rather than inserting 20 000 rows).

   Use PGlite for the server database the way existing server tests do (copy the setup from `search.test.ts`).

### Read first
`AGENTS.md`, `docs/audit/media-gallery-plan.md` §3 and §4, `apps/server/src/search/service.ts`, `apps/server/src/search/routes.ts:120-290` and `:500-535`, `apps/server/src/search/search.test.ts:1-140`, `packages/xmpp-core/src/stanza.ts:950-1000` and `packages/xmpp-core/src/namespaces.ts` (for the `AGENT_NAMESPACE` value). The server parses archive XML with small defensive regex readers, not an XML library (see `stanzaFrom` and `tagAttribute` in `routes.ts`). Do the same: find the `<agent xmlns="…">…</agent>` text with a regex, unescape the five XML entities, then `decodePayload`. Add no dependency., and `apps/server/src/db/schema.ts:1181-1230`.

### Allowed files
`apps/server/src/db/schema.ts`, `apps/server/drizzle/0041_*.sql`, `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0041_snapshot.json`, `apps/server/src/media/indexer.ts`, `apps/server/src/media/indexer.test.ts`, `work/T-0410-server-media-index.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot media/indexer
pnpm gate
```

### Acceptance
- One migration adds the two tables.
- The indexer extracts, upserts, applies edits, retractions and the cap, and never throws on bad rows.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.
- If the gate's scope check rejects the generated file names, report them; the lead will widen the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
