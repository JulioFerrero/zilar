# Messages list and bubble: rewrite map

Status: audit for T-2230, 2026-10-19. No code changes in this task.

Scope: 26 files, 7,468 lines (`wc -l`, see Appendix A). The audit maps behaviour as it is on
`main`: the web list is the hand-rolled window in `apps/web/src/components/MessageList.tsx`
(T-2226 is moving it onto virtua), the phone list is an inverted `FlatList`.

## Path legend

| Alias | Real path |
| --- | --- |
| `C/messages.ts` | `packages/chat-core/src/messages.ts` |
| `C/edits.ts` | `packages/chat-core/src/edits.ts` |
| `C/reactions.ts` | `packages/chat-core/src/reactions.ts` |
| `C/markdown.ts` | `packages/chat-core/src/markdown.ts` |
| `C/markdown-ast.ts` | `packages/chat-core/src/markdown-ast.ts` |
| `C/light-markdown.ts` | `packages/chat-core/src/light-markdown.ts` |
| `W/MessageList.tsx` | `apps/web/src/components/MessageList.tsx` |
| `W/MessageListRow.tsx` | `apps/web/src/components/MessageListRow.tsx` |
| `W/MessageBubble.tsx` | `apps/web/src/components/MessageBubble.tsx` |
| `W/message/MessageMenuBody.tsx` | `apps/web/src/components/message/MessageMenuBody.tsx` |
| `W/message/bubbleFlags.ts` | `apps/web/src/components/message/bubbleFlags.ts` |
| `W/message/use-message-menu.ts` | `apps/web/src/components/message/use-message-menu.ts` |
| `W/lib/scrollToMessage.ts` | `apps/web/src/lib/scrollToMessage.ts` |
| `M/message-list.tsx` | `apps/mobile/src/components/chat/message-list.tsx` |
| `M/message-bubble.tsx` | `apps/mobile/src/components/chat/message-bubble.tsx` |
| `M/message-bubble-content.tsx` | `apps/mobile/src/components/chat/message-bubble-content.tsx` |
| `M/plain-bubble-body.tsx` | `apps/mobile/src/components/chat/plain-bubble-body.tsx` |
| `M/message-bubble-actions.tsx` | `apps/mobile/src/components/chat/message-bubble-actions.tsx` |
| `M/message-bubble-decor.tsx` | `apps/mobile/src/components/chat/message-bubble-decor.tsx` |
| `M/message-list-row.tsx` | `apps/mobile/src/components/chat/message-list-row.tsx` |
| `M/message-menu-host.tsx` | `apps/mobile/src/components/chat/message-menu-host.tsx` |
| `M/message-menu-context.tsx` | `apps/mobile/src/components/chat/message-menu-context.tsx` |
| `M/use-message-list-scroll.ts` | `apps/mobile/src/components/chat/use-message-list-scroll.ts` |
| `M/markdown-text.tsx` | `apps/mobile/src/components/chat/markdown-text.tsx` |
| `M/markdown-decision.ts` | `apps/mobile/src/components/chat/markdown-decision.ts` |
| `M/album-grid.tsx` | `apps/mobile/src/components/chat/album-grid.tsx` |

Adjacent files are named in full when the audit only uses them to understand a caller.

## 1. Behaviour list

`Shared` is `shared` when `@zilar/chat-core`/`@zilar/client-core` owns the rule, `partly` when the
rule is shared but each app draws it, and `platform` when only one operating system has it.

### 1.1 Rows, grouping and the divider

| # | Behaviour | Web | Phone | Shared |
| --- | --- | --- | --- | --- |
| 1 | Sort by `createdAt`; group consecutive messages from one sender on one calendar day when the gap is at most 5 minutes; mark first/last in group. | `W/MessageList.tsx:345-351`, `W/MessageListRow.tsx:158-189` | `M/message-list.tsx:450-456`, `M/message-list.tsx:471-480` | shared: `C/messages.ts:7`, `C/messages.ts:28-37`, `C/messages.ts:56-128` |
| 2 | Album: a run with the same non-empty `album.id`, sender, day and window becomes one `AlbumItem`, ordered by `album.index`; a lone marker stays an album of one so older pages do not flip the row. | `W/MessageList.tsx:345-351` (tiles in `W/message/AlbumGrid.tsx:138-205`) | `M/message-list.tsx:450-456`, `M/album-grid.tsx:199-279` | shared: `C/messages.ts:39-53`, `C/messages.ts:87-113` |
| 3 | Day separator between calendar days, labelled "Today"/"Yesterday"/date by `formatDateSeparator`. | `W/MessageListRow.tsx:81-89` | `M/message-list.tsx:50-60` | label shared: `C/messages.ts:14-26`, `C/messages.ts:68-70` |
| 4 | Unread divider above the first unread message; an album counts as all its members; own messages are never unread; the anchor is frozen when the chat opens and re-evaluated against live items. | `W/MessageList.tsx:358-359`, `W/MessageList.tsx:576-596` | `M/message-list.tsx:458-459`, `M/message-list.tsx:461-483` | shared: `C/messages.ts:278-342` |
| 5 | A string anchor (message id) places the divider after that message; a numeric anchor counts unread non-own messages from the end. | same as #4 | same as #4 | shared: `C/messages.ts:308-342` |
| 6 | Draft reply renders as the AI's next message with id `draft-<turnId>` and a timestamp after the newest message. | `W/MessageList.tsx:328-344` | `M/message-list.tsx:434-449` | platform construction, same shape |
| 7 | The final message keeps the draft's React key so the same bubble (and reveal) continues; finished draft turns stay keyed. | `W/MessageListRow.tsx:121-137`, `W/MessageList.tsx:576-578` | `M/message-list.tsx:471-480` | platform key; phone helper `draftEntryKey` in `apps/mobile/src/store/types` |
| 8 | Blocked senders' group/channel messages are hidden, own messages always stay. | `W/MessageList.tsx:316-327` | `M/message-list.tsx:414-419` | rule partly shared in `chat-core/blocked` (`filterBlockedMessages` on phone) |
| 9 | Loading skeleton, error with Retry, and empty state (AI intro with suggestions, DM handle, "No messages yet"). | `W/MessageList.tsx:519-553` | `M/message-list.tsx:560-574`, `M/message-list.tsx:220-309` | platform |
| 10 | A handoff card draws as a centred line (avatars, arrow, task); tapping it expands the full bubble. | `W/MessageListRow.tsx:167-208` | `M/message-bubble.tsx:425`, `M/message-bubble.tsx:619-628` | platform; same label rule duplicated |

### 1.2 Scroll and paging

