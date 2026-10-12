# Web UX audit (feel and flow vs Telegram Web)

Date: 2026-10-11. Scope: `apps/web` (React), shared logic in `packages/chat-core` and
`packages/client-core`. Docs only; nothing changed. Every item is marked
**confirmed by code** (the cited lines show it) or **suspected** (needs a browser check).
Severity: P1 blocks or confuses a common flow, P2 friction, P3 polish.
Line numbers are from `main` at 54d08c1a6.

## 1. Summary (top 15, P1 first)

| Id | Sev | Finding |
| --- | --- | --- |
| WUX-1 | P1 | People search: a row expands into an inline card instead of opening; no result is hidden silently unless the query starts with `@`; results are not keyboard-navigable; Esc does not clear. |
| WUX-2 | P1 | A search with no chat match shows the first-run empty state "No chats here yet / Invite a friend". |
| WUX-3 | P1 | The composer text is lost when switching chats: no per-chat draft. |
| WUX-4 | P1 | Unread badge sits at a different x in DM rows, topic rows and group rows; in DM rows the hover "more" button covers it. |
| WUX-5 | P1 | Notifications page: an informational "only while open" result is shown as a red error and twice; "Blocked by the browser" still offers Enable; errors render at the page bottom; one text tells the user to "Open Zilar" while in Zilar. |
| WUX-6 | P1 | Opening a chat does not focus the composer and typing anywhere does not focus it. |
| WUX-7 | P1 | "New message" cannot start a DM: it only says to use the search bar; the contact card shows Message only when a DM chat already exists. |
| WUX-8 | P1 | Group panel has no Leave group, no Add members from contacts, no per-member actions (remove, promote); only invite links. |
| WUX-9 | P2 | Sign out and "Archive topic for everyone" run without a confirmation. |
| WUX-10 | P2 | Settings are full-page routes that unmount the chat shell; the hamburger menu is 15 flat entries without icons or sections and has no "Settings". |
| WUX-11 | P2 | Loading older messages: scroll compensation runs in a passive effect (visible jump), no "loading" indicator, and `loadOlder` fires on every scroll event near the top. |
| WUX-12 | P2 | Arrow-key navigation in the chat list skips DM and single-group rows; only topic rows take part. The "N" key shown on New chat has no handler. |
| WUX-13 | P2 | Reply quote is not clickable (no jump to the original). |
| WUX-14 | P2 | Offline: composer stays enabled; the only hint is a small line in the list header after 1.5 s; failed sends become "Not sent" instead of a queue. |
| WUX-15 | P2 | Sign-in: the email field and the first OTP box are not focused automatically. |

Counts: P1 8, P2 14, P3 13 (35 findings).

## 2. Findings by flow and area

### 2.1 Sign-in, invite, first run

**WUX-15 (P2, confirmed)** No autofocus on the email field (`apps/web/src/components/auth/AuthFlow.tsx:198-206`) nor on the first OTP box after the step change (`apps/web/src/components/auth/OtpInput.tsx:76-98`, no `autoFocus`). Telegram Web focuses the phone/code field. Fix: `autoFocus` on `TextInput` in AuthFlow; in OtpInput focus `refs.current[0]` in an effect on mount.

**WUX-16 (P3, confirmed)** Invite flow is good: the invite field appears only when the server asks (`AuthFlow.tsx:111-114`), copy is clear ("This email has no account yet…"). The generic fallback "Something went wrong. Try again." (`AuthFlow.tsx:36`) hides network vs server errors; fine for now.

**WUX-17 (P3, confirmed)** Username step is solid (live check, reasons, Skip: `apps/web/src/routes/HandlePage.tsx:138-162`). Gap: after Skip the gate silently returns next browser session (`apps/web/src/routes/AppRoutes.tsx:88-102`); Telegram never nags. Fix: persist the dismissal in `localStorage` instead of `sessionStorage` (`apps/web/src/lib/handleGate.ts`).

