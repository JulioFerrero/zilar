# Client UX findings sweep (T-1433)

Rechecked the 57 findings that `docs/plan/plan.json` still marks open (MP-9, UI-7 UI-8
UI-12 UI-13 UI-14 UI-15, MUX-13 MUX-16..MUX-33, WUX-10 WUX-14 WUX-16..WUX-44) against the
code on this branch (`4ff4ed187`, "T-1433: spec"). For each finding I read its audit text,
searched for the code it cites (the audit line numbers have moved) and classified it:

- **fixed** — done now; evidence `file:line`, plus the task id when a comment names one.
- **open** — still wrong; one line on what remains, with `file:line`.
- **partly** — some of it shipped; the rest is named with `file:line`.
- **not actionable** — praise ("solid", "good") or a deliberate/owner decision (dark only
  D24, "out of scope for now", a sticky-date revert), not a defect to fix.

`area` lists the main full-repo files a fix would touch, so findings without overlapping
files can be batched together. Line numbers are on this branch.

| id | status | evidence / what remains | area |
| --- | --- | --- | --- |
| MP-9 | not actionable | Delivered tick shipped as server-recorded delivery, not XEP-0184 (`packages/chat-core/src/types.ts:7`, T-1238). Read is still XEP-0333 `displayed`, and `handleDisplayed` marks read for any non-own sender with no DM/group guard (`packages/client-core/src/store/incoming.ts:251-261`), so a room's first reader still flips the sender's tick; no `urn:xmpp:receipts` under `packages/xmpp-core/src`. **Lead, 2026-10-15:** the group rule matches Telegram (two checks once any member has read it), so it stays; a per-member "read by" list would be a new feature. | packages/client-core/src/store/incoming.ts, packages/client-core/src/store/history.ts, packages/xmpp-core/src/stanza/decode.ts, packages/xmpp-core/src/core-effect/stanza-router.ts |
| UI-7 | fixed | `canAct()` added (`packages/chat-core/src/edits.ts:43`, guards sending/failed); web gates Edit/Delete/react on it (`apps/web/src/components/message/MessageMenu.tsx:133-168`), mobile too (`apps/mobile/src/components/chat/message-bubble-actions.tsx:113-115`). Comment names UI-7. | — |
| UI-8 | fixed | Per-chat drafts exist on both apps (T-1170 web / T-1181 mobile): `apps/web/src/lib/composer-drafts.ts` + `apps/web/src/components/Composer.tsx:29`, `apps/mobile/src/lib/composer-drafts.ts` + `apps/mobile/src/components/chat/composer.tsx:100`; "Draft:" preview in `apps/web/src/components/ChatListItem.tsx:68-72` and `apps/mobile/src/components/chat/chat-list-item.tsx:58-60`. | — |
| UI-12 | fixed | One recency sort instead of top-insert: `orderChatRows` → `sortByRecency([...fresh, ...kept])` (`packages/client-core/src/store/rows.ts:29-34`), `chatSortTime` falls back to `createdAt` (T-1318), preview loaded on discovery (`apps/web/src/store/effects/history.ts:302-310`, `apps/mobile/src/store/effects/history.ts:271-279`). Comment names UI-12. | — |
| UI-13 | fixed | `resetUserState` now calls `ctx.k.reset()` and the three manual map clears are gone (`apps/web/src/store/effects/lifecycle.ts:102`, comment names UI-13); mobile already called it (`apps/mobile/src/store/effects/user-state.ts:112`). | — |
| UI-14 | fixed | Sticker failure uses `markSendFailed(..., 'network')` → `status: 'failed'` (`packages/client-core/src/store/send/sticker.ts:27,121,144`), `retrySticker` → `markSendRetrying` (`:154`); `markStickerFailed` no longer exists. Comment names UI-14. | — |
| UI-15 | open | Pins still refresh only every 60 s or on focus (`packages/client-core/src/store/polling.ts:18`, `pinsPolling` `:149-163`); a pin from another device/member is up to a minute late. Audit itself defers it ("not urgent"). | packages/client-core/src/store/polling.ts, apps/web/src/store/effects/pins.ts, apps/mobile/src/store/effects/pins.ts |
| MUX-13 | partly | Viewer rebuilt on `react-native-zoom-toolkit` `Gallery` (T-1341): pinch/pan/double-tap zoom, swipe between photos, pull-down dismiss, Save (`apps/mobile/src/components/chat/image-viewer.tsx:113-236`). Remains: no Share action (`expo-sharing` is not a dependency; toolbar has Save + Close only). | apps/mobile/src/components/chat/image-viewer.tsx, apps/mobile/package.json, apps/mobile/src/lib/save-photo.ts |
| MUX-16 | fixed | `openMessage` calls `reloadChats()` when the row is missing and still pushes the chat id (`apps/mobile/src/components/profile/use-profile-dm.ts:62-71`, T-1308). | — |
| MUX-17 | partly | Done: send key `hitSlop={8}` (`composer-input-row.tsx:145`), quick reactions `h-11 w-11` 44 dp (`message-actions-sheet.tsx:144`), reaction chips `hitSlop={8}` + `py-1` (`reaction-chips.tsx:41-52`), cancel-reply `hitSlop={8}` (`composer-input-row.tsx:56`). Remains: search clear is still a bare 16 px `Pressable` with no `hitSlop` (`apps/mobile/src/components/ui/search-field.tsx:58-60`). | apps/mobile/src/components/ui/search-field.tsx |
| MUX-18 | open | Fixed heights with no font scaling: rows `h-[76px]` (`chat-list-item.tsx:91`), header `h-16` (`chat-header.tsx:145`), composer 36/132 (`composer-input-row.tsx:20-21`); `Text` sets no `maxFontSizeMultiplier` (zero hits repo-wide) (`apps/mobile/src/components/ui/text.tsx`). | apps/mobile/src/components/chat/chat-list-item.tsx, apps/mobile/src/components/chat/chat-header.tsx, apps/mobile/src/components/chat/composer-input-row.tsx, apps/mobile/src/components/ui/text.tsx |
| MUX-19 | open | `app.json` intent filters are VIEW only; no `expo-share-intent` dependency and no `/share` route under `apps/mobile/src/app`, so Zilar is absent from the system share sheet. | apps/mobile/app.json, apps/mobile/package.json, new apps/mobile/src/app/share.tsx |
| MUX-20 | open | Auth screens are still a centered `SafeAreaView` with no keyboard avoidance (`apps/mobile/src/auth/AuthFlow.tsx:151`, `apps/mobile/src/auth/NameForm.tsx:62`, `apps/mobile/src/app/welcome/handle.tsx:138`); no `KeyboardAvoidingView` in auth/welcome. | apps/mobile/src/auth/AuthFlow.tsx, apps/mobile/src/auth/NameForm.tsx, apps/mobile/src/app/welcome/handle.tsx |
| MUX-21 | partly | Double-tap-to-react shipped with a haptic (`apps/mobile/src/components/chat/bubble-gesture.tsx:34-58`, T-1302). Menu is a native sheet (`apps/mobile/src/components/ui/action-sheet.tsx:30-35`, T-1348) but still a bottom sheet, not anchored to the message (no `measureInWindow`). | apps/mobile/src/components/chat/message-bubble.tsx, apps/mobile/src/components/ui/action-sheet.tsx |
| MUX-22 | partly | One `tap()` helper exists (`apps/mobile/src/components/chat/haptics.ts`, comment names MUX-22) on chat-row long-press and the bubble menu; voice start/cancel and double-tap-react have haptics. Remains: no haptic on send, none on the quick-reaction buttons. | apps/mobile/src/components/chat/composer-input-row.tsx, apps/mobile/src/components/chat/message-actions-sheet.tsx |
| MUX-23 | partly | Three channels keyed by chat kind shipped, legacy channel deleted (T-1302) (`apps/mobile/src/lib/push/channels.ts:17-46`, `native.ts:201-214`, used `background.ts:132,144`). Remains: no `categoryIdentifier`/Reply action and no `threadIdentifier` grouping (`background.ts` post `~120-133`). | apps/mobile/src/lib/push/background.ts, apps/mobile/src/lib/push/native.ts |
| MUX-24 | open | `predictiveBackGestureEnabled: false` still set (`apps/mobile/app.json:21`); the MUX-6 precondition is now in (`apps/mobile/src/lib/navigation.ts`, T-1173), so it is no longer blocked. | apps/mobile/app.json |
| MUX-25 | fixed | Message time is 11 px everywhere (`message-bubble-decor.tsx:74`, `plain-bubble-body.tsx:74`, `attachment-body.tsx:158`; T-1289); only the "Not sent" suffix stays 10 px, which is a label, not the time. | — |
| MUX-26 | partly | Chat voice unified to "Could not … Try again." (`message-list.tsx:298`, `attachment-body.tsx:223`, `chat-thread.tsx:91-109`) and a real for-me/for-everyone delete exists (`message-actions-sheet.tsx:234-242`). Remains: no shared `apps/mobile/src/lib/copy.ts`; "Muted: change" (`chat-actions-sheet.tsx:148`); bare "Chat not found" (`apps/mobile/src/app/chat/[id].tsx:45`); "Message not found" notice (`chat-thread.tsx:143`). T-1289 left these out of scope. | new apps/mobile/src/lib/copy.ts, apps/mobile/src/app/chat/[id].tsx, apps/mobile/src/components/chat/chat-actions-sheet.tsx, apps/mobile/src/components/chat/chat-thread.tsx |
| MUX-27 | partly | All three empty states use `StateMessage`; chats has "Start a chat" (`chat-list-page.tsx:101-115`) and topics has "New topic" (`group-topic-list.tsx:110-118`). Remains: the messages empty state has no action (`apps/mobile/src/components/chat/message-list.tsx:303-312`, T-1289). | apps/mobile/src/components/chat/message-list.tsx |
| MUX-28 | fixed | Topics `FlatList` has a `RefreshControl` wired to `refreshGroupDetail` + `reloadChats` (`group-topic-list.tsx:96-102`, T-1288). | — |
| MUX-29 | fixed | The "+" menu has a "New topic" entry opening a group picker (`new-chat-button.tsx:191,210-213`, comment names T-1289/MUX-29). | — |
| MUX-30 | fixed | Send key renders lucide `Check` while editing, `ArrowUp` otherwise (`composer-input-row.tsx:158-162`, T-1288). | — |
| MUX-31 | not actionable | Dark only by decision D24 (`app.json:9`, `_layout.tsx:101,119`), held consistently; literal hexes remain but the audit itself says "no fix now", deferred to the backgrounds task. | — |
| MUX-32 | fixed | `DismissBanner` is gone; one transient 3 s toast sits over the list (`apps/mobile/src/components/ui/toast.tsx:9,23-35`, `chat-thread.tsx:24-25,172`, T-1289). | — |
| MUX-33 | fixed | The "?" fallback is gone: tab icon falls back to lucide `MessagesSquare` (`floating-tab-bar.tsx:41-44`) and the profile entry uses lucide `UserRound` (`apps/mobile/src/app/(tabs)/settings.tsx:53`, T-1302). | — |
| WUX-10 | partly | Menu now has icons and shrank from 15 to ~7 entries (`apps/web/src/components/chatList/ChatListMenu.tsx:30-50,160-207`), grouping moved to a `/settings` hub (`apps/web/src/routes/SettingsHubPage.tsx:58-119`). Remains: settings are still full-page routes that replace `ChatShell` (`apps/web/src/routes/AppRoutes.tsx:149-273`), no in-aside rendering on wide screens (audit calls that part "later"). | apps/web/src/routes/AppRoutes.tsx, apps/web/src/routes/ChatShell.tsx, apps/web/src/components/SettingsShell.tsx, apps/web/src/components/chatList/ChatListMenu.tsx |
| WUX-14 | partly | Offline/connecting line now also renders in the chat view above the composer (`apps/web/src/routes/ChatView.tsx:60,289-296`). Remains: not under the header title; composer still has no offline state (`apps/web/src/components/composer/ComposerControls.tsx:184-202`); no "Will send when online" label — a send still ends as "Not sent" (`apps/web/src/components/message/SendFailure.tsx:25`). | apps/web/src/routes/ChatView.tsx, apps/web/src/components/ChatHeader.tsx, apps/web/src/components/Composer.tsx, apps/web/src/components/MessageBubble.tsx |
| WUX-16 | not actionable | Praise ("Invite flow is good… copy is clear") with a deliberate "fine for now" on the generic fallback (`apps/web/src/components/auth/AuthFlow.tsx:36`). | — |
| WUX-17 | open | Handle-gate dismissal is still in `sessionStorage` (`apps/web/src/lib/handleGate.ts:21`), so the gate asks again at the next browser session. | apps/web/src/lib/handleGate.ts |
| WUX-18 | open | "Checking your invite link…" still renders with no spinner and no delay (`apps/web/src/routes/JoinPage.tsx:113-119,147-153`); `useDelayed` is not used there. | apps/web/src/routes/JoinPage.tsx |
| WUX-19 | fixed | Incoming requests now show as per-request rows at the top of the list (`apps/web/src/components/chatList/ChatListBody.tsx:106-110`, `apps/web/src/components/chatList/RequestRows.tsx:32-38`, T-1336). | — |
| WUX-20 | fixed | Member step gained a `SearchField` and Next no longer requires a member (`apps/web/src/components/NewGroupMembers.tsx:9-47`, `apps/web/src/components/NewGroupDialog.tsx:151-153`). Comment names WUX-20. | — |
| WUX-21 | fixed | `GroupPanel` renders `GroupMembersSection` with "Add members" and "Leave group" (`apps/web/src/components/GroupPanel.tsx:189`, `apps/web/src/components/GroupMembersSection.tsx:18-21,231,302`, T-1183). | — |
| WUX-22 | fixed | The cited literals are gone; `MessageSearchResult.tsx:93` now uses `text-subtle-foreground` (no `border-[#1a1a1a]`/`text-[#d4d4d4]` in `ChatListItem.tsx`/`TopicRow.tsx`/`MessageSearchResult.tsx`). | — |
| WUX-23 | fixed | Message-search hit list keeps a highlighted row and Enter opens it, not only the top hit (`apps/web/src/components/MessageSearchResults.tsx:79-160`). Comment names WUX-23. | — |
| WUX-24 | fixed | List nav has `pb-20` when narrow (`apps/web/src/components/chatList/ChatListBody.tsx:67`) above the FAB (`apps/web/src/components/NewChatButton.tsx:152`). | — |
| WUX-25 | fixed | Folder tabs now use `Badge` (`apps/web/src/components/FolderTabs.tsx:82-88`), which caps at "99+" (`apps/web/src/components/ui/badge.tsx:12-16`). | — |
| WUX-26 | fixed | Emoji picker has a search box and categories (`apps/web/src/components/sticker/EmojiTab.tsx:6-47`, `apps/web/src/components/sticker/emoji.ts:1-23`). Comment names WUX-26. | — |
| WUX-27 | partly | `multiple` is set on both attach inputs and all-image picks stage up to 10 as one album (`apps/web/src/components/composer/useComposerAttachments.ts:115-144`). Remains: a non-image or mixed pick still keeps only the first file (`:123-131`). | apps/web/src/components/composer/useComposerAttachments.ts, apps/web/src/components/attach/AttachMenu.tsx |
| WUX-28 | fixed | Per-chat scroll memory implemented (`apps/web/src/components/useScrollMemory.ts`, wired `apps/web/src/components/MessageList.tsx:134,163`). Comment names WUX-28. | — |
| WUX-29 | fixed | Right-click point passed through and menu rendered at it (`apps/web/src/components/MessageBubble.tsx:187-190`, `apps/web/src/components/MessageActionsMenu.tsx:53-54,105-115`). Comment names WUX-29. | — |
| WUX-30 | fixed | `ui/toast.tsx` (ToastProvider/useToast) mounted in `App.tsx:25`; copy/pin feedback in `apps/web/src/components/message/MessageMenu.tsx:113,131-176`. Comment names WUX-30. | — |
| WUX-31 | not actionable | Deliberate revert (T-1327): a sticky row pinned every separator at once and covered messages, so it stays a plain flow row (`apps/web/src/components/DateSeparator.tsx:3-9`). Owner/product decision, not a bug. | — |
| WUX-32 | fixed | SelectionBar now offers Forward, Delete and Copy (`apps/web/src/components/SelectionBar.tsx:64-128`, T-0439). Comment names WUX-32. | — |
| WUX-33 | fixed | Wide-layout Esc now closes the open chat (`apps/web/src/routes/ChatShell.tsx:28-46`). Comment names WUX-33. | — |
| WUX-34 | fixed | Narrow "Search in chat" opens an in-chat bar instead of leaving to `/` (`apps/web/src/components/ChatSearchBar.tsx:21`, `apps/web/src/routes/ChatView.tsx:247-248`, T-1301/T-1323). | — |
| WUX-35 | fixed | `sr-only role="status"` announcer on a new incoming message (`apps/web/src/components/MessageAnnouncer.tsx:35`, mounted `apps/web/src/components/MessageList.tsx:340`). Comment names WUX-35. | — |
| WUX-36 | fixed | The sending bubble carries `motion-reduce:animate-none` (`apps/web/src/components/MessageBubble.tsx:214`). Note: the comment the task mentioned is not on that line, but the class is present. | — |
| WUX-37 | fixed | `IconButton` defaults `title={title ?? label}` from `aria-label` (`apps/web/src/components/ui/icon-button.tsx:26-28`); header buttons inherit it. | — |
| WUX-38 | fixed | Display name editable in Settings, Save calls `updateMe(nextName)` (`apps/web/src/components/ProfileSettingsSection.tsx:151`, T-1282). | — |
| WUX-39 | partly | Per-chat mute list on Notifications shipped (`apps/web/src/components/push/MutedChatsSection.tsx`, rendered `apps/web/src/routes/NotificationsPage.tsx:180`). Remains: no sound/vibration toggle anywhere. | apps/web/src/routes/NotificationsPage.tsx, apps/web/src/components/push/ |
| WUX-40 | not actionable | Deliberate, documented: an authenticated user is redirected from `/login` with comment "needs a sign-out first, as in Telegram (T-1136)" (`apps/web/src/routes/LoginPage.tsx:21-26`). Out of scope for now. | — |
| WUX-41 | not actionable | Dark only is deliberate (D24); tokens live in `:root` with no scheme switch (`apps/web/src/index.css:5-10,67-68`). The token clean-up is optional prep for a future light theme, not a defect. | — |
| WUX-42 | fixed | Sticker fallback uses lucide `Smile` (`apps/web/src/components/StickerMessage.tsx:49`); pack-editor warning uses `CircleAlert` and the placeholder text is "Emoji" (`apps/web/src/components/sticker/PackEditorItems.tsx:91,113`). | — |
| WUX-43 | fixed | All-caps tags replaced with sentence-case muted text ("Channel"/"Public": `apps/web/src/components/ChatListItem.tsx:95-96,137,140`, `apps/web/src/components/ChatHeader.tsx:124-128`). Remaining nits are intentional ("Mute…" expands durations in place; "Delete for everyone" is the product decision). Comment names WUX-43. | — |
| WUX-44 | partly | A reload prompt exists for protocol mismatch (`apps/web/src/components/ClientVersionBanner.tsx:22`, OPS-21). Remains: the SW update path is still unwired — `App.tsx:15-19` ignores `ensureServiceWorker`, no `registration.waiting`/`updatefound` handling. | apps/web/src/App.tsx, apps/web/src/lib/push/ |