| # | Behaviour | Web | Phone | Shared |
| --- | --- | --- | --- | --- |
| 11 | Open at the unread divider and centre it; with no unread, open at the bottom. | `W/MessageList.tsx:358-385`, `W/MessageList.tsx:724-740` | `M/use-message-list-scroll.ts:296-301` | platform |
| 12 | Remember the last scroll spot per chat for the session and restore it on remount, unless the newest message changed. | `W/MessageList.tsx:616-722` | `M/use-message-list-scroll.ts:77-78`, `M/use-message-list-scroll.ts:139-169`, `M/use-message-list-scroll.ts:253-293` | platform |
| 13 | Prepending an older page keeps the reader's position; the web grows the 150-item window before paging the archive. | `W/MessageList.tsx:176`, `W/MessageList.tsx:203-270`, `W/MessageList.tsx:388-417`, `W/MessageList.tsx:490-504` | `M/message-list.tsx:600-601` (`maintainVisibleContentPosition`) | platform |
| 14 | A new message is followed only when the reader is at the bottom, or when it is the reader's own send; otherwise it increments an unseen count. | `W/MessageList.tsx:412-416`, `W/MessageList.tsx:473-505` | `M/use-message-list-scroll.ts:303-318` | platform |
| 15 | Jump-to-latest button appears off the bottom, with a badge of unseen messages and an accessible label that includes the count. | `W/MessageList.tsx:375`, `W/MessageList.tsx:600-611` | `M/message-list.tsx:318-338`, `M/message-list.tsx:635` | platform |
| 16 | A growing AI draft pins the bottom only when the reader is already there. | `W/MessageList.tsx:439-451` | `M/use-message-list-scroll.ts:200-232`, `M/use-message-list-scroll.ts:287-290` | platform |
| 17 | Load older history near the top; show "Loading older messages"; stop on `hasMore === false` or after 8 s. | `W/MessageList.tsx:419-437`, `W/MessageList.tsx:486-505`, `W/MessageList.tsx:573-575` | `M/message-list.tsx:623-629`, `M/use-message-list-scroll.ts:200-232` | platform |
| 18 | Phone prefetches the next page three viewports before the end and retries once when the page does not grow content. | n/a (window loads on scroll) | `M/use-message-list-scroll.ts:65-72`, `M/use-message-list-scroll.ts:200-232` | platform |
| 19 | Jump to a search hit or a pin: grow the window to include the message, scroll it to centre, pulse an outline. | `W/MessageList.tsx:181-189`, `W/MessageList.tsx:243-261`, `W/lib/scrollToMessage.ts:3-30` | `M/use-message-list-scroll.ts:320-353` | platform |
| 20 | A pending jump wins over the bottom snap; jump retries re-resolve the row index so late arrivals do not miss. | `W/MessageList.tsx:383-385` | `M/use-message-list-scroll.ts:7-61`, `M/use-message-list-scroll.ts:320-335` | platform |
| 21 | Web announces only a new incoming message appended to the open chat (history prepends and own sends skipped) through an `aria-live` status. | `W/MessageList.tsx:50-72` | no equivalent (phone screen readers read the focused row) | platform |
| 22 | Reduced motion: no send slide-in, no colour transition, no caret blink. | `W/MessageBubble.tsx:586`, `W/MessageBubble.tsx:663-664` | `M/message-bubble-decor.tsx:86-107`, `M/message-bubble.tsx:240-254` | platform |

### 1.3 Bubble layout and body

| # | Behaviour | Web | Phone | Shared |
| --- | --- | --- | --- | --- |
| 23 | Own messages on the right, others on the left; group messages get a 34 px avatar slot on the last of a group and a sender name in the sender's colour on the first. | `W/MessageBubble.tsx:582-608`, `W/MessageBubble.tsx:669` | `M/message-bubble.tsx:590-618`, `M/message-bubble-content.tsx:299-308` | colour: `chat-core/sender-color`; layout: platform |
| 24 | AI sender shows the AI badge beside the name. | `W/message/MessageMeta.tsx:45-59` | `M/message-bubble-content.tsx:299-308` (no badge in bubble) | platform, differs |
| 25 | Time, "edited <time>" or "edited", full date in the title (web), ticks only on own messages. | `W/message/MessageMeta.tsx:25-43` | `M/meta-time.ts:4-8`, `M/plain-bubble-body.tsx:173-234`, `M/message-bubble-decor.tsx:57-83` | formatting shared: `chat-core/format` |
| 26 | Delivery state: clock while sending, one/two ticks, red alert on failure; the phone also writes "Not sent" next to the time. | `W/message/MessageMeta.tsx:40`, `W/MessageTicks.tsx` (outside scope) | `M/ticks.tsx:15-35`, `M/plain-bubble-body.tsx:205-214` | status type shared; glyphs platform |
| 27 | Retracted message becomes a slim tombstone with no actions or reactions: "You deleted this message" / "This message was deleted". | `W/MessageBubble.tsx:209-249`, `W/MessageBubble.tsx:522-532` | `M/message-bubble.tsx:258-303`, `M/message-bubble.tsx:461-470` | platform; same sentences duplicated |
| 28 | Grouping tail: the last bubble in a group gets a flat corner; phone draws an SVG tail, web only rounds. | `W/MessageBubble.tsx:665` | `M/message-bubble.tsx:560-566`, `M/message-bubble-decor.tsx:37-55` | platform |
| 29 | Big-emoji messages (1-3 emoji, no other payload) render at 48 px with meta below and no bubble. | `W/message/bubbleFlags.ts:55-63`, `W/MessageBubble.tsx:690-691` | `M/message-bubble.tsx:414-421`, `M/message-bubble.tsx:527-535` | predicate shared: `chat-core/text` (`isBigEmoji`) |
| 30 | Sticker renders without a bubble, at most 200 pt, same-origin URL only, tap opens the pack, failed send offers Retry. | `W/MessageBubble.tsx:610-643` | `M/message-bubble-content.tsx:51-121`, `M/message-bubble-content.tsx:420-464` | platform; trust rule shared |
| 31 | Markdown decision: incoming in an AI chat, or incoming AI in a group; own and human messages stay plain. | `W/message/bubbleFlags.ts:43` | `M/chat-row-facts.tsx:55-57` | shared: `C/markdown.ts:5-17` |
| 32 | Full Markdown: GFM, headings, lists, task lists, tables, quotes, fenced code; raw HTML dropped, remote images shown as alt text, links limited to `http:`, `https:`, `mailto:`. | `W/MarkdownText.tsx:8-45` (outside scope), `W/MessageBubble.tsx:405-415` | `M/markdown-text.tsx:38-429` | AST + URL rules shared: `C/markdown-ast.ts:37-190` |
| 33 | Plain text: mentions as chips (mine highlighted), links underlined and opened safely, light bold/italic/inline code, code fences split into blocks. | `W/LinkText.tsx` (outside scope), `W/MessageBubble.tsx:417-423` | `M/plain-bubble-body.tsx:77-162`, `M/plain-bubble-body.tsx:263-341` | parsing shared: `C/light-markdown.ts:19-117`, mentions/links in `chat-core` |
| 34 | Reply quote: sender name coloured, excerpt or media label, click/long-press jumps to the quoted message; unknown sender hides the quote. | `W/MessageBubble.tsx:52-97` | `M/message-bubble-content.tsx:124-173` | content shared: `C/messages.ts:219-276` |
| 35 | Forward label: "Forwarded from X" / "Forwarded from X in Y". | `W/MessageBubble.tsx:138-149` | `M/message-bubble-content.tsx:196-209` | rule duplicated in the two headers |
| 36 | Routine card header (repeat icon, title, schedule) links to Settings > Routines. | `W/MessageBubble.tsx:196-207`, `W/MessageBubble.tsx:683-688` | `M/message-bubble-content.tsx:176-194`, `M/message-bubble-content.tsx:319-323` | platform |
| 37 | Cards (`progress`, `blocks`, `sticker`, `routine`, `handoff.line`) render by type; a routine card from a sender not allowed to send it is hidden. | `W/MessageBubble.tsx:504`, `W/MessageBubble.tsx:683-688` | `M/message-bubble-content.tsx:336-368` | allow-list shared: `client-core` (`isCardAllowedFrom`) |
| 38 | Attachments: image, file, GIF video, voice note, with upload progress, cancel, open and retry. | `W/MessageBubble.tsx:694-719` (`AttachmentBody` outside scope) | `M/message-bubble-content.tsx:324-396` (`attachment-body`, `media-bubble`, `voice-message` outside scope) | payload type shared; markup platform |
| 39 | Album grid: one photo full width, two half, three one large + two, four+ 2x2 with `+N`; retry per tile; media trust. | `W/message/AlbumGrid.tsx:138-205` (outside the 26) | `M/album-grid.tsx:199-279` | grouping shared: `C/messages.ts:39-53`; layout duplicated |
| 40 | Link preview: first `https://` link, skipped when the message already has an image/attachment; card shows site, title, description, thumbnail; a failed fetch shows nothing. | `W/MessageBubble.tsx:291-353`, `W/MessageBubble.tsx:401-427` | `M/plain-bubble-body.tsx:343-492` | URL choice shared: `C/messages.ts:344-356` |
| 41 | Reaction chips: count and "mine" state, accessible label, list of names (title on web, 3 s line on phone after long-press), tap toggles. | `W/MessageBubble.tsx:106-136`, `W/MessageBubble.tsx:734-736` | `M/message-bubble.tsx:84-146`, `M/message-bubble.tsx:568-580` | label shared: `C/messages.ts:358-362`; summarise: `C/reactions.ts:56-88` |
| 42 | AI draft look: recessed "generating" bubble, smooth text, caret, "generating" label, then a 400 ms fade to the incoming look. | `W/message/bubbleFlags.ts:45-50`, `W/MessageBubble.tsx:464-468` | `M/message-bubble.tsx:210-256` | smooth text shared: `client-core` |