**WUX-18 (P3, confirmed)** Join link: good states (invalid, full, name-first: `apps/web/src/routes/JoinPage.tsx:109-169`). The "Checking your invite link…" text has no spinner and no delay (`JoinPage.tsx:113-119`), so it flashes on fast links; use `useDelayed` like `LoadingScreen` (`AppRoutes.tsx:45-52`).

### 2.2 Contacts, DMs, groups

**WUX-7 (P1, confirmed)** "New message" opens a dialog whose body is a sentence: "Invite a friend… or type their @username in the search bar above" (`apps/web/src/components/NewChatButton.tsx:219-246`). There is no contacts list, though the store has `contacts` (used by `NewGroupDialog.tsx:65,186-205`). The contact card shows Message only when a DM chat already exists (`apps/web/src/components/ContactProfileRow.tsx:131-147`, comment "No DM yet means no Message button"); a fresh contact has no way to start the chat except waiting for a row. Telegram: New message → searchable contact list → opens the chat at once. Fix: a `NewMessageDialog` (new file) listing `s.contacts` with a `SearchField`, each row navigating to `/c/<jid>`; in `ContactProfileRow` show Message for every `contact` and navigate to `/c/<contact.jid>` (the store opens an empty DM).

**WUX-19 (P2, confirmed)** Incoming contact requests are only discoverable as a badge inside the hamburger menu (`apps/web/src/components/chatList/ChatListMenu.tsx:101-114`); the count is polled (`ChatList.tsx:97`) but nothing in the list says "2 people want to add you". Fix: a one-line row at the top of `ChatListBody` when `incomingRequests > 0`, linking to `/settings/requests`.

**WUX-8 (P1, confirmed)** `GroupPanel` renders members as plain rows with role chips (`apps/web/src/components/GroupPanel.tsx:184-222`); there is no Leave group, no Add members, no remove/promote. The store already has `removeMember` (`apps/web/src/store/effects/groupSettings.ts:26-27`) and the API `removeGroupMember` (`apps/web/src/lib/api/groups.ts:176-177`), but no component calls them (grep). Only channels (`ChannelPanel.tsx:369`) and topics (`panels/TopicMembersSection.tsx:124`) have Leave. Telegram: member row menu (Promote, Remove), "Add members", "Leave group" in the header menu. Fix: a `GroupMembersSection` (new, ≤200 lines) with a per-row menu for managers (Remove) and an "Add members" button opening the contact picker; a Leave group item in `ChatHeader`'s non-topic menu for groups (needs a `leaveGroup` port, check `groupSettings.ts` first).

**WUX-20 (P3, confirmed)** `NewGroupDialog` member step has no search and demands at least one member (`apps/web/src/components/NewGroupDialog.tsx:156,181-206`). Telegram Desktop allows an empty group and filters contacts as you type. Fix: a `SearchField` above the list; let Next pass with zero members.

**WUX-21 (P3, confirmed)** Invite people to a group = invite links only (`GroupPanel.tsx` via `InviteLinksSection`); covered by WUX-8.

### 2.3 Chat list and search

**WUX-1 (P1, confirmed)** People results: a click toggles `expanded` and renders a bordered `ContactProfileRow` inside the list (`apps/web/src/components/PeopleSearchResult.tsx:88-126`), so the list grows a card with Add/Block buttons under the row. "No one with that username." shows only when the query starts with `@`; otherwise an empty People section is hidden (`PeopleSearchResult.tsx:19-27`). Rows are `button`s outside `TopicKeyboardNav`, so arrows do nothing; Enter in the box opens only the top message hit (`apps/web/src/components/SearchBar.tsx:64-70`, `MessageSearchResults.tsx:107-116`). Esc does not clear or blur the search (no handler in `SearchBar.tsx`). Telegram Web: sections "Chats", "Global search", "Messages"; a people row click opens the chat (or profile) and clears the search; Up/Down + Enter walk every result; Esc clears then blurs. Fix: in `PeopleSearchResult` make a row a `Link` to the DM when `contact`, else navigate to `/@handle` (the existing card route, `AppRoutes.tsx:237-238`); always show the "No people found" line for 3+ chars; give rows `data-topic-row` so `TopicKeyboardNav` includes them (WUX-12); in `SearchBar` handle Esc: clear when non-empty, else blur.

