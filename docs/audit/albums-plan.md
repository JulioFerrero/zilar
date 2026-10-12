# Albums (TG-10): audit and plan

Task T-1266. **Docs only: this changes no code.** It designs how several photos picked
together become one bubble/grid in both apps, like Telegram's `grouped_id`, and splits
the work into tasks.

Source: `docs/audit/telegram-parity-audit.md` §4 item 10 (`:270`, "grouped bubbles for a
multi-pick (albums, client-side grouping by a shared `batchId`)"), and §3.4.4 (`:239`,
"Several photos become several bubbles: no albums."). The mobile picker half already
landed as T-1246 (`work/T-1246-mobile-multi-photo-downscale.md`: the picker takes up to 10
items and Send sends one message per item, the caption and the reply on the first).

---

## 1. The wire marker

### 1.1 How an attachment travels today

An attachment is **not** XEP-0066 OOB. T-0065 (`work/T-0065-attachments-web.md:36`)
explicitly said "Do not add XEP-0066 in this task", and a repo-wide search for `oob` /
`urn:xmpp:oob` finds no producer or parser outside that task note. Instead:

- the **caption** is the message `<body>` (`packages/xmpp-core/src/stanza/build-outgoing.ts:97`);
- the **attachment** is a JSON payload inside an `<agent xmlns='urn:zilar:agent:0'>`
  child, built at `build-outgoing.ts:99-101` and decoded at
  `packages/xmpp-core/src/stanza/decode.ts:82-89`;
- the payload is a strict union with **one** `attachment` member carrying a **single**
  `AttachmentSchema` (`packages/protocol/src/payload.ts:40-44`,
  `packages/protocol/src/attachment.ts:11-41`). The bytes live at the XEP-0363 download
  URL (`attachment.ts:8-19`);
- the payload is capped at 64 KiB (`payload.ts:13`) and encoded/decoded by
  `encodePayload` / `decodePayload` (`payload.ts:76`, `:80`).

So today **one message = one attachment = one bubble**. The namespaces live in one flat
list, `packages/xmpp-core/src/namespaces.ts:1-28`.

One more existing rule matters for the marker: `build-outgoing.ts:107-109` adds a
`<store xmlns='urn:xmpp:hints'>` hint whenever a message has a payload or an empty body,
because ejabberd's MAM only keeps a hinted/body-bearing message (the comment records the
2026-10-03 voice-note bug). An album's caption-less photos inherit that hint, so each
photo is archived.

### 1.2 Option A — one message per photo, each carrying a shared album marker (recommended)

Add a namespace constant `ALBUM_NAMESPACE = 'urn:zilar:album:0'` in
`namespaces.ts:1-28`, and one child on every message of the album:

```xml
<album xmlns='urn:zilar:album:0' id='<opaque>' index='N' count='M'/>
```

- `buildMessage` (`build-outgoing.ts:84-136`) writes it next to the reply, mentions and
  `<origin-id>`; `SendMessageOptions` (`packages/xmpp-core/src/types.ts:212-222`) gains an
  optional `album` field.
- `decodeMessageStanza` (`decode.ts:40-142`) reads it defensively, the way
  `parse-fields.ts:57-167` reads every other optional element (attrs only; a missing or
  malformed marker is dropped so the message still renders as a single photo), into a new
  optional `album?: MessageAlbum` on `ChatMessage` (`types.ts:46-101`).
- The **id** is generated once per pick; each photo keeps its own `<origin-id>`
  (`build-outgoing.ts:133`) and its own MAM row.
- `index` orders the grid and `count` reserves the N-of-M layout before every sibling row
  has loaded (important across a page boundary, see §2).

**Pros**

- A **non-Zilar client** sees each photo as an ordinary single-photo message; the unknown
  `<album>` child is ignored. Same fallback Telegram accepts.
