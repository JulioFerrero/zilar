# Media in AI cards: images, files and the place map

T-1804, 2026-10-17. **Plan only: no source file changed.** Every claim cites
`file:line`. The 25-block canvas is `docs/plan/message-blocks.md`; the media
rows are `images` (`:204`), `place` with its map (`:205`), `event` with a map
(`:207`) and `file` (`:208`). The safety rule for them is at `:450-453`:
a block points at **an uploaded media id, never a URL**. This document finds the
real upload path, recommends one way for an AI to mint such an id, and lists the
ordered build tasks.

State today, in one line: the protocol accepts the ids
(`packages/protocol/src/blocks-content.ts:16-34, 61-83`), but web and phone do
not draw `images` or `file` at all
(`apps/web/src/components/message/blocks/BlockCard.tsx:16-48`,
`apps/mobile/src/components/chat/blocks/block-card.tsx:20-31, 65-97`), the guide
does not offer those kinds to the model
(`apps/server/src/message-blocks/guide.ts:12-30, 77-95`), `place` draws without
its map (`apps/web/src/components/message/blocks/PlaceBlock.tsx:11-15`), and no
server route resolves a block media id to bytes.

## 1. Today: how a person's image or file is uploaded and served

### 1.1 The client uploads through XEP-0363, not through our API

Web and phone both ask ejabberd for an HTTP-upload slot, `PUT` the bytes to the
slot's `putUrl`, and keep the slot's `getUrl` (the download URL):

- web `uploadAttachmentEffect` checks the 50 MiB cap, requests a slot, `PUT`s
  with the slot headers and returns `slot.getUrl`
  (`apps/web/src/lib/attachments.ts:7, 169-205`);
- the phone does the same in `bytesFor`
  (`apps/mobile/src/store/effects/ports-media.ts:55-102`), with the cap in
  `apps/mobile/src/lib/attachments.ts:24-25`;
- the send pipeline calls `bytes.upload`, then builds an `attachment` payload
  with that URL (`packages/client-core/src/store/send/attachment.ts:75-114`);
- the slot request and its reply are XEP-0363 stanzas
  (`packages/xmpp-core/src/stanza/build-control.ts:153`,
  `packages/xmpp-core/src/types.ts:218-236`), issued by the client's XMPP core
  (`packages/xmpp-core/src/core-effect/operations-types.ts:48`,
  `packages/xmpp-core/src/client.ts:34`);
- the wire payload carries `url`, `name`, `size`, `mime`, and image
  `width`/`height` (`packages/protocol/src/attachment.ts:11-41`).

The server itself never uploads: no server module calls `requestUploadSlot`
(the only hit is a gateway test stub,
`apps/server/src/agents/gateway.test-harness.ts:202-207`), and the server has
no mount of the ejabberd upload volume — only ejabberd has it
(`infra/docker-compose.dev.yml:77`; the server is not a service in that compose
file, it dials ejabberd through `EJABBERD_API_URL`).

### 1.2 Where the bytes live, and their caps

`mod_http_upload` writes into `docroot` (`/opt/ejabberd/upload` in Docker,
`/var/lib/ejabberd/upload` on bare metal) with `max_size: 52428800` (50 MiB)
(`deploy/ejabberd/ejabberd.yml:233-241`,
`deploy/baremetal/ejabberd.yml:236-246`). Production also runs
`mod_http_upload_quota` with per-user soft/hard quotas of 2048/4096 MiB; past
the hard quota ejabberd deletes that user's **oldest** files until usage is
back at the soft quota (`deploy/ejabberd/ejabberd.yml:187-197, 251`; bare metal
`deploy/baremetal/ejabberd.yml:178-186, 254`). The dev compose file has no
quota module (`infra/ejabberd/ejabberd.yml:198-206`).

So today the quota is per **XMPP user** and is enforced by ejabberd, not by our
API.

### 1.3 The server proxies reads through `GET /api/files`

A same-origin `/upload/...` file is loaded through the API so the server can
check the session and the chat membership; the clients rewrite such a URL:

- web `mediaSrc` builds `/api/files?chat=<jid>&url=<download url>`
  (`apps/web/src/lib/attachments.ts:53-76`);
- phone `mediaUrl` builds the same path on the API origin
  (`apps/mobile/src/lib/attachment-common.ts:74-97`) and `useMediaSource` adds
  the session bearer only for that origin
  (`apps/mobile/src/lib/media-source.ts:18-51`).