**WUX-2 (P1, confirmed)** `ChatListBody` shows `EmptyState variant="no-chats"` whenever `chats.length === 0 && archived.length === 0` (`apps/web/src/components/chatList/ChatListBody.tsx:109-110`), and `chats` is already filtered by the search text (`apps/web/src/store/selectors.ts:22-40`). Typing "zzz" therefore shows "No chats here yet" with an Invite button under the People/Messages sections. Telegram shows "No results" under each section. Fix: pass `search` into the condition: when `search.trim() !== ''` render nothing (or a one-line "No chats match") instead of the first-run state.

**WUX-4 (P1, confirmed)** Three row layouts place the badge differently: DM rows put the "more" button `absolute right-0` (`apps/web/src/components/ChatListItem.tsx:159-174`) so the badge is flush right; topic rows keep an inline `size-6` placeholder at `opacity-0` (`apps/web/src/components/TopicRow.tsx:146-161`) so the badge sits 24 px + gap to the left of the time above it; group header rows use `ml-auto` with a chevron button after the badge (`TopicRow.tsx:247-285`). In DM rows the hover button has `bg-surface-raised`, so it paints over the badge/ticks on hover (`ChatListItem.tsx:171`). Telegram: time and badge share one right edge; row actions are only in the context menu. Fix: one layout: move the "more" button out of the flow in `TopicRow` (same `absolute` as DM rows) and in both files shift it to the title row (`top-1.5`) so it never overlaps the badge; or drop the hover button entirely and rely on right-click (`onContextMenu` → `ChatActionsMenu`), which is the Telegram behaviour.

**WUX-22 (P3, confirmed)** Hardcoded greys in list rows: `border-[#1a1a1a]`, `text-[#d4d4d4]` (`ChatListItem.tsx:91,140`; `TopicRow.tsx:84,88,127`; `MessageSearchResult.tsx:96`). See WUX-31.

**WUX-23 (P3, confirmed)** Message search rows pass `selected={false}` always (`apps/web/src/components/MessageSearchResults.tsx:48-57`) and the Enter path opens only the top hit; no highlighted row. Fix with WUX-12 (shared roving focus).

**WUX-24 (P3, suspected: check at 390 px)** On narrow screens the New chat FAB is `absolute right-4 bottom-4` (`NewChatButton.tsx:133`) and the list `nav` has no bottom padding (`ChatListBody.tsx:62-68`), so the last row's actions sit under the FAB. Fix: `pb-20` on the nav when `!isWide`.

**WUX-25 (P3, confirmed)** Folder tab badges print the raw count (`apps/web/src/components/FolderTabs.tsx:81-90`) while `Badge` caps at 99+; use `Badge` there.

### 2.4 Chat view: composer

Confirmed good: Enter sends, Shift+Enter newline (`apps/web/src/components/Composer.tsx:355-362`); Up edits the last message (`Composer.tsx:335-341`); paste and drop of files (`apps/web/src/components/composer/useComposerAttachments.ts:104-148`); mention picker with arrows/Enter/Tab/Esc and `aria-activedescendant` (`useMentions.ts:150-177`, `ComposerControls.tsx:203-208`); Esc order recording → picker → attachment → edit → reply (`Composer.tsx:315-354`); reply and edit bars; sticker/GIF/emoji tabs (`StickerPanel.tsx:48-50`).