- **MAM / history pages**: every row carries the album id, so grouping survives a page
  split. `PAGE_HISTORY_MAX` is 50 (`packages/client-core/src/store/history.ts:12`); an
  album of ≤10 may straddle a page, and the client can group the rows it has and fill in
  as older pages arrive. A single-message album could not be split, but also could not be
  paged photo-by-photo.
- **Existing per-message machinery is unchanged**: an optimistic bubble + one upload +
  one payload message (`packages/client-core/src/store/send/attachment.ts:114-164`), the
  retry path (`:166-192`), the `store` hint, the archive.
- **Per-photo actions already target one id**: reply (`build-outgoing.ts:115-127`),
  reaction (`:252-270`), edit (`:140-154`), retract (`:162-176`). "The whole album" is a
  client-side loop over the album's message ids.
- The viewer already walks per message (`packages/chat-core/src/photos.ts:18-32`), so
  stepping through an album's photos is not new machinery.

**Cons**

- N stanzas, N MAM rows, N upload slots.
- The **client must group**; and the server push path must special-case it (§4).
- A non-Zilar client shows N bubbles (acceptable).

### 1.3 Option B — one message carrying several OOB URLs (rejected)

One message with several `<x xmlns='jabber:x:oob'><url>…</url></x>` children, or a new
payload array type.

- **Cons:** a non-Zilar client shows only the first URL (XEP-0066 has no album concept);
  it rewrites the payload union and **every** reader of `message.attachment` (web
  `AttachmentBody.tsx`, mobile `attachment-body.tsx`, `photosOf`, file/GIF paths), plus
  push and search; and it destroys per-photo reply/reaction/delete at the wire level
  ("reply to one photo" becomes impossible).
- **Pros:** one push, one stanza.
  
The single benefit (one push) is achievable on top of Option A in the push resolver (§4).

**Recommendation: Option A.** It matches how the app already models a message, keeps a
plain-XMPP fallback, and keeps per-photo actions.

### 1.4 Marker invariants

- `id`: opaque, non-empty; generate one per pick (a UUID-like string; do not reuse an
  `<origin-id>`, which must stay unique per message). Cap length.