`GET /api/files` (`apps/server/src/files/api.ts:182-334`) then:

1. answers 501 without an archive, then 429 through a 600/min limiter
   (`:36-37, 210-215`);
2. decodes `chat` and `url`
   (`:59-67, 216-223`) and maps the caller URL to ejabberd's internal base with
   `toInternalUploadUrl`, which requires the same origin as `PUBLIC_URL` and a
   path under `/upload/` (`apps/server/src/voice-transcription/routes.ts:119-148`);
3. checks that the caller may see that chat through `allowedArchives` +
   `resolveChatFilter`, plus `isDmBlocked` for a DM (`:229-246`); unknown and
   invisible both answer 404;
4. finds the `media_items` row for `(archive owner, chat, url)` and re-indexes
   the chat once when a just-sent file is not there yet (`:96-116, 249-296`);
5. fetches the bytes from ejabberd with the public `Host` header, because
   ejabberd resolves the upload vhost from it
   (`apps/server/src/files/internal-fetch.ts:1-12, 58-88`; `files/api.ts:200-204,
   298-310`), and streams the body back untouched (`:319-326`);
6. replaces the upstream headers with an allowlist: content type, length,
   range, etag, last-modified, `cache-control: private, max-age=3600`,
   `nosniff`, a sandbox CSP, and `content-disposition: attachment` for files and
   anything not safely renderable (`:148-180`). SVG and HTML are forced to
   `application/octet-stream`.

### 1.4 The gallery index is derived from the archive

MAM rows are read into `media_items` (`apps/server/src/media/indexer.ts:99-120`).
A media row comes only from an `attachment` or `voice` payload; a card's block
payload produces none, and only ordinary links (if any) come from the body
(`apps/server/src/media/extract.ts:100-131`). A row gets a random
`id` (`apps/server/src/media/rows.ts:42-64`), but that id is only the gallery
row's identity: the gallery API lists rows
(`apps/server/src/media/api.ts:143-249`) and the bytes are fetched by URL, not
by that id. No route turns a `media_items.id` into bytes.

### 1.5 What a block needs, and what is missing

A block needs an opaque id that (a) the server minted after accepting bytes,
(b) any room member can resolve, and (c) nobody else can resolve. Today:

| Piece | Exists? | Where |
|---|---|---|
| id that names an accepted upload | no public one; `media_items.id` is gallery-only | `apps/server/src/media/rows.ts:42-64`, `apps/server/src/media/api.ts:143-249` |
| route id → bytes with a membership check | no | `/api/files` takes a URL, not an id (`apps/server/src/files/api.ts:59-67`) |
| an AI that can store bytes | no | server never uploads (`apps/server/src/agents/gateway.test-harness.ts:202-207`) |

## 2. AI-side options for minting a media id

| Option | Cost | Risk | Verdict |
|---|---|---|---|
| **A. Native `fetch_media` tool + server-owned store** | one tool definition, one table, one read route, one storage dir (already the avatar/sticker pattern) | SSRF, MIME confusion, disk growth — all bounded by the existing guard and caps | **recommended** |
| B. A sandbox tool that returns bytes | no new server code | sandbox output is text/JSON with an 8 KiB model cap and no binary sink; cannot mint an id | reject |
| C. A desk file | no new server code | desk tools are UTF-8 text, 8 KiB at the model, no binary channel | reject for v1 |
| D. A generated chart image | storage + renderer + a rendering service | duplicates native charts; a hosted renderer leaks the data to a third party | reject; use native chart kinds |

### 2.1 Recommended: a native `fetch_media` tool that stores into our own media store

**Tool, not `request_action` adapter.** `post_blocks` is already a native model
tool, offered and dispatched on the same group turns
(`apps/server/src/agents/tools/blocks-tool.ts:11-45`,
`apps/server/src/agents/tools/definitions.ts:347`,
`apps/server/src/agents/gateway/tool-exec.ts:215-224`). An adapter would put an
"Allow?" card in front of every image (`apps/server/src/agents/tools/definitions.ts:179-188`),
which the canvas already rejected for drawing (`docs/plan/message-blocks.md:251-259`).
`fetch_media` follows `post_blocks`: same offer gate, same turn context, no
approval step.

**Where the bytes live: the server's own store, not ejabberd's.** The two
candidates:

- **ejabberd XEP-0363** (what people use). The AI's live session holds an XMPP
  core (`apps/server/src/agents/gateway/contracts.ts:205-208`) that can request
  a slot (`packages/xmpp-core/src/core-effect/operations-types.ts:48`), but the
  server would need a new internal `PUT` transport (the existing one is GET
  only, `apps/server/src/files/internal-fetch.ts:58-88`), and the bytes would
  count against that AI's 2/4 GiB quota and be **trimmed oldest-first**
  (`deploy/ejabberd/ejabberd.yml:194-197`). A card's image could disappear from
  history because the AI uploaded other files.
- **A server-owned store** like avatars and stickers: a random `<uuid>` file
  under a new `CARD_MEDIA_STORAGE_DIR`, a row in a new `card_media` table, and
  a session + room-membership read route. The patterns already exist:
  `resolveStorageDir` (`apps/server/src/stickers/storage.ts:39-48`), startup
  creation and the container-layer warning
  (`apps/server/src/startup/boot.ts:89-126`), `uploadAvatar`
  (`apps/server/src/avatars/service.ts:112-160`), `readAvatarFile` with its
  path-escape guard (`apps/server/src/avatars/read.ts:16-69`), and the storage
  env vars (`apps/server/src/config/server-schema.ts:45-62`).

Recommendation: **server-owned store**. It keeps card history intact, keeps
EXIF stripping in our hands, needs no server→ejabberd upload, and gives the id
a natural owner (our row). It does keep the bytes outside the chat's media
gallery; see §7.

**What `fetch_media` does, in order** (new `apps/server/src/card-media/fetch.ts`):

1. validate `url` (https, ≤ 2048 chars), then call `guardedGet` with
   `anyPublicHost: true`, `allowedContentTypes` per kind, and
   `maxResponseBytes` raised from the 2 MiB default
   (`apps/server/src/web-tools/guarded-fetch.ts:44-91, 148-260`). The guard is
   the one `web.fetch` and link previews use: https only, port 443, no
   credentials, no redirects, DNS pinned to the validated address, and every
   resolved address refused when `classifyIp` says private/loopback/link-local
   (`apps/server/src/web-tools/guarded-fetch.ts:168-260`,
   `apps/server/src/link-preview/fetch.ts:1-20`);
2. sniff the **bytes**, never the declared type: PNG/WebP helpers already exist
   (`apps/server/src/stickers/image.ts:115-123`), JPEG/GIF magic is a few lines;
   parse the header for dimensions and refuse oversized pixels (§4);
3. strip metadata from the bytes (§4);
4. write `<uuid>` into `CARD_MEDIA_STORAGE_DIR`, insert the row under the
   per-AI quota lock (§4), and return
   `{ id, mime, size, width?, height?, name }` as model text;
5. the model passes `id` to `post_blocks`, e.g.
   `{"kind":"images","items":["<id>"]}` or
   `{"kind":"file","media":"<id>","name":"report.csv","size":"12 KB","format":"CSV"}`.
   Note the real `file` field is **`format`**, not the plan's `kind`
   (`packages/protocol/src/blocks-content.ts:74-83`).

**Files it touches**, matching `post_blocks`: a new
`apps/server/src/agents/tools/media-tool.ts` (definition and JSON schema), the
argument schema in `apps/server/src/agents/tools/schemas.ts` (next to
`POST_BLOCKS_TOOL`, `:18-33, 222-262`), the parse branch
(`apps/server/src/agents/tools/parse.ts`), the validated-call branch
(`apps/server/src/agents/tool-calls.ts`), the offer in
`apps/server/src/agents/tools/definitions.ts:347` and the dispatch in
`apps/server/src/agents/gateway/tool-exec.ts:148-160, 215-224`.

### 2.2 Rejected: a sandbox tool returning bytes

A sandbox tool is one ES module whose default export returns a string or
`{ text, data?, blocks?, card? }` (`docs/TOOL_SANDBOX.md:9-20`), validated by
`parseToolOutput` (`apps/server/src/sandbox/types.ts:49-72`). Fetches are
`GET`/`HEAD` only and every host must be declared and approved
(`apps/server/src/agents/tool-guide.ts:20-23`). There is no binary output and no
way for the tool to write our store; a base64 image in `text` then hits the
8 KiB model cap (`apps/server/src/agents/tool-loop.ts:209`). It also produces a
URL, which is exactly what a block must not carry. Reject.

### 2.3 Rejected: a desk file

