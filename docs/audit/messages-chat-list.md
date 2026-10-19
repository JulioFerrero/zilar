# Messages core D: the chat list

Audit for the messages rewrite, 2026-10-19. Scope: chat list, new chat, contact requests,
folders, chat preferences, unread counts, read marks and delivery marks on web, phone and
server. No code was changed.

Measured with `wc -l` on 2026-10-19: the 29 scope files total **6,710 lines**. The task
estimate says 6,743; two files moved since it was written (`chat-folders/api.ts` is 110, not
142, and `chat-prefs/api.ts` is 124, not 125). Every number below comes from the file and
line ranges cited next to it.

## 1. Behaviour list

A behaviour is something a user sees or relies on. "Server guarantee" means the server is
the authority even when the client also computes a value.

### The row

1. **Avatar and presence.** The row shows the chat avatar, an online dot and an AI badge.
   Web `ChatListItem.tsx:122-127`; phone `chat-rows.tsx:359`; the list response carries
   `avatarUrl`, `title`, `isAi` (`chats/api.ts:449-480`), presence comes from the shared
   store.
2. **Title and kind markers.** Title, AI badge, channel icon plus "Channel"/subscriber
   count, public label, pin icon and mute icon.
   Web `ChatListItem.tsx:129-158`; phone `chat-rows.tsx:363-393`; server supplies
   `chatKind`, `visibility`, `memberCount`, `subscriberCount`, `pinnedAt`, `muted`
   (`chats/api.ts:460-479`, `chat-core/src/chat-prefs.ts:53-103`).
3. **Last-message preview.** A prefix ("You:", sender name) and a body for text, photo,
   album, voice, file or card, with a kind icon. Blocked senders in groups are skipped and
   the newest unblocked message is shown instead; DMs and AI chats are never filtered.
   Web `ChatListItem.tsx:48-63,160-169`; phone `chat-rows.tsx:70-83,337-342,414-421` and
   `markdown-decision.ts:12-21`; server produces the fallback text for non-text rows
   (`chats/unread.ts:76-95`) and the newest preview (`unread.ts:143-197`).
4. **Deleted message.** The preview reads "Message deleted" when the last message is
   deleted. Phone `chat-rows.tsx:341,407-413`; web has no deleted branch and renders the
   normal preview (`ChatListItem.tsx:160-169`). This is a current web/phone difference to
   resolve in the rewrite, not a server rule.
5. **Time.** The row shows the last-message time in list format. Web
   `ChatListItem.tsx:153-157`; phone `chat-rows.tsx:389-393`.
6. **Unread badge.** A numeric badge, grey when muted; the server caps the count at 100 and
   never counts the caller's own rows. Web `ChatListItem.tsx:170-176`; phone
   `chat-rows.tsx:423-424` and `unread-badge.tsx:7-26`; server `unread.ts:175-194,289`.
7. **Manual unread dot.** A chat with no unread count but `unreadMark` shows a dot; muted
   chats use the muted colour. Web `ChatListItem.tsx:177-185`; phone
   `chat-rows.tsx:425-432`; server stores the flag in `chat_prefs` (`chat-prefs/service.ts:86-87,153`).
8. **Delivery and read ticks.** For the caller's own last message with zero unread, the row
   shows sent/delivered/read ticks. Web `ChatListItem.tsx:186-193`; phone
   `chat-rows.tsx:433-438`; server returns `deliveredUntil` and the DM `readUntil`
   (`chats/api.ts:555-588`) and the store turns them into a status.
9. **Typing and AI writing.** A typing line names who is typing; in an AI chat with a draft
   or typing names it reads "writing…". Web `ChatListItem.tsx:95-97,161-162`; phone
   `chat-rows.tsx:324-336,396-402`. Typing is local XMPP/store state, not the list endpoint.
10. **Draft line.** A non-active chat with a local composer draft shows `Draft:` plus the
    first line. Web `ChatListItem.tsx:87-90,163-166`; phone `chat-rows.tsx:325-328,403-406`;
    drafts are per-device store state.
11. **Selection and navigation.** The active row is highlighted and links to
    `/c/<jid>`. Web `ChatListItem.tsx:104-120`; phone `chat-rows.tsx:345-358`; the server
    checks chat access on every later request and answers the same 404 for unknown and
    invisible chats (`chat-prefs/access.ts:92-124`).
12. **Row action affordance.** Web shows a hover/focus "chat actions" button and opens the
    same menu on right-click (`RowActions.tsx:15-38`, `ChatListItem.tsx:108-111`); phone
    opens the actions sheet on long press (`chat-rows.tsx:349-356`,
    `app/(tabs)/index.tsx:404`). Platform-only affordance.

### The row menu

13. **Pin/unpin.** Web `ChatActionsMenu.tsx:83-91`; phone `chat-actions-sheet.tsx:111-117`;
    server stamps the first pin time and keeps it (`chat-prefs/service.ts:80-85`), with a
    cap of 20 pinned rows (`service.ts:125-137`).
