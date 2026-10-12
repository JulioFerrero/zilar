# Delivered tick: sent / delivered / seen (plan)

Julio decided on 2026-10-12 to add a real **delivered** state. Own messages show three states:
`sent` (the server has it) → `delivered` (it reached the recipient's device) → `seen` (the
recipient read it). This document is the plan only (T-1226). No code was changed. Every claim
cites `file:line`; anything not verified against the tree is marked **unverified**.

## Decisions (Julio and the lead, 2026-10-12), which override the recommendations below

- **Groups, against §3's recommendation:** delivered = **at least one member's device** got it,
  i.e. option (ii). DMs: the recipient's device got it.
- **Privacy, §7:** **no toggle.** Delivered and seen receipts are always on. Task 6 of §9 is dropped.
- **Transport, §2:** server-recorded delivery (B) for every receiver state, over HTTP. No
  XEP-0184.
- **Wire id, §4:** the origin id. The sender matches through `sameMessage` aliases.

## 1. Today's flow: `sent` and `read`

### 1.1 `sent`

`MessageStatus = 'sending' | 'sent' | 'read' | 'failed'` (`packages/chat-core/src/types.ts:7`).
A text becomes `sent` on any of three paths, all funnelled through one forward-only ladder:

- Stream-management ack: `outboxAcked` matches the acked stanza id (or an alias of the local id
  via `sameMessage`) and calls `updateMessageStatus(entry.chatId, entry.localId, 'sent')`
  (`packages/client-core/src/store/send/outbox.ts:123-133`). The exact SM ack emission inside
  xmpp-core (T-1153/T-1216/T-1220) is **unverified** here — per the task description, "sent" comes
  from stream-management acks.
- Server echo: the MUC reflection / carbon of my own message proves the stanza reached the server,
  so `handleOutgoingEcho` clears any failure and sets `sent`
  (`packages/client-core/src/store/incoming.ts:48-54`). The echo also links the optimistic local id
  to the server id (`linkMessageIds`, `linkLocalToServer`, `incoming.ts:45-47`), which is what later
  status updates match on.
- Direct send confirmation: each send pipeline sets `sent` on success — text
  (`packages/client-core/src/store/send/text.ts:101`), sticker (`send/sticker.ts:52`), voice
  (`send/voice.ts:99`), attachment (`send/attachment.ts:97`), forward (`send/forward.ts:92`).

All of them go through `updateMessageStatus`, which applies `advanceStatus` to both the open
conversation and the chat-list preview so the two always agree
(`packages/client-core/src/store/ledger-mutators.ts:68-75`). The ladder is
`sending -> sent -> read`, forward only; `failed` sits outside it
(`packages/client-core/src/store/rows.ts:46-62`).

### 1.2 `read`

`read` comes from XEP-0333 chat markers (`urn:xmpp:chat-markers:0`,
`packages/xmpp-core/src/namespaces.ts:3`). The receiver sends
`<displayed xmlns="urn:xmpp:chat-markers:0" id="…"/>` via `buildDisplayed`
(`packages/xmpp-core/src/stanza/build-outgoing.ts:222-232`), sent by `markDisplayedEffect`
(`packages/xmpp-core/src/core-effect/operations.ts:261-267`). The sender parses it in
`parseDisplayed` (`packages/xmpp-core/src/stanza/decode.ts:170-186`), the router emits a
`displayed` event (`packages/xmpp-core/src/core-effect/stanza-router.ts:102`), the lifecycle
subscribes (`packages/client-core/src/store/lifecycle.ts:315`), and `handleDisplayed` sets the
message to `read` after dropping reflections of my own markers
(`packages/client-core/src/store/incoming.ts:221-231`).

The receiver sends the marker only when the chat is really open: on a live incoming message when
`activeChatId === chatId` and the app is visible (`incoming.ts:188-194`), on a history page that
lands while the chat is open/visible/focused (`packages/client-core/src/store/history.ts:304-313`),
and when returning to a chat that collected messages while hidden (`clearActiveChatRead`,
`packages/client-core/src/store/polling.ts:65-83`). In parallel the client records a server-side
read mark (`PUT /api/chats/:jid/read`, `recordRead`, `packages/client-core/src/store/reads.ts:39-72`;
server side `apps/server/src/chats/reads.ts:1-84`). Note the id split: the server mark takes only
numeric archive ids (`reads.ts:57`, `chats/reads.ts:44-55`), while the XMPP displayed marker keeps
the origin id (`polling.ts:76-78`).

No delivery receipts exist anywhere: there is no `urn:xmpp:receipts` string in `packages/` or
`apps/` (verified by grep — zero matches).