### 1.4 Actions, menus, selection, accessibility

| # | Behaviour | Web | Phone | Shared |
| --- | --- | --- | --- | --- |
| 43 | Open the message menu with right-click anywhere on the bubble, or the hover actions button (keyboard focusable). | `W/MessageBubble.tsx:562-570`, `W/MessageBubble.tsx:639`, `W/MessageBubble.tsx:723` | n/a | platform |
| 44 | Open the menu with a long press (350 ms) on the bubble, sticker, big emoji, media tile or card; a haptic fires. | n/a | `M/message-bubble.tsx:435-455`, `M/message-bubble.tsx:537-540`, `M/message-bubble-actions.tsx:68-71` | platform |
| 45 | Double-click (web) replies; double-tap (phone) applies the first quick reaction; swipe right past 60 px replies and springs back. | `W/MessageBubble.tsx:186-194`, `W/MessageBubble.tsx:581` | `M/message-bubble.tsx:313-339`, `M/message-bubble.tsx:653-747` | platform |
| 46 | Menu quick reactions: the six shared emoji, disabled until the message has a wire id, plus "More reactions" opening the emoji picker. | `W/message/MessageMenuBody.tsx:143-168`, `W/message/MessageMenuBody.tsx:323-330` | `M/message-bubble-actions.tsx:282-322`, `M/message-bubble-actions.tsx:326-335` | set shared: `C/reactions.ts:3`; `canAct`: `C/edits.ts:27-29` |
| 47 | Menu items and conditions: Reply always; Forward and Select only when forwardable; Edit only own text under 48 h; Copy only with text; Download only for a safe file URL; Delete when own/any-in-DM; Pin/Unpin when allowed. | `W/message/MessageMenuBody.tsx:95-119`, `W/message/MessageMenuBody.tsx:170-279` | `M/message-bubble-actions.tsx:111-125`, `M/message-bubble-actions.tsx:176-268` | edit/delete rules shared: `C/edits.ts:8-29`; the menu conditions are duplicated |
| 48 | Delete semantics: DM own offers "Delete for everyone"/"Delete for me"; DM peer offers "Delete for me"; group offers "Delete for everyone"; album delete targets every member. | `W/message/MessageMenuBody.tsx:91-101`, `W/message/MessageMenuBody.tsx:282-322` | `M/message-bubble-actions.tsx:111-125`, `M/message-bubble-actions.tsx:340-398` | selection rule exists separately: `C/messages.ts:364-377` |
| 49 | Copy text shows "Copied" (web toast, phone notice unless the system confirms). | `W/message/MessageMenuBody.tsx:212-222` | `M/message-bubble-actions.tsx:148-154` | platform |
| 50 | Pin/unpin shows success/failure feedback; Unpin is chosen when the message already has a `pinId`. | `W/message/MessageMenuBody.tsx:248-279`, `W/message/MessageMenuBody.tsx:49-62` | `M/message-bubble-actions.tsx:250-267` | platform |
| 51 | Selection mode: checkbox on each row, tap the row to toggle (web ignores taps on the checkbox itself), messages that cannot be forwarded are disabled, entering selection comes from the menu. | `W/MessageBubble.tsx:571-599` | `M/message-bubble.tsx:597-644`, `M/message-bubble.tsx:435-455` | `canForward` duplicated |
| 52 | Accessibility: bubble body + time + delivery state read as one label on phone; ticks are hidden from screen readers; menu/chip/action labels are fixed strings. | `W/MessageBubble.tsx:251-280`, `W/MessageBubble.tsx:91-97`, `W/MessageBubble.tsx:592-597` | `M/lib/message-a11y.ts:43-46`, `M/ticks.tsx:38-48`, `M/message-bubble.tsx:107-115` | platform |
| 53 | Failed sends: a failed sticker shows Retry; attachments/voice have their own retry paths; only the phone opens a failed text menu with Retry and local Delete. | `W/MessageBubble.tsx:624-635` | `M/message-bubble-actions.tsx:115-122`, `M/message-bubble-actions.tsx:177-195` | phone `retryText` guard; web has no text retry (differs) |

## 2. Twin logic

Every row is a rule web and phone implement twice with the same outcome. Line counts are the
range lengths in each file (`end - start + 1`).