**WUX-3 (P1, confirmed)** The composer text is `useState('')` (`Composer.tsx:26`) and `ChatView` is keyed by chat id (`apps/web/src/routes/ChatShell.tsx:58`), so switching chats unmounts the composer and drops the text. The comment "The draft text itself stays" (`Composer.tsx:72-73`) is no longer true. The store's `drafts` are AI reply drafts, not user drafts (`MessageList.tsx:64`, `lib/drafts.ts:1-13`). Telegram keeps a draft per chat and shows "Draft:" in red in the list row. Fix: a `composerDrafts: Record<chatId, string>` slice in `store/store.ts` + `setComposerDraft` action (`effects/prefs.ts` is the nearest home); `Composer` reads the initial value from it and writes on change; `ChatListItem` prefixes "Draft: " in `text-danger` when the chat is not open.

**WUX-6 (P1, confirmed)** No `autoFocus` on the textarea (`apps/web/src/components/composer/ComposerControls.tsx:193-210`) and no global key listener that forwards printable keys to it (grep: only Cmd+K in `SearchBar.tsx:15-24` and Esc in `ChatShell.tsx:30-38`). Telegram focuses the composer when a chat opens and when you start typing with nothing focused. Fix: in `Composer`, focus the textarea in an effect on `chatId` when `isWide`; in `ChatView` a `keydown` listener that, when `event.target` is `body` and the key is a single printable character without modifiers, focuses the textarea (the key then lands in it).

**WUX-26 (P3, confirmed)** The emoji tab is a fixed list of common emoji (`apps/web/src/components/sticker/emoji.ts`), no search or categories. Telegram has a full picker with search. P3 because stickers are the product focus.

**WUX-27 (P3, confirmed)** Attach is single-file (`ComposerControls.tsx:181`, `multiple={false}`) and drop takes `files[0]` (`useComposerAttachments.ts:111`). Telegram accepts several and groups them. Later.

### 2.5 Chat view: message list

Confirmed good: unread divider centred on open (`apps/web/src/components/MessageList.tsx:135-146`), jump-to-bottom with pending count (`MessageList.tsx:332-343`), date separators and 5-minute grouping (`packages/chat-core/src/messages.ts:4,35`), hover "…" button and right-click menu with reactions row (`MessageActionsMenu.tsx:65-102`), select mode with checkboxes, delete confirm, edited/ticks, big emoji, skeletons delayed 300 ms.

**WUX-11 (P2, suspected: scroll up fast in a long chat)** Older pages: `prependScrollHeight` is applied in a passive `useEffect` after paint (`MessageList.tsx:148-160`), so the frame between commit and effect can show the jump; nothing says "Loading" at the top; `handleScroll` calls `store.loadOlder` on every scroll event under 80 px (`MessageList.tsx:216-220`), relying on the core's `loadingOlder` set to dedupe (`packages/client-core/src/store/history.test.ts:73,168-170`). Telegram keeps the viewport fixed and shows a small spinner. Fix: `useLayoutEffect` for the compensation; a thin `StateMessage kind="loading" size="inline"` at the top while `history === 'loading-older'` (expose it from `historyStateFor`); guard with a local `requestedAt` ref.

**WUX-28 (P3, confirmed)** Scroll position is not remembered per chat: every open remounts (`ChatShell.tsx:58`, `ChatView.tsx:190`) and lands at the divider or the bottom. Telegram restores where you were. Fix: a `scrollTopByChat` ref in `ChatView` passed to `MessageList`.

**WUX-13 (P2, confirmed)** `ReplyQuote` has no click handler (`apps/web/src/components/ReplyQuote.tsx`); `scrollToMessage` is only used by search hits and the pinned banner (`MessageSearchResults.tsx:25`, `PinnedBanner.tsx:46`). Telegram jumps to the quoted message and flashes it. Fix: wrap the quote in a `button` that calls `scrollToMessage(quote.messageId)` and, if not loaded, `openAtMessage` (`store.ts:250`).

**WUX-29 (P3, confirmed)** Right-click opens the menu at the bubble corner (`MessageBubble.tsx:187-194`; `MessageActionsMenu.tsx:60-63` `top-6 right-0`), not at the pointer. Telegram opens at the cursor. Fix: pass `clientX/clientY` to `MessageMenu` and render it `fixed` at that point.

