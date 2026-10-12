# Message features and client UI state audit (2026-10-11)

Scope: edits, deletes, reactions, replies, forwarding, mentions, pins, media, voice, stickers,
drafts, AI drafts, chat list, search, account switch, mock vs real, web vs mobile parity. Code
read at `32fa1f0d8`; nothing was run. Out of scope here: everything in
`docs/audit/message-pipeline-audit.md` (MP-1..MP-13) and today's fixes T-1145, T-1147,
T-1148, T-1149.

Severity: P0 data loss or wrong person/chat; P1 wrong state users notice; P2 polish.
"confirmed" = traced in code; "suspected" = needs the runtime check named.

## 1. Summary

No P0 found: nothing shows a message in the wrong chat or loses a sent message beyond MP-4.

- UI-1 P1 both, confirmed: a reply names the replier's local bubble id on the wire, and the
  receiver matches it by exact id. In a DM the two sides store the same message under different
  ids, so the quote on the other device is empty ("Reply to" with no name or text).
- UI-2 P1 both, confirmed: `openHistory` sends a XEP-0333 displayed marker and clears unread
  for the chat it loaded, even when the user already left it or the app is hidden. `closeChat`
  never clears `pendingOpenChatId`, so a chat opened while offline is marked "seen" on the next
  reconnect while the user is on the list. One concrete source of the false "seen".
- UI-3 P1 both, confirmed: a reply I send from my other device (carbon echo) moves the chat to
  the top but leaves its unread badge, so a chat I just answered on the phone stays unread on
  the web until I open it.
