# Messages core E: chat screen, search and pins — rewrite map

Measured on `task/T-2232-audit-messages-screen-search`, 2026-10-19. Every file in the
scope was opened and read end to end before it was counted. Line counts are `wc -l`
values; every range is inclusive and includes blank lines and closing brackets. The
`docs/LEAN_CODE.md` rules are applied as written.

The task header says 7,351 lines. The 36 files do add up to **7,351** exactly. One of
them is not part of this feature (see §0.2), so the feature baseline used for the
rewrite is **7,159 lines**.

## 0. Inventory and scope corrections

### 0.1 The 36 files, measured

| Area | File | Lines | Role today |
| --- | --- | ---: | --- |
| web | `apps/web/src/routes/ChatView.tsx` | 744 | chat screen, panels, selection, forward |
| web | `apps/web/src/components/ChatHeader.tsx` | 579 | header, menu, topic people line |
| web | `apps/web/src/components/MessageSearchResults.tsx` | 341 | message hits in the chat list |
| web | `apps/web/src/components/PeopleSearchResult.tsx` | 249 | people and public-group hits |
| web | `apps/web/src/components/ChatSearchBar.tsx` | 149 | narrow in-chat search bar |
| web | `apps/web/src/lib/useMessageSearch.ts` | 89 | web message-search state |
| web | `apps/web/src/components/PinsPanel.tsx` | 224 | pins sheet + info-section row |
| web | `apps/web/src/components/PinnedBanner.tsx` | 164 | pin banner |
| web | `apps/web/src/components/ui/search-field.tsx` | 18 | generic search input |
| mobile | `apps/mobile/src/app/chat/[id].tsx` | 547 | phone chat screen, topic join preview |
| mobile | `apps/mobile/src/components/chat/chat-header.tsx` | 369 | header + AIs-here sheet |
| mobile | `apps/mobile/src/components/chat/chat-search-results.tsx` | 391 | search screen composition |
| mobile | `apps/mobile/src/components/chat/message-search.ts` | 330 | phone search controller |
| mobile | `apps/mobile/src/components/chat/use-chat-screen.ts` | 300 | screen state bag |
| mobile | `apps/mobile/src/components/chat/message-search-list.tsx` | 287 | phone search hits |
| mobile | `apps/mobile/src/components/chat/pinned-banner.tsx` | 136 | phone pin banner |
| mobile | `apps/mobile/src/components/chat/pins-sheet.tsx` | 85 | phone pins sheet |
| mobile | `apps/mobile/src/components/chat/typing-dots.tsx` | 90 | typing dots + pulse dot |
| mobile | `apps/mobile/src/components/chat/search-jump.ts` | 45 | phone search jump |
| mobile | `apps/mobile/src/lib/pin-snapshot.ts` | 22 | pin kind label |
| mobile | `apps/mobile/src/lib/search-api.ts` | 15 | search API wrapper |
| mobile | `apps/mobile/src/lib/pins-api.ts` | 3 | pins type alias |
| mobile | `apps/mobile/src/components/ui/search-field.tsx` | 53 | generic search input |
| server | `apps/server/src/search/routes.ts` | 385 | search core + SQL builders |
| server | `apps/server/src/search/snippet.ts` | 233 | headline/markdown/sender helpers |
| server | `apps/server/src/search/edit-overlay.ts` | 204 | correction/retraction overlay |
| server | `apps/server/src/search/match.ts` | 203 | fold, tsquery, fuzzy match, marks |
| server | `apps/server/src/search/service.ts` | 150 | archive pool + allowed archives |
| server | `apps/server/src/search/api.ts` | 80 | search guards + handler |
| server | `apps/server/src/pins/service.ts` | 208 | list/pin/unpin |
| server | `apps/server/src/pins/access.ts` | 128 | pin chat resolution + roles |
| server | `apps/server/src/connections/pinned-fetch.ts` | 192 | **not this feature** (see §0.2) |
| shared | `packages/api-contract/src/pins.ts` | 99 | pin contract |
| shared | `packages/api-contract/src/search.ts` | 67 | search contract |
| shared | `packages/chat-core/src/search.ts` | 97 | search constants and formatting |
| shared | `packages/client-core/src/people-search.ts` | 75 | people prefix-search hook |
| | **Total** | **7,351** | |

### 0.2 Scope corrections that the rewrite spec must account for

1. **`apps/server/src/connections/pinned-fetch.ts` is not chat pins.** It is the
   SSRF-pinned HTTP transport for custom AI providers. Its callers are
   `apps/server/src/ai/model-client.ts:396` (`customProviderFetch`) and
   `apps/server/src/connections/probe.ts:189` (`createPinnedFetch`), and its tests are
   `connections/pinned-fetch.test.ts` and `connections/catalog-provider.test.ts`. It
   stays outside this rewrite; deleting it would break AI connections.
2. **`apps/server/src/search/service.ts` is not search-only.** `allowedArchives` and
   `resolveChatFilter` are imported by `auth/export.ts:20`, `card-media/api.ts:20`,
   `chats/api.ts:29`, `chats/deliveries.ts:10`, `chats/unread.ts:10`, `files/api.ts:19`,
   `media/api.ts:18` and `push/archives-cache.ts:4`. The rewrite moves this rule to a
   shared archive-access module; it must not change its shape casually.
3. **`apps/mobile/src/components/chat/typing-dots.tsx` has an export used elsewhere.**
   `PulseDot` is used by `chat-rows.tsx:398`, `topic-row.tsx:118` and
   `message-bubble-decor.tsx:112`. Only the header's `TypingDots` half belongs here.
4. **`packages/api-contract/*` is the server/mock boundary.** Changes to `SearchQuery`,
   `Pin` or `PinList` must be made in the contract first and will compile both apps and
   `packages/mock-backend/src/domains/search/routes.ts`.
5. **`apps/web/src/components/ui/search-field.tsx` and the mobile twin are generic
   inputs** used beyond this screen (the web forward picker uses it at
   `ChatView.tsx:706`). Keep them; do not count them as search-feature code.

### 0.3 What is measured as "today"

- web: 2,557 lines across the nine web files.
- phone: 2,673 lines across the fourteen mobile files.
- server: 1,783 lines, of which 192 are `pinned-fetch.ts` (unrelated); feature server is
  1,591.
- shared packages: 338 lines.

## 1. Behaviour list

Numbering is stable: the rewrite spec should keep these IDs. "Server" means a guarantee
that must hold even if a client is malicious; "—" means the server only transports or
has no rule.

### 1.1 Opening a chat, loading and missing state

| # | Behaviour | Web | Phone | Server |
| --- | --- | --- | --- | --- |
| B1 | Opening a chat marks it open/read; leaving or switching clears the open chat so arriving messages stay unread. | `ChatView.tsx:418-424` | `use-chat-screen.ts:77-88` (focus-aware) | — |
| B2 | While the chat list is still loading, a chat route shows the message skeleton, not "not found". | route shell outside scope | `[id].tsx:270-279` | — |
| B3 | A chat id that does not resolve shows "Chat not found" with "Back to chats". | route shell outside scope | `[id].tsx:280-293` | chat lookup is access-checked |
| B4 | Switching chats resets the info panel and media sheet so they cannot leak to the next chat. | `ChatView.tsx:365-377` | screen remounts per route; panels live in screen state (`[id].tsx:103-143`) | — |
| B5 | A `?panel=ai/group/topic/contact` deep link opens the panel only when the chat supports it; a bad value is ignored. | `ChatView.tsx:190-211`, `362-370` | platform-only routes/sheets (no `?panel` equivalent) | — |
| B6 | A `?steps=<taskId>` deep link opens Steps only when a progress card in this chat names that task; otherwise the parameter is dropped. | `ChatView.tsx:479-495`, `638-640` | separate route, outside scope | — |
| B7 | A public, non-General topic the viewer has not joined reads read-only with one Join key; an unknown viewer id or member list keeps the normal thread. | `ChatView.tsx:509-518`, `561-562` | `[id].tsx:314-321`, `371-386` | `isTopicJoined` comes from `chat-core`; join is authorized server-side |
| B8 | Topic preview states: loading, error with Retry, empty with "Join to see new messages", and a preview list of text/card messages. | `ChatView.tsx:561-562` renders `TopicJoinView` (component outside scope) | `[id].tsx:407-546` has its own loading/error/empty and FlatList | topic preview endpoint, outside scope |
| B9 | The topic notice banner can be dismissed. | `ChatView.tsx:544-560` | phone redirects to the group on the same notice (`use-chat-screen.ts:139-148`) | — |