**WUX-30 (P3, confirmed)** Copy text and Pin give no feedback: `onCopy` just calls `copyText` (`apps/web/src/components/message/MessageMenu.tsx:115-118`), pin/unpin run detached and drop failures (`MessageMenu.tsx:16-18,125-134`). There is no toast component in the app (grep `toast`: none). Telegram shows "Text copied" / "Message pinned". Fix: a small `Toast` in `components/ui` (one `role="status"` region mounted in `ChatShell`, store slice `toast?: {text, until}`) used by copy, pin, invite-link copy.

**WUX-31 (P3, confirmed)** Date separators are plain rows (`apps/web/src/components/DateSeparator.tsx`), not sticky. Telegram pins the current date while scrolling. Fix: `sticky top-2` on the separator wrapper.

**WUX-32 (P3, confirmed)** Select mode only forwards (`apps/web/src/components/SelectionBar.tsx:5-6,34-37`); no multi-delete or copy. Telegram offers Forward, Delete, Copy. Later.

### 2.6 Keyboard and focus

**WUX-12 (P2, confirmed)** `TopicKeyboardNav` only walks `a[data-topic-row]` (`apps/web/src/components/TopicKeyboardNav.tsx:10-13,24`); `ChatListItem` links have no such attribute (`ChatListItem.tsx:70-82`), nor do people or message hits. The New chat button shows a `kbd N` (`NewChatButton.tsx:167-169`) but no handler exists (grep for an `n` key handler: none). Telegram: Up/Down and Ctrl+Tab move between chats, Esc closes. Fix: add `data-topic-row=""` to the DM link and to search rows; drop the `kbd` or bind `n` in the same listener as Cmd+K.

**WUX-33 (P3, confirmed)** Esc in a wide layout with a chat open does nothing (only narrow navigates home, `ChatShell.tsx:30-38`); there is no "close chat" (Telegram Desktop Esc clears search, then closes the chat). Low priority.

### 2.7 Responsive

Confirmed good: list/chat swap at 900 px (`ChatShell.tsx:27,43-56`), Back arrow in the header (`ChatHeader.tsx:145-147`), Esc goes back (`ChatShell.tsx:30-38`), folder chips on narrow (`FolderTabs.tsx`), `h-dvh`. See WUX-24 for the FAB overlap.

**WUX-34 (P3, confirmed)** On narrow, "Search in chat" navigates to `/` and focuses the list box (`ChatHeader.tsx:56-70`), leaving the chat; Telegram opens an in-chat search bar. Acceptable for now.

### 2.8 Accessibility

Confirmed good: focus ring on `:focus-visible` (`apps/web/src/index.css:164-167`), menus with roving focus, Home/End, Esc returning focus (`components/ui/menu.tsx:42-130`), dialogs and sheets trap focus and return it (`components/ui/use-modal.ts:20-57`), labels on icon buttons, `aria-current` on rows, reduced motion for pulses, skeletons, keys (`index.css:636-664`). Contrast of `--subtle-foreground #8a8a8a` on `#0a0a0a` is about 5.5:1 (AA).

**WUX-35 (P3, confirmed)** No live region announces new messages: `MessageList` renders no `aria-live` (`MessageList.tsx:271-331`; grep `aria-live` hits only forms and `SelectionBar`). Telegram Web announces "New message from X". Fix: an `sr-only` `role="status"` span in `MessageList` set to "N new messages" when `pending` changes.

**WUX-36 (P3, confirmed)** `animate-in fade-in slide-in-from-bottom-2` on a sending bubble has no `motion-reduce:` opt-out (`MessageBubble.tsx:209`). Add `motion-reduce:animate-none`.

**WUX-37 (P3, confirmed)** Header icon buttons have no `title` tooltip (`IconButton` passes none: `components/ui/icon-button.tsx:12-33`; `ChatHeader.tsx:176-189`). Telegram shows tooltips on hover. Fix: `title={aria-label}` default inside `IconButton`.