| Rule | Web | Phone | Duplicated lines | Target home |
| --- | --- | --- | --- | --- |
| Bubble flags (`own`, `deleted`, `generating`, `canEdit`, `canDelete`, `canForward`, `bigEmoji`, `showSender`, `mediaTop`, `imageOnly`, `failed`) | `W/message/bubbleFlags.ts:29-121` (93) | `M/message-bubble.tsx:373-432` (60) | 153 | `C/message-view.ts` |
| Menu items and their conditions | `W/message/MessageMenuBody.tsx:95-119` + `:143-279` (162) | `M/message-bubble-actions.tsx:111-125` + `:176-268` (108) | 270 | `C/message-menu.ts` |
| Delete labels, confirm copy and targets | `W/message/MessageMenuBody.tsx:91-101`, `:282-322` (52) | `M/message-bubble-actions.tsx:111-125`, `:340-398` (74) | 126 | `C/message-menu.ts` |
| Reaction chips (count, mine, toggle, names) | `W/MessageBubble.tsx:106-136` (31) | `M/message-bubble.tsx:84-146` (63) | 94 | `C/message-view.ts` + platform chip |
| Reply quote block | `W/MessageBubble.tsx:52-97` (46) | `M/message-bubble-content.tsx:124-173` (50) | 96 | `C/quote.ts` + platform block |
| Forwarded header | `W/MessageBubble.tsx:138-149` (12) | `M/message-bubble-content.tsx:196-209` (14) | 26 | `C/message-view.ts` label |
| Handoff line + `personFor` | `W/MessageListRow.tsx:18-75` (58) | `M/message-bubble.tsx:156-208` (53) | 111 | `C/message-rows.ts` label + platform line |
| Tombstone | `W/MessageBubble.tsx:209-249` (41) | `M/message-bubble.tsx:258-303` (46) | 87 | `C/message-view.ts` sentence + platform |
| Date separator + unread divider | `W/MessageListRow.tsx:81-99` (19) | `M/message-list.tsx:50-72` (23) | 42 | `C/message-rows.ts` + platform pill |
| Empty chat (AI suggestions, model line, DM handle) | `W/MessageList.tsx:92-174` (83) | `M/message-list.tsx:220-309` (90) | 173 | `C/preview.ts` data, platform view |
| Draft message construction | `W/MessageList.tsx:328-344` (17) | `M/message-list.tsx:434-449` (16) | 33 | `C/message-rows.ts` |
| List entry building and keys | `W/MessageList.tsx:345-351`, `W/MessageListRow.tsx:125-137` (20) | `M/message-list.tsx:461-483` (23) | 43 | `C/message-rows.ts` |
| Big-emoji predicate inputs | `W/message/bubbleFlags.ts:55-63` (9) | `M/message-bubble.tsx:414-421` (8) | 17 | `C/message-view.ts` |
| Media/attachment classification | `W/message/bubbleFlags.ts:66-84` (19) | `M/message-bubble-content.tsx:324-396` (73) | 92 | `C/message-view.ts` |
| Edited time text | `W/message/MessageMeta.tsx:32-39` (8) | `M/meta-time.ts:4-8` (5) | 13 | `C/message-view.ts` |
| Album layout by photo count + photo extraction | `W/message/AlbumGrid.tsx:20-40`, `:138-205` (89) | `M/album-grid.tsx:37-69`, `:199-279` (114) | 203 | `C/album.ts` (`albumPhotos`, `albumSlots`) |
| Chat list preview flattening (AI reply strips Markdown, human/own stays light) | `W/ChatListItem.tsx:56-61` (6) | `M/markdown-decision.ts:12-20` (9) | 15 | `C/preview.ts` with one formatting rule |

The markdown renderer itself is not a twin: web uses `react-markdown` and phone renders the
shared AST (`C/markdown-ast.ts`). The safe-URL rule is one home (`C/markdown-ast.ts:37-46`) and
the decision to render Markdown is one home (`C/markdown.ts:5-17`). Keep it that way.

## 3. Slop by rule

### 3.1 One home per piece of logic

| Where | What | Lines |
| --- | --- | --- |
| `W/message/bubbleFlags.ts:29-121` and `M/message-bubble.tsx:373-432` | Same 20-flag view model written twice. | 153 |
| `W/message/MessageMenuBody.tsx:95-119` + `:143-279` and `M/message-bubble-actions.tsx:111-125` + `:176-268` | Same menu items, same conditions, two renderers. | 270 |
| `W/message/MessageMenuBody.tsx:91-101` + `:282-322` and `M/message-bubble-actions.tsx:111-125` + `:340-398` | Same DM/group delete copy and album target rule. | 126 |
| `C/messages.ts:364-377`, `W/message/MessageMenuBody.tsx:99-101`, `M/message-bubble-actions.tsx:125` | Three homes for "which delete action is allowed". | 18 |
| `W/MessageBubble.tsx:52-97` and `M/message-bubble-content.tsx:124-173` | Quote chrome plus colour choice; only the content is shared. | 96 |
| `W/MessageBubble.tsx:106-136` and `M/message-bubble.tsx:84-146` | Reaction chip markup and name list, two implementations. | 94 |
| `W/MessageBubble.tsx:209-249` and `M/message-bubble.tsx:258-303` | Tombstone layout and sentences. | 87 |
| `W/MessageListRow.tsx:18-75` and `M/message-bubble.tsx:156-208` | `personFor` + handoff line, same fallback chain. | 111 |
| `W/MessageListRow.tsx:81-99` and `M/message-list.tsx:50-72` | Date separator and unread divider markup. | 42 |
| `W/MessageList.tsx:92-174` and `M/message-list.tsx:220-309` | Empty chat, same two API calls and same fallback. | 173 |
| `W/MessageList.tsx:328-344` and `M/message-list.tsx:434-449` | Draft message built twice. | 33 |
| `W/message/MessageMeta.tsx:32-39` and `M/meta-time.ts:4-8` | "edited <time>" formatting. | 13 |
| `C/messages.ts:147-170`, `:172-204`, `:219-241` | The same payload priority (album/voice/image/attachment/text/card) written three times. | 80 |
| `W/message/bubbleFlags.ts:66-84` and `M/message-bubble-content.tsx:324-396` | Attachment/GIF/image/voice priority in two places. | 92 |
| `W/message/AlbumGrid.tsx:20-40` + `:138-205` and `M/album-grid.tsx:37-69` + `:199-279` | Photo extraction and 1/2/3/4+ layout rule duplicated. | 203 |

### 3.2 Trust the types and the contract

| Where | What | Lines |
| --- | --- | --- |
| `W/message/MessageMenuBody.tsx:93-101` | Looks the chat up again in the store and defaults `chat?.kind` to group semantics; if the chats list is not loaded, a DM menu offers "Delete for everyone". The menu should receive the decoded chat from the view model. | 9 |
| `W/message/MessageMenuBody.tsx:99`, `M/message-bubble.tsx:386` | `chat.isAI !== true` on a required boolean; `!chat.isAI` is the same rule. | 2 |
| `W/message/bubbleFlags.ts:44`, `M/message-bubble.tsx:405`, `C/messages.ts:163`, `C/messages.ts:190` | `text !== undefined && text.length > 0` derived four times; one `hasText` in the view model. | 4 |
| `C/messages.ts:321` | `!Number.isFinite(anchor)` on a number that comes from a count; the string branch already covers ids. Keep the `<= 0` check, drop the rest. | 2 |
| `M/plain-bubble-body.tsx:319` | `(message.mentions ?? []).map(...)` allocates and rebases mentions per text block; the block already knows its slice, so one precomputed offset map is enough. | 5 |

