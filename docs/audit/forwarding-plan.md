# Forwarding plan (T-0256)

Audit and plan for message forwarding. Document only: no code, config or package
change. D28 in `docs/PROJECT_PLAN.md` (line 141) lists forwarding as a must-have
for a human-first daily chat; nothing forwards today. A repo-wide search for
`forward` in `apps/web/src`, `packages/chat-core/src` and `packages/protocol/src`
finds only an unrelated status comment (`apps/web/src/store/realStore.ts:1403`)
and generic "forwards to" comments, so the plan below starts from the real send
and receive paths.

Every code claim carries a `file:line`. Line numbers are from the worktree at
`/Users/julio/personal-projects/zilar-T-0256` on branch
`task/T-0256-forwarding-plan` on 2026-10-06.

## 1. Today: how a message is sent and stored on web

### 1.1 The wire

`apps/web/src/store/realStore.ts` calls `core.sendMessage(chatId, kind, body,
options)` (`realStore.ts:3964`, `:1767`, `:3262`, `:1662`). `sendMessage` lives in
`packages/xmpp-core/src/client.ts:930-950` and delegates to
`buildMessage` in `packages/xmpp-core/src/stanza.ts:113-174`, which builds one
`<message type to id>`:

- `<body>` = the text/caption (`stanza.ts:122`);
- optional `<agent xmlns="urn:zilar:agent:0">` = `encodePayload(payload)`
  (`stanza.ts:124-126`, namespace in `packages/xmpp-core/src/namespaces.ts:1`);
- `<store xmlns="...hints">` when the body is empty or a payload is present, so
  MAM keeps it (`stanza.ts:132-134`);
- optional `<reply xmlns="...reply" id>` (`stanza.ts:136-145`);
- optional one `<reference type="mention" uri="xmpp:jid" begin end>` per mention
  (`stanza.ts:147-171`).

ejabberd routes the stanza and archives it with `mod_mam` (`default: always`,
`deploy/ejabberd/ejabberd.yml:229-232`). The client receives and decodes it in
`decodeMessageStanza` (`stanza.ts:903-978`): carbons/MAM are unwrapped
(`stanza.ts:466-490`, including the forwarded `<delay/>` used as the timestamp),
body and payload are read (`stanza.ts:929-942`), then `toUiMessage`
(`realStore.ts:2257-2306`) maps `ChatMessage` to `UiMessage`.

The sender's name is **not** on the wire: the stanza carries only the sender JID
(`from`), and `senderNameFor` resolves a display name locally from the contacts
list, the MUC nick, the group member list, the room occupant list, the DM title,
or `"Someone"` (`realStore.ts:1851-1875`). Any "forwarded from" header therefore
must carry the name captured at forward time, because the target chat cannot be
assumed to resolve the origin JID.

### 1.2 Text, replies and mentions

- Text: `sendText` trims the text and inserts an optimistic `UiMessage`
  (`realStore.ts:3928-3985`); mentions are computed from the trimmed text
  (`realStore.ts:3934`, `mentionsForTrimmedText`) and sent as XEP-0372
  references (`realStore.ts:3964-3975`).
- Reply: `replyTo` is a `ReplyRef` (`packages/chat-core/src/types.ts:31-35`) and
  is sent as the `<reply id>` element (`realStore.ts:3965`). The id points at a
  message in the **source** chat; the target chat has no such message.
- Mentions: a `UiMention` has a JID and UTF-16 offsets into the body
  (`chat-core/src/types.ts:46-53`); `buildMessage` converts them to code-point
  offsets (`stanza.ts:152-168`).

**Re-send to another chat:** text works as-is. A reply link and mention ranges
must **not** be copied: the reply id does not exist in the target chat, and
mention offsets are tied to the original text/audience. Copy the body only.

### 1.3 Attachments, stickers, voice and GIFs