### 2.9 Feedback, errors, offline

Confirmed good: delayed skeletons (`Skeleton.tsx:9-12,37-38`), list retry banner (`ChatListBody.tsx:81-104`), history retry (`MessageList.tsx:243-258`), optimistic bubbles with Clock/Check/CheckCheck ticks (`MessageTicks.tsx:5-14`), "Not sent" + Retry, plain-word errors in auth, contacts and handles.

**WUX-14 (P2, suspected: toggle the network in devtools)** Offline shows only "Waiting for network…" in the list header after 1.5 s (`apps/web/src/components/chatList/rowsSelector.ts:59-68`; `ChatList.tsx:59,153-157`); the chat view has no banner and the composer stays enabled, so a send fails to "Not sent". Telegram shows "Waiting for network…" in the header and queues the message. Fix: read `s.status` in `ChatHeader` and show the same line under the title; keep sends but label the bubble "Will send when online" (the retry path exists).

**WUX-9 (P2, confirmed)** Sign out runs on click (`ChatListMenu.tsx:159-161`; `ChatList.tsx:82-85`), and "Archive topic for everyone" runs on click (`ChatHeader.tsx:246-253,327-334`). Telegram confirms log out. Fix: `ConfirmDialog` (exists, `MessageMenu.tsx:139-150`) before both.

### 2.10 Settings, profile, notifications, sign-out, account switch

**WUX-10 (P2, confirmed)** Every settings page is a route under `RequireAuth` that replaces `ChatShell` (`AppRoutes.tsx:146-225`), with a Back arrow to `/` (`SettingsShell.tsx:25-45`). The hamburger menu lists Invite, Requests, Chat folders, Blocked, Explore, Profile, Connections, Machines, Approvals, My AIs, Notifications, Install, Stickers, Integrations, Sign out, none with an icon though `MenuItem` supports one (`ChatListMenu.tsx:93-161`; `menu.tsx:157-192`). Telegram: a short menu with icons, Settings opens inside the left column. Fix: icons on each `NavMenuItem`; group entries (People: Requests, Blocked; Chats: Folders, Stickers, Notifications; Account: Profile, Sign out; Developer: Connections, Machines, Approvals, Integrations) with `aria-hidden` dividers; later render settings in the `aside` on wide screens.

**WUX-38 (P2, confirmed)** The display name cannot be changed after onboarding: `updateMe` is called only in `NamePage.tsx:23`; `ProfileSettingsSection` edits the handle and picture only (`apps/web/src/components/ProfileSettingsSection.tsx:135-178`). Telegram: Edit profile has name and bio. Fix: a `Name` `TextInput` + Save in `ProfileSettingsSection` calling `updateMe`.

**WUX-5 (P1, confirmed)** `usePushEnable` on a browser without a push service sets `onlyWhileOpen` and also `setErrorMessage(PUSH_SERVICE_UNAVAILABLE)` (`apps/web/src/lib/push/usePushEnable.ts:166-174`), so the page shows the "Only while open" card (`NotificationsPage.tsx:110-127`) and the same sentence again in red at the bottom (`NotificationsPage.tsx:162-166`). With permission `denied` the card reads "Blocked by the browser" but still shows the Enable button (`NotificationsPage.tsx:39-44`; `components/push/ThisDeviceCard.tsx:30-34`), and the click fails with "The browser did not grant permission…" (`lib/push/pageActions.ts:66`). All errors render after the Test section, far from the button that failed. One text says "Open Zilar, wait for it to connect" (`pageActions.ts:69`) while the user is in Zilar. Telegram: one toggle, one sentence under it. Fix: in `usePushEnable` do not set `errorMessage` for the only-while-open case; in `ThisDeviceCard` hide Enable when `state === 'Blocked by the browser'`; move the `errorMessage` paragraph into the card (pass it as a prop); reword `pageActions.ts:69` to "Not connected yet. Wait a moment and try again."