### 3.3 No layers that do nothing

| Where | What | Lines |
| --- | --- | --- |
| `W/message/use-message-menu.ts:1-23` | One caller (`W/MessageBubble.tsx:284`); six callbacks for two booleans. Inline as two `useState` calls in the menu. | 23 |
| `M/message-list-row.tsx:1-12` | Type-only file with one exported union; fold into `M/message-list.tsx`. | 12 |
| `W/MessageBubble.tsx:283-289` | `MessageMenu` wrapper with one caller. | 7 |
| `W/MessageBubble.tsx:384-430` | `MessageTextBody` wrapper with one call at `:710`; its choice is markdown vs plain, plus `previewUrl`. | 47 |
| `W/MessageBubble.tsx:295-353` | `LinkPreviewCard` with one call at `:427`. | 59 |
| `W/MessageBubble.tsx:251-281` | `MessageActionsButton`, two calls in the same file. | 31 |
| `W/message/bubbleFlags.ts:24-27` + `:45-47` | `draftAnimates` re-computes `animate`, which `bubbleFlags` computes again. | 8 |
| `M/message-bubble-actions.tsx:68-71` | `openMessageMenu` haptic wrapper with one caller. | 4 |
| `M/album-grid.tsx:37-70` | `albumPhotosOf` is exported but has one caller in the same file. | 34 |

### 3.4 Data over branches

| Where | What | Lines |
| --- | --- | --- |
| `C/messages.ts:147-170`, `:172-204`, `:219-241` | Three `if` chains encode the same payload order; one `kindOf(message)` and a `Record<Kind, label>` removes two. | 80 |
| `W/message/bubbleFlags.ts:29-121` | 20 booleans from a 93-line `if` chain; a `kind` + capability object is smaller and testable. | 93 |
| `M/message-bubble-content.tsx:324-414` | Five-way body choice (`media`, card, attachment, voice, markdown, plain) in JSX. | 91 |
| `M/message-bubble-actions.tsx:176-268` | Seven conditional spreads build one action list. | 93 |
| `W/message/MessageMenuBody.tsx:143-330` | Conditional JSX for every item plus three confirm dialogs. | 188 |
| `W/MessageListRow.tsx:194-208` | Nested ternary chooses separator/handoff/bubble. | 15 |
| `M/ticks.tsx:15-35` (web `MessageTicks.tsx` is outside scope) | Status-to-glyph chain instead of a record keyed by `MessageStatus`. | 21 |

### 3.5 Use the platform and the libraries we have

| Where | What | Lines |
| --- | --- | --- |
| `W/MessageList.tsx:203-270`, `:388-417`, `:453-471`, `:473-505`, `:616-722` | Hand-rolled window, anchor map, `ResizeObserver` pinning, DOM queries and rAF scroll save. Virtua owns row virtualisation, `scrollToIndex` and shift-on-prepend; T-2226 is already moving this list. | 257 |
| `M/use-message-list-scroll.ts:1-356` | Hand-rolled restore, follow, unseen count, prefetch, jump retries and content-size bookkeeping around an inverted `FlatList`. `maintainVisibleContentPosition`, `initialScrollIndex` and `onEndReached` already exist; keep only the follow/unseen policy. | 356 |
| `M/message-list.tsx:486-488` | Reverses the whole entry array and converts every index by hand; `FlatList`'s inverted data does this once in the list. | 3 |
| `M/message-bubble.tsx:237-254` and `:653-747` | Legacy `Animated` for the generating swap and Reanimated for gestures on the same row. Use Reanimated for both. | 18 |
| `W/MessageBubble.tsx:295-310` and `M/plain-bubble-body.tsx:382-428` | Two link-preview fetch implementations in components (web effect, phone cache + in-flight map). Move the cache to `client-core`; the cards stay platform markup. | 16 + 47 |
| `M/message-list.tsx:604-616` | Manual `onScrollToIndexFailed` re-scroll dance; LegendList or a virtua-style list removes it. | 13 |
| `W/MessageList.tsx:97-124` and `M/message-list.tsx:226-254` | Same AI empty-state fetch logic written against two API styles; the data part belongs in `client-core`. | 28 + 29 |

### 3.6 No speculative code

| Where | What | Lines |
| --- | --- | --- |
| `M/message-bubble-content.tsx:221-222`, `:227`, `:238-239` | `onEdit`, `onDelete`, `onStartSelect`, `onPin`, `onUnpin` are declared on `MessageBubbleProps` but never passed: the only `<MessageBubble>` call is `M/message-list.tsx:131-155`. | 5 |
| `M/message-bubble-actions.tsx:379-380`, `:392-393` | `busy={false}` and `busyLabel="Deleting…"` on both confirm dialogs. | 4 |
| `W/message/bubbleFlags.ts:102` | `beyondDraft` is returned but `W/MessageBubble.tsx:469-491` never reads it. | 1 |
| `W/MessageBubble.tsx:154-170`, `W/message/bubbleFlags.ts:11-22` | Exported prop types with one consumer each (see part 4). | 29 |
| `M/message-bubble.tsx:403` | `const react = onReact ?? (() => {})`; every caller passes `onReact` (`M/message-list.tsx:526`). | 1 |

### 3.7 Comments

256 of 7,468 lines are comments (3.4%). Many are useful WHY notes (album marker, preview
priority, Android zero-alpha trick); the ones below restate the next lines or the old task, and
the target budget assumes about half of the 256 disappear with the code they describe.

| Where | What | Lines |
| --- | --- | --- |
| `M/message-bubble-actions.tsx:73` | One-line summary of what the sheet offers; the JSX says it. | 1 |
| `M/message-list.tsx:127` | Restates the album item rendering. | 1 |
| `M/message-list.tsx:193-194` | Restates the memo comparator below. | 2 |
| `M/use-message-list-scroll.ts:94-97` | Restates inverted-list mechanics. | 4 |
| `W/MessageList.tsx:45-48` | Restates the announcer. | 4 |
| `W/MessageList.tsx:296` | Restates the `historyState` default. | 1 |
| `C/messages.ts:55` | Restates `groupMessages`. | 1 |
| `C/messages.ts:364` | Restates `deleteActionFor`. | 1 |
| `M/markdown-decision.ts:9` | Says the decision is "unit-tested"; no test file imports it (`git grep -ln markdown-decision -- '*.test.*'` is empty). The claim is false. | 1 |
| `W/message/bubbleFlags.ts:48-49`, `:86-88` | Explain WHY (400 ms transition, edit limits) and should stay. | 0 cost |

### 3.8 Tests