### 1.2 The header

| # | Behaviour | Web | Phone | Server |
| --- | --- | --- | --- | --- |
| B10 | Back control: visible only on narrow web; always on phone. | `ChatHeader.tsx:247-249` (`wide:hidden`) | `chat-header.tsx:175-177` | — |
| B11 | Title with AI badge; public globe on web; private-topic lock; channel megaphone on phone. | `ChatHeader.tsx:54-67` | `chat-header.tsx:120-149` | — |
| B12 | Avatar shows an online dot for DMs when known. | `ChatHeader.tsx:251`, `260` | `chat-header.tsx:178` | presence comes from XMPP |
| B13 | Avatar and title open the matching info surface: topic info, AI settings, group/channel info, contact info, or the DM profile on phone. | `ChatHeader.tsx:250-292` | `chat-header.tsx:179-208` | every panel re-checks access |
| B14 | Subtitle precedence is connection status, then AI status line, then "writing…", then typing, then the default label. | `ChatHeader.tsx:161-175` | `chat-header.tsx:77-98` | — |
| B15 | Connection status appears immediately on web and after 1.5 s on phone. | `ChatHeader.tsx:163` | `chat-header.tsx:94` | — |
| B16 | Typing: DM says "typing"; a group names one or two people or says "N people are typing". | `chat-core/chat-labels.ts:47-63`, `ChatHeader.tsx:169` | `chat-header.tsx:80,92` | typing stanzas over XMPP |
| B17 | An AI that has a draft, or typing names, reads "writing…"; web hides dots while writing, phone shows them. | `ChatHeader.tsx:169-174`, `241` | `chat-header.tsx:91-97`, `165-167` | — |
| B18 | A topic shows either a writing line with writer avatars or `Group · member-count` with up to four avatars; it keeps one line height. | `ChatHeader.tsx:521-579`, `418-519` | `chat-header.tsx:151-159` → `topic-people-line.tsx` (152, outside scope) | group detail is access-checked |
| B19 | "AIs here" shows active AI marks and opens a sheet with stop (own AIs only), approvals and waiting questions. | `ChatHeader.tsx:301` → `AisHereKey.tsx` (outside scope) | `chat-header.tsx:209-221`, `245-369` | AI stop/list are authorized |
| B20 | Header menu: channel/group info, topic info, pinned messages, media, search (topics on web), chat background (web), Mute/Unmute, Pin/Unpin chat, Archive chat, Mark read/unread, Clear history (DM), Archive topic for everyone (managers, never General). | `ChatHeader.tsx:191-202`, `318-361`; `ChatActionsMenu.tsx:62-194` | phone routes most prefs through the topic/group info sheet; header keeps media, search and More (`chat-header.tsx:222-236`), so this half is **platform-only** | prefs and archive are authorized server-side |
| B21 | Archiving a topic asks for confirmation, shows a fixed error on failure, then navigates to the group's General topic (or home). | `ChatHeader.tsx:203-228`, `369-416` | topic-info host, outside scope | patch is manager-checked |
| B22 | Media, files and links opens as a sheet with Media/Files/Links/Voice tabs and an inline "Message not found" when a jump fails. | `ChatView.tsx:284-351`, `601-641` | `MediaSheet` via `[id].tsx:133-140` | media gallery is access-checked |

### 1.3 Message search

| # | Behaviour | Web | Phone | Server |
| --- | --- | --- | --- | --- |
| B23 | The chat-list search runs message search from 2 trimmed characters; people results appear for `@handle` or 3+ characters. | `ChatList.tsx:340-342`, `500`, `576-582` | `(tabs)/index.tsx:314-316`, `341-377` | `q` is 1..100 decoded, then 2..100 enforced |
| B24 | Chat-scoped search: wide web sets a scope chip and focuses the list search; narrow web opens an in-chat bar that replaces the header. Phone opens the list search with the chat filter via a route param. | `ChatView.tsx:378-396`; `ChatList.tsx:186-205`, `206-236`; `ChatSearchBar.tsx:19-149` | `chat-header.tsx:326`; `(tabs)/index.tsx:121-132`; `chat-search-results.tsx:256-270` | a chat filter outside the allowed set answers 404, never 403 |
| B25 | Message search debounces 250 ms, sends the trimmed query, pages 20 hits at a time, and aborts or ignores superseded requests. | `useMessageSearch.ts:1-89` (no paging) | `message-search.ts:236-324` (paging at `146-222`) | limit is 1..50, default 20; newest first |
| B26 | Hits are grouped by chat in newest-first order; a hit shows avatar, `Group › Topic` title (or chat title), sender, time and a one-line (web) or two-line (phone) snippet with highlighted character ranges. | `MessageSearchResults.tsx:242-262` | `message-search-list.tsx:213-265`; `chat-core/search.ts:59-91` | snippet is plain text plus code-point `marks`, never HTML |
| B27 | Search states: idle/hidden, loading ("Searching…"), error ("Couldn't search messages"), empty ("No messages found"), and unavailable (server 501 hides the section). | `MessageSearchResults.tsx:300-330`; `useMessageSearch.ts:45-53` | `message-search-list.tsx:177-209`; `message-search.ts:303-321` | 501 when the archive is unconfigured; 400 invalid query; 429 rate limit |
| B28 | Opening a hit pages history back to the message and lands on it; a miss shows "Message not found" once, without a retry loop. | `MessageSearchResults.tsx:24-46`; `ChatSearchBar.tsx:27` | `message-search-list.tsx:151-175`; `search-jump.ts:14-41`; route `?notFound=1` | `openAtMessage` pages server history; a 404 is a fixed `message_not_found` |
| B29 | In the narrow web bar the first result opens automatically, the counter reads `n of m`, Up/Down and buttons step and clamp at the ends, Enter steps forward, Esc closes. | `ChatSearchBar.tsx:53-148` | n/a (phone has no in-chat bar) — **platform-only web** | — |
| B30 | In the web chat list, Up/Down wrap the highlighted hit and Enter opens it; the input stays focused. | `MessageSearchResults.tsx:188-240`; `ChatList.tsx:213-216` | n/a — **platform-only web** | — |
| B31 | Phone message search pages when the scroll is within 400 px of the end, de-duplicates by `chatJid:messageId`, and keeps the loaded hits with an inline retry when a page fails. | n/a (web has one page) | `message-search.ts:26-28`, `146-222`; `message-search-list.tsx:226-285` | the cursor is an opaque microsecond `nextBefore`, never the last ISO date |
| B32 | Phone shows a "Message not found" notice under the results after a search miss. | n/a — **platform-only** | `(tabs)/index.tsx:305-311`, `359` | — |