- UI-4 P1 both, confirmed: any `unavailable` presence stamps `lastSeenAt = now` ("last seen just
  now"), and the 60 s chat-list refresh drops the field, so the DM header flips between a wrong
  "last seen" and nothing every minute.
- UI-5..UI-15 P2: typing line shows one name per group; quotes have no fallback text; edit,
  react and delete silently no-op on an unacked bubble; composer text is lost on chat switch
  on both apps; "seen" is never sent when the first page fails; a new chat jumps top then
  bottom; web account switch skips `ledger.reset()`; a failed sticker keeps the sending clock;
  pins refresh only every 60 s.

## 2. Findings by feature

### A. Replies and quotes

**UI-1 P1 both, confirmed.** Symptom: in a DM, B replies to A's message; on A's screen (and on
A's own second device) the reply bubble shows an empty quote. Evidence:

- The quote is built from the bubble id: `packages/chat-core/src/chat-labels.ts:66-73`
  (`id: message.id`); web `apps/web/src/routes/ChatView.tsx:103`, mobile
  `apps/mobile/src/components/chat/use-chat-screen.ts:175`.
- The id goes on the wire unchanged: `packages/client-core/src/store/send/text.ts:48`
  (`replyTo: { id: replyTo.id }`); `packages/xmpp-core/src/stanza/build-outgoing.ts:76-84`
  sends only `<reply id/>`, no fallback body.
- The stored id of an incoming DM message is the stanza-id of the *receiver's* archive:
  `packages/xmpp-core/src/stanza/resolve-sender.ts:123-132`. The sender knows the same message
  under its own archive's stanza-id (or `local-N` while no echo replaced it,
  `packages/client-core/src/store/incoming.ts:73-80`). Only `aliasRoot` (the origin id,
  `ledger-incoming.ts:87-89`) is common to both sides; `wireTargetFor`
  (`packages/client-core/src/store/ledger-ids.ts:145-152`) already computes it for reactions
  but the reply path does not use it.
- The receiver resolves the quote by exact id only:
  `packages/client-core/src/store/ledger-incoming.ts:107-117` (`item.id === message.replyTo?.id`).
  `withReplyQuote` (`ledger-edits.ts:199-219`) is alias-aware but runs only when the chat has
  edits (`refreshEdits` early return, `ledger-edits.ts:226-231`).

Groups work because the room stanza-id is the same on every side. Repro: web DM, reply to the
peer's last message; look at the peer's screen. Fix: in `send/text.ts:48`, `send/attachment.ts`,
`send/voice.ts`, `send/sticker.ts` put `wireTargetFor(replyTo.id) ?? replyTo.id` on the wire and
key the echo signature with the same id (`incoming.ts:43-48`); in `ledger-incoming.ts:109-111`
find the referenced message with `sameMessage`; carry `senderName`/`text` in the optimistic
`ReplyRef` so the sender's own bubble is unchanged. One test in
`packages/client-core/src/store/incoming.test.ts` (reply to a DM message stored under a
different id resolves its quote).

**UI-6 P2 both, confirmed.** A reply to a message older than the loaded page (or not loaded
yet) shows an empty quote for good: `ledger-incoming.ts:109-117` only searches
`messagesByChat`, and the stanza carries no XEP-0461 fallback text (`build-outgoing.ts:76-84`).
Fix with UI-1: add the fallback `<body>` quote per XEP-0461 and read it on decode; or at least
re-run `withReplyQuote` whenever an older page loads (`history.ts:148`).

### B. Read state and "seen"

**UI-2 P1 both, confirmed.** Symptom: the sender sees "seen" while the recipient is on the chat
list, or has the phone in a pocket. Evidence: `packages/client-core/src/store/history.ts:279-283`
(`recordRead` + `markDisplayed` of the newest page message, no check of `activeChatId` or
`isVisible`). The open is deferred when the core is not online: web
`apps/web/src/store/effects/history.ts:51` and mobile
`apps/mobile/src/store/effects/history.ts:380` set `pendingOpenChatId`; `closeChat` only clears
`activeChatId` (web `apps/web/src/store/effects/chatActions.ts:128-132`, mobile
`apps/mobile/src/store/real-store.ts:287-291`); `flushPending` runs it on the next chat merge or
(re)connect (`history.ts:204-215`). The incoming path already guards correctly
(`incoming.ts:133-134`). Repro: airplane mode, open chat A, go back to the list, restore
network; A's peer sees "seen". Fix: `history.ts:279-283` mark only when
`ctx.get().activeChatId === chatId && ctx.ports.isVisible()`; `closeChat` on both apps clears
`pendingOpenChatId` when it names that chat (and drops its `loading` marker via
`clearSupersededMarker`). One test in `history.test.ts` (page arrives after close: no marker).

**UI-3 P1 both, confirmed.** Symptom: I answer a chat from the phone; the web keeps its unread
badge (and the app badge) until I open the chat there. Evidence: the carbon of my own message
takes `handleOutgoingEcho` (`incoming.ts:40-98`): `moveChatToTop` + `lastMessage`, never
`unread: 0` or `recordRead`. Telegram clears unread on an outgoing message from any device.
Fix: in `handleOutgoingEcho`, when `localId === undefined` (not a bubble of this device) call
`recordRead(ctx, chatId, ui.id)` (no displayed marker). Sub-case of MP-6; this part needs no
server work. Test in `incoming.test.ts`.

**UI-9 P2 both, confirmed.** `openChat` clears unread at once (web history.ts:46, mobile
history.ts:365) but the displayed marker goes only after the first page loads
(`history.ts:279-283`); when that load fails (`:287`, state `error`) the sender never gets
"seen" even though the chat is open and the live messages are on screen. Also `loadPreview`
seeds `lastRead` with the newest preview for a chat never opened on this device
(`history.ts:185-188`), so the first open shows no unread divider. Fix: on the `error` branch
mark the newest live message if the chat is active; do not seed `lastRead` from the preview.

**UI-10 P2 web, suspected.** `isRead` uses `ports.isVisible()` (`incoming.ts:133`), which on web
is page visibility, not focus: a visible but unfocused window (second monitor) marks every
incoming message "seen" while nobody reads. Check:
`apps/web/src/store/effects/portAdapters.ts` `isVisible` against `document.hasFocus()`; repro by
putting the tab on a second screen and sending from the phone.

**UI-11 P2 mobile, suspected.** `use-chat-screen.ts:96-106` opens on mount and closes on
unmount only. A screen pushed over the chat (group info, profile, settings) keeps the chat
mounted, so `activeChatId` stays and messages arriving meanwhile are marked read and "seen"
(`incoming.ts:133-134`, AppState is still `active`). Check: open a chat, push the group info,
receive a message, look at the sender's ticks. Fix: `useFocusEffect` from expo-router to
open/close on focus/blur.

### C. Presence and typing

**UI-4 P1 both, confirmed.** Symptom: DM header says "last seen just now" for a contact who has
been away for days; a minute later it says nothing; then "just now" again after a reload.
Evidence: `incoming.ts:243-254` stamps `lastSeenAt: now()` on every `available: false`;
`packages/xmpp-core/src/stanza/parse-presence.ts:38-46` ignores any `<delay/>` stamp; the label is
`packages/chat-core/src/chat-labels.ts:42-43`; the 60 s refresh rebuilds rows and keeps only
`lastMessage`, `unread`, `online`, `onlineCount` (web `apps/web/src/store/effects/history.ts:118-127`,
mobile `apps/mobile/src/store/effects/history.ts:185-194`), so `lastSeenAt` is dropped every
tick. The connect-time burst is suspected (check: ejabberd answers the initial probes of offline
contacts with `unavailable`; open a DM with an offline contact right after a reload). Fix: parse
`<delay stamp>` on unavailable presence and use it; without a stamp keep the previous value
(set `now` only on a transition from `online: true`); keep `lastSeenAt` in both merges. No test
(not pipeline).

**UI-5 P2 both, confirmed.** `handleTyping` replaces `typing[chatId]` with the one latest name
(`incoming.ts:199`) and one timer per chat (`:201-205`), so in a group two typers show as one,
and A's `paused` clears B's line (`:207-210`). Fix: key the names and timers by sender inside the
chat entry; render "A and B are typing".

### D. Edits, deletes, reactions

Design checked and sound: alias roots (`ledger-ids.ts:32-59`), correction target = origin id
(`:182-185`), group retraction = room stanza-id (`:189-196`), pending edits until the target
loads (`chat-core/src/edits.ts:155-188`), author check (`:113-129`), optimistic apply and
rollback with `actionError` (`actions.ts:54-173`). No id mismatch found for edits or reactions.

**UI-7 P2 both, suspected.** React, edit and delete return silently when the bubble has no wire
id yet (`actions.ts:32-37`, `:72-76`, `:140-144`): a tap on a still-sending or offline-queued
message does nothing and the menu gives no reason. Check: go offline, send a text, long-press
it, tap a reaction. Fix: hide or disable those items while `wireTargetFor(id)` is undefined
(web `MessageActionsMenu.tsx`, mobile `message-actions-sheet.tsx`); expose a `canReact`
selector in chat-core beside `canEditMessage`.

**UI-14 P2 both, confirmed.** A failed sticker is flagged `failed: true` but keeps
`status: 'sending'` (`ledger-mutators.ts:161-163`), unlike attachments and voice which go to
`status: 'failed'` (`:99-105`); ticks keep the clock and selection treats it as sending
(`apps/web/src/components/MessageBubble.tsx:98`). Fix: `markStickerFailed` → `markSendFailed`
with reason `network`; `retrySticker` then goes through `markSendRetrying`.

### E. Composer drafts and AI drafts

**UI-8 P2 both, confirmed.** Typed text is lost when switching chats: `ChatView` is keyed by
chat (`apps/web/src/routes/ChatShell.tsx:58`) so `Composer`'s `useState('')`
(`apps/web/src/components/Composer.tsx:26`) remounts; the comment at `Composer.tsx:70-72` ("the
draft text itself stays") no longer holds. Mobile keeps `text` in the screen
(`apps/mobile/src/components/chat/composer.tsx:93`), gone on back. There is no per-chat draft
store; the `drafts` state (`client-core/src/store/polling.ts:197-209`) is only the AI's live
reply. Telegram keeps a draft per chat and shows "Draft:" in the list. Fix: a small
`composerDrafts` record in each app store (web `localStorage`, mobile AsyncStorage, keyed by
user + chat), restore on mount, clear on send; list preview shows "Draft: …" when set.

AI drafts: the turn bookkeeping is correct (`polling.ts:134-209`, `incoming.ts:136-163`); a
draft dropped by the 5 s fallback when XMPP is down is the MP-5 catch-up gap, not a UI bug.

### F. Chat list

**UI-12 P2 both, confirmed.** A chat that first appears in a refresh goes to the top without a
preview (`[...fresh, ...sortByRecency(kept)]`, web history.ts:129, mobile history.ts:198-199),
and on the next tick `sortByRecency` sinks it to the bottom (`rows.ts:8-14`, no `lastMessage` =
`-Infinity`). Fix: load its preview on discovery (`loadPreview`) before inserting, or insert it
by `sortByRecency` from the start; folds into MP-5's preview work.

Ordering, pinned, archived and folders were checked: web `chatGroups.ts:35-104`, mobile
`apps/mobile/src/lib/chat-list.ts:34-76`; both pin-first then recency; archived singles hidden on
both; muted excluded from the badge (`apps/web/src/store/effects/badge.ts:9`). No bug found.

**UI-15 P2 both, confirmed (design).** Pins refresh only every 60 s or on focus
(`polling.ts:16-17`, `:107-120`); a pin made on another device or by another member is up to a
minute late, and a pin while the tab is hidden waits for focus. Fix later: a pin stanza or a
`/api/chats` change marker; not urgent.

### G. Account switch

**UI-13 P2 web, confirmed.** `resetUserState` clears `messageAuthors`, `messageOriginIds`,
`messageBaseTexts` by hand (`apps/web/src/store/effects/lifecycle.ts:92-96`) but not the alias
and server-id maps; the ledger's own `reset()` (`packages/client-core/src/store/ledger.ts:72-74`)
is never called on web, while mobile calls it (`apps/mobile/src/store/effects/user-state.ts:110`).
Impact today is memory and stale alias chains, because the `local-N` sequence is not reset on
web. Fix: call `ledger.reset()` from `resetUserState` and drop the three manual clears.

### H. Media, voice, forward, mentions, search, mock

Checked without findings: attachment failure and retry are consistent
(`send/attachment.ts:38-41`, `:85-96`, `:143-169`); forwarding covers text, cards, attachments
and voice (`packages/chat-core/src/store/ledger.ts:10-23`) and skips sending/failed/deleted
(`send/forward.ts:120-128`); mentions map by range (`ledger-incoming.ts:56-73`); search hits
carry the archive `origin_id` (`apps/server/src/search/archive-query.ts:48`) which `openAtMessage`
matches alias-aware (`history.ts:314-315`). Mock mode: mobile runs every API and the fake XMPP on
one shared backend (`apps/mobile/src/store/chat-store-provider.tsx:56-83`); web mocks XMPP and
has a separate optional HTTP layer (`apps/web/src/mock/gate.ts:99-107`). Divergence is in the
fixtures, not the store code; no finding.

## 3. Parity table

| Feature                      | Web                         | Mobile                      |
| ---------------------------- | --------------------------- | --------------------------- |
| Edit / delete for everyone   | works                       | works                       |
| Reactions                    | works (UI-7 silent no-op)   | works (UI-7)                |
| Replies / quotes             | broken in DMs (UI-1, UI-6)  | broken in DMs (UI-1, UI-6)  |
| Forward (text/media/voice)   | works                       | works                       |
| Mentions                     | works                       | works                       |
| Pins                         | works, 60 s poll (UI-15)    | works, 60 s poll (UI-15)    |
| Shared media panel           | works (`ChatMediaPanel`)    | missing                     |
| Attachments, progress, retry | works                       | works                       |
| Voice notes                  | works                       | works                       |
| Stickers + pack editor       | works (UI-14 status)        | works (UI-14 status)        |
| GIFs                         | works                       | works                       |
| Composer draft per chat      | missing (UI-8)              | missing (UI-8)              |
| AI "writing…" draft          | works                       | works                       |
| Chat list order/pin/archive  | works (UI-12 jump)          | works (UI-12 jump)          |
| Folders                      | works                       | works                       |
| Typing line                  | one name (UI-5)             | one name (UI-5)             |
| "Last seen"                  | wrong (UI-4)                | wrong (UI-4)                |
| Unread after other-device reply | stale (UI-3)             | stale (UI-3)                |
| "Seen" marker                | false positives (UI-2, 10)  | false positives (UI-2, 11)  |
| Message / chat search        | works                       | works                       |
| Account switch               | works (UI-13 hygiene)       | works                       |

## 4. Fix plan

Ordered by impact, then size. Tests only where the message pipeline is touched.

1. **F1 Reply ids (UI-1, UI-6).** `packages/client-core/src/store/send/{text,attachment,voice,sticker}.ts`
   put `wireTargetFor` on the wire and key the echo signature the same way;
   `ledger-incoming.ts` resolves the quote with `sameMessage` and keeps the optimistic
   `senderName`/`text`; `build-outgoing.ts` + `parse-fields.ts` add the XEP-0461 fallback quote.
   One test in `incoming.test.ts`. Both apps unchanged.
2. **F2 Displayed marker only for the open chat (UI-2, UI-9).** `history.ts:279-287` guard on
   `activeChatId` + `isVisible`, mark on the error branch too; `closeChat` clears
   `pendingOpenChatId` in `apps/web/src/store/effects/chatActions.ts` and
   `apps/mobile/src/store/real-store.ts`. One test in `history.test.ts`.
3. **F3 Other-device echo clears unread (UI-3).** `incoming.ts` `handleOutgoingEcho`: `recordRead`
   when no local bubble matched. One test in `incoming.test.ts`.
4. **F4 Last seen (UI-4).** `parse-presence.ts` reads `<delay/>`; `incoming.ts:243-254` keeps the
   previous stamp unless the contact was online; both `history.ts` merges keep `lastSeenAt`.
5. **F5 Typing per sender (UI-5).** `incoming.ts:181-211` keyed names and timers; label helper in
   chat-core; `ChatHeader.tsx`, `ChatListItem.tsx`, mobile `chat-header.tsx`, `chat-list-item.tsx`.
6. **F6 Composer drafts per chat (UI-8).** New `composerDrafts` slice in each app store with
   storage; `Composer.tsx` and mobile `composer.tsx` restore/clear; list preview "Draft:".
7. **F7 Small store fixes (UI-12, UI-13, UI-14).** Preview-before-insert for new rows in both
   `history.ts`; web `resetUserState` calls `ledger.reset()`; `markStickerFailed` uses the
   `failed` status.
8. **F8 Menu guards and screen focus (UI-7, UI-10, UI-11).** `canReact` in chat-core, disabled
   menu items on both apps; web `isVisible` includes focus; mobile chat screen uses
   `useFocusEffect`. Run the two suspected checks first.