- The shared logic is covered in `packages/chat-core/src/messages.test.ts` (grouping, previews,
  divider), `edits.test.ts`, `reactions.test.ts` and `markdown-ast.test.ts`. A split of
  `C/messages.ts` must move these cases to the new modules; deleting them loses the only tests
  of the divider math and album grouping.
- `M/markdown-decision.ts` has no test despite its comment (see 3.7). The shared replacement
  (`C/preview.ts`) should get the 4 cases (AI MD, AI plain, human, own) or the claim should go.
- UI code gets no tests per `AGENTS.md`; the phone smoke and live checks cover part 1.

## 4. Dead code

Proof pattern: `git grep -n -w <name> -- ':!<own file>'` prints nothing means no importer
outside the defining file. All results below were run on the task branch.

| Item | Location | Proof | Action |
| --- | --- | --- | --- |
| `onEdit`, `onDelete`, `onStartSelect`, `onPin`, `onUnpin` props | `M/message-bubble-content.tsx:221-222`, `:227`, `:238-239` | The only `<MessageBubble>` call is `M/message-list.tsx:131-155` and passes none of them. `M/message-bubble.tsx:342-366` destructures none of them. | Delete the five props. |
| `albumPhotosOf` export | `M/album-grid.tsx:37-70` | `git grep -n -w albumPhotosOf` → definition `:37` and use `:209`, same file. | Unexport; move the body to `C/album.ts` in the rewrite. |
| `MessageTextBody` export | `W/MessageBubble.tsx:384` | `git grep -n -w MessageTextBody -- ':!apps/web/src/components/MessageBubble.tsx'` → empty. | Drop export keyword; the rewrite keeps the body inside `MessageBubble.tsx`. |
| `MessageActionsButton` export | `W/MessageBubble.tsx:251` | Only `:639` and `:723`, same file. | Drop export. |
| `MessageTombstone` export | `W/MessageBubble.tsx:209` | Only `:524`, same file. | Drop export. |
| `RoutineHeader` export | `W/MessageBubble.tsx:196` | Only `:686`, same file. | Drop export. |
| `LinkPreviewCard` export | `W/MessageBubble.tsx:295` | Only `:427`, same file. | Drop export; the rewrite extracts the file. |
| `EmptyChat` export | `W/MessageList.tsx:92` | Only `:549`, same file. | Drop export. |
| `HandoffLine` export and `HandoffLineProps` | `W/MessageListRow.tsx:37-44` | Only `:198`, same file; no other importer. | Drop export, fold into `MessageRow`. |
| `MessageListRowProps` export | `W/MessageListRow.tsx:101` | Only `:139`, same file. | Drop export. |
| `MessageBubbleProps` export (web) | `W/MessageBubble.tsx:154` | Only `:448`, same file. | Drop export. |
| `BubbleFlagsInput` export | `W/message/bubbleFlags.ts:11` | Only `:29`, same file. | Drop export; the type moves to `C/message-view.ts`. |
| `PreviewOptions`, `ReplyQuoteContent` exports | `C/messages.ts:9-12`, `:247-252` | `git grep -l -w` finds one file for each; `PreviewKind` is imported by both chat-list rows, so it stays exported. | Keep the shapes, drop `export`. |
| `LightBlock`, `LightInline`, `EditMention`, `CorrectionUpdate`, `RetractionUpdate`, `CorrectionEntry`, `MessageEdits`, `ReactionUpdate`, `ReactionEntry`, `GROUP_WINDOW_MS` exports | `C/light-markdown.ts:1-11`, `C/edits.ts:38-86`, `C/reactions.ts:8-22`, `C/messages.ts:7` | `git grep -l -w` finds one file for each. | Drop `export`; these are implementation shapes. |
| `beyondDraft` return field | `W/message/bubbleFlags.ts:102` | `W/MessageBubble.tsx:469-491` never destructures it. | Remove the field. |
| `busy`/`busyLabel` values | `M/message-bubble-actions.tsx:379-380`, `:392-393` | Literal `false` and constant strings, never varied by a caller. | Remove the props. |

Branches checked and reachable, so keep: failed-sticker menu suppression
(`W/MessageBubble.tsx:537`), handoff expansion (`W/MessageListRow.tsx:167-205`), DM peer delete
(`W/message/MessageMenuBody.tsx:299-310`), `selecting` defaults (`W/MessageBubble.tsx:441-442`),
and `chat.topic` padding (`W/MessageList.tsx:567-570`).

## 5. Lean target structure

### 5.1 What moves where

- **`packages/chat-core/src`** owns every pure rule that both apps need: grouping and rows,
  bubble view model, menu model and delete semantics, preview/quote text, reaction summaries,
  edit/delete windows, Markdown decision and parsers, album rules. No React, no icons, no
  colours, no platform imports.
- **`packages/client-core/src`** owns the one link-preview fetch/cache (both apps already have
  an API module) and keeps the existing sheet/album providers the apps need.
- **`apps/web/src/components/message`** keeps markup, the virtua list engine, DOM scrolling,
  context menus and keyboard focus. It must not compute a flag or a menu condition.
- **`apps/mobile/src/components/chat`** keeps markup, gestures, haptics, the sheet host and the
  `FlatList`/LegendList engine. It must not compute a flag or a menu condition either.

The rewrite is done in one task per `docs/LEAN_CODE.md`: callers move in the same commit and the
old files are deleted, with no compatibility flag.

### 5.2 Shared files (chat-core unless noted)

| File | Owns | Budget |
| --- | --- | --- |
| `grouping.ts` | Sort, 5-minute group window, album run, day keys, `RenderItem` construction. | 100 |
| `message-rows.ts` | `buildRows(messages, { draft, unreadAnchor, meId })`: separators, divider, draft, album items, entry keys. Replaces the two entry builders. | 90 |
| `message-view.ts` | `messageView(message, chat, me, state)`: `kind`, `own`, `deleted`, `generating`, `hasText`, `showSender`, `mediaFirst`, capability booleans (`canCopy/Edit/Delete/DeleteForMe/Forward/Pin/React/Select`), meta time/edited text and delivery status, accessibility body words, big-emoji predicate. Glyphs stay platform. | 170 |
| `message-menu.ts` | `menuModel(view, { isDm, isPinned, albumMembers, canPin })`: quick reactions, ordered item list with `label/action/enabled/destructive`, delete target ids and confirm copy, `deleteActionFor` for selection. Icons are action ids, not components. | 110 |
| `preview.ts` | `previewParts`, `replyQuoteLabel` and `firstName`; one Markdown-vs-light flattening rule for both chat-list rows. | 80 |
| `quote.ts` | `replyQuoteContent`: name/excerpt/media label, own detection, unknown-sender hide. | 55 |
| `reactions.ts` | Existing reducer, `summarize`, `mergeTargets`, `chipLabel`, quick set, cap. | 70 |
| `edits.ts` | Existing correction/retraction reducer and `canEditMessage`/`canDeleteMessage`/`canAct`. | 165 |
| `markdown.ts` | `shouldRenderMarkdown` and `markdownToPlain`. | 50 |
| `markdown-ast.ts` | Shared AST parser and safe URL rule. | 150 |
| `light-markdown.ts` | Inline light Markdown, code fences, `lightToPlain`. | 90 |
| `album.ts` | `albumPhotosOf`, `albumSlots(count)` (1/2/3/4+ geometry as data), `albumHiddenCount`. | 55 |
| `chat-rules.ts` | `canPostTo`; move the unrelated set helpers (`withoutId`, `withKey`) here or inline at their two callers. | 20 |
| `packages/client-core/src/link-preview.ts` | Link-preview fetch, in-flight dedupe and session cache; callers pass their API function. | 60 |
| **Total** | | **1,265** |