### 1.4 People search

| # | Behaviour | Web | Phone | Server |
| --- | --- | --- | --- | --- |
| B33 | `@handle` is an exact lookup after 900 ms (or immediately on Enter); the same handle is not looked up twice in a row; 404 reads "No one with that username", 429 has fixed copy, other failures have fixed copy. | `PeopleSearchResult.tsx:102-133`; `client-core/people-handle-search.ts:26-33`, `133-176`, `200-249` | `chat-search-results.tsx:42-137` (same shared hook) | handle lookup is rate-limited; unknown and invisible answer the same 404 |
| B34 | Prefix people search runs from 3 characters, debounces 300 ms, latest query wins, and maps 429/errors to fixed sentences with no self-retry. | `PeopleSearchResult.tsx:56-100`; `client-core/people-search.ts:24-74` | `chat-search-results.tsx:154-199` | user search is rate-limited and access-filtered |
| B35 | A person row shows avatar, name and `@handle`; tapping opens the DM (or refresh-then-open when the chat row is not loaded) or the profile. | `PeopleSearchResult.tsx:135-169` | `chat-search-results.tsx:350-391` | — |
| B36 | Public-group hits: 3+ characters, at most five rows, matched name and `@handle · N members`; any failure hides the section. | `PeopleSearchResult.tsx:171-249` | none — **platform-only web** | directory search is public |
| B37 | On phone a found handle shows a relation hint (`Requested`, `Wants to connect`, `Blocked`, `You`) and the matching action; "self" has no action. | none (web always opens the profile/DM) — **platform-only phone** | `chat-search-results.tsx:111-152` | relation is server-derived |

### 1.5 Message pins

| # | Behaviour | Web | Phone | Server |
| --- | --- | --- | --- | --- |
| B38 | Pin/Unpin sits in the message menu when the viewer may pin: anyone in a DM, owner/admin in a group/topic; unpin needs a known pin id. | `message/MessageMenuBody.tsx:248-279` | `message-bubble-actions.tsx:250-267`; `chat-thread.tsx:80-95` | manager rule in `pins/access.ts:78-96` |
| B39 | Pin/unpin is optimistic: it paints immediately, rolls back on failure, and shows one fixed error per operation. | `client-core/store/pins.ts:141-210` | same shared code (`store/effects/pins.ts:125-136`) | create is capped at 20 per chat under an advisory lock; duplicate is 409 |
| B40 | The banner shows the current pin's sender and snapshot text, or the kind label when text is empty; a retracted original reads "Message deleted"; no pins hides the banner. | `PinnedBanner.tsx:49-101` | `pinned-banner.tsx:37-101`; `pin-snapshot.ts:16-22` | the snapshot is display-only, never authorization |
| B41 | More than one pin shows `n of m`; tapping cycles, resets the index when it no longer fits, and clears a jump error when cycling. | `PinnedBanner.tsx:70-80`, `103-114` | `[id].tsx:331-345`; `pinned-banner.tsx:68`, `102-127` | order is newest first |
| B42 | Tapping the banner jumps to the message; failure shows "Can't find this message here. It may have been deleted." and web offers Unpin when allowed. Phone has no history paging here, so an unloaded pin fails. | `PinnedBanner.tsx:31-47`, `86-144` | `use-chat-screen.ts:153-169`; `pinned-banner.tsx:129-133` | `openAtMessage` is history-paged on web and search; pin jump does not use it on phone |
| B43 | "List"/"n pins" opens the pins panel or sheet. Web also has a Pinned messages row in topic info. | `PinnedBanner.tsx:115-124`; `PinsPanel.tsx:211-223`; `ChatHeader.tsx:129-134` | `pinned-banner.tsx:115-127`; `[id].tsx:120-129` | — |
| B44 | Pins list rows: sender, snapshot (deleted → "Message deleted", empty → kind label), jump, Unpin for managers, empty hint, and inline jump/unpin errors. | `PinsPanel.tsx:58-209` | `pins-sheet.tsx:11-85`; `[id].tsx:103-129` | every list/unpin resolves chat visibility first; unknown and invisible are the same 404 |
| B45 | Pins load when a chat opens; the store refreshes them on focus and on a 60 s tick, and a silent load failure does not open an error banner. | `ChatView.tsx:520-523`; `store/effects/history.ts:95`; shared poll `client-core/store/polling.ts:13`, `105-126` | `store/effects/history.ts:238-239`; `real-store.ts:353-360`; same shared poll | list returns the caller's pin list for the chat |

### 1.6 The screen's own state, composer and overlays

| # | Behaviour | Web | Phone | Server |
| --- | --- | --- | --- | --- |
| B46 | Reply mode: replying builds a reply reference (own messages read "You") and can be cancelled; starting an edit clears a reply. | `ChatView.tsx:446-452`, `473-475`, `408-416`; `chat-core/chat-labels.ts:87-94` | `use-chat-screen.ts:150-151`; composer outside scope | reply is validated when sent |
| B47 | Selection mode: start with one message, toggle, cancel; forwarding sends the selected messages and exits selection. A selection never leaks across chats. | `ChatView.tsx:104-156`, `573-580` | `use-chat-screen.ts:105-129`; `[id].tsx` selection bar caller outside scope | forward is authorized per target |
| B48 | Forward picker: archived chats and non-postable channels are never offered; search by title/group; multi-select; optional comment; forwarding an album forwards the whole album in index order. | `ChatView.tsx:454-471`, `650-744` | `[id].tsx:48-96`; `chat-thread.tsx:97-110` | forward re-checks posting rights |
| B49 | Typing a printable key with nothing focused focuses the composer. | `ChatView.tsx:426-443` — **platform-only web** | native keyboard, n/a | — |
| B50 | A channel the viewer cannot post in shows a read-only bar with Mute/Unmute and a fixed mute error instead of the composer. | `ChatView.tsx:62-102`, `581-582` | `[id].tsx:347-350` (`composerBarFor`, bar outside scope) | posting rights are enforced server-side |
| B51 | Active AIs sit above the composer: working before waiting, waiting AI names open their question; web shows two plus `+N`, phone shows the first plus `+N`. | `ChatView.tsx:213-282`, `585-589` | `[id].tsx:145-195`, `377-382` | question ids are access-checked |
| B52 | Overlays are hosted by the screen: AI/group/topic/contact panels, pins, steps, media, forward. Switching chats or closing a panel must not leave a stale overlay. | `ChatView.tsx:601-644`; `365-377` | `[id].tsx:103-143`, `388-389` | — |

### 1.7 What the server guarantees

These are the rules the rewrite must not weaken, with today's source:

- **Search off is 501.** `search/api.ts:35-40`; the client hides the section on 501
  (`useMessageSearch.ts:45-53`, `message-search.ts:303-306`).
- **Rate limit before decode.** `search/api.ts:41-46`; the fixed sentence is
  "Too many searches, try again later".
- **Query decode.** `api-contract/src/search.ts:13-24`: `q` 1..100, optional `chat`
  1..256, `limit` 1..50, `before` a positive integer; excess properties fail. The core
  then trims and requires 2..100 (`search/routes.ts:187-190`).
- **Only allowed archives.** `search/service.ts:66-133`: contacts that are not blocked
  in either direction, the caller's own AIs, then every visible group's General room
  and its visible topics (`visibleTopicsForGroups`). A DM is always read under the
  caller's own `username` with a `bare_peer` filter, never under the peer's.