The desk tools read and write UTF-8 text (`packages/desk/src/tools/read.ts:24-30`,
`packages/desk/src/tools/write.ts:17-28`) with a 1 MiB host cap
(`packages/desk/src/serve.ts:17`); the gateway truncates every tool result to
8 KiB before the model sees it (`apps/server/src/agents/tool-loop.ts:209`).
There is no binary channel from the jail to the chat, and the jail's egress is
an allowlisted proxy (`packages/desk/src/egress/policy.ts:23-31, 54-66`).
A desk file would need a new binary read endpoint on the Hands protocol plus an
upload path; that is a separate task, not this one. Reject for v1.

### 2.4 Rejected: a generated chart image

`bars`, `line` and `gauge` are native, already drawn, and in the guide
(`apps/server/src/message-blocks/guide.ts:12-30, 44-52`). Rendering a PNG would
add storage and a renderer to get a worse, unscalable card; a hosted chart
service would also send the data to a third party. Use the native kinds.

A **generated text file** is different: it cannot be fetched from a URL, and the
desk cannot hand it over (§2.3). A small second tool, `save_text_media`
(`{ name, mime: text/csv|text/plain|text/markdown|application/json, content }`,
≤ 64 KiB), can mint a file id from text the model already has. It is cheap and
makes `file` blocks useful without a binary channel; listed as M5 below.

## 3. The id, and how web and phone resolve it

**Format.** `card_media.id` is `randomUUID()` — 36 characters of hex and `-`,
inside `IdSchema` (`^[A-Za-z0-9._~-]+$`, 1..128,
`packages/protocol/src/common.ts:66-72`). The same generator the gallery rows
use (`apps/server/src/media/rows.ts:44`). The model copies it verbatim into
`images.items[]`, `file.media`, `place.map` or `event.map`.

**URL.** `GET /api/card-media/:id`, server-relative. The row stores `room_jid`,
so the client needs no `chat` parameter: the server looks up the row, then
checks that the caller can see `room_jid` (`allowedArchives` +
`resolveChatFilter`, `apps/server/src/search/service.ts:77-163`, plus
`isDmBlocked` as in `apps/server/src/media/api.ts:163-176`). Unknown and
invisible answer the same 404.

**Web.** `<img src={`/api/card-media/${id}`}>` is same-origin, so the session
cookie authenticates it; no bearer and no URL construction from an untrusted
host. The renderer needs no chat id: the row carries the room.

**Phone.** The URL must be absolute before `useMediaSource` sees it, because
`useMediaSource` only adds the bearer when the resolved URL is on the API origin
(`apps/mobile/src/lib/media-source.ts:18-51`, `isApiOriginUrl` at
`apps/mobile/src/lib/attachment-common.ts:68-72`). Add
`cardMediaUrl(id, API_URL)` next to `mediaUrl` and pass that through
`useMediaSource`, exactly like an attachment.

**Auth, cache, variants.** Every read is session-required (401 from the
`Session` middleware, `apps/server/src/effect/http-core.ts:30-58`); the route
carries a per-viewer limiter like `/api/files` (600/min,
`apps/server/src/files/api.ts:36-37, 213-215`). Responses set
`cache-control: private, max-age=3600`, `nosniff`, the stored content type, and
`content-disposition: attachment` for files — the same header set as the files
proxy (`apps/server/src/files/api.ts:148-180`). There are **no size variants**
in v1: the image cap (§4) keeps a card's bytes small, and the renderer uses
fixed tiles (one image full width, 2–4 in a 2×2 grid) so it needs no stored
dimensions and causes no layout shift.

## 4. Security

**SSRF.** Only `guardedGet` fetches the URL
(`apps/server/src/web-tools/guarded-fetch.ts:148-260`): https only, port 443,
no credentials, no redirects, DNS resolved once and pinned, every address
classified and private/loopback/link-local refused; IP literals are refused
outright. `fetch_media` passes `anyPublicHost: true` (the URL is user-supplied,
like a link preview, `apps/server/src/link-preview/fetch.ts:5-9`), never a raw
`fetch`. The URL is never sent to a client and never logged.

**MIME sniffing.** The declared `Content-Type` is only the guard's first filter
(`apps/server/src/web-tools/guarded-fetch.ts:246-249`); accept bytes only when
magic bytes agree:
PNG/JPEG/WebP for images, PDF/CSV/plain-text/ZIP for files. Reject SVG, HTML
and JavaScript outright — active content on our origin is the exact thing the
files proxy already defends against (`apps/server/src/files/api.ts:128-146`).
Store the sniffed type, not the declared one.