14. **Mute.** Mute opens the duration list (1 hour, 8 hours, 1 day, 1 week, forever);
    an already muted chat gets Unmute. Web `ChatActionsMenu.tsx:92-124`; phone
    `chat-actions-sheet.tsx:118-146`; durations and the far-future "forever" stamp live
    once in `chat-core/src/chat-prefs.ts:11-33`. Muting a group's General topic mutes its
    topics (`applyChatPrefs`, `chat-core/src/chat-prefs.ts:59-82`); archive and pin stay
    per row.
15. **Archive/unarchive.** Web `ChatActionsMenu.tsx:125-133`; phone
    `chat-actions-sheet.tsx:147-153`; server stores it per user (`chat-prefs/service.ts:79`).
16. **Mark read/unread.** The menu shows Mark as read when the chat has unread messages or
    a manual mark, otherwise Mark as unread. Web `ChatActionsMenu.tsx:77-78,134-154`;
    phone `chat-actions-sheet.tsx:65-66,154-170`. Read clears the manual mark and advances
    the read mark (`chats/reads.ts:73-82`); unread sets `unreadMark` (`chat-prefs/service.ts:86-87`).
17. **Clear history.** Only a DM (web `chat.kind === 'dm'`; phone excludes AI DMs,
    `chat-actions-sheet.tsx:69,171-179`) asks for confirmation and deletes only the
    caller's archive copy plus their read and delivery rows
    (`chats/api.ts:212-246,314-353`). One message can also be deleted for me from the
    message menu, not the chat list (out of scope but same server rule,
    `api.ts:249-282`).
18. **Menu failure.** A failed pref save keeps the menu open and shows one fixed sentence.
    Web `ChatActionsMenu.tsx:11-13,52-56,155-159`; phone `app/(tabs)/index.tsx:191-234`
    and `chat-actions-sheet.tsx:45,108`. Errors never show raw server text.

### Grouping, order and archives

19. **Groups collapse into one row.** A group's topics are not listed as separate sidebar
    rows; the group row shows topic count (or subscriber count for a channel) and opens the
    group. Web uses `GroupHeaderRow` (`ChatList.tsx:527-543`); phone `chat-rows.tsx:43-143`
    and `chat-list.ts:38-47`. Platform difference: web can expand a group header in place.
20. **Ordering.** Pinned rows first (newer pin stamp first), then newest activity, ties by
    title; a just-created chat with no messages sorts by creation time. Web
    `store/store.ts:55-143`; phone `lib/chat-list.ts:30-81`; shared time rule
    `chat-core/src/topics.ts:16-21,24-40`. The server itself sorts alphabetically
    (`chats/api.ts:590`); ordering is client logic.
21. **Unjoined topics are hidden.** Web `store/store.ts:69-72`; phone
    `lib/chat-list.ts:34`; rule `chat-core/src/topics.ts:52-60`.
22. **Archived section.** Archived DMs/AIs leave the main rows and appear under an
    "Archived (n)" toggle; archived topics stay inside their group. Web
    `ChatList.tsx:546-572`; phone `chat-list.ts:249-278`; per-user flag from
    `chat-prefs` (`service.ts:79`).
23. **Group header extras.** Web group rows can collapse/expand, open the archived topics
    and open a new-topic dialog (`ChatList.tsx:527-543`). Phone opens the group screen
    instead (`chat-rows.tsx:87-92`). Platform-only.

### Folders and search

24. **Folder tabs and unread totals.** "All chats" plus each folder, each with a count that
    excludes archived and muted chats. Web `ChatList.tsx:240-325`; phone
    `chat-list.tsx:449-579`, totals in `app/(tabs)/index.tsx:291-297` and
    `lib/filter.ts:12-15`; rule `chat-core/src/folders.ts:67-78`. Web shows tabs only in
    the compact layout (`ChatList.tsx:438`); phone always shows them.
25. **Folder rule.** A folder includes a chat by type or explicit chat id and excludes
    archived, excluded, muted (when `excludeMuted`) and read (when `excludeRead`) chats.
    Both apps call `folderMatches` (`chat-core/src/folders.ts:50-65`); web
    `store/selectors.ts:7-37`, phone `lib/filter.ts:17-29`.
26. **Folder paging.** Phone swipes horizontally between folder pages with edge resistance,
    a distance/velocity commit and a snap-back on cancel (`chat-list.tsx:283-421`).
    Platform-only.
27. **Search.** Typing filters chat names; `@handle` looks a person up exactly; 3+
    characters show people/group hits; 2+ characters also search message text. Web
    `ChatList.tsx:158-238,338-342,496-510,576-582`; phone
    `app/(tabs)/index.tsx:299-377`; server provides the list and message search.
28. **Search scope.** Web can scope search to one chat with a removable chip
    (`ChatList.tsx:186-205`); phone carries `searchChat` through its search screens
    (`app/(tabs)/index.tsx:317,343-360`). Same rule, different layout.
29. **Loading, empty and error states.** Skeleton on first load, "Couldn't load chats" with
    Retry on failure, a non-blocking retry banner when rows are already painted, and
    "No chats match" for a search with no rows. Web `ChatList.tsx:360-375,458-510`;
    phone `chat-list.tsx:124-143,226-248`; server failure of unread/marks never fails the
    list (`chats/api.ts:542-570`).