**WUX-39 (P3, confirmed)** No per-chat mute list or sound toggle on the Notifications page; mute lives only in row menus (`ChatActionsMenu.tsx:91-121`). Telegram lists exceptions. Later.

**WUX-40 (P3, confirmed)** No account switch: a signed-in user is redirected from `/login` (`apps/web/src/routes/LoginPage.tsx:21-26`, "needs a sign-out first, as in Telegram (T-1136)"). Telegram Web allows up to 3 accounts. Out of scope for now.

### 2.11 Theming, icons, copy

**WUX-41 (P3, confirmed)** Dark only: `color-scheme: dark` and tokens in `:root` with no scheme switch (`apps/web/src/index.css:5-10,67-68`). Components also hardcode greys that would break a light theme: `ReplyQuote.tsx:6-8`, `ComposerControls.tsx:120-122`, `EditBar.tsx:11-13`, `message/MessageMeta.tsx:7` (sender colours), `TopicRow.tsx:84`, `ChatListItem.tsx:91,140`. Telegram offers light, dark and system. Fix (prep only): replace the literals with existing tokens (`--border`, `--foreground`, `--badge-muted`), so a future light scheme is one `@media (prefers-color-scheme: light)` block.

**WUX-42 (P3, confirmed)** Emoji glyphs in UI chrome: sticker fallback `🙂` (`apps/web/src/components/StickerMessage.tsx:47`), warning `⚠️` (`components/sticker/PackEditorItems.tsx:71`), placeholder `🐱` (`PackEditorItems.tsx:93`). Reactions (`QUICK_REACTIONS`, `packages/chat-core/src/reactions.ts:2`) are content, fine. Fix: `Smile`, `CircleAlert` from lucide; placeholder text "Emoji".

**WUX-43 (P3, confirmed)** Copy is consistent and plain (sentence case, no jargon). Small nits: "Mute…" vs "Mute" toggles label by state (`ChatActionsMenu.tsx:119`); "CHANNEL" / "PUBLIC" tags are all-caps mono in rows and header (`ChatListItem.tsx:106-115`, `ChatHeader.tsx:124-128`) while role chips use the same style for different meaning (`GroupPanel.tsx:206-218`); "Delete for everyone" is the only delete (no "delete for me"), matching the product decision.

### 2.12 PWA

Confirmed good: manifest with maskable icon (`apps/web/public/manifest.webmanifest`), service worker registered at boot (`apps/web/src/App.tsx:14-19`), offline page cached (`public/sw.js:54,112-119`), `notificationclick` opens the chat (`sw.js:88-91`), in-tab notifications while hidden (`lib/push/inTab.ts:42-58`), install entry when `beforeinstallprompt` fires (`ChatListMenu.tsx:144-156`).

**WUX-44 (P3, confirmed)** No "update available, reload" prompt: registration failures and updates are ignored (`App.tsx:17`). Telegram Web reloads silently. Fix later: listen for `registration.waiting` and show the toast from WUX-30.

## 3. Keyboard and interaction table

| Action | Zilar web | Telegram Web | Status |
| --- | --- | --- | --- |
| Send / newline | Enter / Shift+Enter (`Composer.tsx:355-362`) | same | ok |
| Edit last message | Up in empty composer (`Composer.tsx:335-341`) | same | ok |
| Cancel edit / reply / picker | Esc, layered (`Composer.tsx:315-354`) | same | ok |
| Focus composer on chat open / type-to-focus | none (WUX-6) | yes | gap P1 |
| Search | Cmd/Ctrl+K focuses (`SearchBar.tsx:15-24`); Enter opens top message hit | Esc clears, arrows walk results | gap P1 (WUX-1) |
| Chat list Up/Down | topic rows only (`TopicKeyboardNav.tsx:24`) | all rows, Ctrl+Tab next chat | gap P2 (WUX-12) |
| New chat | `kbd N` shown, no handler (`NewChatButton.tsx:167`) | none | misleading P2 |
| Back on narrow | Esc and Back arrow (`ChatShell.tsx:30-38`, `ChatHeader.tsx:145`) | Back | ok |
| Menus | arrows, Home/End, Esc returns focus (`menu.tsx:68-130`) | same | ok |
| Dialogs / panels | focus trap, Esc topmost only (`use-modal.ts:20-57`) | same | ok |
| Mention picker | arrows, Enter/Tab, Esc (`useMentions.ts:150-177`) | same | ok |
| Message context menu | right-click at bubble corner (`MessageBubble.tsx:187-194`) | at cursor, reactions row | P3 (WUX-29) |
| Paste / drop file | yes (`useComposerAttachments.ts:104-148`) | yes, multi | ok (single) |
| Jump to bottom | button with count (`MessageList.tsx:332-343`) | same | ok |
| Jump to quoted message | none (WUX-13) | click quote | gap P2 |
| Sign out | one click (WUX-9) | confirm | gap P2 |