**Size, pixels, quota.**

- image: ≤ 8 MiB, ≤ 4096 px per side and ≤ 16 MP (header-only check, so a
  decompression bomb is refused before the phone decodes it; the sticker probe
  is the precedent, `apps/server/src/stickers/image.ts:153-171`);
- file: ≤ 25 MiB (`guardedGet`'s `maxResponseBytes`, the 50 MiB ejabberd cap
  is the upper bound, `deploy/ejabberd/ejabberd.yml:234`);
- at most 4 media per `images` block (`packages/protocol/src/blocks-content.ts:19-21`)
  and at most 8 per turn, counted like the five-facts cap in the turn closure
  (`apps/server/src/agents/gateway/tool-exec.ts:108-111`);
- per-AI daily count and total-bytes cap counted from `card_media`, checked and
  inserted in one transaction under
  `pg_advisory_xact_lock(hashtext('card-media:' + aiId))` — never
  check-then-insert; the questions cap is the pattern
  (`apps/server/src/questions/service.ts:66-93`). Recommended defaults: 40
  media/day and 200 MiB total per AI (open question 5).

**EXIF and metadata.** Strip before the file is written and the id exists:
JPEG `APPn` segments (keep `APP0`/JFIF and `APP2`/ICC, drop `APP1` and the
rest), PNG `eXIf`/`tEXt`/`zTXt`/`iTXt`, WebP `EXIF`/`XMP` chunks. Pixels are not
re-encoded, so the image stays byte-cheap to validate; a format we cannot strip
is refused rather than stored. No image decoder dependency is added. The source
URL is not stored in the row — only the id, the sniffed type, the display
metadata and the storage key.

**Who may read.** Session required; then the row's `room_jid` must resolve
through the caller's allowed archives (room members, including topic rooms —
`visibleTopics` feeds `allowedArchives`,
`apps/server/src/search/service.ts:72-143`) and, for a DM, `isDmBlocked`
(`apps/server/src/media/api.ts:163-176`). Unknown id and a room the caller
cannot see are the same 404. There is no public or signed URL; the id alone is
not a capability.

**Logging.** Ids and outcomes only: no URL, file name, bytes, EXIF, or page
text. Follow the existing lines (`apps/server/src/files/api.ts:311-316, 328-333`,
`apps/server/src/media/api.ts:203-208`) and the audit rule (`AGENTS.md:102`). The action's
result to the model carries the id and the display metadata, nothing about the
fetch.

**Card validation.** Before `post_blocks` sends, every id in `images.items[]`,
`file.media`, `place.map` and `event.map` must exist, belong to this AI, and
have the same `room_jid` as the turn; otherwise the model gets
`invalid: unknown media`, the same shape as today's `invalid: <reason>`
(`apps/server/src/agents/gateway/post-blocks.ts:82-109`). The read route's
membership check is the second line of defence.

## 5. The place map: keep "no map" for now

Today the schema has an optional `map` on `place` and `event`
(`packages/protocol/src/blocks-content.ts:27-34, 61-70`), the guide tells the
model `place` means **"(no map)"** and omits the field
(`apps/server/src/message-blocks/guide.ts:58, 91`), and both renderers draw the
title, subtitle and Directions link only
(`apps/web/src/components/message/blocks/PlaceBlock.tsx:11-38`,
`apps/mobile/src/components/chat/blocks/place-block.tsx:39-59`).

Options:

| Option | Cost | Key / terms |
|---|---|---|
| Keep no map (recommended) | zero | none; the address goes in `subtitle`, Directions in `url` |
| Fetch a static map through `fetch_media` | one extra fetch per place; same image pipeline | depends on the provider; any hosted tile/static-map service needs an account and its terms allow/forbid storing tiles; self-hosting OSM needs a tile stack and geocoding |
| Render a map on the client | new native map SDK (web + phone) | a key per platform, plus a geocoder |

Besides the provider, the hard part is turning a free-text address into
coordinates: the AI would guess coordinates for anything but a famous place,
and a wrong pin is worse than no map. Recommendation: **keep "no map" in v1**;
the model puts the address in `subtitle` and a directions link in `url`. If
Julio wants maps later, it is a separate task after `fetch_media` ships (the map
image then needs no new client code, only a provider and a geocoder decision).
External prices and terms were not checked in this repo and must be re-checked
before that task (open question 4).