**Attachments** are a `Payload` of `type: 'attachment'` (`payload.ts:35`) whose
data is `AttachmentSchema` (`packages/protocol/src/attachment.ts:10-22`): the
bytes live at `url`, an XEP-0363 download URL (`attachment.ts:13`), and the
message body carries the caption. The upload path is `sendAttachment`
(`realStore.ts:4058-4101`) → `runAttachmentUpload` (`realStore.ts:1739-1795`),
which classifies the file, reads image dimensions, then calls
`attachmentPort.upload` (`realStore.ts:1757`) → `uploadAttachment`
(`apps/web/src/lib/attachments.ts:203-236`). That asks for a slot via the XMPP
upload service `upload.<domain>` (`packages/xmpp-core/src/client.ts:1045-1083`),
PUTs the bytes to `slot.putUrl`, and uses `slot.getUrl` as the message URL
(`attachments.ts:216-235`).

**Where the bytes live and who may read them.** `mod_http_upload` serves them
from the ejabberd docroot `/opt/ejabberd/upload` (`deploy/ejabberd/ejabberd.yml:233-251`).
The `/upload/*` path is reverse-proxied **straight to ejabberd with no auth
layer** (`deploy/caddy/Caddyfile:39-43`; `deploy/baremetal/nginx-zilar.conf:97-101`;
dev: `infra/ejabberd/ejabberd.yml:198-205`). There is no per-chat access check:
anyone holding the URL can read the bytes. The client trusts a media URL by
**host**, not by chat membership (`trustedMediaHosts`, `attachments.ts:99-116`;
`isTrustedMediaUrl`, `attachments.ts:124-134`; incoming sanitizers,
`realStore.ts:444-476` and `:505-516`). This contradicts the spec's example of
"an attachment URL that only members of the source chat may read" — that
limitation does not exist in this deployment.

Consequence: **forwarding an attachment URL works as-is, no server copy
endpoint is required for access.** The real risk is durability: the per-user
upload quota (`mod_http_upload_quota`, soft 2048 MiB / hard 4096 MiB) deletes the
uploader's **oldest files** once the hard quota is exceeded
(`deploy/ejabberd/ejabberd.yml:187-197`, `:241-251`), so a forwarded message can
later point at deleted bytes. That is a durability problem, not an access one.

**Stickers** are a payload `type: 'sticker'` (`payload.ts:36`) with data
`StickerSchema` (`packages/protocol/src/sticker.ts:15-35`). The `url` is either an
`http(s)` upload URL or the relative `/api/stickers/:id/file` path
(`sticker.ts:19-29`). Sending is `sendSticker` (`realStore.ts:4102-4157`): it
validates the data, builds the payload, and sends it; there is no upload step.
Re-sending the same sticker payload to another chat works as-is, provided the
pack still exists (a deleted pack already 404s today).

**Voice notes** are a payload `type: 'voice'` (`payload.ts:34`) with data
`VoiceMetaSchema` (duration, mime, waveform, optional url and optional
transcript; `packages/protocol/src/voice.ts:11-18`). Sending is `sendVoice`
(`realStore.ts:3986-4023`) → `runVoiceSend` (`realStore.ts:3237-3289`), which
converts the recording server-side with `POST /api/voice`
(`apps/web/src/lib/voice.ts:200-231`, request at `:211`) and uploads it to the
same XEP-0363 host (`voice.ts:243-268`). Re-sending the voice payload works
as-is (same URL + waveform). Transcripts are per-request server rows keyed by URL
hash and are not part of the stored send path in `realStore.ts` (no `transcript`
match there); a forward should drop `transcript` defensively anyway.

**GIFs** are not a payload kind: the composer fetches the proxied blob and sends
it through the **attachment** path with a `gif-` name and a video/image mime
(`apps/web/src/components/Composer.tsx:445-476`; `gifBlobType`,
`attachments.ts:244-262`). Forwarding a GIF is therefore attachment forwarding.

**Polls** exist in the protocol (`payload.ts:32-33`) but have no composer or send
path in the web app (no `sendPoll`/`type: 'poll'` in `apps/web/src`), so they are
out of scope now; a generic forward should still preserve the payload.

## 2. Telegram behaviour to copy, and what we take now