30. **Connection banner.** Web delays "Connecting…"/"Waiting for network…" by 1.5 s
    (`rowsSelector.ts:5-6,58-68`, `ChatList.tsx:358-359,440-450`); phone shows the same
    store status immediately (`chat-list.tsx:115-123`). Platform difference only in delay.
31. **Pull to refresh.** Phone `chat-list.tsx:211-217`; web re-reads on retry/actions. Both
    call the store's `reloadChats`/`retryChats` (`app/(tabs)/index.tsx:390-397`,
    `ChatList.tsx:372-375`).

### Contact requests

32. **Request rows.** Up to three incoming requests appear above the chat rows; more
    collapse into "See all N requests". Web `RequestRows.tsx:33,143-175`; phone
    `request-rows.tsx:39,155-189`. Requests poll while the list is visible and reload on
    foreground/focus (`RequestRows.tsx:25-30`, `request-rows.tsx:28-36,54-58`).
33. **Accept.** Accept adds the contact, hides the row, refreshes chats, shows "<name>
    added", refreshes contacts and opens the new DM when its JID is known. Web
    `RequestRows.tsx:73-98`; phone `request-rows.tsx:82-111`; server contacts rule is out
    of scope but adds the contact and creates the DM.
34. **Decline and undo.** Decline hides the row at once and sends the call after a 5-second
    Undo window; Undo restores the row and cancels the call; leaving the list commits it;
    a second decline commits the previous one first. Web `RequestRows.tsx:100-141`,
    phone `request-rows.tsx:113-153`. Failure restores the row and shows one fixed
    sentence.
35. **Request profile.** A request with a handle links to the public profile; one without
    a handle is not a link. Web `RequestRows.tsx:213-249`; phone
    `request-rows.tsx:223-249`. Folder visibility rule: requests show for All and any
    folder that includes DMs (`RequestRows.tsx:41-46`, `chat-list.tsx:202`).

### New chat

36. **New chat trigger and menu.** Web: a full-width "New chat" button on wide screens and
    a floating button on compact screens, toggled by `N`; menu: New group, New channel,
    Explore groups, New message, New AI, New topic when the viewer has a group that
    allows it. `NewChatButton.tsx:28-246`. Phone: floating button, action sheet with New
    channel, New group, New message, New topic, Explore, Join with a link
    (`new-chat-button.tsx:241-344`). Platform difference: web has New AI in this menu and
    no join-link entry; phone has the join-link entry.
37. **New message picker.** A searchable contact list; Enter/arrow keys work on web; with
    no contacts the dialog explains how to start and offers Invite a friend. Web
    `NewChatButton.tsx:249-354`; phone `new-chat-button.tsx:47-133`; the contact filter is
    shared (`chat-core` `matchesContactFilter`).
38. **New topic.** Web derives the groups where the viewer may create a topic from
    `groupInfos`, opens the only group directly, or asks which group when there are
    several (`NewChatButton.tsx:89-144,202-240`). Phone always offers New topic and opens
    a group picker sheet, then the group screen with `newTopic=1`
    (`new-chat-button.tsx:236-239,305-309`). The real permission is enforced when the
    topic is created, not in this menu.
39. **New channel.** Web reuses the group dialog with `channel`
    (`NewChatButton.tsx:190-192,209-211`); phone has its own channel sheet with title,
    optional 300-character description and private/public plus handle fields
    (`new-chat-button.tsx:346-479`). Channel creation goes through the store and the
    directory handle check; failures are fixed sentences.
40. **Invite a friend.** Web menu opens `InviteDialog`; the new-message dialog also offers
    it (`ChatList.tsx:402-418`, `NewChatButton.tsx:241-243`). Phone has an invite sheet
    that creates a personal link, copies it and shares it (`new-chat-button.tsx:481-601`).
    Platform-only details; both use the session invite endpoint.
41. **Main menu.** Web: profile, Contacts with request badge, My AIs, Explore groups, Invite
    a friend, Settings with approvals badge, Install app when the browser offers it.
    `ChatListMenu.tsx:117-198`, wiring `ChatList.tsx:382-418`. Phone navigation lives in
    its tab bar, so this menu is web-only. **Sign out is currently unreachable**: the
    state and dialog exist (`ChatList.tsx:345,377-380,592-603`) but the menu has no item
    and ignores `onSignOut` (`ChatListMenu.tsx:101-129`).

### Server rules behind the list

42. **List assembly.** One request returns contacts as DMs, the caller's active AIs as DMs
    (with creation time so a new empty AI chat sorts first), groups, visible topics for
    non-channel groups, avatars and topic activity (`chats/api.ts:419-514`). Disabled and
    other people's AIs are excluded (`api.ts:357-375`).
43. **Unread and preview rule.** For each scoped chat: rows after the read mark or a
    30-day floor, newest first, at most 101 rows to cap the badge at 100; the caller's own
    rows are not counted; a resend counts once by `(kind, barePeer, senderKey, originId)`;
    an album counts once; live AI UI and edits of it are skipped; the first kept row is the
    preview (`chats/unread.ts:18-29,99-112,143-197,288-293,350-400`).
