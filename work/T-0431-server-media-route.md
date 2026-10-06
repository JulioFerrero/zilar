---
id: T-0431
title: "Media gallery 1b (server): GET /api/media?chat&type&before&limit, which indexes the chat on demand and returns paged items, members only, with a block check"
status: todo
milestone: M5
branch: task/T-0431-server-media-route
model: auto
effort: low
depends_on: [T-0410]
estimate: 0.4 day
---

# T-0431: the `/api/media` read route

## Spec (written by Claude, do not edit)

### Why
This is Task 1b of `docs/audit/media-gallery-plan.md` §4. Julio accepted every recommendation in §5 on 2026-10-06. T-0410 (merged) added the `media_items` and `media_index_state` tables and `indexChat`. This task adds the read endpoint that the web and mobile galleries will call. **No schema change.**

### Endpoint (plan §3b, §3c)
`GET /api/media?chat=<jid>&type=<media|files|links|voice>&before=<micros>&limit=<n>`

- **`type`:** `media` returns kinds `image` and `gif`; `files` returns `file`; `links` returns `link`; `voice` returns `voice`. The default is `media`.
- **`limit`:** default 50, maximum 100. **`before`:** a positive integer in microseconds.
- **Response:** `{ items: MediaItem[], next: string | null }`, newest first. `next` is the `atMicros` (as a string) of the last item when there may be more, else `null`.
  - Use limit + 1 to detect another page.
- **`MediaItem`:** `{ messageId, chat, at (ISO), senderName, kind, url?, name?, size?, mime?, width?, height?, durationMs?, waveform?, linkUrl?, linkHost? }`. Omit absent fields; never send `null`.

### Verified facts (do not re-derive)
- **Pattern to copy:** `apps/server/src/search/routes.ts:302-332`, `createSearchRoutes`:
  - `createRateLimiter({ max: 30, windowMs: 60_000, now })`;
  - `requireSession(deps.auth, c.req.raw.headers)`;
  - 501 `search_unavailable` when `deps.archive` is undefined;
  - 429 `rate_limited`;
  - a strict zod `querySchema` (lines 49-56) → 400 `invalid_request`;
  - `allowedArchives(deps.db, deps.config, user.id)` and `resolveChatFilter(allowed, chat)` (`apps/server/src/search/service.ts:65,116`) → 404 `not_found` when null.
  - The deps interface is at `search/routes.ts:38-47`.
- **Mount:** `apps/server/src/app.ts:375-388` mounts search at `/api` with `{ auth, db, config, logger, archive?, now? }`. Mount the media routes right after it the same way. Reuse the existing `archive` and `searchNow` options, so add no new `createApp` option.
- **Indexer:** `apps/server/src/media/indexer.ts`:
  - `indexChat({ archive, db, archiveOwner, chatJid, scope, now })` (lines 45-56, 308);
  - `scope` is `{ kind: 'dm'; peer } | { kind: 'room'; room }`, the same shape `resolveChatFilter` returns;
  - `archiveOwner` is the room JID for a room, or the caller's own localpart (`allowed.ownLocalpart`) for a DM, as the comments at lines 40-52 say;
  - `chatJid` is the room JID, or the DM peer's bare JID.
- **Table `mediaItems`** in `apps/server/src/db/schema.ts`. Columns: `archiveOwner`, `chatJid`, `messageId`, `atMicros` (bigint), `senderJid`, `kind`, `url`, `name`, `mime`, `size`, `width`, `height`, `durationMs`, `waveform`, `linkUrl`, `linkHost`, `deleted`. Index on (`archive_owner`, `chat_jid`, `kind`, `at_micros`).
- **`senderJid`** is the stanza `from` (`indexer.ts:304-306`): a full room JID `room@muc/nick` in a room, or a full user JID in a DM.
- **Sender names, like `senderNameFor` (`search/routes.ts:108-124`):**
  - room → the part after `/`, or "Unknown" if empty;
  - DM → "You" when the bare `from` equals `${allowed.ownLocalpart}@${config.xmpp.domain}` (lowercased, like `ownBareJid` at `search/routes.ts:146-148`), else `allowed.peerNames.get(peer) ?? 'Unknown'`.
- **Blocks:**
  - `userBlocks` is in `apps/server/src/db/schema.ts:193`, with `userId` and `blockedUserId`; the either-way check pattern is at `apps/server/src/contact-requests/service.ts:190-199`;
  - a DM peer JID maps to a user through `xmppAccounts.jid` (`schema.ts:63-68`, `userId`);
  - an AI peer has no `xmppAccounts` row, so it has no block.
- **Tests to mirror:** `apps/server/src/search/search.test.ts`. It has the PGlite fake archive (`ARCHIVE_DDL` lines 21-35, `pgliteArchivePool` line 65, `seedArchive` line 83), an app built with `archive` at lines 119-140, and the helpers `setupDm`, `createGroup`, `createTopic` and `dmJid` (lines 155-198). Payload XML helpers: `apps/server/src/media/indexer.test.ts:79-110`.
- **401 sweep:** `apps/server/src/authz-sweep.test.ts` walks `app.routes` by itself; a session-guarded route needs no change there.

### What to build
1. **New `apps/server/src/media/routes.ts`:** `createMediaRoutes(deps)`, with the deps interface shaped like search's, and `GET /media`. Order of operations:
   1. session;
   2. 501 `media_unavailable` without an archive;
   3. rate limit;
   4. parse the query;
   5. `allowedArchives` → `resolveChatFilter` → 404;
   6. for a DM: look up the peer's user id by `xmppAccounts.jid` (case-insensitive, like `resolveChatFilter`); when a `userBlocks` row exists either way → 404 `not_found`;
   7. `await indexChat(...)` for that chat; if it throws, log a warning (never the chat contents) and answer from the rows already stored;
   8. select from `mediaItems`: this `archiveOwner` and `chatJid`, `deleted = false`, `kind` in the tab's kinds, `atMicros < before` when given, ordered by `atMicros` desc then `id`, limit + 1;
   9. map the rows to `MediaItem`.
2. **`apps/server/src/app.ts`:** mount it after search.
3. **New `apps/server/src/media/routes.test.ts`:**
   - 401 without a session;
   - 404 for an unknown chat, for a stranger's DM, and for a private topic the caller is not in;
   - 404 for a DM when either side blocked the other;
   - an image, a file, a link and a voice note in a DM, each returned under its own `type`, with `media` as the default;
   - paging with `limit=1`: `next` then `before` gives the next item, and the last page has `next: null`;
   - a retracted image is not returned;
   - sender names: "You" for mine, the peer's name for theirs, the nick in a room;
   - 400 for a bad `type` or a `limit` above 100;
   - 429 after 30 requests a minute;
   - 501 without an archive.

### Read first
`AGENTS.md`, `docs/audit/media-gallery-plan.md` §3b-§3c, `apps/server/src/search/routes.ts:1-60` and `:100-150` and `:302-335`, `apps/server/src/search/service.ts:55-140`, `apps/server/src/media/indexer.ts:1-60` and `:300-330`, `apps/server/src/app.ts:370-392`, `apps/server/src/search/search.test.ts:1-200`, `apps/server/src/media/indexer.test.ts:1-160`.

### Allowed files
`apps/server/src/media/routes.ts`, `apps/server/src/media/routes.test.ts`, `apps/server/src/app.ts`, `work/T-0431-server-media-route.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot media/routes authz-sweep
pnpm gate
```

### Acceptance
- `GET /api/media` returns paged, typed items for a chat the caller may see, and 404 for anything else, including blocked DMs.
- It never returns retracted items, and never logs message contents.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