## 4. Fix plan (ordered by user impact, then size)

1. **Search results that open things** (WUX-1, WUX-2, WUX-12): `PeopleSearchResult.tsx` rows become links (DM if contact, else `/@handle`), always show the no-match line; `ChatListBody.tsx` no first-run empty state while searching; `data-topic-row` on `ChatListItem` links and search rows; Esc in `SearchBar.tsx`. Files: `PeopleSearchResult.tsx`, `ChatListBody.tsx`, `ChatListItem.tsx`, `SearchBar.tsx`, `TopicKeyboardNav.tsx`. Small.
2. **One badge layout + no hover overlap** (WUX-4): `TopicRow.tsx` and `ChatListItem.tsx` share one "more" placement (absolute, title row) or switch to right-click only via `onContextMenu`; emulator/browser screenshot before and after. Small.
3. **Per-chat composer drafts + focus** (WUX-3, WUX-6): store slice `composerDrafts` in `store/store.ts` + `effects/prefs.ts`; `Composer.tsx` reads/writes it; `ChatListItem.tsx` "Draft:" prefix; focus on open and type-to-focus in `ChatView.tsx`. Medium; one test in `store/effects` for draft keep/clear on send.
4. **Start a DM from New message and the contact card** (WUX-7, WUX-19): new `NewMessageDialog.tsx` listing contacts with search; `ContactProfileRow.tsx` Message for every contact; requests row at the top of `ChatListBody.tsx`. Medium.
5. **Notifications page clarity** (WUX-5): `usePushEnable.ts` no error for only-while-open; `ThisDeviceCard.tsx` hides Enable when blocked and shows the error inline; reword `pageActions.ts:69`. Small.
6. **Group membership actions** (WUX-8, WUX-20): `GroupMembersSection.tsx` (new) with Remove for managers and Add members from contacts; Leave group in `ChatHeader.tsx` menu; `NewGroupDialog.tsx` search + zero members. Medium; needs a `leaveGroup` port check (`effects/groupSettings.ts`).
7. **Confirmations and feedback** (WUX-9, WUX-30): `ConfirmDialog` before Sign out and Archive topic; `components/ui/toast.tsx` (new) + store `toast` slice; use for copy, pin, invite link. Small.
8. **Older-history loading and quote jump** (WUX-11, WUX-13, WUX-28): `useLayoutEffect` compensation, top spinner, `requestedAt` guard, per-chat scroll memory in `ChatView.tsx`; clickable `ReplyQuote.tsx`. Small-medium.
9. **Menu and settings shape** (WUX-10, WUX-38): icons and dividers in `ChatListMenu.tsx`; Name field in `ProfileSettingsSection.tsx`. Small.
10. **Polish batch** (WUX-14 header offline line, WUX-15 autofocus, WUX-22/41 token literals, WUX-42 emoji to icons, WUX-35 live region, WUX-36 motion, WUX-37 tooltips, WUX-24 FAB padding, WUX-25 badge cap, WUX-31 sticky dates). Several one-file tasks; fine as a wave of small specs.
