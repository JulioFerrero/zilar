# Shared media gallery per chat — audit and plan (T-0257)

Docs-only. No code, config, schema or package changes. Every claim about today's
code carries a `file:line`. Scope: photos, files, links, voice notes and GIFs,
Telegram-style, web first.

Task: `work/T-0257-media-gallery-plan.md` (D28, `docs/PROJECT_PLAN.md:141`).
Checked out at `docs/audit/media-gallery-plan.md` date 2026-10-06.

---

## 1. Today

### 1a. Where each media kind lives

| Kind | Wire shape | Bytes live | App table |
| --- | --- | --- | --- |
| Photo / file | `attachment` payload | ejabberd upload volume | none |
| Voice note | `voice` payload | ejabberd upload volume | `voice_transcripts` (text only) |
| GIF | `attachment` payload (video mime, `gif-` name) | ejabberd upload volume | none |
| Link | plain text in the message body | nowhere (text) | none |
| Sticker | `sticker` payload | Zilar server sticker volume | `stickers` |

**Payloads.** The server-visible payload union is `packages/protocol/src/payload.ts:14-37`:
`voice` (line 34), `attachment` (line 35), `sticker` (line 36).

- `attachment`: `packages/protocol/src/attachment.ts:10-22`. `kind: 'image' | 'file'`
  (line 11), the bytes URL is the XEP-0363 download URL (line 13), `size` capped at
  100 MiB (line 16, cap at line 4).
- `voice`: `packages/protocol/src/voice.ts:11-18`. Optional `url` is the XEP-0363
  download URL (line 16), plus `duration_ms`, `mime`, `waveform`, optional
  `transcript`.
- `sticker`: `packages/protocol/src/sticker.ts:15-35`; its `url` is a
  `/api/stickers/<id>/file` path or an absolute URL (lines 19-29).
- The payload travels as JSON inside `<agent xmlns="urn:zilar:agent:0">` on the
  `<message>`: namespace `packages/xmpp-core/src/namespaces.ts:1`, element built at
  `packages/xmpp-core/src/stanza.ts:124-125`, JSON encoded at
  `packages/protocol/src/payload.ts:67-68`. A body-less payload message also carries
  a `<store/>` MAM hint (`packages/xmpp-core/src/stanza.ts:128-134`), so it is
  archived.

**Upload flow (photos, files, voice, GIFs).** The client asks ejabberd for a slot
over the user's own XMPP session: `upload.<domain>` at
`packages/xmpp-core/src/client.ts:1045-1055`; slot/URL types at
`packages/xmpp-core/src/types.ts:208-226` (`getUrl` is what goes in the message,
line 222). Real deployments point the upload at ejabberd's `mod_http_upload`:
`infra/ejabberd/ejabberd.yml:78` (`/upload` handler) and lines 198-205
(`max_size: 52428800`, `docroot: /opt/ejabberd/upload`, `put_url`). Caddy proxies
`/upload/*` straight to ejabberd with no strip: `deploy/caddy/Caddyfile:39-44`. The
volume is `ejabberd-uploads:/opt/ejabberd/upload`
(`deploy/docker-compose.yml:96`, declared at line 278). The public URL is
`https://<domain>/upload` (`deploy/docker-compose.yml:93`). Client-side caps are
50 MiB (`apps/web/src/lib/attachments.ts:4`, `apps/mobile/src/lib/attachments.ts:15`).

**GIFs.** The Giphy search/trending/media proxy is `apps/server/src/gifs/routes.ts:14-27`;
media is fetched through `/api/gifs/media/:token` (`apps/server/src/app.ts:649-650`).
A picked GIF is **not** stored as a remote Giphy URL: the client fetches the proxied
blob, then re-uploads it through the normal XEP-0363 attachment path and sends an
`attachment` payload named `gif-<id>.<ext>` with a video mime —
`apps/web/src/components/Composer.tsx:437-476` (name at line 468). At render time a
`gif-` name plus `video/mp4|webm` and a trusted host auto-plays
(`apps/web/src/components/GifMessage.tsx:16,65-82`). So a GIF is a file attachment
by storage and a distinct render kind by convention.