## 6. Ordered tasks

Server first, then the two app twins, then the guide. Each is one worker, each
touched source file stays under 400 lines
(`packages/devtools/src/gate/size.ts:10`). Tests only where the task touches
auth, permissions or the message pipeline; the numbers below are per task.

### M1 — the card media store and its table

- Files: `apps/server/drizzle/0072_card-media.sql` (starts with
  `SET lock_timeout = '5s';`, like `apps/server/drizzle/0071_block-cards.sql:1`),
  new `apps/server/src/card-media/service.ts` (write, read row, quota),
  `apps/server/src/db/rows-agents.ts` (row types),
  `apps/server/src/config/server-schema.ts:45-62` (`CARD_MEDIA_STORAGE_DIR`),
  `apps/server/src/startup/boot.ts:109-126` (create/warn),
  `docs/SERVER_CONFIG.md` (the env row).
- Table: `id text primary key`, `ai_id` (FK `ais`), `room_jid`, `group_id?`,
  `topic_id?`, `mime`, `size int`, `width?`, `height?`, `name`, `storage_key`,
  `created_at`; index on `(ai_id, created_at)`. No source URL column.
- Tests: 1 — concurrent writes at the cap leave exactly one over-limit
  rejection (quota under the advisory lock).
- Estimate 40 min.

### M2 — `GET /api/card-media/:id`

- Files: new `apps/server/src/card-media/api.ts` (group modelled on
  `apps/server/src/files/api.ts:182-334` and `apps/server/src/avatars/api.ts:55-72`),
  mount in `apps/server/src/app.ts:74-82`.
- Session, limiter, row lookup, `allowedArchives`/`resolveChatFilter`/
  `isDmBlocked`, disk read with the path guard, streamed bytes, the header set
  of §3, 404 for unknown and invisible.
- Tests: 1 — 401 unauthenticated, 404 for a stranger and for an unknown id,
  200 for a member.
- Estimate 35 min.

### M3 — the `fetch_media` tool

- Files: new `apps/server/src/agents/tools/media-tool.ts`, new
  `apps/server/src/card-media/fetch.ts`, new `apps/server/src/card-media/sniff.ts`
  (magic bytes + dimensions, reusing `isPng`/`isWebp`),
  `apps/server/src/card-media/strip.ts` (EXIF), edits to
  `apps/server/src/agents/tools/schemas.ts:18-33, 222-262`,
  `apps/server/src/agents/tools/parse.ts`,
  `apps/server/src/agents/tool-calls.ts`,
  `apps/server/src/agents/tools/definitions.ts:347`,
  `apps/server/src/agents/gateway/tool-exec.ts:148-160, 215-224`.
- Same offer gate as `post_blocks` (group turns only); returns the id plus
  display metadata; caps and guard of §4.
- Tests: 1 — the guard refuses http, a private address and a non-image body;
  the stripper removes a GPS tag from a small fixture.
- Estimate 45 min.

### M4 — validate media ids in `post_blocks`

- Files: new `apps/server/src/message-blocks/media-ids.ts` (collect ids from the
  four kinds), `apps/server/src/agents/gateway/post-blocks.ts:82-109`,
  `apps/server/src/routines/outcomes.ts:60-90` and the `tool.run` card at
  `apps/server/src/tools/tool-adapters.ts:283-305` (reject ids that path cannot
  own, keep the rest of the card).
- Tests: 1 — extend `apps/server/src/agents/gateway/post-blocks.test.ts`:
  another AI's id, another room's id, and an unknown id all give
  `invalid: unknown media`.
- Estimate 30 min.

### M5 — `save_text_media` for small generated files

- Files: new `apps/server/src/agents/tools/text-media-tool.ts`, one schema and
  one parse branch next to M3, dispatch in
  `apps/server/src/agents/gateway/tool-exec.ts`, reuse of the M1 writer.
- UTF-8 text only, ≤ 64 KiB, mime allowlist (`text/csv`, `text/plain`,
  `text/markdown`, `application/json`), same quota.
- Tests: 0 (no new route or permission surface; the shared writer is covered by
  M1).
- Estimate 25 min.

### W1 — web renderers

- Files: new
  `apps/web/src/components/message/blocks/ImagesBlock.tsx` and
  `apps/web/src/components/message/blocks/FileBlock.tsx`, edits to
  `apps/web/src/components/message/blocks/BlockCard.tsx:16-48` (two cases).