- **Chat filter is allow-listed.** `service.ts:135-150`; a JID outside the allowed set
  is `null`, and `routes.ts:192-197` turns it into the same 404 as an unknown chat.
- **Bounded scan.** `routes.ts:136-140`: 12 months, 5 000 candidates, 3 s statement
  timeout (`service.ts:32-33`). Exact matching folds accents/case and matches the last
  term as a prefix (`match.ts:21-55`).
- **Fuzzy is a second pass.** Only when the exact pass is short and the query is 3+
  characters (`routes.ts:349-368`); it never changes scope, cutoff or order, and exact
  hits rank first.
- **Edits and retractions.** `edit-overlay.ts:134-204`: the target set is read without
  a time cursor, only an edit whose sender equals the original sender counts, a
  retraction hides the message on every page, and a superseded correction is not a hit.
- **Names are not nicknames.** `snippet.ts:178-198`: a room hit names `bare_peer` from
  our tables, falling back to the nick only when the lookup has nothing; an outgoing DM
  reads "You" from the stanza `from`.
- **Snippets are plain text plus marks.** `snippet.ts:11-37`, `46-171`,
  `match.ts:163-203`; marks are code-point ranges and the client never renders HTML.
- **Paging cursor.** `routes.ts:379-384`: `nextBefore` is the oldest returned
  microsecond timestamp as a string, and only when the page was full.
- **Logs carry no query text.** `routes.ts:370-377` logs user id, result count and
  duration only.
- **Pins resolve access first.** `pins/access.ts:47-73` uses `requireChatAccess`,
  `canSeeTopic` and the DM pair key; an unknown or invisible chat is the same 404
  (`access.ts:10-15`). `requirePinManager` (`75-96`) allows either DM side, a topic
  creator, or a group owner/admin; plain members read only.
- **Pin writes.** `pins/service.ts:72-135`: one text snapshot rule, at most 20 pins per
  chat with the count and insert in one transaction under
  `pg_advisory_xact_lock(hashtext(chat_jid))`, duplicate = 409. Unpin loads the row,
  checks visibility and manager, then deletes (`137-166`). Audit detail carries ids
  only and no group id for private topics (`178-196`).

## 2. Twin logic

"Today" is the measured block in both files. The last column is the single home the
rewrite should give the rule; web and phone keep only markup and gesture adapters.

| Rule | Web | Phone | Today | Target home |
| --- | --- | --- | ---: | --- |
| Header subtitle precedence (connection, AI status, writing, typing, default) | `ChatHeader.tsx:161-175` (15) | `chat-header.tsx:77-98` (22) | 37 | `client-core/chat-screen.ts` |
| Header title and badges (AI, public, private, channel) | `ChatHeader.tsx:54-67` (14) | `chat-header.tsx:120-149` (30) | 44 | `client-core/chat-screen.ts` |
| Header action targets (topic/group/DM/contact panel) | `ChatHeader.tsx:175-202`, `250-292` (71) | `chat-header.tsx:104,179-208` (31) | 102 | `client-core/chat-screen.ts` |
| Topic people line (writers, count, avatar stack) | `ChatHeader.tsx:418-579` (162) | `topic-people-line.tsx:1-152` (152, outside scope) | 314 | `chat-core` view model + one avatar-stack component per platform |
| Join-preview predicate | `ChatView.tsx:509-518` (10) | `[id].tsx:314-321` (8) | 18 | `client-core/chat-screen.ts` |
| AI status line ordering and text | `ChatView.tsx:213-282` (70) | `[id].tsx:145-195` (51) | 121 | `client-core/chat-screen.ts` |
| Message-search controller (debounce, scope, cancel, errors, paging) | `useMessageSearch.ts:16-89` (74) | `message-search.ts:9-330` (322) | 396 | `client-core/search-model.ts` |
| Search hit row, grouping, snippet marks | `MessageSearchResults.tsx:48-341` (294) | `message-search-list.tsx:22-287` (266) | 560 | `client-core/search-model.ts` + `chat-core/search.ts` |
| People search rows and states | `PeopleSearchResult.tsx:56-169` (114) | `chat-search-results.tsx:72-199` (128) | 242 | `client-core/people-search.ts` + `chat-screen.ts` |
| Pin banner content and cycle | `PinnedBanner.tsx:23-164` (142) | `pinned-banner.tsx:18-136` (119) | 261 | `client-core/pins-model.ts` |
| Pins list row and unpin state | `PinsPanel.tsx:33-209` (177) | `pins-sheet.tsx:11-85` (75) | 252 | `client-core/pins-model.ts` |
| Pin kind label table | `PinnedBanner.tsx:15-21`, `PinsPanel.tsx:16-22` (14) | `pin-snapshot.ts:8-14` (7) | 21 | `client-core/pins-model.ts` (one table) |
| Selection and forward (album grouping, send label) | `ChatView.tsx:104-156`, `650-744` (148) | `[id].tsx:48-96`; `use-chat-screen.ts:105-129` (74) | 222 | `client-core/chat-screen.ts` |
| Screen state and chat-switch resets | `ChatView.tsx:353-424`, `477-523` (119) | `use-chat-screen.ts:51-76`, `229-298` (96) | 215 | `client-core/chat-screen.ts` |
| Chat open/close lifecycle | `ChatView.tsx:418-424` (7) | `use-chat-screen.ts:77-88` (12) | 19 | `client-core/chat-screen.ts` adapter contract |
| "Message not found" copy | `MessageSearchResults.tsx:257-261`; `ChatSearchBar.tsx:139-146`; `PinnedBanner.tsx:126-130`; `PinsPanel.tsx:108-112` (23) | `search-jump.ts`/`[id].tsx`/sheet (12) | 35 | one message constant in `client-core` |

Not twin logic, and should stay platform-specific: the web global-search keyboard
navigation, the phone scroll paging trigger and 400 px threshold, the phone relation
hints, the web public-group search, the web type-to-focus shortcut, the phone
focus-aware open/close, and the phone topic preview.

## 3. Slop by rule

### 3.1 One home per piece of logic

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `useMessageSearch.ts:16-89` + `message-search.ts:9-330` | 396 | The same search state machine twice; the phone copy is four times longer because it also pages, retries and aborts. |
| `MessageSearchResults.tsx:48-341` + `message-search-list.tsx:22-287` | 560 | The same hit row, grouping and snippet rendering twice, with different line clamps and time formatting plumbing. |
| `ChatHeader.tsx:161-175` + `chat-header.tsx:77-98` | 37 | The subtitle precedence `if` chain is repeated. |
| `ChatView.tsx:213-282` + `[id].tsx:145-195` | 121 | AI activity sorting/text is repeated; web reimplements `activeAis`/`entryText` (`ChatView.tsx:213-226`) while the phone uses the shared `topicActivityView`/`topicActivityLine`. |
| `PinnedBanner.tsx:15-21`, `PinsPanel.tsx:16-22`, `pin-snapshot.ts:8-14` | 21 | Three copies of the same kind→label table. |
| `ChatView.tsx:104-156` + `[id].tsx:48-96` | 196 | Selection, album forwarding and the send label are separate implementations. |
| `MessageSearchResults.tsx:303-330` + `message-search-list.tsx:180-209` | 58 | The loading, error and empty scaffolding (heading, "Searching…", "No messages found") is written twice. |
| `ChatView.tsx:509-518` + `[id].tsx:314-321` | 18 | The join-preview rule is copied, including the three "unknown" guards. |
| `PinnedBanner.tsx:26-29` + `use-chat-screen.ts:25-27` | 7 | The pins error is reshaped twice (`{chatId,message}` vs a string). |
| `search/routes.ts:69-72`, `82-86` + `edit-overlay.ts:42-56` | 24 | Two SQL binders; `scopePredicate` repeats the scope SQL from `archiveFilters`. |
| `pins/access.ts:47-73` + `98-128` | 58 | Room pin visibility is resolved twice (resolve + requirePinVisible/resolveRoomPin). |

