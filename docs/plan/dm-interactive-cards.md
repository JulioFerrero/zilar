# Interactive cards in an AI's DM (plan)

T-1809, 2026-10-17. **Plan only: no source file changed.** Every claim cites
`file:line`. Related: `docs/plan/message-blocks.md` (cards in rooms),
`docs/plan/routine-live-message.md` (ids and corrections).

Recommendation in one line: **record a DM card under the origin id the gateway
already gets from the send, and have both clients send that origin id for a DM
card** (no schema change, no route change, no archive read).

## 1. The map

### (a) How a DM card is posted

- `post_blocks` is offered on DM turns since T-1800 — `buildTools` appends
  `POST_BLOCKS_TOOL_DEF` (`apps/server/src/agents/tools/definitions.ts:318-336`).
- The executor hands the runner the owner's JID and `kind: 'chat'`, never the
  model's arguments (`apps/server/src/agents/gateway/tool-exec.ts:215-226`).
- The runner sends the card through `liveSendMessage` and keeps the returned id
  (`apps/server/src/agents/gateway/post-blocks.ts:50-62`). That id is the one
  `sendMessage` generated (`packages/xmpp-core/src/core-effect/operations.ts:136-144`).
- `buildMessage` writes the same id twice: the stanza `id` and the
  `<origin-id/>` (XEP-0359) — `packages/xmpp-core/src/stanza/build-outgoing.ts:145,147`.
- **A DM card is not recorded.** The guard skips `recordPosted` when
  `kind === 'chat'` (`apps/server/src/agents/gateway/post-blocks.ts:131-136`).
  `recordPosted` would write the origin id, AI id, room JID and card data
  (`:66-84`).

### (b) Which id the owner's client has