**Links.** Links are only text in the body. `LinkText` splits it with
`splitLinks`: `apps/web/src/components/LinkText.tsx:1,30`, rule at
`packages/chat-core/src/links.ts:4,60` (only `http(s)`, non-empty authority,
trailing punctuation trimmed). Mobile mirrors it at
`apps/mobile/src/components/chat/link-text.tsx:11,20`. There is no link table and no
link extraction server-side.

### 1b. Storage and tables — what the server actually has

- **No message/media table.** The app schema (`apps/server/src/db/schema.ts`) has no
  `messages` table and no attachments table; the only media-adjacent rows are:
  - `voice_transcripts` (lines 42-47): keyed by `url_hash` only — the text of one
    audio URL, no chat id, no metadata.
  - `pinned_messages` (lines 573-593): a **display-only** client snapshot with
    `kind: 'text' | 'image' | 'file' | 'voice' | 'card'` (line 581). The server
    trusts it for rendering, never for authorization
    (`apps/server/src/pins/service.ts:57-59`; text capped at 300 at line 19).
  - `stickers` (line 685) and `avatars` (line 738) are unrelated served assets.
- **Attachments/voice/GIF bytes are not in our database at all.** They sit on the
  ejabberd upload volume (1a) and the only durable reference is the `<agent>`
  payload inside the MAM archive.
- **What the server knows about a chat's media without reading MAM: essentially
  nothing.** It cannot list attachments, files, links or voice notes for a chat,
  because the message payloads only exist in ejabberd's `archive` table
  (`docs/SEARCH_NOTES.md:7-25`). The two exceptions are the pinged snapshots above,
  which are client-supplied and incomplete.

### 1c. Download access check

There is no application access check on media downloads. The XEP-0363 GET URL is a
bearer capability on the upload volume: Caddy forwards `/upload/*` to ejabberd with
no auth (`deploy/caddy/Caddyfile:42-44`), and `mod_http_upload` sets no `access:`
rule (`infra/ejabberd/ejabberd.yml:198-205`), so anyone holding the random URL can
fetch the bytes. Membership is not re-checked at download time. Any gallery must
remember this: **gating the list is a server decision; gating the bytes is not
currently possible.** (This is a known property, not a new bug; flagged as an open
question.)

### 1d. Does search already index attachments or links?

No, structurally. The search index is ejabberd MAM read live, not a table:
`apps/server/src/search/routes.ts:178-213` selects `txt` (the body) and matches
`to_tsvector('simple', translate(lower(txt), …))` (lines 191-196); `xml` is read,
not indexed, and only for the sender (`stanzaFrom`, lines 119,133-137), corrections
and retractions (lines 215-247, 364-430). No expression index is possible in the
ejabberd database, so every search is bounded to the last 12 months and 5 000
candidate rows (`apps/server/src/search/routes.ts:32-36`, 198, 210). The read-only
archive pool carries a 3 s statement timeout (`apps/server/src/search/service.ts:33-39`).

Consequences:

- A link inside a body **is** searchable as text (it is just `txt`), but no code
  extracts URLs, so there is no list of links.
- An attachment or voice note with no caption has `txt` NULL/empty
  (`docs/SEARCH_NOTES.md:14`) and is invisible to search. There is no way to find
  "all photos in this chat" today.

The permission computation search uses is reusable and is the right base for a
gallery: `allowedArchives` (`apps/server/src/search/service.ts:65-111`) builds the
caller's DM peers (contacts + own active AIs, lines 74-99) and room JIDs (group
General + `visibleTopics`, lines 101-108), and `resolveChatFilter` maps a chat JID
to a branch or `null` (lines 116-130); the route answers 404 for a chat outside the
set (`apps/server/src/search/routes.ts:327-332`). `visibleTopics`
(`apps/server/src/topics/access.ts:166`) already honours custom roles (T-0116), so
private topics are covered for free.