- `images`: 1–4 square tiles in a 2×2 grid, `object-cover`, lazy loading, alt
  text from the card title; `extra` shown as a `+N` tile.
- `file`: the name, `size`, `format`, optional `rows`, and a download link to
  `/api/card-media/<id>` with `download`.
- Tests: 0 (UI).
- Estimate 40 min.

### P1 — phone twins

- Files: new
  `apps/mobile/src/components/chat/blocks/images-block.tsx` and
  `apps/mobile/src/components/chat/blocks/file-block.tsx`, edits to
  `apps/mobile/src/components/chat/blocks/block-card.tsx:20-31, 65-97`,
  `apps/mobile/src/components/chat/payload-card.tsx:41-54` (`chatId` prop),
  `apps/mobile/src/components/chat/message-bubble-content.tsx:188-198`,
  `apps/mobile/src/lib/attachment-common.ts` (`cardMediaUrl`).
- Reuse `useMediaSource`; the same square grid and 40 px keys
  (`docs/plan/message-blocks.md:421-423`). The hook takes a chat id for its
  `/upload/` rewrite (`apps/mobile/src/lib/attachment-common.ts:83-97`), so
  `message.chatId` is threaded through `PayloadCard`; the absolute
  `/api/card-media/<id>` URL is left as is and gets the bearer.
- Tests: 0 (UI).
- Estimate 40 min.

### D1 — deploy and docs

- Files: `deploy/coolify/docker-compose.app.yml:175-186` (env +
  `CARD_MEDIA_STORAGE_DIR` on a persistent volume),
  `deploy/baremetal/` (the same env in the service unit/README),
  `docs/SERVER_CONFIG.md`.
- Without this the server warns that the store sits on the container layer and
  loses files on replace (`apps/server/src/startup.ts:110-124`).
- Tests: 0.
- Estimate 20 min.

### G1 — the card guide and the tool description

- Files: `apps/server/src/message-blocks/guide.ts:12-30, 77-95` (add `images`
  and `file` to `CARD_KINDS` and the shape map; one line: "call `fetch_media`
  and pass the returned id, never a URL"; keep `place (no map)`),
  `apps/server/src/agents/tools/blocks-tool.ts:11-15` (mention media ids).
- Depends on M3 and M4, so the model is only told about kinds the server can
  accept.
- Tests: 0.
- Estimate 20 min.

## 7. Open questions for Julio

1. **Storage: our disk vs ejabberd's upload store.** Recommend our own store
   (§2.1): card history survives the AI's upload-quota trimming, and EXIF
   stripping stays under our control. Cost: a new volume and backup rule, and
   card images do not appear in the chat's media gallery. **Confirm.**
2. **Approval.** Recommend no approval step: `fetch_media` follows
   `post_blocks`, guarded by the SSRF/MIME/size rules. The alternative is a
   tier-1 `request_action` adapter, which puts an "Allow?" card in front of
   every image. **Confirm no approval.**
3. **Generated files.** Recommend shipping M5 (`save_text_media`, ≤ 64 KiB
   text). Binary files generated on a desk (PDF, XLSX, a matplotlib PNG) stay
   out of scope until the Hands protocol grows a binary transfer. **Confirm.**
4. **Place map.** Recommend keeping "no map" (§5) and the address in
   `subtitle`. If a map is required, pick the provider and the geocoder in a
   separate task; provider prices and terms must be checked at that point.
   **Confirm no map.**
5. **Quotas.** Recommend 8 MiB / 4096 px / 16 MP for an image, 25 MiB for a
   file, 4 per `images` block and 8 per turn, 40 media/day and 200 MiB total per
   AI. **Confirm or give other numbers.**
6. **Retention.** Recommend no age-out (a card in history must keep working);
   delete rows and files when the AI is deleted (FK cascade + a janitor for
   orphans). A later admin "clear card media" action can free space. **Confirm.**
7. **Gallery and export.** Recommend not indexing card media into
   `media_items` in v1: it would show files in the gallery that have no message
   bubble to jump to. The card's `fallback` text is indexed as usual. **Confirm.**
8. **Design (corrected by the lead).** The boards exist:
   - web: `docs/design/mockups/blocks/WebContent.dc.html:86` (24 · FILE) and `:123` (20 · IMAGES);
   - phone: their twins in `PhoneContent.dc.html`.
   W1/P1 draw exactly those. No question here.