### 3.2 Trust the types and the contract

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `apps/server/src/search/routes.ts:151-171` | 21 | Local `SearchQuery`, `SearchItem`, `SearchResult` repeat the contract types; none is used outside this file. Pass `typeof SearchQuery.Type` through instead. |
| `apps/server/src/search/api.ts:64-68` | 5 | Copies `q/chat/limit/before` field by field; pass the decoded query. |
| `apps/web/src/components/ChatHeader.tsx:107-111`, `164-166` | 8 | Widened `TypingStatus` record and a cast to read a field the shared typing type should carry. |
| `apps/mobile/src/components/chat/message-search.ts:129-136` | 8 | Guards `chat === undefined || chat === ''` although the contract already forbids an empty chat. |
| `apps/web/src/lib/useMessageSearch.ts:35` + `packages/client-core/src/chat-extras-api.ts:107-110` | 4 | The same defensive empty-chat guard at two boundaries. |
| `apps/server/src/pins/service.ts:31-42` | 12 | `toPinView` copies eight fields; a contract-shaped row should pass through (or the SQL should alias). |
| `apps/server/src/pins/service.ts:38`, `184-195` | 13 | `row.kind as PinKind` plus an audit object with six `as`/null fields instead of a typed factory. |
| `apps/mobile/src/components/chat/chat-header.tsx:42` | 1 | `TypingStatus` repeats the status shape locally. |
| `apps/server/src/search/service.ts:19-30` | 12 | `ArchiveRow` requires `headline`, but `buildFuzzyCandidatesQuery` never selects it (`routes.ts:96-112`), so fuzzy rows lie about their type. |
| `apps/web/src/components/PeopleSearchResult.tsx:195-200` | 6 | A local `GroupSearchState` and a debounce `DebouncedStep` interface that repeat states the shared hook already owns. |

### 3.3 No layers that do nothing

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `apps/mobile/src/lib/search-api.ts:9-15` | 15 | `makeSearchApi(_call, transport)` ignores `_call` and wraps `makeChatExtrasApi`; two call sites in one file. |
| `apps/mobile/src/lib/pins-api.ts:1-3` | 3 | A pure type alias of `ReturnType<typeof makeChatExtrasApi>`. |
| `apps/mobile/src/components/chat/chat-search-results.tsx:42-70`, `154-158` | 33 | Two wrappers whose only logic is a `useMemo`/`useState` for one screen. |
| `apps/web/src/components/MessageSearchResults.tsx:122-148` | 27 | `SearchHit` exists only to give each row a hook (`useOpenHit`); the row itself already takes `onOpen`. |
| `apps/web/src/components/PinsPanel.tsx:211-224` | 14 | `PinsSection` is a one-caller wrapper around `ListRow`; either move it to `client-core` as data or inline it. |
| `apps/server/src/search/api.ts:20` | 1 | Re-exports `SearchRoutesDependencies`; `app/deps.ts:17` could import the service type directly. |
| `apps/server/src/search/routes.ts:142-149` | 8 | A four-field dependency type that only feeds the one core function. |
| `apps/mobile/src/components/chat/message-search.ts:39-53` | 15 | `settleSearch` wraps a single `Effect.runFork(tryPromise)`; a `.then/.catch` on the promise is the same rule without a second error channel. |
| `apps/web/src/routes/ChatView.tsx:158-188` | 31 | `ComposerDock` is a one-caller observer; the CSS variable could be set by the composer itself. |

### 3.4 Data over branches

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `apps/web/src/routes/ChatView.tsx:190-211` | 22 | `initialPanel` is a four-branch `if` chain over panel keys; a `Record<PanelKey, predicate>` is the same rule. |
| `apps/web/src/routes/ChatView.tsx:601-640` | 40 | Six conditional panel blocks; a panel map would make supported panels data. |
| `apps/web/src/components/PinnedBanner.tsx:15-21`, `PinsPanel.tsx:16-22`, `pin-snapshot.ts:8-14` | 21 | The same kind→label switch/table three times. |
| `apps/mobile/src/components/chat/chat-search-results.tsx:139-152` | 14 | `relationHint` is a `switch` mapping one value to one string. |
| `apps/server/src/search/routes.ts:226-231` | 6 | `editScope` is an `if` chain over filter kind. |
| `apps/server/src/search/service.ts:53-59` | 7 | `archiveFilters` is an `if` chain that returns three strings. |
| `apps/web/src/components/ChatHeader.tsx:179-185` | 7 | `panelLabel` is a nested ternary over four chat shapes. |
| `apps/server/src/search/snippet.ts:211-233` | 23 | Two nearly identical attribute readers (`stanzaFrom` regex and `tagAttribute`). |

### 3.5 Use the platform and the libraries we have

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `apps/mobile/src/components/chat/typing-dots.tsx:1-90` | 90 | Hand-rolled `Animated` loops; Reanimated is already a dependency and the header only needs a reduced-motion-aware dot row. |
| `apps/web/src/components/ChatSearchBar.tsx:92-148` | 57 | A raw `<input>` plus custom buttons; the web kit already has `SearchField`/`IconButton`/`Well`. |
| `apps/web/src/lib/useMessageSearch.ts:29-55` | 27 | Rebuilds debounce/abort with `useAction` + `AsyncResult`; a plain controller with `AbortController` is shorter. |
| `apps/mobile/src/components/chat/chat-search-results.tsx:240-252` | 13 | Builds an API transport and a mock branch inline; the screen should receive the shared search API like every other screen. |
| `apps/web/src/components/PinnedBanner.tsx:96-100`, `PinsPanel.tsx:186-192` | 12 | Two hand-written snapshot renderers instead of one shared `pinLabel` + `LinkText` rule. |

### 3.6 No speculative code

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `apps/mobile/src/components/chat/message-search.ts:30-34`, `55-56` | 7 | `SearchScheduler` and the `DebouncedQuery` type exist for tests; `git ls-files` has no `message-search.test.*`, so the seam is unused. |
| `apps/mobile/src/components/chat/message-search.ts:83-91` | 9 | `attempt`/`pageRequest` retry bookkeeping has no failing consumer beyond the inline retry button. |
| `packages/client-core/src/people-search.ts:29`, `68-74` | 8 | `setEntries` is returned but both callers destructure `{ state }` only (`PeopleSearchResult.tsx:57`, `chat-search-results.tsx:157`). |
| `apps/web/src/components/MessageSearchResults.tsx:269-273`, `282-288` | 12 | `onNotFound` is a required prop whose only caller passes `() => {}` (`ChatList.tsx:580`); the local notice does all the work. |
| `apps/web/src/components/PinsPanel.tsx:39-42`, `48-56`, `98-107` | 23 | `unpinning`/`settling` rows are passed `listed={false}` and `PinRowItem` returns `null` for them (`160-162`), so the "keep the row until it settles" state is dead. |
| `apps/server/src/search/routes.ts:67`, `96` | 2 exports | `buildArchiveQuery`/`buildFuzzyCandidatesQuery` are exported but used only in this file. |
| `packages/api-contract/src/search.ts:8`, `10` | 2 exports | `SEARCH_MAX_LIMIT` and `SEARCH_MATCHES` have no reader outside the file (`git grep`). |
| `apps/server/src/pins/access.ts:29-32` | 4 | `dmPairKey` is exported but used only inside the same file. |