### 1.3 Where the ticks are drawn

- Web bubble meta: `MessageMeta` renders time plus `<MessageTicks status>` for own messages
  (`apps/web/src/components/message/MessageMeta.tsx:18-42`). `MessageTicks` maps
  `sending → Clock`, `failed → CircleAlert`, `read → CheckCheck`, anything else → single `Check`
  (`apps/web/src/components/MessageTicks.tsx:4-15`). So today sent = one tick, read = two ticks.
  The same component is reused in the chat list (`apps/web/src/components/ChatListItem.tsx:166`),
  topic rows (`apps/web/src/components/TopicRow.tsx:142`) and stickers
  (`apps/web/src/components/StickerMessage.tsx:56`).
- Mobile bubble meta: `BubbleInlineMeta` renders time/edited plus `Ticks` for outgoing messages
  (`apps/mobile/src/components/chat/message-bubble-content.tsx:47-89`). `Ticks` maps
  `failed → CircleAlert`, `sending → Clock`, `read → CheckCheck`, else single `Check`
  (`apps/mobile/src/components/chat/ticks.tsx:13-27`). Chat-list and topic rows show ticks only
  when the chat has no unread and the last message is mine (`showTicks`,
  `apps/mobile/src/components/chat/chat-list-item.tsx:74` and `:143-148`,
  `apps/mobile/src/components/chat/topic-row.tsx:82` and `:162-163`).

## 2. Proof of delivery, per receiver state

There are two candidate transports:

- **(A) XEP-0184 receipts** (client-to-client over XMPP): the receiving client replies with a
  `<received/>` stanza over its live stream, addressed to the sender. It needs both sides online
  with an XMPP stream at the same moment, and it leaves no server trace — an offline sender never
  learns of it unless the server stores it (standard ejabberd does not archive receipt stanzas
  into the sender's readable state; exact ejabberd behavior here is **unverified**).
- **(B) Server-recorded delivery**: the receiving device tells the *server* (HTTP call or a
  client→server marker the server intercepts), the server stores "user U's device got message M"
  and pushes that fact to the sender — live if the sender is online, or on the sender's next
  reconnect/catch-up.

Per receiver state:

1. **Web tab open (connected).** The web app runs the same client-core store, so either transport
   works: an XEP-0184-style receipt over the live stream (same shape as today's `markDisplayed`
   path, §1.2), or an HTTP confirmation to the server. No new capability is needed on this path.
2. **Mobile in the foreground.** Same as (1): the app holds a live XMPP stream and the full store,
   so either transport works.
3. **Mobile in the background, woken by an FCM data push.** This is the deciding case. The wake
   (`apps/mobile/src/lib/push/background.ts`) carries `{ chatId, messageId? }` (`background.ts:46-50`,
   parsed at `:63-82`), has a session token (`getSessionToken`) and HTTP (`fetchImpl`, `apiUrl`;
   `background.ts:52-56`, resolved at `:167-171`), fetches a preview over HTTPS
   (`background.ts:127-136`) — but **no XMPP stream**: nothing in that module imports xmpp-core,
   and the phone suspends its socket in the background (wave-1 item T-1151,
   `docs/plan/plan.json:24`). So transport (A) is impossible here: there is no stream to send a
   receipt on. Only transport (B) works — the wake handler makes one extra HTTP call
   ("device holds messageId M") alongside the existing `push.preview` call. Opening an XMPP stream
   from the headless task just to send a receipt would cost a full session setup per push and is
   not recommended.
4. **Mobile killed or offline: delivered later.** Nothing can be proven until the client reconnects
   and catches up through MAM (catch-up after reconnect is the T-1207 item,
   `docs/plan/plan.json:58-59`). At that point the client holds the messages locally and confirms
   them in bulk over HTTP (or the server infers delivery from the client's MAM sync cursor —
   **unverified** whether the server can observe that cursor; the explicit confirmation call is the
   safe plan). Transport (A) would additionally require the original sender to still be online when
   the receipt is sent, which cannot be relied on.

**Recommendation: (B) server-recorded delivery for all four paths (a uniform single path), no
XEP-0184.** Rationale: (B) is the only transport that covers the push-wake case (3); using it for
(1), (2) and (4) as well avoids two code paths, two id schemes and two offline stories. The
receiver→server confirmation rides the same HTTP pattern as today's read marks
(`PUT /api/chats/:jid/read`, `apps/server/src/chats/reads.ts`), and the server→sender fan-out
rides the existing push/on-reconnect machinery (§6). A client→client XMPP receipt could be added
later as a latency optimization (sender sees the tick without a server round trip), but it must
never be the only path.

Privacy note for (3): the wake fires for every push, including muted chats where nothing is shown
(the scan stays silent for muted/hidden rows, `apps/server/src/push/archive-scan.ts:41-52` and
`delivery.ts:159-169`). A delivery confirmation must only be sent when a message was actually
fetched/shown — i.e. after a successful `push.preview`, never on the generic-fallback path
(`background.ts:121-123`) and never for a 404 (`background.ts:129-132`) — or a muted message would
leak its arrival to the sender. The confirmation carries ids only, like the existing pipeline
which logs "ids only, never message text" (`delivery.ts:43-47`).

## 3. DMs vs groups

Options: (i) delivered = all members' devices got it; (ii) delivered = any member's device got it;
(iii) no delivered state in groups.

**Recommendation: (iii) — DMs get the full sent → delivered → seen ladder; groups keep today's
sent → read.** Rationale: per-member delivery in groups is an N-way fan-out with ambiguous UX
(any/all thresholds confuse more than they inform), and the plan.json MP-F8 entry already frames
this feature against Telegram (`docs/plan/plan.json:62`), where groups show no per-member delivery
state. Group `read` keeps working exactly as today (any member's displayed marker advances the
message — note this existing looseness: `handleDisplayed` does not distinguish *which* member read
it, `incoming.ts:221-231`). If Julio later wants group delivery, (ii) "reached at least one member"
is the cheaper next step; (i) needs per-member server state and per-member UI and is not
recommended. Either way this is Julio's call — the task split (§9) puts DMs first so groups can
ship unchanged.

## 4. Ids: what each receipt names, and how the sender matches it

Background: one logical message currently has up to three ids. `messageId`
(`packages/xmpp-core/src/stanza/resolve-sender.ts:116-132`) prefers the `<stanza-id/>` stamped by
the archive (`by` = the room JID in groups, own JID in DMs), else any stanza-id, else the archive
id, else the wire `id`. The sender-generated **origin id** is what stays stable: a resent copy
(T-1216) goes out with the same origin id and may be archived twice under two different stanza-ids;
`rememberOriginId` aliases the second id to the first within a `(chatId, sender)` scope, so
`sameMessage` is true and history dedupes the copy
(`packages/client-core/src/store/ledger-ids.ts:163-204`, `sameMessage` at `:113-115`). The scope
matters because origin ids are client-generated and another sender may reuse one (`ledger-ids.ts:199-201`).

Rules for the delivered tick:

- The receiver's confirmation names the **origin id** (the id its own ledger stored the message
  under, and the same id today's displayed markers keep — `polling.ts:76-78`). Never the stanza-id:
  the sender may hold a different stanza-id for the same message (resend aliases, §4 above), and in
  groups the sender's and receiver's stanza-ids come from different archives.
- The sender matches with the alias-aware lookup it already uses everywhere: `sameMessage`
  (`ledger-ids.ts:113-115`) / `updateMessageStatus` (`ledger-mutators.ts:70-75`), which resolves
  through `aliasRoot` (`ledger-ids.ts:33-41`). A confirmation naming any alias of the message —
  local id, origin id, echo server id — lands on the same bubble, including resent copies aliased
  by `rememberOriginId`.
- Server-side, the delivery row keys on `(chat, origin_id)` — the same key the archive already
  exposes (`origin_id` column read in `apps/server/src/push/archive-scan.ts:145-146` and
  `apps/server/src/search/archive-query.ts:48`). The groupchat-row shape shows origin ids are the
  stable cross-device key (`archive-scan.ts:213-215`, `search/service.ts:26`).

## 5. State rules

- `delivered` ranks between `sent` and `read`: extend the ladder in
  `packages/client-core/src/store/rows.ts:46-62` to `sending(0) -> sent(1) -> delivered(2) ->
  read(3)`, keeping `failed` outside it (`advanceStatus` never moves into or out of `failed` except
  by explicit retry, `rows.ts:57-62`, `ledger-mutators.ts:117-119`). `MessageStatus` gains
  `'delivered'` (`packages/chat-core/src/types.ts:7`); this is a shared-type change both apps pick
  up, and every `switch` over the status must handle it (the tick components in §1.3 are if-chains
  and fall through safely, but they still need the new branch — §8).
- `read` implies `delivered`: since `read` outranks `delivered`, `advanceStatus` guarantees it with
  no extra code — and `handleDisplayed` needs no change (`incoming.ts:221-231`). A displayed marker
  arriving with no prior delivery still ends at `read`, correctly.
- A receipt that arrives before the ack still ends `delivered`: `updateMessageStatus` always applies
  `advanceStatus` (`ledger-mutators.ts:70-75`), so a later `sent` (lower rank) cannot downgrade an
  earlier `delivered` — the same guard that today stops a late echo/ack from downgrading `read`
  (`incoming.ts:50-52`, `rows.ts:46-47`). **Unverified**: the exact SM-ack emission order under
  session resume (T-1216); the ladder makes the order irrelevant, which is the point.
- Forward-only like reads: the existing server read-mark pattern (larger id wins, atomic
  `ON CONFLICT … WHERE`, `chats/reads.ts:64-82`) is the template for the server-side delivery
  write (§6).

## 6. Server and storage

Something must be stored: without server state, a delivery that happens while the sender is offline
is lost (transport (A) has this hole; §2). Design, following the `chat_reads` precedent
(`apps/server/src/chats/reads.ts`):

- New table, e.g. `message_deliveries (chat_jid, origin_id, recipient_id, delivered_at)`, unique on
  `(chat_jid, origin_id, recipient_id)` — or per-DM `(peer-pair, origin_id)` keyed through the
  existing archive scope (`archive-scan.ts:148-156`). Needs a migration (numbering/lock rules per
  T-1186, `docs/plan/plan.json:47`). Exact schema is for the spec task; the atomicity rule is not:
  the write must be check-then-insert-proof (unique index or `ON CONFLICT DO NOTHING`, mirroring
  `chats/reads.ts:76-81`).
- Receiver→server: new endpoint, e.g. `PUT /api/chats/:jid/delivered { originIds: [...] }` with the
  same access check as reads (unknown and invisible chats answer the same 404 —
  `chats/reads.ts:18-23`) and the same numeric-vs-origin-id care (unlike read marks, delivery ids
  *are* origin ids, so no numeric validation; cap batch size — every write needs a rate limit or
  cap per the security checklist). Bulk form covers the MAM catch-up path (§2.4) in one call.
- Server→sender: if the sender is online, push the delivery over the existing live channel (the
  mechanism is for the spec task to choose — **unverified** which sender-push channel exists today
  beyond XMPP stanzas and the T-1205 unread/preview sync, `docs/plan/plan.json:58`); if offline,
  the sender learns on reconnect — either by querying undelivered confirmations for its recent
  messages alongside the T-1207 catch-up, or by the server replaying queued delivery events at
  connect time. Either way the sender's reconnect path is the delivery sync path; that coupling
  must be explicit in the spec.
- Group cost note: with §3's recommendation, the server stores deliveries for DMs only; group
  markers (if any client sends them) are ignored or rejected (prefer 404/400 per the "unknown and
  invisible answer alike" rule — exact code TBD in spec).

Audit/detail hygiene: delivery rows and logs carry ids only (chat JID, origin id, user id) — never
message text — following the existing rule (`delivery.ts:43-47`, `handleIncomingPush` logs ids
only, `delivery.ts:52-98`).

## 7. Privacy: can a user turn off delivered or read receipts?

Today there is **no verified user-facing toggle** for read receipts: the only "Read receipts" string
in the apps is a component-fixture label (`apps/web/src/components/ui/switch.fixture.tsx:29`), not
a setting. `MessageMeta`/ticks render unconditionally (§1.3), and `markDisplayed` fires whenever the
chat is open (§1.2).

**Recommendation: ship one privacy toggle that covers both delivered and read receipts ("Send read
receipts", default on), not two toggles.** Rationale: with §5's "read implies delivered", disabling
only delivered while keeping read is incoherent (every seen message would jump sent → seen, and the
sender still learns arrival from reads); disabling only read while keeping delivered leaks strictly
less but doubles the settings surface for a distinction few users want. One toggle: off means the
client sends neither displayed markers nor delivery confirmations (push-wake confirmations
included). Note the asymmetry to document: turning receipts off hides *your* states from others; you
still see theirs. Final shape (one toggle vs two, default on vs off) is **Julio's call**.

## 8. UI: icons for sent, delivered and seen

Today on both apps sent = single tick, seen = double tick: web `MessageTicks`
(`apps/web/src/components/MessageTicks.tsx:4-15`) and mobile `Ticks`
(`apps/mobile/src/components/chat/ticks.tsx:13-27`) both render `Check` for `sent` and `CheckCheck`
for `read`, both from lucide (`lucide-react` / `lucide-react-native` — no emoji, per project
rules). Times render beside the ticks in `MessageMeta` (web, `MessageMeta.tsx:29-42`) and
`BubbleInlineMeta` (mobile, `message-bubble-content.tsx:51-89`).

Proposal (both apps, same mapping):

| state | icon | color | aria / label |
|---|---|---|---|
| sending | `Clock` (unchanged) | current muted | "Sending" |
| sent | single `Check` (unchanged) | muted grey | "Sent" |
| delivered | double `CheckCheck` (unchanged shape) | muted grey | "Delivered" |
| seen | double `CheckCheck` | accent | "Seen" |
| failed | `CircleAlert` (unchanged) | danger | "Not sent" |

So delivered = two grey ticks, seen = two accent ticks — the standard messenger mapping, and the
smallest possible diff: each tick component gains one branch (`status === 'delivered'` → grey
`CheckCheck`; `read` → accent `CheckCheck`). Mobile note: the chat-list rows pass an explicit color
(`chat-list-item.tsx:146`, `topic-row.tsx:165` use `#ededed` for read else `MUTED_FOREGROUND`) —
extend that ternary to three states rather than adding a new color prop. Pitfall: per AGENTS.md,
never swap a gradient style on a live view — ticks are plain icons, not gradients, so no `key`
dance is needed; still, keep the change to one branch per file, no reordering (same rule as
registry files). Accessibility labels ("Sent"/"Delivered"/"Read") follow the existing `aria-label`
pattern (`MessageTicks.tsx:6-14`); mobile `Ticks` has no labels today — add none (out of scope).

## 9. Task split (in order; files and tests per task)

Message-pipeline tests only, per project test rules (no UI tests; `incoming.test.ts`,
`ledger.test.ts`, `delivery.test.ts` patterns exist).

1. **Shared status + ladder** — add `'delivered'` to `MessageStatus`
   (`packages/chat-core/src/types.ts:7`), rank it between `sent` and `read` in `STATUS_RANK` /
   `advanceStatus` (`packages/client-core/src/store/rows.ts:50-62`). Tests: extend the
   `advanceStatus` cases — receipt-before-ack ends `delivered`, `read` after `delivered` ends
   `read`, `sent` after `delivered` stays `delivered`. No UI change in this task. (Unblocks 2–5.)
2. **Receiver confirmations (DM, connected clients)** — send a delivery confirmation where displayed
   markers are sent today: live incoming in an open visible chat (`incoming.ts:188-194`), history
   pages (`history.ts:304-313`), `clearActiveChatRead` (`polling.ts:65-83`), plus a `markDelivered`
   core operation mirroring `markDisplayedEffect` (`core-effect/operations.ts:261-267`,
   `build-outgoing.ts:222-232`, `decode.ts:170-186`, router + `handleDisplayed`-style handler in
   `incoming.ts:221-231`) — or HTTP-only if the spec chooses §2's pure-(B) shape. DM-only per §3.
   Tests: handler sets `delivered`, ignores own reflections, never downgrades `read`; alias
   matching via `sameMessage` (mirror `incoming.test.ts` displayed cases).
3. **Server storage + sender fan-out** — migration + `PUT …/delivered` endpoint + online push /
   on-reconnect sync (`apps/server/src/chats/reads.ts` pattern, `archive-scan.ts` origin-id reads,
   T-1205/T-1207 catch-up hooks). Tests: forward-only write, 404-parity for unknown/invisible
   chats, rate-limit/cap (follow `chats/reads.test.ts` and push `delivery.test.ts` patterns).
   Parallel with 2 after 1 (different packages; agree the wire id = origin id, §4).
4. **Push-wake + catch-up confirmations** — background-task HTTP confirmation after a successful
   preview (`apps/mobile/src/lib/push/background.ts:110-137`, privacy guard per §2), and bulk
   confirmation after MAM catch-up (T-1207 path). Tests: wake posts confirmation only on shown
   preview (not on generic fallback or 404); catch-up sends one bulk call. Needs 3 (the endpoint).
5. **Ticks UI (web + mobile)** — the §8 branch in `MessageTicks.tsx`, `ticks.tsx`, and the list-row
   color ternaries (`chat-list-item.tsx:146`, `topic-row.tsx:165`, web `ChatListItem.tsx:166`).
   No tests (UI code gets none; lead's phone smoke covers it). Needs 1; parallel with 3–4.
6. **Receipts privacy toggle** (needs Julio's §7 decision first) — setting + gating of displayed
   markers and all delivery confirmations. Tests: toggle off sends neither marker nor confirmation.
   Last, or deferred past the milestone.

## Open questions for the lead / Julio

- §3 group semantics and §7 toggle shape (one vs two, default) — Julio's call.
- Server→sender live channel for delivery events: reuse the T-1205/T-1207 sync or a new push —
  spec task to decide (**unverified** current options, §6).
- Whether ejabberd needs any config so the new client→server markers are not archived as message
  rows (displayed markers presumably already avoid this — **unverified** how).