44. **Read marks.** Stored per `(user, chat)` as the last-read archive id, forward only;
    opening a chat also clears the manual unread flag; ids are validated before the write
    and an unknown/invisible chat answers the same 404 (`chats/reads.ts:45-85`,
    `api.ts:61-96`). A read marker stanza is sent best-effort after the mark
    (`api.ts:80-95`).
45. **Delivery marks.** Origin ids are resolved to rows in the author's archive that the
    caller did not write; the largest timestamp is stored forward only, and only a moved
    DM mark notifies the author's devices (`chats/deliveries.ts:46-104,191-199,252-286`).
    The list returns the peer's mark for a DM and the highest other-member mark for a room
    (`deliveries.ts:114-170`), merged into topics (`226-249`).
46. **Delivered notice.** A bodiless headline from the author's bare JID to each connected
    resource, with `no-store`, best effort and forked off the HTTP answer
    (`chats/delivered-notice.ts:13-123`).
47. **Chat access rule.** A DM is visible when the JID is a contact's account or one of the
    caller's own AIs; a room is visible when any non-archived topic in it is visible;
    malformed JIDs, unknown chats and invisible chats all answer 404
    (`chat-prefs/access.ts:10-124`).
48. **Chat preferences.** A list plus one upsert per `(user, chat)`; fields left out keep
    their value, `null` clears; an all-defaults row is deleted; caps are 200 rows and 20
    pins; background preset/image/dim are validated, with preset and image mutually
    exclusive and dim requiring an image (`chat-prefs/service.ts:37-214`). The list also
    returns the caller's default background (`service.ts:220-297`, `api.ts:58-104`).
49. **Folders.** List seeds "Personal" (DMs) and "AIs" once under a per-user advisory lock;
    create caps at 20 and appends; update only the caller's folder or 404, rewriting
    positions on reorder and delete; order must list every folder exactly once
    (`chat-folders/service.ts:10-307`, `chat-folders/api.ts:26-108`). Writes are rate
    limited (`api.ts:29-30`).

## 2. Twin logic

These are rules web and phone implement separately. Shared helpers exist for sorting,
folder matching and previews, but the surrounding derivation, state and conditions are
still written twice. Line counts are the ranges cited.

| Rule | Web | Phone | Twin lines | What is already shared |
| --- | --- | --- | --- | --- |
| Flat-to-row derivation, archive split, pinned/recency order | `store/store.ts:55-143` (85), `store/selectors.ts:21-38` (18) | `lib/chat-list.ts:30-81` (52), `lib/filter.ts:17-29` (13), `lib/chat-prefs.ts:9-15` (7) | 175 | `chatSortTime`, `sortTopics`, `folderMatches` |
| Preview body, Markdown choice, deleted fallback | `ChatListItem.tsx:48-63` (16) | `markdown-decision.ts:12-21` (10), `chat-rows.tsx:70-83,337-342` (20) | 46 | `previewMessage`, `previewParts`, `shouldRenderMarkdown` |
| Row markers, time, typing/draft, unread/dot/ticks precedence | `ChatListItem.tsx:129-193` (65) | `chat-rows.tsx:363-438` (76) | 141 | labels/time helpers |
| Row menu items and conditions | `ChatActionsMenu.tsx:62-194` (133) | `chat-actions-sheet.tsx:62-188` (127), `app/(tabs)/index.tsx:242-260,418-453` (55) | 315 | none |
| Contact requests: poll, accept, decline, undo, errors | `chatList/RequestRows.tsx:25-198` (174) | `chat/request-rows.tsx:23-208` (186) | 360 | `useContactRequestsPoll`, `withoutId` |
| Request-row wrapper around the poll | `RequestRows.tsx:22-30` (9) | `request-rows.tsx:23-36` (14) | 23 | `useContactRequestsPoll` |
| New-message contact picker | `NewChatButton.tsx:249-354` (106) | `new-chat-button.tsx:47-133` (87) | 193 | `matchesContactFilter` |
| New-chat menu conditions and items | `NewChatButton.tsx:187-207` (21) | `new-chat-button.tsx:267-302` (36) | 57 | none |
| Folder tabs and per-folder unread totals | `ChatList.tsx:240-325` (86), totals `247-255` (9) | `chat-list.tsx:449-579` (131), totals `app/(tabs)/index.tsx:291-297` (7), `lib/filter.ts:12-15` (4) | 237 (pager `283-421` is platform-only) | `folderUnreadTotal`, `folderMatches` |
| Empty/loading/error copy and branches | `ChatList.tsx:458-510` (53) | `chat-list.tsx:226-248` (23) | 76 | none |
| Server: "is this row mine" | `chats/unread.ts:99-112` (14) | `chats/deliveries.ts:27-40` (14) | 28 | none |
| Server: decode a chat JID from a route param | `chats/api.ts:300-307` (8) | `chats/reads.ts:26-43` (18) | 26 | none |
| Server: access check, then budget, then write | `chats/api.ts:61-96` (36) | `chats/api.ts:99-118` (20) | 56 | none |