### 3.7 Comments that explain the next line

| Where | Lines | What breaks the rule |
| --- | ---: | --- |
| `apps/mobile/src/components/chat/message-search.ts:9`, `26`, `38`, `58`, `60`, `75`, `88`, `146`, `268` | 9 | Restate the code (`/** Null until... */`, `/** The in-flight page request... */`, etc.). |
| `apps/web/src/routes/ChatView.tsx:113`, `158`, `365`, `371`, `408-409`, `420`, `426-427`, `445`, `456`, `479`, `499`, `509-511`, `520` | 17 | Most restate the following statement. Keep only the non-obvious why (e.g. the edit/reply exclusivity and the wide/narrow search split). |
| `apps/web/src/components/ChatHeader.tsx:107-111`, `116`, `397`, `478-481`, `521-523` | 14 | `TypingStatus` rationale and "needs a manager" belong in the model, not repeated at the call site. |
| `apps/web/src/components/PinnedBanner.tsx:39` | 1 | The comment describes a row lifecycle that is dead (§3.6). |
| `apps/server/src/search/routes.ts:62-66`, `94-95`, `114-115`, `173-175`, `243-245`, `284-286`, `349-351` | 21 | Useful security/why comments; keep the access and fuzzy ones, drop the restatements. |
| `apps/server/src/search/edit-overlay.ts:1-5`, `36`, `75-76`, `124-125`, `134-137` | 14 | Keep the sender-forgery why; the rest restates the SQL. |

### 3.8 Repeated server shapes

| Where | Lines | What to do |
| --- | ---: | --- |
| `apps/server/src/search/routes.ts:176-385` | 210 | One route body does validation, access, two query passes, overlay loading, rendering and paging. Split into `runSearch` (orchestration), `renderExact`, `renderFuzzy`, `loadOverlay`; route becomes read, call, return. |
| `apps/server/src/pins/service.ts:88-135` | 48 | Pre-check duplicate, transaction, catch/rethrow, then a second select. The unique index + `INSERT ... RETURNING *` inside the advisory-lock transaction removes the pre-check (~6), the catch (~5) and the post-select (~7). |
| `apps/server/src/pins/access.ts:47-73`, `98-128` | 58 | Two room-resolution paths; one resolver with `{ requireManager }` and one visibility function. |
| `apps/server/src/search/service.ts:78-103` | 26 | Two `runSql(Effect.gen(...))` around single selects; one `runSql` with both queries, or the plain db helper, saves the wrappers. |
| `apps/server/src/search/routes.ts:210-222`, `357-368` | 25 | Four `Effect.try`/`Effect.tryPromise` wrappers with the same `searchFailed` mapper; one small `queryArchive(text, values)` helper. |
| `apps/server/src/search/api.ts:24-51` | 28 | The 501/429 preflight is bespoke; reuse the shared guard shape used by media/files (same order: archive, then rate limit). |

## 4. Dead code

| Item | Proof |
| --- | --- |
| Pins-panel settling rows never render. `PinsPanel.tsx:39-42` tracks `unpinning`/`settling`, `98-107` passes `listed={false}`, and `PinRowItem` returns `null` at `160-162`. | `git grep -n "listed={false}" apps/web/src` → only `PinsPanel.tsx:103`. |
| `MessageSearchResults` `onNotFound` prop has no effect at its only caller. | `git grep -n "onNotFound" apps/web/src` → `ChatList.tsx:580` passes `() => {}`; the internal `setNotFound` path is what shows the notice. |
| `setEntries` on the shared people-search result is unused. | `git grep -n "setEntries" apps packages` → definitions at `people-search.ts:29,68,74`; the other hits are unrelated `useState` setters in `explore.tsx`/`ExploreRoute.tsx`. |
| Mobile search test seam and exported controller types are unused. | `git ls-files` filtered for `message-search` → only `message-search.ts` and `message-search-list.tsx`; no `message-search.test.*`. `DebouncedQuery`/`SearchScheduler` appear only in `message-search.ts`. |
| `buildArchiveQuery`, `buildFuzzyCandidatesQuery`, `dmPairKey`, `SEARCH_MAX_LIMIT`, `SEARCH_MATCHES` are exported with no external reader. | `git grep -n "buildArchiveQuery\|buildFuzzyCandidatesQuery\|dmPairKey\|SEARCH_MAX_LIMIT\|SEARCH_MATCHES" -- apps packages` → only their definitions/uses in the defining files (contract constants are used only inside `api-contract/src/search.ts`). |
| `makeSearchApi`'s first parameter is unused. | `apps/mobile/src/lib/search-api.ts:9`; its only call sites are `chat-search-results.tsx:249,251`. |
| `pins-api.ts` is a type alias only. | `git grep -n "pins-api'"` → imports are all `import type`. |
| `SearchQuery`, `SearchItem`, `SearchResult` in `search/routes.ts:151-171` duplicate contract types and are not imported elsewhere. | `git grep -n "SearchResult\b\|SearchItem\b\|SearchQuery\b" apps/server` → only `routes.ts` (other hits are unrelated `WebSearchResult`/`UserSearchQuery`). |
| `apps/server/src/connections/pinned-fetch.ts` is not chat pins. | `git grep -n "pinned-fetch" apps/server/src` → `ai/model-client.ts:396`, `connections/probe.ts:189`, plus its own tests. Do not delete in this rewrite. |
| `apps/mobile/src/components/chat/typing-dots.tsx` is partly live. | `git grep -n "PulseDot" apps/mobile/src` → `chat-rows.tsx:398`, `topic-row.tsx:118`, `message-bubble-decor.tsx:112`. Keep `PulseDot`; only `TypingDots` is in this screen. |
| `apps/web/src/components/PinsPanel.tsx:211 PinsSection` is live from topic info. | `git grep -n "PinsSection" apps/web/src` → `TopicPanel.tsx:18,564`; the rewrite must keep a rendered equivalent. |
| `SearchItem.match` is produced by the server (`routes.ts:274-281`) and typed in the contract (`search.ts:43`) but no client reads it. | `git grep -n "\.match\b\|match:" apps/web/src apps/mobile/src` shows no search-result use; it may stay as a server-side signal, but the client should not render from it. |

## 5. Lean target structure

### 5.1 Where logic lives

- **Shared rules:** `packages/client-core` gets three framework-free models with thin
  React hooks: the chat-screen view model, the search model and the pins model. Both
  apps pass an API adapter and navigation callbacks; neither app writes its own
  debounce, precedence chain, pin cycle or jump state.
- **Pure text/formatting:** `packages/chat-core` keeps constants, `snippetParts`,
  `groupSearchByChat`, `searchResultTitle`, `activeQuery` and the existing
  `chat-labels` helpers.
- **Apps:** markup, gestures, native APIs and route/navigation only. No `useState`
  blocks that mirror each other across web and phone.
- **Server:** one service per rule: archive access, query building, matching, edit
  overlay, snippet/name rendering, search orchestration, search HTTP, pin access, pin
  service. Route bodies only decode, call, return.
- **Contract:** the HTTP shapes stay in `packages/api-contract`; clients keep using
  `packages/client-core/src/chat-extras-api.ts`. No second hand-written client.

### 5.2 New and rewritten files, with budgets

#### Server — target 1,045 lines (today 1,591 feature lines)