- The owner's client decodes every message into a `ChatMessage`; its `id` is
  the `<stanza-id by=me>` (the owner's archive id) when present, else the
  stanza id (`packages/xmpp-core/src/stanza/resolve-sender.ts:116-131`,
  `packages/xmpp-core/src/stanza/decode.ts:107`). The sender-generated id is
  kept separately as `originId` (`decode.ts:115-116`,
  `packages/xmpp-core/src/stanza/parse-fields.ts:189-196`).
- A DM has **no room reflection**. The AI's own message is not echoed back to
  the sending resource; MUC reflections are what the rekey handles
  (`apps/server/src/agents/gateway/group-ingest.ts:111-125`,
  `apps/server/src/agents/gateway/card-rekey.ts:18-49`). A carbon reaches only
  the account's other resources and its stanza-id is `by=<ai>`, not
  `by=<owner>` (`resolve-sender.ts:125-130`).
- Therefore **the server can match a DM card only by the origin id it chose**.
  It never learns the owner's archive id that the owner's client quotes.

### (c) How an answer is sent and stored today

- Web: the rendered message has only `id` (there is no `originId` on `UiMessage`
  today — `packages/chat-core/src/types.ts:68-114`), so the respond target is
  built with `messageId: message.id`
  (`apps/web/src/components/message/AttachmentBody.tsx:78-100`, the field at
  `:83`), and the card posts it as-is
  (`apps/web/src/components/message/blocks/BlockCard.tsx:113-118`) through
  `respondToBlock` (`apps/web/src/lib/api/blocks.ts:16-27`).
- Server: `findCard` accepts the origin id **or** the stanza id
  (`apps/server/src/message-blocks/cards.ts:83-94`); access is decided in
  `requireCardAccess` (`apps/server/src/message-blocks/respond.ts:64-88`); the
  answer is stored, merged, saved and corrected (`:239-280`).
- Phone: **no interactive card at all.** `BlockCard` draws only the static
  kinds (`apps/mobile/src/components/chat/blocks/block-card.tsx:105-144`), and
  `PayloadCard` passes it only `data` (`apps/mobile/src/components/chat/payload-card.tsx:41-52`).

### (d) How the correction works today

- `respondToCard` calls `correctInRoom` with `originalId: card.originId`
  (`apps/server/src/message-blocks/respond.ts:210-237`, args at `:221-227`).
- The live gateway **refuses any correction outside a joined room** and always
  sends `groupchat` (`apps/server/src/agents/gateway/live.ts:339-363`).
- `sendCorrection` itself supports both kinds; it only needs the id
  (`packages/xmpp-core/src/core-effect/operations.ts:178-196`,
  `packages/xmpp-core/src/stanza/build-outgoing.ts:152-165`).
- DM progress cards already correct by origin id (`live.ts:133-135,178-179`,
  `apps/server/src/agents/gateway/dm-turn-input.ts:92-98`), so the wire and the
  clients can do it — the card path just never uses it.
- Clients apply a correction's payload only for `progress`
  (`packages/client-core/src/store/ledger-edits.ts:72-89`); a `blocks`
  correction is currently dropped, and the card is not replaced.

### (e) Do question cards already work in DMs?

No. `ask_people` is only built for group turns
(`apps/server/src/agents/tools/definitions.ts:340-349`), its runner requires a
group and topic (`apps/server/src/agents/gateway/ask-people.ts:29-33,55-62`),
and its rekey runs only on room reflections
(`apps/server/src/agents/gateway/question-answer.ts:24-46`). There is no DM
precedent to copy.

## 2. The id problem and the options

The card row is written **before** the owner's server assigns anything, and the
gateway returns the id it generated. In a room the reflection later rekeys the
row (`card-rekey.ts:18-49`); in a DM there is no reflection, so the row keeps
the origin id while the client holds the owner's archive id.

### Option A — record under the origin id; DM clients send that id (recommended)

- Remove the `kind === 'chat'` guard and record every posted card
  (`post-blocks.ts:131-136`). The row already stores `groupId`/`topicId` null
  for a DM (`:73-80`; nullable in
  `apps/server/drizzle/0071_block-cards.sql:1-12`).
- On a DM, the client sends the message's **origin id** as `messageId`. The
  route already matches it (`cards.ts:83-94`), so nothing else changes.
- The value exists on both clients and is already the id they name when they
  correct or retract a DM message
  (`packages/client-core/src/store/ledger-ids.ts:237-251`) — the same id the
  progress-card corrections in a DM use (`live.ts:133-135`). Web/phone only
  need it on the rendered message: add `originId?: string` to `UiMessage`
  (`packages/chat-core/src/types.ts:68-114`), set from `ChatMessage.originId`
  in `toUiMessage` (`packages/client-core/src/store/ledger-incoming.ts:126-141`).
- No migration, no contract change, no archive read, no race. An old client
  keeps sending the archive id and gets the same 404 it gets today
  (`respond.ts:42-44`), so shipping the server first is safe.

**Variant A′:** add an optional `originId` to `BlocksRespondPayload` and let the
server try it before `messageId`. Clearer log lines, but a contract + two client
+ server change for the same result. Not recommended for this task.

### Option B — learn the owner's archive id back

The server can reach ejabberd's `archive` table (precedent:
`apps/server/src/chats/deliveries.ts:60-94`, which maps `origin_id` to
`timestamp`). Two shapes:

- **B1, after the send:** poll `archive` for the owner's row with that
  `origin_id` and store the `timestamp` in `block_cards.stanza_id`
  (`cards.ts:63-79`). The row is written asynchronously, so this needs retries
  like `card-rekey.ts:16,29-44`, and the archive pool is optional in the
  gateway (`apps/server/src/agents/gateway/contracts.ts:76-77`). If it is
  absent, DM cards silently stay unanswerable.
- **B2, at answer time:** reverse the lookup — `timestamp` (the id the client
  sent) to `origin_id`, scoped by the owner's localpart and the AI's bare peer
  (`deliveries.ts:71-89`). One query per answer, same archive dependency, plus
  a user-id-to-localpart mapping.

Rejected: it couples every DM card answer to the chat archive being on, adds a
race (B1) or a query on the tap path (B2), and buys nothing over Option A.

### Option C — match by sender + time + block id

Rejected: two cards can share a sender and a minute, ids would be guessable,
and a wrong match writes an answer onto another card.

### Recommendation

**Option A.** It is the only approach that is deterministic at post time, needs
no new storage or archive access, and uses the id clients already keep for
every DM edit. The server records under the id it returns from the send; the
client sends that same id for a DM card.

## 3. Access: only the owner may answer a DM card

- A DM card is the row with **both** `group_id` and `topic_id` null and
  `room_jid` equal to the owner's JID (`post-blocks.ts:73-80`,
  `tool-exec.ts:220-226`; the columns are nullable in
  `apps/server/drizzle/0071_block-cards.sql:6-7`).
  The group and topic paths always set their id, so the shape is unambiguous.