**Blocked people are a gap.** `allowedArchives` reads only `contacts` and `ais`
(`apps/server/src/search/service.ts:74-87`), and blocking does not delete contacts:
`blockUser` inserts `user_blocks` and cancels pending contact requests only
(`apps/server/src/blocks/service.ts:86-102`). A gallery built on `allowedArchives`
alone would still show a blocked person's media. The endpoint must add an explicit
block check (see 3c).

---

## 2. Telegram behaviour to copy

Telegram's chat info has a **Media** tab group: a photo/video grid (plus a "GIFs"
sub-list), and flat **Files**, **Links**, **Voice** lists. Tapping a grid cell opens
a full viewer with next/previous; tapping a row jumps to the message in the chat.

**What we take now (web first):**

- One gallery surface per chat with four tabs: **Media** (photos + GIFs in one
  grid), **Files**, **Links**, **Voice**. Empty tabs show a fixed empty sentence.
- Media/photo tab is a lazy-loaded square grid; the other three are row lists.
- Tapping a grid cell opens the full image (or the GIF video) in an overlay.
- Tapping a list row (file/link/voice) jumps to its message and closes the panel,
  reusing the pins jump (`apps/web/src/components/PinsPanel.tsx:84-100` →
  `openAtMessage` + scroll). Tapping a grid cell also offers "Go to message".
- Each item shows sender and date; links show the host; files show name and size;
  voice shows duration and the existing waveform player
  (`apps/web/src/components/VoiceMessage.tsx:50`).

**What we take later:**

- Sub-tabs inside Media (Photos / GIFs / Videos), video messages, and a separate
  "Videos" tab.
- Multi-select and bulk actions, in-gallery search, download-all.
- Mobile parity sheet (task 4).
- Link previews (title/site card) — we only have the raw URL today.

---

## 3. Design

### 3a. Data source: server index vs client scan

**Option A — server index table built from MAM (recommended).**
A new table in our Postgres, filled by a server-side indexer that reads the
ejabberd archive and extracts payloads/links, then serves the gallery from the
table.

- *Correctness:* complete. It sees history the client never loaded, applies edits
  and retractions once server-side (`apps/server/src/search/routes.ts:215-247`), and
  the access set is computed from our tables (`allowedArchives`), never client
  input.
- *Cost:* one small row per media item. The expensive part is the MAM read, which
  is already bounded the same way search is (12 months, 5 000 candidate rows, 3 s
  statement timeout: `apps/server/src/search/service.ts:33-39`,
  `apps/server/src/search/routes.ts:32-36`). Do it incrementally with a
  per-chat `indexed_through` cursor so each pass reads only newer rows.

**Option B — index at send time (rejected as the primary source).**
The only server-side message hook is the XEP-0114 push component: it receives
`mod_push` publish IQs (`infra/ejabberd/ejabberd.yml:210-219`,
`apps/server/src/push/component.ts:36-58`) and then re-reads MAM
(`apps/server/src/push/service.ts:86-95`). It only runs when `PUSH_ENABLED=true`
(`apps/server/src/push/config.ts:5`) and only fires for users with a push
subscription, so it would miss messages and duplicate across members. Useful later
as a low-latency accelerator, with a `(chat_jid, message_id, kind, ref)` unique
index for dedup; not a complete source.

**Option C — client scan of loaded history (rejected).**
The web store loads history 50 messages at a time
(`apps/web/src/store/realStore.ts:140,859-870`; default page size also
`packages/xmpp-core/src/types.ts:228-233`) and a jump pages back at most 20 pages
(`apps/web/src/store/realStore.ts:835-837`). A gallery would therefore be partial,
its "count" wrong, and it would re-parse per client, with every device able to skip
the permission filter. Correct for a tiny fallback, not for the feature.

**Decision:** Option A. Index from MAM, bounded and incremental, served from our
table. Keep the client as a thin reader.