| File | Owns | Budget |
| --- | --- | ---: |
| `apps/server/src/archive/access.ts` (new; moved from `search/service.ts`) | `ArchivePool` + timeout, `ArchiveRow`, `allowedArchives`, `resolveChatFilter`; the one access rule eight other modules import | 140 |
| `apps/server/src/search/query.ts` (new; from `routes.ts:37-140`) | exact and fuzzy candidate SQL, binders, scope predicate, 12-month/5,000 cap | 85 |
| `apps/server/src/search/match.ts` (kept) | fold map, terms, tsquery, Damerau distance, exact/fuzzy match, mark merge/window | 150 |
| `apps/server/src/search/edits.ts` (renamed from `edit-overlay.ts`) | correction/retraction overlay, sender-forgery check, newest-edit rule | 120 |
| `apps/server/src/search/snippet.ts` (kept, trimmed) | headline sentinels → marks, Markdown strip and mark remap, timestamp, sender/JID helpers | 120 |
| `apps/server/src/search/run.ts` (new; from `routes.ts:142-385`) | trim/validate, access, exact pass, fuzzy pass, overlay, render, page cursor, log | 160 |
| `apps/server/src/search/http.ts` (renamed from `api.ts`) | 501/429 guards, decoded-query handler, mount | 50 |
| `apps/server/src/pins/access.ts` (kept, trimmed) | DM pair key, chat resolution, visibility, manager rule; one room path | 80 |
| `apps/server/src/pins/service.ts` (kept, trimmed) | list, pin (transaction + `RETURNING`), unpin (scoped delete), audit | 140 |

#### Shared — target 820 lines (today 338 lines, absorbing ~1,000 app lines)

| File | Owns | Budget |
| --- | --- | ---: |
| `packages/client-core/src/chat-screen.ts` (new) | subtitle precedence, title/badge flags, header menu items + conditions, panel target, join predicate, AI status rows, selection/reply/forward rules, pin-cycle index, "message not found" copy | 250 |
| `packages/client-core/src/search-model.ts` (new) | message-search controller: min length 2, 250 ms debounce, scope, abort/supersede, paging with `nextBefore`, 501/429/error states, hit grouping, jump callback contract | 190 |
| `packages/client-core/src/pins-model.ts` (new) | kind label table, snapshot display (deleted/empty), current pin, cycle/clamp, banner/panel row view, unpin pending/error | 80 |
| `packages/client-core/src/people-search.ts` (kept) | prefix search + exact handle search; drop `setEntries` and duplicate fixed strings | 85 |
| `packages/chat-core/src/search.ts` (kept) | constants, `activeQuery`, `snippetParts`, `groupSearchByChat`, `searchResultTitle`, people normalization | 80 |
| `packages/api-contract/src/search.ts` (kept) | `SearchQuery`, `SearchItem`, `SearchPage`, endpoint; drop unused exports | 55 |
| `packages/api-contract/src/pins.ts` (kept) | pin payloads, snapshot control-character rules, endpoints | 80 |

#### Web — target 1,088 lines (today 2,557)

| File | Owns | Budget |
| --- | --- | ---: |
| `apps/web/src/routes/ChatView.tsx` | screen markup, header/search switch, banner, thread, composer dock, panel map, forward picker; all state from the shared models | 290 |
| `apps/web/src/components/ChatHeader.tsx` | title/subtitle/badges, menu rendering from the shared menu model, archive confirm/error | 200 |
| `apps/web/src/components/search/MessageSearch.tsx` (new; replaces `MessageSearchResults.tsx`) | hit list, hit row, snippet spans, loading/error/empty/unavailable states, keyboard highlight | 180 |
| `apps/web/src/components/search/PeopleSearch.tsx` (new; replaces `PeopleSearchResult.tsx`) | handle lookup, prefix people, public-group section, rows | 120 |
| `apps/web/src/components/search/ChatSearchBar.tsx` (moved) | narrow in-chat bar: autofocus, first-hit open, counter, Up/Down/Enter/Esc | 85 |
| `apps/web/src/components/pins/PinnedBanner.tsx` (new) | banner markup, cycle button, jump error/unpin offer | 85 |
| `apps/web/src/components/pins/PinsPanel.tsx` (new) | sheet, rows, unpin, empty/error, `PinsSection` export for topic info | 110 |
| `apps/web/src/components/ui/search-field.tsx` (kept) | generic field | 18 |

#### Phone — target 1,118 lines (today 2,673)

| File | Owns | Budget |
| --- | --- | ---: |
| `apps/mobile/src/app/chat/[id].tsx` | screen layout, loading/not-found, topic join preview, overlays host, AI status placement | 290 |
| `apps/mobile/src/components/chat/chat-header.tsx` (kept, trimmed) | title/subtitle/badges, action targets, media/search/more buttons, AIs-here sheet | 210 |
| `apps/mobile/src/components/chat/chat-screen.ts` (new; replaces `use-chat-screen.ts`) | route params, shared chat-screen model adapter, focus open/close, pins gesture, navigation | 75 |
| `apps/mobile/src/components/chat/chat-search-results.tsx` | search screen composition: header, scope chip, people, chats, messages, miss notice | 160 |
| `apps/mobile/src/components/chat/message-search-list.tsx` | hit rows, snippet, grouped list, near-end paging, inline page error | 140 |
| `apps/mobile/src/components/chat/pinned-banner.tsx` | banner, cycle, error, open list | 85 |
| `apps/mobile/src/components/chat/pins-sheet.tsx` | sheet rows, unpin, error, empty | 65 |
| `apps/mobile/src/components/ui/search-field.tsx` (kept) | generic field | 53 |
| `apps/mobile/src/components/chat/typing-dots.tsx` (trimmed) | `TypingDots` animation + the kept `PulseDot` export | 40 |

### 5.3 Files to delete or replace

| Delete | Replaced by |
| --- | --- |
| `apps/web/src/components/MessageSearchResults.tsx` | `search/MessageSearch.tsx` |
| `apps/web/src/components/PeopleSearchResult.tsx` | `search/PeopleSearch.tsx` |
| `apps/web/src/components/ChatSearchBar.tsx` | `search/ChatSearchBar.tsx` |
| `apps/web/src/components/PinsPanel.tsx` | `pins/PinsPanel.tsx` (keep `PinsSection`) |
| `apps/web/src/components/PinnedBanner.tsx` | `pins/PinnedBanner.tsx` |
| `apps/web/src/lib/useMessageSearch.ts` | `client-core/search-model.ts` |
| `apps/mobile/src/components/chat/message-search.ts` | `client-core/search-model.ts` |
| `apps/mobile/src/components/chat/use-chat-screen.ts` | `chat-screen.ts` + `client-core/chat-screen.ts` |
| `apps/mobile/src/components/chat/search-jump.ts` | `client-core/search-model.ts` jump contract |
| `apps/mobile/src/lib/pin-snapshot.ts` | `client-core/pins-model.ts` |
| `apps/mobile/src/lib/search-api.ts` | `packages/client-core/src/chat-extras-api.ts` via the existing transport |
| `apps/mobile/src/lib/pins-api.ts` | the return type of `makeChatExtrasApi` |
| `apps/server/src/search/service.ts` | `archive/access.ts` |
| `apps/server/src/search/routes.ts` | `search/query.ts` + `search/run.ts` |
| `apps/server/src/search/api.ts` | `search/http.ts` (rename) |
| `apps/server/src/search/edit-overlay.ts` | `search/edits.ts` (rename) |

Keep `pinned-fetch.ts`, both `search-field.tsx`, `PulseDot`, `PinsSection` and the
`api-contract` files.

### 5.4 Totals against today