## Counts

- **fixed: 32** — UI-7, UI-8, UI-12, UI-13, UI-14, MUX-16, MUX-25, MUX-28, MUX-29, MUX-30, MUX-32, MUX-33, WUX-19, WUX-20, WUX-21, WUX-22, WUX-23, WUX-24, WUX-25, WUX-26, WUX-28, WUX-29, WUX-30, WUX-32, WUX-33, WUX-34, WUX-35, WUX-36, WUX-37, WUX-38, WUX-42, WUX-43
- **partly: 13** — MP-9, MUX-13, MUX-17, MUX-21, MUX-22, MUX-23, MUX-26, MUX-27, WUX-10, WUX-14, WUX-27, WUX-39, WUX-44
- **open: 7** — UI-15, MUX-18, MUX-19, MUX-20, MUX-24, WUX-17, WUX-18
- **not actionable: 5** — MUX-31, WUX-16, WUX-31, WUX-40, WUX-41

Total: 57.

## Updates after the sweep (lead, 2026-10-15)

The table and counts above are as of the sweep. Since then:

- **Now fixed:**
  - MUX-18: fonts are capped at 1.4× and the rows grow with them (T-1436; tables follow in T-1486);
  - MUX-20: the auth screens avoid the keyboard (T-1436);
  - MUX-24: predictive back is on, tested on Android 16 (T-1489);
  - WUX-17: Skip on the handle gate is remembered (T-1435);
  - WUX-18: the invite check shows a spinner (T-1435).
- **Partly done before, now complete:**
  - MUX-17: the search clear key is easier to hit (T-1436);
  - MUX-22: send and the quick reactions give haptics (T-1436);
  - WUX-44: a waiting service worker now offers Reload (`useServiceWorkerUpdate`, `apps/web/src/App.tsx:15`, `controllerchange` at `apps/web/src/lib/push.ts:133`, T-1435).
- **Not actionable:** MP-9, because the group rule matches Telegram (see its row).
- **Still open:** UI-15 and MUX-19, both on Julio's list.