### 5.3 Web files

| File | Owns | Budget |
| --- | --- | --- |
| `components/message/MessageList.tsx` | Virtua list, paging (`onScroll` top, load older, 8 s guard), open-at-unread/restore, follow and unseen count, jump-to-latest, announcer. | 190 |
| `components/message/MessageRow.tsx` | Separator, unread divider, handoff line + expansion, album-members provider, row key, bubble props. | 110 |
| `components/message/MessageBubble.tsx` | Own/other layout, avatar slot, selection checkbox, hover actions button, right-click menu anchor, double-click reply, tombstone, tail corner, reactions placement. | 170 |
| `components/message/BubbleHeader.tsx` | Header order: sender row via the existing `MessageSender` (AI badge), forwarded label, reply quote button, routine header. | 90 |
| `components/message/ReactionChips.tsx` | Chips and names title. | 40 |
| `components/message/MessageMenu.tsx` | Renders `MenuModel`: quick row, picker, items with icon table, pin/unpin, three confirm dialogs, toast. | 130 |
| `components/message/LinkPreviewCard.tsx` | Card markup, thumbnail, broken image. Uses `client-core` cache. | 55 |
| `components/message/EmptyChat.tsx` | AI intro/suggestions, DM handle, empty state; uses the existing app API modules. | 65 |
| `lib/scrollToMessage.ts` | Scroll into view + pulse. Unchanged. | 30 |
| **Total** | | **880** |

Reuse `W/message/MessageMeta.tsx`, `AttachmentBody.tsx`, `AlbumGrid.tsx`, `BigEmoji.tsx`,
`StickerMessage.tsx`, `QuestionCard.tsx`, `MarkdownText.tsx`, `LinkText.tsx`. They are outside
this scope and keep their responsibilities; the rewrite only stops duplicating their rules.
`AlbumGrid.tsx` must import `albumPhotosOf`/`albumSlots` from `C/album.ts` in the same commit;
its lines are outside the 7,468 and are not counted in the budget.

### 5.4 Mobile files

| File | Owns | Budget |
| --- | --- | --- |
| `message-list.tsx` | FlatList (or LegendList if the spec adds the dependency) in inverted order, paging, empty/jump states, row rendering, menu host wiring. | 190 |
| `message-bubble.tsx` | Row layout, avatar/name slot, selection, handoff expansion, reveal animation, tombstone, tail, gesture wiring. | 220 |
| `message-bubble-content.tsx` | Body dispatch by `view.kind`, sender header, forward, quote, routine, sticker/big-emoji wrappers, card/media/attachment/voice slots, meta placement. | 190 |
| `plain-bubble-body.tsx` | RN inline text tree: mentions, links, light formatting, code blocks, meta tail/overlay, generating label. | 210 |
| `link-preview.tsx` | Card markup only; calls the client-core cache. | 85 |
| `markdown-text.tsx` | AST renderer, code block, lists, quotes, tables, inline styles. | 250 |
| `album-grid.tsx` | Tiles, gradient/local/remote sources, retry, `+N`, layout from `albumSlots`. | 160 |
| `message-bubble-actions.tsx` | The one action sheet: renders `MenuModel`, quick row, picker, retry/delete-local, three confirm variants, labels. | 120 |
| `message-menu-host.tsx` | List-level sheet host and open/reopen sequencing. | 75 |
| `message-bubble-decor.tsx` | Tail, meta, caret, generating label, big emoji, timing constants. | 100 |
| `use-message-list-scroll.ts` | Follow/unseen policy, jump retries, restore using the list engine; no manual anchor bookkeeping. | 180 |
| `message-menu-context.tsx` | Context that lets media tiles forward a long press. Keep as is. | 18 |
| **Total** | | **1,798** |

### 5.5 Files deleted

| File | Today | Replaced by |
| --- | --- | --- |
| `W/MessageList.tsx` | 740 | `W/message/MessageList.tsx` |
| `W/MessageListRow.tsx` | 212 | `W/message/MessageRow.tsx` |
| `W/MessageBubble.tsx` | 740 | `W/message/MessageBubble.tsx`, `BubbleHeader.tsx`, `ReactionChips.tsx`, `LinkPreviewCard.tsx` |
| `W/message/MessageMenuBody.tsx` | 333 | `W/message/MessageMenu.tsx` + `C/message-menu.ts` |
| `W/message/bubbleFlags.ts` | 122 | `C/message-view.ts` |
| `W/message/use-message-menu.ts` | 23 | state inside `MessageMenu.tsx` |
| `M/message-list-row.tsx` | 12 | folded into `M/message-list.tsx` |
| `M/markdown-decision.ts` | 21 | `C/preview.ts` + callers |
| `C/messages.ts` | 401 | `grouping.ts`, `message-rows.ts`, `preview.ts`, `quote.ts`, `message-menu.ts`, `chat-rules.ts` |
| **Deleted total** | **2,604** | |

The other 17 scope files are rewritten in place, not kept beside the new code: `C/edits.ts`,
`C/reactions.ts`, `C/markdown.ts`, `C/markdown-ast.ts`, `C/light-markdown.ts`,
`W/lib/scrollToMessage.ts` (unchanged), and the 11 existing mobile files in 5.4
(`message-menu-context.tsx` stays unchanged; `link-preview.tsx` is new).

Adjacent files that must change in the same rewrite, but are outside the 7,468 and not counted
in the budget:

- `W/message/AlbumGrid.tsx` (212) imports `albumPhotosOf`/`albumSlots` from `C/album.ts`.
- `M/lib/message-a11y.ts` (46) folds into `C/message-view.ts`; the phone keeps only the
  platform ordering/joining of the words.
- `M/chat-row-facts.tsx` (76) drops `showMarkdown`, which the view model carries.
- `W/ChatListItem.tsx` and `M/chat-rows.tsx` call `C/preview.ts` instead of their inline
  Markdown-vs-light branch.

### 5.6 Budget against today

| Home | Today | Budget | Change |
| --- | --- | --- | --- |
| `packages/chat-core/src` | 1,115 | 1,205 | +90 (absorbs view/menu/rows/album rules from the apps) |
| `packages/client-core/src` | 0 | 60 | +60 |
| `apps/web/src` (scope) | 2,200 | 880 | −1,320 (−60%) |
| `apps/mobile/src` (scope) | 4,153 | 1,798 | −2,355 (−57%) |
| **Total** | **7,468** | **3,943** | **−3,525 (−47.2%)** |