- `index`: `0 ≤ index < count`; `count`: `2 ≤ count ≤ 10` (Telegram's cap, and the mobile
  picker's `selectionLimit: 10` from T-1246). A marker outside these bounds is dropped
  (the message stays a single photo).
- Group only **consecutive** rows with the same `id` **and** the same sender — see §2.

---

## 2. Client grouping

The message-list helpers live in **`packages/chat-core`** (the task's "client-core
grouping" is really `chat-core`; `client-core` owns the store/unread layer). Both apps
consume the same function.

- `groupMessages` (`packages/chat-core/src/messages.ts:35-75`) serialises messages into
  `RenderItem[]`; `startsNewGroup` (`messages.ts:19-28`) starts a new group on a different
  sender, a different calendar day, or more than `GROUP_WINDOW_MS` (`messages.ts:4`, five
  minutes) apart. `MessageItem` carries `firstInGroup`/`lastInGroup`
  (`packages/chat-core/src/types.ts:215-222`).
- Web consumes it at `apps/web/src/components/MessageList.tsx:116-122` and maps each item
  to a `MessageBubble` at `:338-383`.
- Mobile consumes it at `apps/mobile/src/components/chat/message-list.tsx:154-160`, builds
  `ListEntry[]` at `:165-188`, and renders `MessageListRow` (`message-list-row.tsx:84-115`).

**Design (recommended).** Add an album dimension to the grouping output rather than a
parallel pass, so web and mobile get it for free:

- Extend the render item in `chat-core/src/types.ts:209-222` with either
  `MessageItem.albumItems?: UiMessage[]` (the album's messages, on the first row only,
  with the other rows suppressed) or a new `{ kind: 'album'; messages: UiMessage[]; … }`
  variant. Prefer the explicit new kind: it makes "one list item" unambiguous.
- Grouping rule: consecutive messages with the same non-empty `album.id`, the same
  `senderId`, on the same day and inside `GROUP_WINDOW_MS` become one item. `index`
  orders the photos; `count` sizes the placeholder grid. A malformed/missing marker never
  joins a group.
- Missing siblings (page boundary) are tolerated: render the photos that are loaded, in
  `index` order, and fill the rest as pages arrive. Do not require a contiguous
  `0..count-1` run to render.
- Keep the ≤400-line rule: `messages.ts` is 161 lines, `types.ts` 222; both have room.

**Chat-list preview.** `previewBody` (`messages.ts:94-117`) shows `🖼 Photo` for the last
attachment. Extend it to `` `🖼 ${count} photos` `` when the last message belongs to an
album (it carries `album.count`).

**Unread counts.** Today each archived row counts once. Telegram counts an album as one
unread. If Julio wants parity, the store's unread merge (`client-core`) must collapse a
consecutive album run to 1 — a separate `client-core` change (§4 preview, §7 open decision).

---

## 3. Rendering the grid

Both clients render one bubble per album; the caption sits under the grid (it is the first
message's body, `T-1246`; `composer-media.ts:50-55`).

**Layouts** (Telegram-like; implement as the 2/3/4/5+ cases):

- **2** → two equal columns.
- **3** → one large tile on the left, two stacked on the right.
- **4** → a 2×2 grid.
- **5+** → a 2-column grid; the last visible tile shows `+N` for the hidden remainder.

**Web.** Add a new `apps/web/src/components/message/AlbumGrid.tsx` and render it from the
existing attachment surface. Today one attachment is drawn by
`apps/web/src/components/message/AttachmentBody.tsx` (image branch `:76-115`, file
`:117-158`, GIF `:160-192`); the tile opens the viewer through
`apps/web/src/components/ImageMessage.tsx:52-63`. Reuse `mediaSrc`
(`apps/web/src/lib/attachments.ts`) and the same trusted-host rule the image/GIF branches
use (`AttachmentBody.tsx:49-53`).

**Mobile.** Add `apps/mobile/src/components/chat/album-grid.tsx` and render from
`apps/mobile/src/components/chat/attachment-body.tsx`. Reuse `AttachmentImage`
(`apps/mobile/src/components/chat/attachment-message.tsx:59`) and the trusted-host gate
`isLoadableMediaUrl` (`attachment-message.tsx:26-31`).

**File-size guard.** `apps/web/src/components/MessageBubble.tsx` is exactly **400** lines
and `apps/web/src/components/MessageList.tsx` is exactly **400**. `MessageBubble` already
delegates to `AttachmentBody`, so the grid code belongs in the new `AlbumGrid.tsx`, not in
`MessageBubble`. If the list needs a per-item branch for an `album` render item, extract
the row map into a small component first (the plan task must keep every file ≤400).

---

## 4. The rules

### 4.1 Reply

Wire: a reply names one id (`build-outgoing.ts:115-127`; `parseReply`,
`parse-fields.ts:40-51`).

- Tap a tile → reply targets that photo's message id.
- Long-press the grid → reply targets the album's **first** photo and the quote reads as
  the album (`> 3 photos` fallback text). Keep the wire unchanged.

### 4.2 Delete for everyone and delete for me

- **Per photo:** `deleteForEveryone` (`client-core/src/store/actions.ts:129-173`) sends one
  XEP-0424 retraction (`build-outgoing.ts:162-176`); delete-for-me is
  `deleteForMe` (`client-core/src/store/delete-own.ts:50-87`).
- **Whole album:** loop over the album's ids. There is no album retraction on the wire;
  cap the loop at the album size (≤10). The menu offers "Delete photo" and "Delete album".
- A user may only delete their own photos (`canDeleteMessage`, used at `actions.ts:137`);
  a mixed-album rule is not possible (an album is always one sender).

### 4.3 Forward

`forwardMessages` already takes a list (`client-core/src/store/send/forward.ts:102-171`)
and preserves order; the comment is a separate message after the copies (`:165-169`).

- Forward selected photos in `index` order.
- Recommendation: a forward of a **whole** album re-groups it in the target by stamping a
  **fresh** album id on the forwarded copies (Telegram does this). That needs the forward
  payload/UI mapping (`forwardedPayloadFor` / `forwardedUiFieldsFor`, `chat-core`) to carry
  the marker; if it is deferred, forwarded photos arrive as separate bubbles.

### 4.4 Reactions

Wire: one message id (`actions.ts:22-52`; `build-outgoing.ts:252-270`).

- Reacting on a tile targets that photo.
- Recommendation: reacting on the grid header applies to the album's first photo, and the
  grid shows the aggregate of its photos' reactions. The wire is unchanged.

### 4.5 Viewer

`photosOf` (`photos.ts:18-32`) already returns every photo of the chat in message order,
so the existing viewers step through an album's photos continuously **today**.

- Web `MediaViewer` (`apps/web/src/components/media/MediaViewer.tsx:59-68` list, `:81-97`
  arrows).
- Mobile `attachment-body.tsx:49-54` builds the list, `:141-149` opens `AttachmentViewer`
  (`image-viewer.tsx` / `photo-pager.tsx`).

**Requirement:** when the viewer is opened **on an album tile**, ←/→ should step through
**that album first**, then continue to the rest of the chat. Recommendation: pass an
optional album scope (the album's message ids) to the viewer and build the photo list from
it when present. Small change in the two callers; the pager itself is untouched.

### 4.6 Edits

Only the caption. The caption is the first message's body. Recommendation: the grid offers
Edit only when the first message has text; editing sends one XEP-0308 correction
(`actions.ts:54-127`; `build-outgoing.ts:140-154`) for that first message. The wire is
unchanged. (Web already hides Edit on any attachment: `MessageBubble.tsx:160-165`.)

### 4.7 Max album size

Telegram's cap is 10, and the mobile picker already limits to 10 (T-1246). Enforce it in
two places: the parser drops a marker with `count > 10` or `index ≥ 10`, and the send
paths stage at most 10.

---

## 5. Sending

### 5.1 Mobile (T-1246 already sends N messages)

`composer-media.ts:187-195` (`sendPicked`) calls `onSendAttachment` once per pick in order,
with `captionOptions(text, replyTo)` on the **first** only (`composer-media.ts:50-55`).
Change: generate one album id per Send and pass `album: { id, index, count }` on every
call. `SendAttachmentOptions` (`client-core/src/store/send/context.ts:37-40`) gains the
field, and `sendAttachment` (`send/attachment.ts:114-164`) forwards it into `sendMessage`.
Uploads already run in parallel (each `sendAttachment` forks its own run,
`send/attachment.ts:51`); "ordered send" is the index order the composer uses.

### 5.2 Web (single-file picker today)

`useComposerAttachments` accepts one file at a time (`useComposerAttachments.ts:59`,
`acceptFile(file: File)` at `:70-81`), and `Composer.tsx:264-265` sends it with
`storeApi.getState().sendAttachment(...)`. Change:

- accept `input.multiple` and stage an array (a small strip/preview like mobile's
  `composer-picked-strip.tsx`, `apps/mobile/src/components/chat/composer-picked-strip.tsx`);
- on Send, call `sendAttachment` once per file, in order, with the shared album options on
  every call and the caption/reply on the first.

### 5.3 Uploads in parallel with ordered send

Two options: (a) create all N optimistic bubbles up front and let each upload independently
(today's per-message behaviour), rendering the album in `index` order; or (b) upload all N
first, then send in order. **Recommendation: (a)** — it matches the existing pipeline, keeps
per-photo retry, and the grid renders by `index`, not by arrival order. Server echoes may
arrive out of order; grouping by id + sorting by index handles that.

---

## 6. Push

Today one publish IQ yields at most one notification:
`newestMessageForUserEffect` scans the newest rows oldest-first and returns exactly one
acceptable message plus a `notify` list that marks the older rows it walked past
(`apps/server/src/push/archive-scan.ts:85-111`, `:100-104`); resolution is per row
(`apps/server/src/push/candidates.ts:21-47`), and the payload shows that one row's text
(`apps/server/src/push/payload.ts:52-75`). A burst of album rows can still buzz more than
once, because each arriving IQ takes the next un-notified row.

Recommendation (small, in the server):

- in `candidates.ts`, when the winning row carries the album marker (regex over
  `row.xml`, the way `:32` detects a retraction and `:183-207` reads the reply fallback),
  return the album's `count` and let the scan mark the sibling album rows notified in
  `superseded` (`archive-scan.ts:81-110`);
- in `payload.ts`, carry an `albumCount` on `ResolvedPushMessage` (`:24-33`) and make
  `previewFor` (`:106-112`) / the body show `"3 photos"` for a caption-less image album;
- do **not** rely on the Web Push summary's `message-count` field
  (`apps/server/src/push/notification.ts:57-83`, `protocol.ts:23,30`): the comment at
  `protocol.ts:23` says ejabberd's `mod_push` leaves it absent, and nothing consumes it.

`previewBody` in `chat-core` (§2) covers the in-app chat list.

---

## 7. Recommendation (summary)

- **Wire:** Option A — one message per photo, each with
  `<album xmlns='urn:zilar:album:0' id index count/>` (§1.2).
- **Grouping:** a new album render item in `chat-core/src/messages.ts`; one item per album
  (§2).
- **Render:** a grid component per app (Telegram 2/3/4/5+ layouts), caption under the grid
  (§3).
- **Rules:** per-photo actions; album-wide reply/delete/forward/reaction as a client-side
  loop over message ids; viewer scoped to the album when opened on a tile; edit only the
  caption; cap 10 (§4).
- **Send:** one album id per Send, `album` on `SendAttachmentOptions`; mobile already
  loops, web gains multi-select; parallel uploads, ordered render (§5).
- **Push:** collapse the album to one notification with a "3 photos" preview (§6).

---

## 8. Open decisions for Julio

1. **Album cap = 10** (Telegram parity, matches T-1246's picker).
   *Recommendation: yes, 10.*
2. **Non-Zilar clients see N single photos** (Option A fallback).
   *Recommendation: accept it.*
3. **Album-wide reply/reaction target the first photo.**
   *Recommendation: yes, with an album-flavoured quote/chip.*
4. **Forward a whole album re-groups it in the target.**
   *Recommendation: yes; if it slips, forwarded photos arrive separately.*
5. **Delete-one-photo inside an album is allowed** (a gap is left in the grid).
   *Recommendation: yes, like Telegram.*
6. **An album counts as 1 unread** and the chat-list preview says "N photos".
   *Recommendation: yes, both; the preview is cheap, the unread collapse is a small
   `client-core` follow-up.*
7. **Viewer opened on a tile steps through the album first.**
   *Recommendation: yes.*
8. **Mixed content (photos + a file/video) in one pick.**
   *Recommendation: photos only for v1 (attachments of `kind: 'file'` stay single
   bubbles); revisit later.*

---

## 9. Task split (3-5 tasks; every file ≤400 lines)

### Task 1 — xmpp-core marker + chat-core grouping (with tests)

- **Does:** the `urn:zilar:album:0` namespace and marker element; build + parse + drop
  invalid; `ChatMessage.album` and `UiMessage.album`; the album render item in
  `groupMessages`; the "N photos" chat-list preview.
- **Tests:** parsing/build round-trip and the grouping rule (`packages/chat-core/src/messages.test.ts`
  and `packages/xmpp-core/src/stanza.test.ts` are the nearest kept tests; the message
  pipeline is the "crucial code" case in AGENTS.md).
- **Allowed files:** `packages/xmpp-core/src/namespaces.ts`,
  `packages/xmpp-core/src/stanza/album.ts` (new: element + parser + constants),
  `packages/xmpp-core/src/stanza.ts` (barrel export),
  `packages/xmpp-core/src/stanza/build-outgoing.ts` (380 lines — keep it thin, delegate to
  `album.ts`), `packages/xmpp-core/src/stanza/decode.ts`,
  `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/stanza.test.ts`,
  `packages/chat-core/src/types.ts`, `packages/chat-core/src/messages.ts`,
  `packages/chat-core/src/messages.test.ts`,
  `work/T-XXXX-albums-wire-grouping.md`.
- **Note:** `build-outgoing.ts` is at 380/400; the marker builder must live in
  `stanza/album.ts` so the file is not pushed past 400.

### Task 2 — web render + send

- **Does:** `AlbumGrid.tsx` (2/3/4/5+ layouts, caption under the grid); render the album
  item in `MessageList`; multi-select in the file picker and per-file ordered sends with
  the album options; the viewer opens scoped to the album.
- **Allowed files:** `apps/web/src/components/message/AlbumGrid.tsx` (new),
  `apps/web/src/components/message/AttachmentBody.tsx`,
  `apps/web/src/components/Composer.tsx`,
  `apps/web/src/components/composer/useComposerAttachments.ts`,
  `apps/web/src/components/media/MediaViewer.tsx`,
  `apps/web/src/components/ImageMessage.tsx`,
  `apps/web/src/lib/attachments.ts`, `work/T-XXXX-albums-web.md`.
- **File-size note:** `MessageList.tsx` and `MessageBubble.tsx` are each exactly 400
  lines; if either must change, extract the row map into a new component first and keep
  both ≤400 (add the extracted file to this task's Allowed files when the task is written).
- **No tests** (UI), per AGENTS.md.

### Task 3 — mobile render + send

- **Does:** `album-grid.tsx` (same layouts); render the album item in the mobile list;
  generate the album id and pass `album` through `SendAttachmentOptions` /
  `sendAttachment`; the viewer opens scoped to the album; the picked strip sends the album.
- **Allowed files:** `apps/mobile/src/components/chat/album-grid.tsx` (new),
  `apps/mobile/src/components/chat/attachment-body.tsx`,
  `apps/mobile/src/components/chat/message-list.tsx`,
  `apps/mobile/src/components/chat/message-list-row.tsx`,
  `apps/mobile/src/components/chat/message-bubble.tsx`,
  `apps/mobile/src/components/chat/composer-media.ts`,
  `apps/mobile/src/components/chat/composer-picked-strip.tsx`,
  `apps/mobile/src/components/chat/image-viewer.tsx`,
  `apps/mobile/src/components/chat/photo-pager.tsx`,
  `packages/client-core/src/store/send/context.ts`,
  `packages/client-core/src/store/send/attachment.ts`, `work/T-XXXX-albums-mobile.md`.
- **No tests** (UI/native).

### Task 4 — push collapse

- **Does:** one notification per album; the resolver reports the album size; the payload
  previews "N photos"; the scan marks sibling rows notified.
- **Allowed files:** `apps/server/src/push/candidates.ts`,
  `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/payload.ts`,
  `apps/server/src/push/candidates.test.ts`, `work/T-XXXX-albums-push.md`.
- **Tests:** `candidates.test.ts` (existing) for the collapse and the "N photos" preview.

### Task 5 (optional) — unread collapse and chat-list preview

- **Does:** an album counts as one unread in the store; the chat-list preview shows
  "N photos" (if the preview is not already landed in Task 1).
- **Allowed files:** `packages/chat-core/src/messages.ts`,
  `packages/chat-core/src/messages.test.ts`, `packages/client-core/src/store/incoming.ts`,
  `packages/client-core/src/store/*` (the unread merge), `work/T-XXXX-albums-unread.md`.
- Depends on Task 1.