- The check belongs in `requireCardAccess`
  (`apps/server/src/message-blocks/respond.ts:64-88`), after the topic branch
  (`:69-83`) and the group branch (`:84-86`): when both ids are null, load the
  card's AI owner and allow only `userId === ownerId`.
- Owner lookup: the row's `ai_id` points at `ais`, whose `owner` is the user id
  (the query in `apps/server/src/agents/gateway/db.ts:184-193`). Keep the
  layering: add a private `loadAiOwnerId` next to `loadNameLookup`
  (`respond.ts:171-189`), which already runs SQL in this file.
- Anything else answers the same `404 card_not_found` as a missing card
  (`respond.ts:42-44,87`), so ids cannot be probed.
- The AI is the DM's other party but never calls the route: it answers through
  the correction (§4). No other user, group member or admin is admitted.
- No new route and no new limit: the existing per-user cap still applies
  (`apps/server/src/message-blocks/api.ts:25-26,85-93`).

## 4. The correction: a `chat` correction to the owner

- `correctInRoomEffect` must choose the channel instead of requiring a room
  (`live.ts:339-363`): if `session.rooms.has(roomJid)`, keep `groupchat`; else
  resolve the owner's JID the way `postToChatEffect` does
  (`live.ts:294-301`), require the requested `roomJid` to equal it, and send
  `sendCorrection(ownerJid, 'chat', originalId, text, { payload })`.
- Resolving the owner inside the gateway (not trusting the caller) keeps a bad
  DB row or a future caller from sending a chat correction to a stranger. A
  stopped or offline AI still answers `false`
  (`live.ts:346-352`; best-effort path in `respond.ts:207-237`).
- XEP-0308 names the **origin id**; that is exactly `card.originId`
  (`respond.ts:221-227`) and what `buildCorrection` puts in `<replace/>`
  (`build-outgoing.ts:152-165`). Clients already resolve a DM correction's
  target by origin id (`ledger-ids.ts:237-240`), so the stanza lands.
- The clients must learn one more payload kind: widen `cardEditFor` to accept
  `blocks` as well as `progress`
  (`packages/client-core/src/store/ledger-edits.ts:72-89`). The body rule
  (`:37-59`) is satisfied because the correction sends `data.fallback`
  (`respond.ts:221-227`). Then `withEdits` swaps the card
  (`ledger-edits.ts:180-188,288-300`) and `BlockCard` resets its local state
  (`apps/web/src/components/message/blocks/BlockCard.tsx:88-96`).
- Both apps share that store (`apps/mobile/src/store/real-store.ts:1-20`), so
  one change makes the corrected card render on web and phone; phone still
  needs its own controls (§7 task 7).
- No `edited` marker work is needed on the card: the correction's text is the
  fallback and the card shows the merged data.

## 5. The answer path for the decision kinds

- Buttons, choice, form and rating send a normal `@AI` reply today after the
  route call (`apps/web/src/components/message/blocks/ButtonsBlock.tsx:56`,
  `ChoiceBlock.tsx:52`, `FormBlock.tsx:74`, `RatingBlock.tsx:45`, wired by
  `BlockRespond.tsx:36-38`); the text is built in
  `AttachmentBody.tsx:87-99` (`@name` prefix + mention).
- A DM needs no mention: every non-outgoing `chat` stanza from the owner is
  queued for the DM turn, with no mention check
  (`apps/server/src/agents/gateway.ts:262-296`, push at `:295-296`).
- Web change: in that `reply`, branch on `chat.kind === 'dm'` — send the plain
  text with the same `replyTo`, drop the `@name` prefix and the `mentions`
  array. Rooms keep the mention (it is how a room turn wakes,
  `group-ingest.ts` mention gate). Nothing else about the tap changes.
- Checklist and poll taps send no reply today (no `reply(` call in those
  blocks), so in a DM they record and correct only. Keep that: ticking an item
  should not start a model turn.
- The route, its payload and its rate limit are unchanged
  (`api.ts:25-26,85-93`).

## 6. What does not change, and why there is no schema task

- **No migration.** `block_cards` already keys the row by `origin_id`, has a
  unique `stanza_id`, and allows null `group_id`/`topic_id`
  (`apps/server/drizzle/0071_block-cards.sql:1-12`); `block_responses`
  already stores the owner as `actor_id` (`:13-22`).