**What the indexer extracts** (from the archived stanza `xml` +
`txt`/body):

- `attachment` payload → `kind` from `attachment.kind` (`image`/`file`), with a
  `gif` override when the name starts `gif-` and the mime is `video/*`
  (`apps/web/src/components/Composer.tsx:468`, `GifMessage.tsx:65-82`).
- `voice` payload → `voice`, with `duration_ms` and `waveform`.
- body text → `http(s)` links via the same rule as `splitLinks`
  (`packages/chat-core/src/links.ts:4,60`), one index row per URL.
- Corrections update the indexed row's caption/URL; retractions mark it deleted
  (see 3c). Invalid/oversized JSON is dropped, exactly like
  `decodePayload` (`packages/protocol/src/payload.ts:71-111`).

### 3b. Endpoint shape with paging

Mount at `/api`, next to search (`apps/server/src/app.ts:378-387`):

```
GET /api/media?chat=<jid>&type=<media|files|links|voice>&before=<micros>&limit=<n>
```

- `requireSession` + a rate limiter like search's 30/min
  (`apps/server/src/search/routes.ts:28-29,304-317`).
- `chat` is a bare JID (DM peer bare JID or room JID — the same key space as
  `chatJidFor`, `apps/server/src/search/routes.ts:139-141`). Resolve it through the
  caller's allowed set; unknown and invisible both answer `404 not_found`, exactly
  like search (`apps/server/src/search/routes.ts:330-332`).
- `type` maps to a tab: `media` = `image` + `gif` (grid), `files` = `file`,
  `links`, `voice`. Default `media`.
- `limit` default 50, max 100; `before` is a microsecond cursor, same unit as the
  MAM timestamp (`docs/SEARCH_NOTES.md:12`) and search's `before`
  (`apps/server/src/search/routes.ts:54,336`).
- Response: `{ items: MediaItem[], next: string | null }`, ordered by `at` desc.
  `next` is the `at` of the last row, `null` on the last page.

```
MediaItem = {
  messageId: string        // origin_id, the client jump key
  chat: string
  at: string               // ISO
  senderName: string
  kind: 'image' | 'file' | 'gif' | 'voice' | 'link'
  url?: string             // image/file/gif/voice
  name?: string
  size?: number
  mime?: string
  width?: number; height?: number
  durationMs?: number; waveform?: number[]
  linkUrl?: string; linkHost?: string
}
```

Web and mobile type this locally (as they do for pins, e.g.
`apps/web/src/lib/api.ts` `Pin`), so no `packages/protocol` change is needed for
the first cut.

### 3c. Access rules

All computed server-side, never from client input (mirrors
`apps/server/src/search/service.ts:65-111`):

- **Members only.** Reuse `allowedArchives`: DM peers are the caller's contacts plus
  their own active AIs (lines 74-99); rooms are the group General room plus
  `visibleTopics` (lines 101-108), which already enforces custom-role access to
  private topics (`apps/server/src/topics/access.ts:166`). A chat outside the set →
  `404`.
- **Blocked people.** Add an explicit `user_blocks` check and hide a DM whose
  counterpart is blocked in either direction. `allowedArchives` alone does not do
  this (3d above).
- **Deleted messages.** A retraction wins over everything
  (`packages/chat-core/src/edits.ts:174-178`; detection at
  `apps/server/src/search/routes.ts:519-532`). Hide retracted media from the lists
  (recommended). Note the bytes stay on disk: a retraction never deletes the upload
  file, and the bearer URL keeps working for anyone who already has it (1c). That is
  pre-existing; do not claim the gallery fixes it.
- **Private topics.** Covered by `visibleTopics`; a non-member gets the same `404`
  as an unknown chat.
- **Edits.** A correction changes the caption/link; the indexer keeps the latest row
  per target (`apps/server/src/search/routes.ts:364-430`) and updates the item.
- **Cap / rate.** Read endpoint rate-limited like search; index rows capped per
  chat (proposed 20 000, prune oldest) so a huge room cannot grow unbounded.