The two request implementations are the clearest twin: same `MAX_ROWS = 3`, same
`UNDO_MS = 5000`, same two error sentences, same accept/decline/undo state machine
(`RequestRows.tsx:33-38`, `request-rows.tsx:39-44`). The two menu implementations are the
second: same pin/mute/archive/read/unread/clear conditions and the same "show Mark as read
when unread or marked" rule (`ChatActionsMenu.tsx:75-78`, `chat-actions-sheet.tsx:62-66`).

## 3. Slop by rule

`docs/LEAN_CODE.md` rule in bold; each row is a place in scope that breaks it and the
lines that region costs today.

### One home per piece of logic

| Place | Lines | Why it breaks the rule |
| --- | --- | --- |
| Web `store/store.ts:55-143` + `store/selectors.ts:21-38` vs phone `lib/chat-list.ts:30-81`, `lib/filter.ts:17-29` | 175 | Same row derivation, grouping, filter and order in two apps. |
| Web `ChatListItem.tsx:48-63` vs phone `markdown-decision.ts:12-21`, `chat-rows.tsx:70-83` | 46 | Same preview/Markdown rule in two apps. |
| Web `ChatActionsMenu.tsx:62-194` vs phone `chat-actions-sheet.tsx:62-188`, `app/(tabs)/index.tsx:242-260,418-453` | 315 | Same menu items and conditions twice. |
| Web `RequestRows.tsx:25-198` vs phone `request-rows.tsx:23-208` | 360 | Same request state machine twice, including constants and sentences. |
| Web `NewChatButton.tsx:249-354` vs phone `new-chat-button.tsx:47-133` | 193 | Same contact picker twice. |
| Server `chats/unread.ts:99-112` vs `chats/deliveries.ts:27-40` | 28 | `isOwnRow` and `isCallerRow` are the same rule. |
| Server `chats/api.ts:300-307` vs `chats/reads.ts:26-43` | 26 | Percent-decoding and 404 handling written twice. |
| Server `chats/api.ts:61-96` vs `99-118` | 56 | Two copies of access → budget → write. |

### Trust the types and the contract

| Place | Lines | Why it breaks the rule |
| --- | --- | --- |
| `chat-folders/api.ts:43-52` and `71-91` | 31 | The route copies each optional payload field and re-applies `[]`/`false` defaults the contract already defines. |
| `chat-prefs/api.ts:83-94` | 12 | The decoded payload is copied field by field into the service input. |
| `new-chat-button.tsx:140-145` vs `357-362` | 6 | `ChannelInput` repeats the inline prop type of `NewChannelSheet`. |
| `chat-folders-api.ts:14-22`, `chat-prefs-api.ts:10-17` | 17 | Local interfaces and aliases restate `client-core`/contract types. |

### No layers that do nothing

| Place | Lines | Why it breaks the rule |
| --- | --- | --- |
| `lib/chat-folders-api.ts:24-33` | 10 | Wrapper that returns every method of `makeChatsApi` one by one. |
| `lib/chat-prefs-api.ts:19-25` | 7 | Same for two pref methods. |
| `lib/chat-prefs.ts:3-15` | 13 | Re-export plus two one-line filters. |
| `RequestRows.tsx:22-30` and `request-rows.tsx:23-36` | 23 | One-caller adapters around `useContactRequestsPoll`. |
| `chats/reads.ts:12-18` | 7 | `requireChatReadAccess` only forwards to `requireChatAccess`. |
| `chat-prefs/service.ts:37-46, 68-75, 100-107, 113-120, 126-133, 139-169, 201-208, 224-231, 240-247, 256-263, 268-287` | ~90 | One statement per `runSql(Effect.gen(...))`; no service logic, only boilerplate. |
| `rowsSelector.ts:22-56` | 35 | A hand-rolled cache for one selector; a hook with `useMemo` on the same slices says the same. |

### Data over branches

| Place | Lines | Why it breaks the rule |
| --- | --- | --- |
| `rowsSelector.ts:58-68` | 11 | `statusLabel` switch maps three values to two strings. |
| `chats/unread.ts:76-95` | 20 | `labelForRow` is an if-chain over XML tokens; a table maps token to label. |
| `chat-core/src/chat-prefs.ts:68-103` | 36 | Branch-by-branch object surgery; a normalised pref → row flags table would be smaller. |
| `NewChatButton.tsx:125-144` | 20 | Three branches all end in the same dialog; only the picked group differs. |
| `RequestRows.tsx:113-141` + `request-rows.tsx:126-153` | 56 | The decline/undo state machine is re-derived with booleans and refs instead of a small state type. |

### Use the platform

| Place | Lines | Why it breaks the rule |
| --- | --- | --- |
| `ChatList.tsx:115-156` | 42 | Hand-written arrow/Enter navigation over links that are already anchors. |
| `ChatList.tsx:257-279` | 23 | Manual roving tabindex for a tablist; a small shared tab component would own it. |
| `ChatList.tsx:54-109` | 56 | Hand-rolled localStorage decode/encode with an Effect codec for a string array. |

### No speculative code, no dead code