This clears the 40% floor with every behaviour in part 1 assigned to a file. The largest single
files are `M/markdown-text.tsx` (250), `M/message-bubble.tsx` (220) and `M/plain-bubble-body.tsx`
(210); none reaches the 400-line soft limit.

### 5.7 Rewrite order

1. **Shared model first.** Add `C/message-view.ts`, `C/message-menu.ts`, `C/message-rows.ts`,
   `C/album.ts`; split `C/messages.ts` into `grouping.ts`, `preview.ts`, `quote.ts`,
   `chat-rules.ts`. Move the `messages.test.ts` cases and add menu-model and view-model tests.
   No app caller changes yet.
2. **Web list engine.** Land T-2226's virtua list on top of `buildRows`; delete the window,
   anchor map and DOM scroll helpers. Keep `scrollToMessage` for pulses.
3. **Web bubble.** Replace `bubbleFlags` with `messageView`, split `MessageBubble` into
   `MessageBubble` + `BubbleHeader` + `ReactionChips` + `LinkPreviewCard`, and render
   `MessageMenu` from `menuModel`. Delete the old files in the same commit.
4. **Phone list and bubble.** Move `useMessageListScroll` to the follow/unseen policy plus the
   list engine's restore; replace the inline flags with `messageView`; rebuild
   `MessageBubbleContent` from `view.kind`.
5. **Phone menu and album.** Render `BubbleActionsSheet` from `menuModel`; move album extraction
   and `albumSlots` to `C/album.ts`; delete `markdown-decision.ts`, `message-list-row.tsx` and
   the dead props.
6. **Cleanup.** Delete all old files, move/trim comments, run `pnpm gate`.

## 6. Risks

| # | Behaviour that is easy to lose | Why it breaks | How the lead checks |
| --- | --- | --- | --- |
| 1 | Album as one item while paging | `C/messages.ts:87-98` treats a lone marker as an album of one on purpose; a naive regroup flips the row when the sibling page arrives. | Web mock: open an album, load older pages; phone emulator: scroll an album across a page boundary; live. |
| 2 | Unread divider position | It counts album members and skips own messages (`C/messages.ts:284-341`); moving the divider into `message-rows.ts` can easily count render items instead of messages. | Web mock: chat with unread 0, 1, many, an album and own sends at the end; open it repeatedly; live. |
| 3 | Open at unread vs restore | Web chooses restore before the divider (`W/MessageList.tsx:369`, `:393-398`); phone gives jump targets priority (`M/use-message-list-scroll.ts:139-146`). A rewrite can make both snap to bottom. | Web mock with slow history; emulator: leave a chat scrolled up, reopen it; live. |
| 4 | Prepend does not jump | Virtua's shift and `maintainVisibleContentPosition` replace the manual scroll-height compensation (`W/MessageList.tsx:401-409`, `M/message-list.tsx:600-601`). | Web mock: load older pages repeatedly while watching the top message; emulator the same; live. |
| 5 | Follow rules | Following every new message steals the reader's place; never following misses own sends (`M/use-message-list-scroll.ts:303-318`). | Web mock: two tabs, send from the other while scrolled up; emulator with a second account; live. |
| 6 | Draft reveal continuity | The final message must keep the draft key and the smooth-text reveal (`W/MessageListRow.tsx:121-137`, `M/message-list.tsx:471-480`); a new key makes the bubble pop and replay. | Web mock AI chat: watch the reply replace the draft; emulator; live. |
| 7 | Menu conditions | `canAct` (sending/failed), album delete and DM-vs-group copy are easy to flatten into "always Delete". | Web mock: right-click sending, failed, own, peer DM and group messages; emulator long-press each; live delete for everyone with two accounts. |
| 8 | Delete for me scope | DM peer delete must remove only the reader's copy (`W/message/MessageMenuBody.tsx:299-310`); the shared menu model must keep targets per album member. | Web mock with a DM; emulator; live: check the peer still has the message. |
| 9 | Markdown decision | Own messages and human DMs must stay plain; only incoming AI replies render Markdown (`C/markdown.ts:5-17`). A shared view model that loses `isAI` paints human text as Markdown. | Web mock: human DM, AI DM, group with AI and human senders; emulator; live. |
| 10 | Safe media and links | Stickers/GIFs auto-load only from trusted hosts, images in Markdown never load, links only `http(s)/mailto` (`C/markdown-ast.ts:37-46`, `M/message-bubble-content.tsx:51-56`). | Web mock with an absolute untrusted URL; emulator; live with a hostile sticker URL. |
| 11 | Link preview rules | Only the first https link, never when an image/attachment exists, no card on failure (`C/messages.ts:344-356`). | Web mock: text+link, link+image, failing preview endpoint; emulator; live. |
| 12 | Reactions order and mine | `summarize` ranks by first stanza order and marks `mine` per reactor (`C/reactions.ts:56-88`); the chips must keep the same order on both apps. | Unit tests plus web mock with two reactors and a phone emulator; live. |
| 13 | Edits, retractions, mentions | Correction wins by stanza order; retraction wins for good; mention ranges shift through code blocks (`C/edits.ts:130-180`, `M/plain-bubble-body.tsx:309-330`). | Keep `edits.test.ts` green; web mock edit/delete; emulator; live. |
| 14 | Selection mode | Checkbox taps must not double-toggle on web (`W/MessageBubble.tsx:571-580`), and non-forwardable rows stay disabled. | Web mock: select several rows, tap the checkbox itself; emulator; live. |
| 15 | Accessibility | The phone bubble label carries body + time + status while ticks are hidden (`M/lib/message-a11y.ts:38-46`, `M/ticks.tsx:38-48`); web has the live announcer and keyboard focus rings. | Web: keyboard-only pass and screen reader; emulator: TalkBack/VoiceOver; live. |
| 16 | Gestures and motion | Swipe-to-reply must not fight the double-tap or vertical scroll; reduced motion removes caret/slide/transition (`M/message-bubble.tsx:653-747`, `:240-254`). | Emulator with reduce motion on; live on device. |
| 17 | Virtua with variable heights | Albums, Markdown tables and expanded handoffs change row height; jump-to-index and restore can land off by a row. | Web mock: albums, long Markdown, handoff expand, jump to a mid-list pin; live. |

## Appendix A: counting

- Scope line counts: task spec, re-counted with `wc -l` over the 26 files → 7,468.
- Comment count: `grep -cE '^[[:space:]]*(//|/\*|\*|\{/\*)'` per file → 256.
- Dead-export proof: `git grep -n -w <name> -- ':!<own file>'` → empty for every exported
  symbol row in part 4.
- Call-site proof for the dead mobile props:
  `git grep -n "<MessageBubble$" -- apps/mobile/src` → only `M/message-list.tsx:131`.
- Budgets are estimates from the behaviour list, not measurements of unwritten code.