- **No api-contract change** under Option A.
- **Group behaviour is untouched**: posting, rekey, access and correction keep
  their current paths (`post-blocks.ts:133-136`, `card-rekey.ts`,
  `respond.ts:69-86`, `live.ts:350-361`). The new DM branch is additive.

## 7. Ordered tasks

Each task names its files and one acceptance line. Tasks 1-3 can ship alone
(old clients are unaffected); 4-5 unblock 6-7.

1. **[server] Record a DM card.** `apps/server/src/agents/gateway/post-blocks.ts:131-136`
   (drop the `kind === 'chat'` guard; keep the best-effort `recordPosted`),
   `apps/server/src/agents/gateway/post-blocks.test.ts:157-180` (the "records
   nothing" case becomes "records under the sent origin id with no group or
   topic").
   *Acceptance: a `kind: 'chat'` post writes one `block_cards` row keyed by the
   id the send returned, with null group/topic and the owner's JID.*

2. **[server] Owner-only access.** `apps/server/src/message-blocks/respond.ts:64-88`
   plus a private `loadAiOwnerId` beside `:171-189`;
   `apps/server/src/message-blocks/respond.test.ts` (DM fixtures: owner 200,
   another user 404, unknown id 404).
   *Acceptance: the AI's owner gets the merged card; every other caller gets
   the same 404 as a missing card.*

3. **[server] Correct a DM card as `chat`.** `apps/server/src/agents/gateway/live.ts:339-363`
   (channel by room membership, else owner JID equality, per §4) and a gateway
   test using `apps/server/src/agents/gateway.test-harness.ts` (new
   `apps/server/src/agents/gateway-dm-correction.test.ts`) asserting
   `sendCorrection(ownerJid, 'chat', originId, …)`; group case still
   `groupchat`.
   *Acceptance: answering a DM card sends one `chat` correction naming the card
   origin id, and group corrections are unchanged.*

4. **[shared] Put the origin id on the rendered message.**
   `packages/chat-core/src/types.ts:68-114` (optional `originId`),
   `packages/client-core/src/store/ledger-incoming.ts:126-158` (set it from
   `ChatMessage.originId`), plus a `ledger-incoming` test.
   *Acceptance: a live and a history DM message both carry `originId` equal to
   the stanza's `<origin-id/>`, and a group message is unchanged.*

5. **[shared] Apply a `blocks` correction.** `packages/client-core/src/store/ledger-edits.ts:72-89`
   (accept `payload.type === 'blocks'`), a store test that a blocks correction
   replaces `message.card` and an older/foreign one is ignored.
   *Acceptance: the corrected card replaces the drawn card in a DM and a group,
   with the same author and order checks as `progress`.*

6. **[web] Answer a DM card with its origin id and a plain reply.**
   `apps/web/src/components/message/AttachmentBody.tsx:78-100` (send
   `message.originId` when `chat.kind === 'dm'`, else `message.id`; plain
   `text` reply in a DM), `apps/web/src/components/message/blocks/BlockRespond.tsx:31-38`
   (document the DM reply).
   *Acceptance: a checklist tap in a DM updates the card and a button tap sends
   one message with no `@` prefix or mention; group behaviour is unchanged.*

7. **[phone] Answer cards on the phone.** New
   `apps/mobile/src/lib/blocks-api.ts` (the `message-blocks.respond` call, like
   `apps/web/src/lib/api/blocks.ts:16-27`, over
   `apps/mobile/src/lib/effect/api-client.ts`); render the interactive kinds in
   `apps/mobile/src/components/chat/blocks/block-card.tsx:105-144` (new
   `apps/mobile/src/components/chat/blocks/choice-blocks.tsx` for
   checklist/poll/choice/rating/buttons/form); pass message, chat kind and
   origin id through `apps/mobile/src/components/chat/payload-card.tsx:41-52`
   and `apps/mobile/src/components/chat/message-bubble-content.tsx:189-200`.
   *Acceptance: tapping a checklist item or a choice on the phone updates the
   card through the route, sends the DM origin id, and sends a decision reply
   with no mention in a DM and with the mention in a room.*

## 8. Open question for Julio

1. **Phone scope.** Task 7 covers all six interactive kinds at once; a
   checklist/choice-only first cut would ship sooner. Which do you want?