| Place | Lines | Why |
| --- | --- | --- |
| Web `NewChatButton.tsx:28-34,127-131,202` | 12 | `defaultGroupId` is never passed by any caller. |
| Web `ChatListMenu.tsx:101-129` + `ChatList.tsx:345,377-380,382-383,409-410,592-603` | ~24 | Sign-out state/dialog and owner wiring are unreachable; the menu ignores both props. |
| Phone `chat-rows.tsx:145-229,258-265,300-311` + `chat-list.tsx:124-143` + `app/(tabs)/index.tsx:188,220-230` | ~135 | The swipe actions, `ChatRowSwipe`, `SwipeAction` and swipe-error line are never reached: no caller passes `onPref`/`openSwipeRef` (see part 4). |

### Comments

| Place | Lines | Why |
| --- | --- | --- |
| `ChatList.tsx:111-114, 360-370, 382, 497-499, 512-515` | ~20 | Comments explain what the next line does or carry history; the names and types already say it. |
| `chat-rows.tsx:10-11, 73, 145, 314` | ~10 | Same; one comment also carries a device-report date. |
| `chat-prefs-api.ts:6-8`, `chat-folders-api.ts:10-12`, `chat-prefs.ts:3-5` | ~9 | File-level comments restate the re-export or wrapper below. |

## 4. Dead code

Proof commands were run in the worktree; each result is summarised. "No other caller"
means `git grep` found only the definition and the internal use listed.

1. **Web new-chat `defaultGroupId`.** `git grep -n "defaultGroupId" -- apps/web` returns
   `NewChatButton.tsx:29,32,127-128,202` only; the only render is
   `ChatList.tsx:587 <NewChatButton onExplore=… />`. The prop, its branch and its menu
   condition are dead (12 lines).
2. **Web main-menu sign-out and owner wiring.** `git grep -n "onSignOut|isServerOwner" --
   apps/web/src/components` returns only the interface lines `ChatListMenu.tsx:107-108`
   and the passing lines `ChatList.tsx:409-410`; the menu body never reads them. The
   `ConfirmDialog` at `ChatList.tsx:592-603`, `signOut` at `377-380`, state at `345` and
   `useIsServerOwner` at `383` are unreachable from the list (~24 lines). Sign out may
   still exist in Settings; it does not exist in this menu.
3. **Phone swipe actions.** `git grep -n "onPref=|openSwipeRef" -- apps/mobile` returns
   only the definitions in `chat-rows.tsx` and the optional parameters; both `ChatRow`
   renders (`chat-list.tsx:219-224,267-273`, `chat-search-results.tsx:289-294`) omit them.
   Therefore `SwipeAction`, `ChatRowSwipe`, the swipe branches in `ChatRow` and `GroupRow`,
   and the swipe-error line in `chat-list.tsx:124-143` never run (~135 lines). The long-press
   actions sheet is the live path.
4. **Web `visibleChats`.** `git grep -n "visibleChats" -- apps` shows one caller,
   `rowsSelector.ts:43`, and the list uses the result only to decide whether there are any
   rows (`ChatList.tsx:501`) and to pass `chats` to that check. `groupChats` re-applies the
   folder/search filter itself (`store.ts:73,81-93`), so 18 lines of filtering at
   `selectors.ts:21-38` duplicate the rule and can collapse to a boolean.
5. **Server re-export types.** `git grep -n "ChatFolderRow|ChatPrefRow" -- apps/server/src`
   shows `chat-folders/service.ts:12` and `chat-prefs/service.ts:12` export the db row
   types, but every other reference is inside the same file. Two export lines are dead.
6. **Server one-line access wrapper.** `requireChatReadAccess` (`chats/reads.ts:12-18`) has
   one caller, `reads.ts:37`; it is a rename, not a rule (7 lines).
7. **Mobile API re-export wrappers.** `makeChatFoldersApi` and `makeChatPrefsApi` are used
   only by the store provider (`chat-store-provider.tsx:141-142,155-156`), which could
   hold `makeChatsApi` directly; the wrapper interfaces repeat the methods (17 lines).
8. **Unread-badge is live.** `unread-badge.tsx:7-26` is used by `chat-rows.tsx:424`; it is
   not dead and should stay (or be folded into the row's badge primitive).

## 5. Lean target structure

The rewrite keeps every behaviour in part 1 and removes the twins, wrappers and dead
paths. The total is **3,471 lines**, 48.3% below today's 6,710 (the task's 40% floor is
4,026 against 6,710, or 4,045 against its 6,743).

### Shared packages