| Telegram behaviour | Now | Later |
|---|---|---|
| "Forwarded from &lt;name&gt;" header | ✅ Take. Origin name captured at forward time; shown in a muted line above the bubble | — |
| Forward one or several messages | ✅ Take. Menu entry enters a multi-select mode | — |
| Pick one or more target chats in a search sheet | ✅ Take. New picker with a search field over chats/topics | — |
| Optional comment | ✅ Take, as a **separate text message** per target (matches Telegram's multi-forward; keeps the forwarded content unmodified) | caption-style comment for a single forward if wanted |
| Forward from channels | ✅ Take, as normal sends into the target; also forward *out* of a channel by reading its history | — |
| Sender privacy option to hide the original name | ❌ Not now: names are client-asserted, so hiding is not enforceable without server work | server-verified origin + a per-user "hide my name in forwards" setting |
| Tap the header to open the origin chat | ❌ Not now | yes, once cross-chat links are solid |
| "Restrict forwarding" on a message/channel | ❌ Not now | server-enforced per origin |

## 3. Design

### 3.1 Wire format

Add a **separate `<forward>` element** on the message instead of a new payload
type. Reason: a message already has at most one `<agent>` payload, so a
`forward` payload could not coexist with an `attachment`/`voice`/`sticker`
payload. Re-sending the original body and payload unchanged means every existing
renderer keeps working and older clients degrade to "content without the
header".

Namespace `urn:zilar:forward:0`. The origin object is validated in
`packages/protocol`:

```ts
// packages/protocol/src/forward.ts
export const ForwardOriginSchema = z.strictObject({
  sender_id: z.string().min(1).max(255),   // bare JID or user id of the author
  sender_name: z.string().min(1).max(120), // captured at forward time
  chat_id: z.string().min(1).max(255).optional(),   // source room JID; only for a public origin
  chat_name: z.string().min(1).max(120).optional(), // only for a public origin
  original_id: z.string().min(1).max(255).optional(),
  original_at: z.iso.datetime(),           // original send time
});
export type ForwardOrigin = z.infer<typeof ForwardOriginSchema>;
```

`chat_id` and `chat_name` are **producer-side optional and set together only for a
public origin**. A private-topic forward must omit both: the target members must
not learn the private room JID (§3.6), the same 404 discipline that hides private
topics from non-members. A DM origin likewise has no room JID, so its header
falls back to `sender_name` (§3.3).

On the wire (all long strings as child text, ids/time as attributes):

```xml
<forward xmlns="urn:zilar:forward:0" sender="ana@zilar.test"
         at="2026-10-06T10:00:00.000Z" id="orig-123">
  <name>Ana</name>
  <chat jid="design@rooms.example" name="Design" />
</forward>
```

`packages/xmpp-core` builds it in `buildMessage` (new `forward?` option on
`SendMessageOptions`) and parses it in `decodeMessageStanza` into a new
`ChatMessage.forward` field. A malformed `<forward>` is dropped and the message
still decodes (never throw on the receive path). Sender name is stored as text
and rendered as text (React escapes it); cap it with the schema.

Rejected alternative: a nested `forward` payload
(`{ origin, content: Payload | { kind:'text' } }`). It is self-contained in one
`<agent>` element, but it cannot coexist with the original payload, forces every
renderer to unwrap it, and makes an un-updated client show nothing instead of the
content.

### 3.2 How each content kind is copied

| Kind | Copy | Notes |
|---|---|---|
| Text | `body` only | drop `replyTo` and `mentions` (see 1.2) |
| Attachment | payload unchanged, same `url` | works as-is (3.1 of §1.3); no upload. Left open: quota durability |
| GIF | same as attachment | it is an attachment today |
| Sticker | payload unchanged | pack must still exist, same as today |
| Voice | payload unchanged, drop `transcript` | same URL + waveform; transcript is chat-scoped |
| Poll | payload unchanged | no send UI yet; preserve if present |
| Deleted message | refuse to forward | `message.deleted === true` has no content (`chat-core/src/types.ts:85-89`) |

No server copy endpoint now: attachments have no per-chat read ACL, so access is
not the blocker, and a copy under the forwarder's account would still count
against their quota. A copy endpoint is a durability/ACL feature to revisit (T-C
below).

### 3.3 What the receiver shows

- A muted header line above the bubble: `Forwarded from <sender_name>` for a
  person, or `Forwarded from <chat_name>` when a public `chat` origin is
  present. Plain text, no markup.
- The original content exactly as today (text, attachment card, sticker, voice,
  poll) because the body/payload are unchanged.
- No reply link and no mention highlights even if the original had them.
- Later: the header becomes a button that opens the origin chat.

### 3.4 What AIs see

The gateway builds turns from `body` only (`apps/server/src/agents/context.ts:126-142`
for DMs, `:149-160` for groups) and drops body-less payloads
(`context.ts:131-133`, `:153-155`). So:

- forwarded text and attachment **captions** are visible;
- forwarded voice, sticker and caption-less attachments are invisible;
- the `<forward>` origin is not seen by the model.

Recommendation: unchanged now. Keep `body` equal to the forwarded text/caption.
If we later want the model to know a message was forwarded, the server task adds
a fixed prefix or an origin line in `buildGroupMessages`
(`context.ts:171-197`); do not put the origin into the body.

### 3.5 Blocked people

Blocks are a silent list used **only** by the block routes
(`apps/server/src/blocks/service.ts:1-4`; the only callers are
`apps/server/src/blocks/routes.ts:61,71,82`). Nothing in message delivery, MAM or
the upload path reads `userBlocks`, so a block does not stop messages and would
not stop a forward. Recommendation: no server change now; a forwarded message
from a blocked origin still shows. A Telegram-style "restrict forwarding" is a
server-enforced property of the origin and is listed as Later (§2).

### 3.6 Topics

Each topic is its own XMPP room (D29, `docs/PROJECT_PLAN.md:142`), and a private
topic answers a byte-identical 404 to hide it
(`apps/server/src/topics/access.ts:68-79`). A forward target is therefore just a
`ChatSummary.id` that maps to a room JID; the target picker must apply the same
visibility rules as the sidebar:

- DMs, groups and their public topics the user is in;
- private topics **only** when the user was added (never list or name the
  others — same 404 discipline);
- channels only where the user may post (owner/admin; a plain member has no
  voice in the feed room, `apps/server/src/topics/rooms.ts:28-30`).

Forwarding **from** a private topic is allowed only for members because only they
can open its history. The MUC is members-only and non-anonymous
(`deploy/ejabberd/ejabberd.yml:206-224`), so the origin sender is the resolved
member or MUC nick. A forward whose origin is a private topic carries neither
`chat_id` nor `chat_name`, so the target members never receive the private room
JID and cannot use it to probe or open the topic (§3.1).

## 4. Task split

Ordered, small, one concern each. Each task touches only the files listed.

### T-A — protocol: `ForwardOriginSchema`

- Allowed files:
  - `packages/protocol/src/forward.ts` (new)
  - `packages/protocol/src/index.ts`
  - `packages/protocol/src/forward.test.ts` (new)
- Tests: valid object passes; strict object rejects an unknown key; missing
  `sender_id`/`sender_name`/`original_at` fails; each length cap and a bad
  datetime fail. Keep `PayloadSchema` (`payload.ts:14-37`) and `v: 0` untouched.
- Risks: low. Do not renumber or reorder existing exports.

### T-B — xmpp-core: build and parse `<forward>`

- Allowed files:
  - `packages/xmpp-core/src/namespaces.ts`
  - `packages/xmpp-core/src/types.ts` (`ChatMessage.forward`, `SendMessageOptions.forward`)
  - `packages/xmpp-core/src/stanza.ts` (`buildMessage`, `decodeMessageStanza`)
  - `packages/xmpp-core/src/client.ts` (`sendMessage` passes `forward`)
  - `packages/xmpp-core/src/stanza.test.ts`
  - `packages/xmpp-core/src/client.test.ts`
- Tests: build→decode round-trip with and without a chat origin; a malformed
  forward leaves the message decodable with no `forward`; a message with no
  forward has no field.
- Risks: the receive path must never throw (drop bad forward); keep the element
  small and covered by the schema caps.

### T-C — server copy endpoint (only if durability/ACL is required)

- Not taken now. Recommended trigger: users report broken forwarded files, or a
  per-chat upload ACL is added.
- Allowed files (if taken): `apps/server/src/attachments/service.ts` (new),
  `apps/server/src/attachments/routes.ts` (new), the app wiring file that mounts
  routes, and their tests.
- Tests: SSRF guard (only the configured upload host is fetched), caller must be
  able to read the origin message, size cap, quota accounting.
- Risks: SSRF, double quota use, large-file timeouts. Do not add without the
  lead's sign-off.

### T-D — web store: `forwardMessages` action

- Allowed files:
  - `apps/web/src/store/store.ts`
  - `apps/web/src/store/realStore.ts`
  - `apps/web/src/store/realStore.forward.test.tsx` (new)
- Behaviour: `forwardMessages(targets: string[], messages: UiMessage[], options?:
  { comment?: string })` — for each target and each message build an optimistic
  `UiMessage` and send via `core.sendMessage` with the copied body/payload plus
  `forward`; one message per forwarded item; after the forwards, send the
  optional comment as a normal text message to each target. Skip deleted
  messages; drop `replyTo`/`mentions`/`transcript`. Reuse the existing send
  timeout/status machinery (`realStore.ts:1696-1795`).
- Tests: text forward to two targets creates two sends; attachment forward keeps
  the URL and drops the reply; deleted message is skipped; comment sends a
  separate text; failure marks the bubble failed with a fixed reason.
- Risks: many optimistic inserts per target; do not duplicate `signatureFor`
  queue keys across targets.

### T-E — web UI: menu entry, multi-select, target picker, header

- Allowed files:
  - `apps/web/src/components/MessageActionsMenu.tsx` (add a Forward item)
  - `apps/web/src/components/MessageBubble.tsx` (render the header; send
    `onForward`)
  - `apps/web/src/components/MessageList.tsx` (selection mode / selection bar)
  - `apps/web/src/components/ForwardPicker.tsx` (new)
  - `apps/web/src/components/ForwardedHeader.tsx` (new)
  - the route/view file that wires `MessageList` actions (the file that owns
    `onReply` today)
  - `apps/web/src/components/ForwardPicker.test.tsx` (new),
    `apps/web/src/components/MessageBubble.forward.test.tsx` (new),
    `apps/web/src/components/MessageActionsMenu.test.tsx`
- Flow: Forward in the menu enters select mode with that message selected; more
  messages can be checked; a bottom bar shows the count and a Forward button;
  the picker searches chats/topics, allows several targets, shows an optional
  comment field, and sends. Keep selection state in a local provider, not the
  store.
- Tests: menu shows Forward; picker filters and lists DM/group/topic; private
  topics hidden unless a member; send disabled with no target; header renders on
  an incoming forward.
- Risks: selection touches the list render path; keep the pitfall about registry
  files in mind and add one entry at a time.

### T-F — mobile parity

- Allowed files:
  - `apps/mobile/src/store/chat-store.ts`
  - `apps/mobile/src/store/real-store.ts`
  - `apps/mobile/src/components/chat/message-actions-sheet.tsx`
  - `apps/mobile/src/components/chat/message-bubble.tsx`
  - `apps/mobile/src/components/chat/message-list.tsx`
  - `apps/mobile/src/components/chat/forward-sheet.tsx` (new) and its test
- Mirror T-D/T-E with the existing mobile sheet patterns; run the mobile tests
  with the worker cap. Risks: Hermes has no `crypto.subtle`; keep the same
  protocol/Origin shape and no new native dependency.

## 5. Open questions for Julio

**Answered 2026-10-06: Julio accepted every recommendation below.** T-A and T-B shipped in T-0261. Next come T-D (web store) and T-E (web UI), then T-F (mobile). T-C stays out.

1. **What is the optional comment?** Recommended: a separate text message per
   target, sent after the forward(s) (matches multi-forward, leaves content
   untouched). Alternative: a caption on a single-message forward.
2. **Re-upload attachments or reuse the source URL?** Recommended: reuse the URL
   now (no per-chat ACL exists), accept the quota-deletion risk, and add the
   server copy endpoint (T-C) only if it bites.
3. **Sender "hide my name" privacy.** Recommended: later, server-enforced; show
   the captured name now because client-asserted hiding is not trustworthy.
4. **Forward from a private topic.** Recommended: allowed for members only; the
   picker lists only chats/topics the user can see. A per-origin "restrict
   forwarding" flag is a later server feature.
5. **Forward into a channel as a non-admin.** Recommended: hide non-postable
   channels in the picker instead of showing a target that always fails.
6. **Keep reply/mentions on a forward?** Recommended: drop both (the reply id and
   the audience do not exist in the target chat).
7. **Multi-select entry point.** Recommended: the message menu's Forward enters
   select mode with one message checked; long-press is a later mobile nicety.