- **401 sweep.** The new route sits under the session auth group so the existing
  401 sweep covers it.

### 3d. Web UI entry point

- **Groups.** `GroupPanel` already opens with `?panel=group`
  (`apps/web/src/components/GroupPanel.tsx:44,46`; wired at
  `apps/web/src/routes/ChatView.tsx:127-129`). Add a tab strip under the panel
  header: default "Info" (today's members/roles/AIs/pins content) plus Media, Files,
  Links, Voice. The Media tab renders the shared gallery. This keeps the existing
  sections untouched.
- **DMs.** There is **no DM info panel today**: `ChatView` mounts only
  `ai`/`group`/`topic`/`channel` panels (`apps/web/src/routes/ChatView.tsx:126-135`),
  and the DM header menu only offers Pinned messages
  (`apps/web/src/components/ChatHeader.tsx:250-274`). Add a "Media" item to that menu
  that opens the shared gallery as a panel (`?panel=media`). A full DM info panel is
  bigger and can wait (open question 3).
- One shared `ChatMediaPanel` component serves both, so groups and DMs get identical
  tabs, grid/lists, empty sentences and jump behaviour. Tapping an item jumps with
  `openAtMessage` and closes the panel (`apps/web/src/components/PinsPanel.tsx:84-100`).

---

## 4. Task split

Three ordered tasks, each one PR. Task 1 is the **only one that touches the database
schema**; no other schema task may run while it is open. Task 1 may be split into
1a (table + indexer) and 1b (read endpoint) if it is too large, but the migration
lives in 1a only.

### Task 1 — Server: media index table, indexer, read endpoint (one migration)

*Depends on:* nothing.
*Deliverable:* `GET /api/media` returns paged items from a new index table, filled
by a bounded incremental MAM indexer.

*Allowed files (full paths):*
- `apps/server/src/db/schema.ts` (add `mediaItems`)
- `apps/server/src/media/indexer.ts` (new)
- `apps/server/src/media/service.ts` (new)
- `apps/server/src/media/routes.ts` (new)
- `apps/server/src/media/indexer.test.ts` (new)
- `apps/server/src/media/routes.test.ts` (new)
- `apps/server/src/app.ts` (mount the route)
- `apps/server/drizzle/<next>_media-index.sql` and
  `apps/server/drizzle/meta/_journal.json` + the new snapshot (generated by
  `pnpm --filter @zilar/server db:generate`; current head is `0040_majestic_legion`)

*Tests:* indexer parses `attachment`/`voice`/`gif`/links from synthetic archive
rows, drops invalid JSON, applies corrections and hides retractions, is idempotent
(unique-key upsert); route auth (401), unknown/invisible chat → 404, pagination
cursor, `type` filtering, block check, rate limit. No real ejabberd: reuse the
search tests' fake `ArchivePool` (`apps/server/src/search/search.test.ts`).

*Risks:* MAM scan safety (reuse the bounded 12-month/5 000-row/3 s pattern); parsing
untrusted XML/JSON (never execute, drop invalid); migration is the serialization
point — only this task touches `schema.ts`/`drizzle/`; first index only reaches 12
months of history (open question 2); index growth (cap + prune).

### Task 2 — Web: gallery panel with tabs (groups + DMs)

*Depends on:* Task 1.
*Deliverable:* Media/Files/Links/Voice tabs in `GroupPanel`, plus a DM header menu
entry opening the same panel; tap opens or jumps.

*Allowed files (full paths):*
- `apps/web/src/components/ChatMediaPanel.tsx` (new)
- `apps/web/src/components/ChatMediaPanel.test.tsx` (new)
- `apps/web/src/components/GroupPanel.tsx` (tab strip; do not reorder existing
  sections)
- `apps/web/src/components/GroupPanel.test.tsx` (add tab cases)
- `apps/web/src/components/ChatHeader.tsx` (DM "Media" menu item)
- `apps/web/src/routes/ChatView.tsx` (mount `?panel=media`)
- `apps/web/src/routes/ChatView.test.tsx` (open/close cases)
- `apps/web/src/lib/api.ts` (types + `listChatMedia`)
- `apps/web/src/store/store.ts` and `apps/web/src/store/realStore.ts` (load/cache/page)

*Tests:* panel renders tabs, empty states, grid vs lists, lazy image loading only
for trusted hosts (`apps/web/src/lib/attachments.ts:99,124`), jump calls
`openAtMessage`, a11y (dialog, Esc, focus trap like
`apps/web/src/components/PinsPanel.tsx:41-80`), `?panel=media` opens and closes.

*Risks:* must not disturb the existing GroupPanel sections/tests; dialog + focus
trap parity; image grid performance (virtualize and lazy-load); only render media
from trusted hosts (reuse the `sanitizeIncomingAttachment` rules), links via
`splitLinks`.

### Task 3 — Mobile: media sheet (groups + DMs)

*Depends on:* Task 1 (and ideally Task 2 to reuse the shape).
*Deliverable:* a media sheet with the same tabs, reachable from the group detail
screen (`apps/mobile/src/app/group/[id].tsx`) and the chat actions sheet.

*Allowed files (full paths):*
- `apps/mobile/src/lib/media-api.ts` (new)
- `apps/mobile/src/components/chat/media-sheet.tsx` (new)
- `apps/mobile/src/components/chat/media-sheet.test.tsx` (new)
- `apps/mobile/src/app/group/[id].tsx` (entry)
- `apps/mobile/src/components/chat/chat-actions-sheet.tsx` (entry; add one item)
- `apps/mobile/src/store/types.ts` (media types and the store interface)
- `apps/mobile/src/store/chat-store.ts` (mock store media selectors/actions)
- `apps/mobile/src/store/real-store.ts` (load/cache/page, following the existing
  store files)

*Tests:* sheet tabs and empty states, jump to message
(`apps/mobile/src/components/chat/jump-scroll.ts`), trusted-host filter, relative
`/api/...` URLs resolved against the API origin (AGENTS pitfall), FlatList paging.

*Risks:* registry-style files (`chat-actions-sheet.tsx`) — add one item, never
reorder or reformat; resolve server-relative URLs on native; Hermes has no
`crypto.subtle` (not needed here, but do not introduce it); no emoji in chrome
(lucide only).

Ordering note: 1 → 2 → 3. 2 and 3 can run in parallel only after 1 merges. Only one
schema task (1) at a time.

---

## 5. Open questions for Julio

1. **Index source.** Server index built from MAM (recommended) vs a client scan of
   loaded history. *Recommend:* server index; the client scan is incomplete and
   cannot enforce permissions.
2. **First-build window.** The MAM read pattern is capped to 12 months
   (`apps/server/src/search/routes.ts:32-36`). *Recommend:* index the last 12 months
   first and file a follow-up backfill task; state the limit in the UI ("Media from
   the last 12 months") until backfilled.
3. **DM entry point.** Add a full DM info panel now, or a "Media" item in the DM
   header menu opening the gallery? *Recommend:* the menu item now (smallest), full
   DM info panel later.
4. **Deleted media.** Hide retracted items entirely, or show a "Message deleted"
   placeholder? *Recommend:* hide. Note the bytes are not deleted (1c).
5. **Blocked people.** Hide blocked counterparts' media in both directions?
   *Recommend:* yes; `allowedArchives` does not do this today and the endpoint must.
6. **Links scope.** Use the existing `splitLinks` rule (only `http(s)`), show the
   host, no previews for now? *Recommend:* yes.
7. **Tabs and GIFs.** Media (photos + GIFs), Files, Links, Voice; stickers and
   videos out of scope for now? *Recommend:* yes.
8. **Index retention.** Cap items per chat (proposed 20 000, prune oldest) or keep
   everything? *Recommend:* cap and prune.