| New or kept file | Owns | Budget |
| --- | --- | --- |
| `packages/chat-core/src/chat-list.ts` (new) | Pure view model: `ChatListRow = { kind: 'chat'; chat; preview } \| { kind: 'group'; groupId; topics; … }`; folder/search filter; unjoined-topic rule; pinned/recency order; archived split; `previewFor` (blocked, deleted, Markdown); row badge state (`count` / `manual` / `ticks`). No React, no I/O. | 200 |
| `packages/chat-core/src/chat-prefs.ts` (trim) | Mute durations and stamps, `applyChatPrefs` (including General-topic inheritance), effective pref. Delete `effectivePrefFor` if the view model owns the lookup. | 100 |
| `packages/chat-core/src/folders.ts` (trim) | Folder type, `chatFolderType`, `folderMatches`, `folderUnreadTotal`, `sortFolders`. | 70 |
| `packages/client-core/src/chat-list.ts` (new) | The shared view model/hook: selects chats, prefs, folders, typing, drafts, blocked JIDs; returns `{ rows, archived, tabs, counts }`. Owns the request state machine (accept/decline/undo, 5 s timer, fixed errors) and the row-action table (`pin`, `mute`, `archive`, `mark read/unread`, `clear history` with conditions). Adapters inject navigation, toast, foreground and clock. | 240 |
| `packages/client-core/src/new-chat.ts` (new) | New-chat menu model: menu items and visibility, contact filter, topic groups the viewer may use, channel input parsing. | 100 |
| `packages/api-contract/src/chat-list.ts` (new, replaces two files) | One home for chat-list user state: chat pref + folder schemas, payloads and the two route groups. Reuse the existing schemas unchanged. | 180 |
| **Subtotal** | | **890** |

### Web

| New or kept file | Owns | Budget |
| --- | --- | --- |
| `apps/web/src/components/chatList/ChatList.tsx` (rewrite) | Shell only: search bar, compact tabs, connection banner, loading/empty/error, archived section, mounts rows and new-chat. | 160 |
| `apps/web/src/components/chatList/ChatRow.tsx` (new, replaces `ChatListItem.tsx` and `RowActions.tsx`) | Row markup, hover/focus action button, context menu, avatar, markers, preview, status. | 110 |
| `apps/web/src/components/chatList/RequestRows.tsx` (rewrite) | Request row markup and profile link; behaviour comes from the shared controller. | 60 |
| `apps/web/src/components/chatList/NewChatButton.tsx` (trim) | Trigger, menu and new-message picker; existing group/channel/AI/topic dialogs stay as they are. | 120 |
| `apps/web/src/components/chatList/ChatListMenu.tsx` (trim) | Main menu; either restore a working Sign out item or delete the dead state (part 4). | 80 |
| `apps/web/src/components/chatList/useChatRows.ts` (new) | Thin `useChatSelector` adapter over the client-core view model; `statusLabel` and the delayed banner can live here. | 20 |
| **Subtotal** | | **550** |

`ChatListItem.tsx`, `chatList/rowsSelector.ts` and `chatList/RowActions.tsx` are deleted.

### Phone

| New or kept file | Owns | Budget |
| --- | --- | --- |
| `apps/mobile/src/components/chat/chat-list.tsx` (rewrite) | Shell, folder tabs, pager gesture, archived footer, loading/error/empty, request header. | 200 |
| `apps/mobile/src/components/chat/chat-rows.tsx` (rewrite) | Chat row and group row markup only. No swipe path (dead today); long press opens the shared actions sheet. | 150 |
| `apps/mobile/src/components/chat/request-rows.tsx` (rewrite) | Request markup; shared controller owns accept/decline/undo. | 60 |
| `apps/mobile/src/components/chat/new-chat-button.tsx` (trim) | FAB, action sheet, new-message sheet, topic picker, hand-off between sheets. | 130 |
| `apps/mobile/src/components/chat/new-channel-sheet.tsx` (new) | Channel form and visibility/handle fields, extracted from the current file. | 110 |
| `apps/mobile/src/components/chat/invite-sheet.tsx` (new) | Invite link create/copy/share, extracted from the current file. | 80 |
| `apps/mobile/src/components/chat/unread-badge.tsx` (keep) | Badge with the muted/live keyed gradient (keep the key: RN live-view crash rule). | 26 |
| **Subtotal** | | **756** |

`apps/mobile/src/lib/chat-list.ts`, `lib/filter.ts`, `lib/chat-prefs.ts`,
`lib/chat-folders-api.ts` and `lib/chat-prefs-api.ts` are deleted; the screens import
`chat-core`/`client-core` and `makeChatsApi` directly.

### Server

| New or kept file | Owns | Budget |
| --- | --- | --- |
| `apps/server/src/chats/list.ts` (new) | List assembly only: contacts, active AI DMs, groups, visible topics, avatars, unread/mark merge, final order. Calls the services below; no routes. | 150 |
| `apps/server/src/chats/unread.ts` (trim) | Unread + preview rule: thresholds, 30-day floor, 100 cap, own-row exclusion, resend/album identity, live-AI skip, two batched queries and the label table. | 190 |
| `apps/server/src/chats/reads.ts` (trim) | Read-mark rule: validate id, forward-only upsert, clear manual unread, list a DM peer's marks. | 80 |
| `apps/server/src/chats/deliveries.ts` (trim, absorbs `delivered-notice.ts`) | Delivery rule: resolve origin ids in the author's archive, forward-only max, list marks, merge topics, build/send the XMPP notice. | 200 |
| `apps/server/src/chats/api.ts` (trim) | Routes only: list, read, delivered, reply, clear history, delete for me. Decode, call, return. | 150 |
| `apps/server/src/chats/access.ts` (move from `chat-prefs/access.ts`) | One access rule for DMs, own AIs and rooms; one 404; one JID decoder used by every route. | 90 |
| `apps/server/src/chat-prefs/service.ts` (trim) | Pref and default-background rules: merge, delete all-defaults, caps inside the write, background validation. | 140 |
| `apps/server/src/chat-prefs/api.ts` (trim) | Pref routes only; one shared `withChatAccess` wrapper for access → budget → write. | 60 |
| `apps/server/src/chat-folders/service.ts` (trim) | Folder rule: seed, list, create cap, update, reorder, delete, one transaction helper. | 160 |
| `apps/server/src/chat-folders/api.ts` (trim) | Folder routes only; pass the decoded payload through. | 55 |
| **Subtotal** | | **1,275** |