| Area | Today | Target | Cut | Cut % |
| --- | ---: | ---: | ---: | ---: |
| web | 2,557 | 1,088 | 1,469 | 57% |
| phone | 2,673 | 1,118 | 1,555 | 58% |
| server (feature) | 1,591 | 1,045 | 546 | 34% |
| shared packages | 338 | 820 | −482 | (absorbs app logic) |
| **Feature total** | **7,159** | **4,071** | **3,088** | **43.1%** |
| unrelated `pinned-fetch.ts` (unchanged) | 192 | 192 | 0 | 0% |
| **Task file set** | **7,351** | **4,263** | **3,088** | **42.0%** |

The target meets the "at least 40% fewer" bar under either counting. Every behaviour
B1–B52 must be mapped to a file in §5.2 before the rewrite starts; if one cannot fit,
the rewrite spec must say which and why instead of dropping it.

### 5.5 Build order for the rewrite spec

1. **Contract + shared models first** (`search-model`, `pins-model`,
   `chat-screen`), with the old components still rendering, so parity is visible.
2. **Server split** (`archive/access` first because eight modules import it, then
   `query`/`run`/`http`; pins access + service). Keep `routes.test.ts` and
   `edit-overlay.test.ts` green after the move.
3. **Web search** (global list + narrow bar + people), then **web pins**, then
   **web ChatView/ChatHeader** consuming the shared view model.
4. **Phone search**, then **phone pins**, then **phone screen/header**. Delete each
   old file in the same commit that moves its last caller, per `LEAN_CODE.md` rule 3.
5. **Delete** the dead items in §4 in the same commits; do not keep compatibility
   shims.

## 6. Risks

| # | Risk | Why a rewrite loses it | How the lead checks |
| --- | --- | --- | --- |
| R1 | **Search access** | `allowedArchives` is shared by eight modules; a "clean" search-only module can forget blocked contacts, invisible topics, or the DM-own-username rule. | Live with two accounts: DM between A and B, block B, search a unique word from B's message as A; create a private topic not visible to A and search its word; call `GET /api/search?chat=<B's room>` as A and expect 404, never 403 or hits. Also `routes.test.ts`. |
| R2 | Edits and retractions | The overlay is loaded outside the page cursor; dropping the union rebuild lets a retracted message reappear on page 2 or a foreign edit count. | `edit-overlay.test.ts` plus live: edit a message, retract another, search both words; the retracted one never appears; another user's edit of your message is ignored. |
| R3 | Room sender names | The archive nick is free text; using it spoofs names. | `routes.test.ts` "shows the database name for bare_peer, not a spoofed nick"; live: set a room nick to another member's name and search. |
| R4 | Exact/fuzzy ranking and paging | Fuzzy is a second pass that must not change scope/order; a duplicating merge gives repeated hits or skips a row. | Phone emulator: search a 3+ character typo, scroll two pages, confirm no duplicate `chatJid:messageId` and no missing hit; web: one page, no cursor. |
| R5 | 501/429 and query privacy | A refactor can move the guard after decode or log the query. | Unit/live: unset the archive URL and expect 501 and no search UI; hammer the limiter for 429 copy; grep the request log for the query text after a search. |
| R6 | Search jump | `openAtMessage` pages history; a plain "find in loaded messages" loses old hits. `search-jump.ts` has a one-attempt rule, no retry loop. | Web mock and phone emulator: search a hit older than the loaded page, tap it, land on it; delete the message server-side and tap, expect "Message not found" once and no loop. |
| R7 | Pin authorization | Either DM side may pin; a topic creator or group owner/admin may pin; plain members may not; General belongs to the group. Unknown and invisible must both be 404. | Server tests plus live two accounts: member tries to pin (403), non-member tries to list (404), topic creator pins (201), DM either side pins; unpin with a foreign pin id returns 404. |
| R8 | Pin cap and duplicates | The count and insert must share the advisory-lock transaction; a pre-check alone races. | Unit: two concurrent pins at 19 count; one succeeds, one gets `pin_limit`; duplicate message gets 409. Check no 21st pin. |
| R9 | Pin snapshot display | "Message deleted", empty text → kind label, control characters rejected, snapshot never authorizes. | Web mock and phone emulator: pin an image with no caption, a deleted message, a voice note; each shows the right label; server rejects control characters. |
| R10 | Pin cycle index | Pins change under the banner (another side pins/unpins); phone keeps `pinIndex` without reset. | Phone emulator: with two pins, open the list and unpin the current one; the banner must clamp to a real pin and the label must match the row. |
| R11 | Pin jump on phone | Today it only searches loaded messages; search jump pages. A rewrite must not silently "fix" or silently keep the difference. | Phone emulator: pin an old message not in the loaded page and tap the banner; record whether it lands or says "Message not found", and keep the chosen behaviour in the spec. |
| R12 | Header menu conditions | Web puts prefs in the header; phone routes them through info sheets. Dropping the conditions loses archive/mute/clear/background/AI-only entries. | Web mock and phone emulator: open the menu for DM, AI DM, group, channel, topic (General and private). Compare against `ChatHeader.tsx:191-361` and `ChatActionsMenu.tsx:62-194`. |
| R13 | Join preview | Showing Join to a member while ids load, or showing the thread to a non-member, breaks the read-only story. | Phone emulator and web mock: public non-General topic as member (thread, no Join), as non-member (preview + Join), while chat list loads (thread, never Join), General topic (thread). |
| R14 | Search state freshness | Old results flashing for a new query, an aborted request writing late, or "unavailable" not sticking. | Web mock and phone emulator: type quickly through 3 queries; only the last results show; throttle the search route so an earlier answer returns late; confirm it is ignored. |
| R15 | Narrow vs wide search | Wide scopes the chat-list search and keeps the bar; narrow replaces the header. Unifying them changes the flow. | Web at <900 px and ≥900 px: search from a chat and confirm the narrow bar vs the scope chip + focused list input; phone from a chat confirms the route-param scope chip. |
| R16 | Chat-switch state leaks | Panels, media, selection, reply, edit and scroll position can leak to the next chat. | Web mock and phone emulator: open pins + select a message + start a reply, then switch chats; every overlay and mode must be closed. |
| R17 | Reply/edit/selection exclusivity | Starting an edit clears reply; selection replaces the composer; forwarding exits selection. | Web mock: edit a message while replying, then select and forward; only one mode is active at a time. |
| R18 | Topic notice and steps guards | A stale `?steps` or topic notice must not open an unrelated panel. | Web mock: open `?steps=` for a task not in the chat (nothing opens), then for a progress card in the chat (Steps opens). Phone: topic deletion while open redirects to the group. |
| R19 | AI status line | Web sorts working before waiting and shows two; phone shows one. Waiting names must open the question. | Web mock and phone emulator: a topic with three active AIs in mixed states; compare order, counts and question taps. |
| R20 | Pins load errors | `loud` loads (explicit refresh) show the banner error; silent open loads do not. | Web mock: fail `GET /api/pins` on open (no error banner) and on focus refresh (banner error + Dismiss). |

### 6.1 Tests to keep and where they sit

- `apps/server/src/search/routes.test.ts` — room sender name from `bare_peer`.
- `apps/server/src/search/edit-overlay.test.ts` — retraction and edit overlay rules.
- `packages/client-core/src/store/pins.test.ts` — optimistic pin/unpin and rollback.
- No test exists for `message-search.ts` or `search-jump.ts` today; the rewrite's
  shared search model should be tested in `packages/client-core` (Node, no native
  modules) for debounce/supersede/paging, because that is where both apps' rule will
  live. UI behaviour stays with the lead's phone smoke and Julio's live checks.