`chats/delivered-notice.ts`, `chat-prefs/access.ts`, and the old route bodies in
`chats/api.ts`, `chat-prefs/api.ts` and `chat-folders/api.ts` are deleted. The existing
server tests for the message pipeline move with the services and stay:
`unread.test.ts`, `unread-wake.test.ts`, `read-marks.test.ts`, `reads.test.ts`,
`deliveries.test.ts`, `mark-displayed.test.ts`, `channel-kind.test.ts`,
`reply-handler.test.ts`, `delete-own.test.ts`, `chat-prefs/unread-mark.test.ts`.

### Budget summary

| Area | Today | Target |
| --- | --- | --- |
| Shared packages | 409 | 890 |
| Web | 1,741 | 550 |
| Phone | 2,070 | 756 |
| Server | 2,490 | 1,275 |
| **Total** | **6,710** | **3,471** |

The measured part totals: packages 150 + 110 + 149 = 409; web 606 + 355 + 273 + 200 +
199 + 68 + 40 = 1,741; phone 601 + 579 + 444 + 265 + 82 + 33 + 26 + 25 + 15 = 2,070;
server 594 + 400 + 307 + 297 + 286 + 125 + 124 + 124 + 123 + 110 = 2,490. They sum to
6,710, the number the percentage is taken from.

## 6. Risks and how to check them

1. **Unread counts.** The easiest behaviour to lose: the read threshold, 30-day floor,
   100 cap, own-row exclusion, resend/album dedupe and live-AI skip are one rule in
   `unread.ts:143-197,288-293`. Check with the server tests (`unread.test.ts`,
   `unread-wake.test.ts`) and live: two accounts, send 3 messages plus an album, verify
   the badge, open and return, verify 0; check a muted chat still shows a grey badge.
2. **Read marks and manual unread.** Opening a chat must advance the mark forward only and
   clear `unreadMark` on every device (`reads.ts:73-82`); marking unread must survive the
   next list load. Check both apps with one account on web and phone: read on one, watch
   the other; mark unread, reload, then open.
3. **Delivery and read ticks.** The direction of the mark, the decimal-id comparison and
   the "only a moved DM notifies" rule (`deliveries.ts:172-199,252-286`) are easy to
   invert. Check live with two accounts: send, confirm delivery on the peer, then read;
   verify ticks move one step at a time. Keep `deliveries.test.ts` and
   `mark-displayed.test.ts`.
4. **Delivered notice.** The headline is bodiless and best effort (`delivered-notice.ts:34-100`);
   a rewrite that logs the raw JID or until id would leak. Check the server test plus a live
   two-device DM.
5. **Preview correctness.** Blocked group senders fall back to the newest unblocked message,
   deleted shows "Message deleted" (web currently lacks it), albums/voice/files get the
   server label, incoming AI replies use Markdown while the caller's own do not
   (`ChatListItem.tsx:48-63`, `markdown-decision.ts:12-21`, `unread.ts:76-95`). Check in
   web mock mode with fixtures for blocked, deleted, album and AI rows.
6. **Ordering, pins and folders.** Pinned first (newer pin first), recency with creation
   time for empty chats, General first inside a group, archived outside, unjoined hidden,
   folder include/exclude/muted/read rules. Check web mock and phone emulator with a pinned
   group, an empty new chat, an archived DM and a folder that excludes muted chats.
7. **Requests.** Accept must open the DM and refresh contacts; decline must be undoable for
   five seconds, commit on leave and not send twice; three rows plus "See all". Check web
   mock and phone emulator with four incoming requests; watch the server call count.
8. **New chat.** Topic visibility, the single-group shortcut, channel create with a public
   handle, join link and invite link are platform-specific. Check web mock (topic menu) and
   the phone emulator/smoke (all action-sheet entries).
9. **Server caps and access.** 200 pref rows, 20 pins, 20 folders and the same 404 for
   unknown/invisible chats are security-relevant (`chat-prefs/service.ts:9-10,112-137`,
   `chat-folders/service.ts:10,149-157`, `access.ts:92-124`). Check with the existing
   server tests and one unauthorised probe per route.
10. **Dead code decisions.** The web sign-out entry and the phone swipe actions are not
    reachable today. The rewrite should either restore them from the shared menu/actions
    or delete them; the lead should confirm which before the spec is written, so the
    behaviour list in part 1 does not silently lose a feature users expect.
