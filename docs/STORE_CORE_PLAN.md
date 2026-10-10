# Store core plan (simplify plan 4.3)

Written by T-0896 on 2026-10-10, from commit `aa7cf979`. Every `file:line` below was read at that commit; merges move lines, so re-check a citation before you copy it into a spec. "web" means `apps/web/src/store/`, "mobile" means `apps/mobile/src/store/`, "core" means `packages/client-core/src/store/` (it does not exist yet).

## 0. Summary

- **Lifetime:** the core takes web's `Lifetime` (one store Scope from `start()` to `stop()`, one child session Scope per boot attempt, `FiberSet` + `FiberMap` runners). Mobile's two Scopes map onto it one to one, and its keyed runner replaces five hand-kept timer maps on mobile. Section 3.
- **Pilot:** T1, "store package wiring + pure row helpers". It moves 8 verbatim pure functions (`sortByRecency`, `moveChatToTop`, `sortMessages`, `advanceStatus`, `clearFailure`, `coreKind`, `rememberFinishedDraftMessage`, `withoutDraft`) into `core/rows.ts`, adds the package dependencies and the `@zilar/client-core/store` entry, and proves Metro and both test runners resolve it. No behaviour changes.
- **Split:** 10 tasks (section 6). Each new core module is extracted from web first, behind the unchanged web facade, and mobile adopts it in a separate task. Pins, prefs, folders, groups, the shared `ChatEntry` mapping and the state-name clean-up are phase 2 (section 9).
- **Real behaviour differences:** 20 are listed in section 2.3. Six change what a user sees; they make four questions for Julio (section 8). The biggest: mobile never maps the mentions of a received message, and mobile voice, attachment and forward failures have no 60 s deadline and no failure status.
- **The audit is partly stale:** F1a (AI flag) and F1c (pinned topics first) are fixed, and F1b is wrong about text: web text sends also stay `sending` on failure (section 1).

## 1. What changed since the audit (2026-10-09)

| Audit claim | Now | Evidence |
| --- | --- | --- |
| F1a: mobile never marks AI DMs | Fixed | `mobile/real-store.ts:169` reads `entry.isAi === true` |
| F1b: web marks a failed **text** send Not sent after 60 s | Wrong. Web text sends swallow the error and stay `sending`, exactly like mobile. The 60 s deadline covers only voice, attachments and forwards on web | `web/effects/send.ts:406-430` (comment at `:427`), `mobile/effects/send.ts:364-393`; deadline in `web/effects/send.ts:69-88`, used at `:186`, `:254`, `:347` |
| F1c: pinned topics first only on web | Fixed: both use chat-core `sortTopics` | `web/store.ts:522`, `apps/mobile/src/lib/topics.ts:136,140`, `packages/chat-core/src/topics.ts:8` |
| F2: web has no selector hook | A selector hook exists | `web/ChatStoreProvider.tsx:54-56` |
| F3: media and pref helpers duplicated | `trustedMediaHosts`, `isTrustedMediaUrl`, `sanitizeIncomingAttachment`, `cleanFilename` and `applyChatPrefs` are in chat-core | `packages/chat-core/src/media.ts:11,60,82,146`, `packages/chat-core/src/chat-prefs.ts:60` |
| Ledger helpers | `forwardedPayloadFor`, `forwardedUiFieldsFor`, `mentionsEqual`, `reactionsEqual`, `reactionChips`, `userLocalpartOf` are in chat-core | `packages/chat-core/src/store/ledger.ts:10,27,40,61,92,115` |
| `client-core` | Exists with `createAtomStore`, `useStoreSelector`, `makeUseAction`, `makeUseQuery`, `ApiFailure`; no store code, no dependency on chat-core, xmpp-core or protocol | `packages/client-core/src/index.ts:1-12`, `packages/client-core/package.json:13-17` |
| Fake XMPP core | `createFakeXmppCore` in `@zilar/xmpp-core/testing`; mobile tests use it, web still has its own `fakeXmpp` | `packages/xmpp-core/src/testing.ts:32`, `apps/web/src/test/storeHarness.ts:12-13` |
| One wire contract | The derived client exists, but `/api/chats` entries stay `Unknown` in the contract, each app keeps its own `ChatEntry`, and mobile keeps a hand-written `GroupDetail` | `packages/api-contract/src/chats.ts:4-16`, `apps/web/src/lib/api.ts:143`, `apps/mobile/src/lib/chat-api.ts:22-53,70-82` |
| Unpin result | Still `Promise<void>` on web, `Promise<Pin>` on mobile | `apps/web/src/lib/api.ts:753`, `apps/mobile/src/lib/pins-api.ts:36` |
| Store tests "16k lines" | Measured 14.9k: web 6,082, mobile 8,785 (`wc -l` of every store test file) | section 7 |

## 2. Inventory

Tags: **same** = same behaviour, different code; **web-only** / **mobile-only** = a feature one side has; **real** = the same feature behaves differently (section 2.3 picks the winner).

### 2.1 Modules

| Module | Exports | Counterpart | Differences that matter |
| --- | --- | --- | --- |
| `web/realStore.ts` (1,550) | `createRealChatStore` `:146`; re-exports constants, `mergeWithPainted`, `summariesFor`, `sendFailureReasonFor`, `ApiClient`, `RealStoreDeps`, `StorageLike` `:114-121` | `mobile/real-store.ts` | The closure holds the whole message ledger (`:182-1170`), the message mutators (`:649-899`), the `StoreCtx` wiring (`:1207-1314`) and the facade (`:1316-1548`). See 2.3 R1-R5 for the ledger differences. |
| `web/store.ts` (561) | `ChatStore` `:91-384`, `ChatStoreState` `:386-411`, option types `:43-89`, selectors `visibleChats` `:429`, `groupChats` `:478`, `folderUnread` `:549`, `matchesFolder` `:415`; re-exports the mock `createChatStore` `:40` | `mobile/types.ts` | State names differ (2.2). Selectors are web-only; mobile does the chat list in `apps/mobile/src/lib`. |
| `web/effects/ctx.ts` (140) | `Kernel` `:26-81`, `SendRun` `:84-86`, `StoreCtx` `:88-139` | `mobile/effects/runtime.ts` `StoreHelpers` `:156-248`, `StoreState` `:116-153`, `StoreCtx` `:265-282` | **same** pattern (a helper bag plus mutable bookkeeping). Mobile adds `StoreFx` `:251-262`, a bag of cross-module Effects; web imports modules directly. |
| `web/effects/runtime.ts` (118) | `Task`, `Fibers` `:14-23`, `Lifetime` `:25-43`, `makeLifetime` `:78-118` | `mobile/effects/runtime.ts` `Life` `:85-113`, `makeRunners` `:284-302` | Section 3. Web logs every failed fork (`:45-48`); mobile forks are unguarded (`:288-296`). Mobile `fork` returns the fiber (`:274`); web returns void (`:17`). |
| `web/effects/ports.ts` (326) | `ApiClient` `:90-160`, `StorageLike` `:162-166`, `RealStoreDeps` `:169-183`, `PortsShape` `:186-196`, `Ports` `:198`, `resolvePorts` `:267`, `portsLayer`, `PortsLive`, `testPorts` `:299`, `PortsTest`, `readPorts` | `mobile/effects/ports.ts` `AppStateLike` `:20-23`, `RealStoreDeps` `:25-56`, `PortsShape` `:59-78`, `resolvePorts` `:107`, `PortsLive`, `PortsTest` `:150` | **same** idea. Web has one flat `ApiClient`; mobile has nine per-domain clients, two of them optional (`chatPrefs`, `chatFolders` `:67-68`). **web-only:** `storage`, `goToLogin`. **mobile-only:** `uploader`, `statSize`, `ownedAis`, `appState`. The inert test layers differ: web rejects, mobile throws synchronously (`web :287-292`, `mobile :142-147`). |
| `web/effects/chatRows.ts` (263) | `sortByRecency` `:6`, `mergeWithPainted` `:20`, `summariesFor` `:161`, `coreKind` `:194`, `clearFailure` `:199`, `moveChatToTop` `:210`, `advanceStatus` `:234`, `rememberFinishedDraftMessage` `:243`, `sortMessages` `:258` | `mobile/real-store.ts` `:82-95,99-101,137-163,165-204,924-940,999-1008`; `apps/mobile/src/lib/topics.ts:23-124` | Eight helpers are **same** (verbatim). `summariesFor` is **real**: web rows carry `visibility`, `handle`, `avatarUrl`, `groupBackground` (`:73-78`, `:124-129`); mobile rows do not (`lib/topics.ts:23-64`, `real-store.ts:182-187`); this is audit F1g, phase 2. `mergeWithPainted` is **web-only** (cached list). |
| `web/effects/constants.ts` (30) | timing constants `:3-30` | `mobile/effects/polling.ts:8-23`, `mobile/effects/events.ts:20-21`, `mobile/effects/history.ts:12-20` | **same** values except the **web-only** `CONNECT_RETRY_DELAYS_MS` `:13`, `SEND_TIMEOUT_MS` `:16` and `LAST_READ_PREFIX` `:3`. |
| `web/effects/util.ts` (15) | `fromPromise` `:5`, `prefsByJid` `:9` | `mobile/effects/runtime.ts` `lift` `:26`, `recover` `:34`, `failAfter` `:47`, `orElse` `:57`, `detached` `:63` | **same**. |
| `web/effects/badge.ts` (24) | `syncBadgeInBackground` `:17`, `dismissNotificationsInBackground` `:22` | none | **web-only** (app badge, push dismiss). |
| `web/effects/reads.ts` (50) | `saveChatList` `:11`, `persistLastRead` `:22`, `recordRead` `:36` | `mobile/real-store.ts` `recordRead` `:363-372` | **real** (audit F1 i, still open): web persists last-read per user in storage (`:22-33`), mobile keeps it in memory (`real-store.ts:243`). Web also dismisses push and syncs the badge (`:48-49`). |
| `web/effects/incoming.ts` (241) | `handleMessage` `:92`, `handleTyping` `:167`, `handleDisplayed` `:199`, `handleOccupants` `:211`, `handlePresence` `:229` | `mobile/real-store.ts` `handleMessage` `:1459-1590`, `handleDisplayed` `:1592`, `handleOccupants` `:1606`, `handlePresence` `:1621`; `mobile/effects/events.ts` `handleTyping` `:69-115` | **same** flow. Web's echo also clears a failed send and sets `sent` (`:54-60`); mobile has no failed status to clear (R6). Typing timer: web keyed fiber (`:187-192`), mobile `Map<chatId, Fiber>` (`events.ts:58,88-107`), **same** result. Web syncs the badge on unread (`:155-157`), **web-only**. |
| `web/effects/messageActions.ts` (181) | `react` `:23`, `editMessage` `:55`, `deleteForEveryone` `:130`, `sendTyping` `:176` | `mobile/effects/events.ts` `actions.react` `:156`, `editMessage` `:193`, `deleteForEveryone` `:268`; `mobile/effects/send.ts` `sendTyping` `:330` | **same**, near verbatim, including the error texts (`web :123,169`, `mobile :262,308`). Both fork into the start-to-stop Scope. |
| `web/effects/history.ts` (496) | `canLoadHistory` `:49`, `loadOlderPage` `:72`, `loadPreview` `:109`, `flushPending` `:156`, `openHistory` `:169`, `loadOlder` `:246`, `openChat` `:255`, `openAtMessage` `:285`, `scheduleChatsRefresh` `:343`, `refreshChats` `:361`, `refreshChatsOrThrow` `:371` | `mobile/effects/history.ts` `makeHistory` `:44` (`History` `:22-37`); `scheduleChatsRefresh` is `mobile/effects/events.ts:117-133` | First page, older pages, previews and `openAtMessage` are **same**, line for line (`web :169-243` vs `mobile :281-353`). **real:** a topic that vanished while open goes to General with a notice keyed by chat id and `window.history.replaceState` on web (`:426-466`), to the topics screen with a notice keyed by group id on mobile (`:110-123`); this is platform navigation, so it becomes an adapter hook. **mobile-only:** `jumpTarget` (`:435,444,469`), folders loaded with the list (`:59-71,209-215`), `reloadChats` that restarts a boot that never reached a core (`:484-493`). **web-only:** quiet self-archive (`:426-438`), the stale-refresh `ApiError` (`:385-393`). |
| `web/effects/groupMembers.ts` (114) | `domainOf` `:14`, `applyGroupDetail` `:21`, `ensureGroupMembers` `:62`, `loadGroupMembersInBackground` `:91`, `joinGroups` `:100` | `mobile/effects/groups.ts` `ensureGroupDetail` `:119`, `ensureGroupMembers` `:209`, `joinGroups` `:242` | **real** (R14): web caches the detail per chat id (`:40-46`), mobile per group id with one shared GET (`:89-151,209-240`). Phase 2. |
| `web/effects/groups.ts` (571) | 22 topic, group and channel Effects `:112-571` | `mobile/effects/groups.ts` `makeGroups` `:69` (`GroupActions` `:18-52`) | Facades differ (R15, R17). **web-only:** group AIs, background, listener, visibility, members-can-create, public join, invite URL, `refreshTopicRow`, `refreshGeneralTopic`. **mobile-only:** invite links, custom roles and topic roles in the store, `listTopicMembers`, `listTopicAis`, `listChannelMembers`, `archiveTopic`, input validation (`:456-462,487-490`). Phase 2. |
| `web/effects/pins.ts` (169) | `refreshPinsFor` `:12`, `loadChatMedia` `:48`, `pinMessage` `:67`, `unpinMessage` `:130`, `setPushPair` `:158` | `mobile/effects/pins.ts` `makePins` `:46` (`PinActions` `:27-37`) | **real** (R12, R13): pins live in the atom on web (`pinsByChat`, `pinsReady`), in a closure `Map` plus a revision on mobile (`:54-76`). Mobile resolves relative media URLs against `API_URL` (`:20-25,121`). `setPushPair` is **web-only**. Phase 2. |
| `web/effects/prefs.ts` (225) | `applyPrefs` `:14`, `refreshChatPrefs` `:23`, `refreshDefaultBackground` `:35`, `setPinned`, `setMuted`, `setArchived`, `setChatBackground`, `setChatBackgroundImage`, `setDefaultBackground`, `setDefaultBackgroundImage` `:135-225` | `mobile/effects/events.ts` `setChatPref` `:317-370` | **real** (R11). Backgrounds are **web-only**. Phase 2. |
| `web/effects/polling.ts` (205) | `startChatsPolling` `:85`, `startPinsPolling` `:93`, `markTurnFinished` `:101`, `clearFinishedTurns` `:115`, `withoutDraft` `:120`, `clearDraftTimeout` `:130`, `startDraftStream` `:187` | `mobile/effects/polling.ts` `makePolling` `:59` (`Polling` `:37-51`), `withoutDraft` `:25` | Draft handling is **same** (`web :137-184` vs `mobile :176-226`). Web polls on window `focus` and `document.visibilityState` (`:24-45`); mobile on `AppState` (`:79-98,125-132`): one Visibility port. Web pins poll follows the active chat (`:62-67`); mobile starts one poll per opened chat (`:108-133`): **same** result. |
| `web/effects/lifecycle.ts` (355) | `readLastRead` `:42`, `startStore` `:76`, `retryBoot` `:99`, `stopStore` `:108`, `signOutStore` `:122` | `mobile/effects/lifecycle.ts` `makeLifecycle` `:34` (`Lifecycle` `:18-25`) | **real** (R7-R10). **web-only:** cached list paint and `pagehide` save (`:80-94`), connect retry with backoff (`:234-259`), one Scope per XMPP connection attempt (`:321-334`), sign-out (`:122-179`). **mobile-only:** reconnect on resume (`:184-223,240-248`), one boot per generation (`:154-180`). |
| `web/effects/send.ts` (721) | `sendText` `:372`, `sendVoice` `:433`, `retryVoice` `:470`, `deleteFailedMessage` `:487`, `sendAttachment` `:506`, `sendSticker` `:549`, `forwardMessages` `:604`, `retrySticker` `:675`, `retryAttachment` `:703` | `mobile/effects/send.ts` `makeSend` `:37` (`Send` `:15-28`); `forwardOriginFor` at `mobile/real-store.ts:1169` | Text, sticker and forward fan-out are **same**. **real:** R6, R18. **mobile-only:** upload progress, cancel, unknown-size stat, inline size and voice validation (`:91-187,544-551,604-619,625-638,700-714`). **web-only:** `deleteFailedMessage`, base text on sends (`:400,544,595,662`). |
| `web/effects/sendFailure.ts` (70) | `sendFailureReasonFor` `:9` | `voiceFailureReasonFor` in `apps/mobile/src/lib/voice-native.ts` (used at `mobile/effects/send.ts:265`) | Both map errors to a fixed `SendFailureReason`; the tables are not compared here. Moves with T10. |
| `web/chatListCache.ts` (123) | `CHAT_LIST_CACHE_KEY` `:9`, `readChatListCache` `:51`, `writeChatListCache` `:87`, `clearChatListCache` `:117` | none | **web-only**; stays a web adapter. |
| `mobile/real-store.ts` (1,827) | `isUpdateStanza` `:110`, `summariesFor` `:196`, `createRealChatStore` `:223`; re-exports constants `:72-78`, `AppStateLike`, `RealStoreDeps` `:97` | `web/realStore.ts` | Same structure as web: ledger `:390-922`, mutators `:942-1150`, sender names `:1190-1271`, `toUiMessage` `:1348-1411`, incoming `:1459-1651`, wiring `:1655-1773`, facade `:1775-1825`. `teardown` clears the ledger on `stop()` (`:1757-1773`), web does not (R10). |
| `mobile/types.ts` (507) | `ChatStoreState` `:150-507`, option types `:35-72`, `LoadState` `:79`, `draftEntryKey` `:92`, `chatsListView` `:108`, `messagesListView` `:125`, `emptyChatsText` `:142` | `web/store.ts` | State names differ (2.2). The view helpers are **mobile-only** (web uses `historyStateFor`, `realStore.ts:1324`). |
| `mobile/chat-store.ts` (1,595) | `createChatStore` `:358`, `createInitialState` `:152`, `isMockMode` `:1583`, mock constants `:49-57` | `web/mockStore.ts` `createChatStore` `:434` | The mock stores; out of scope (plan 4.4). |

### 2.2 State shape

The core writes the fields both sides name the same: `chats`, `contacts`, `messagesByChat`, `edits`, `reactions`, `typing`, `drafts`, `finishedDraftMessages`, `historyComplete`, `me`, `currentUserId`, `status`, `editTarget`, `actionError`, `mediaTrustedHosts`, `search`, `activeFolder`, `folders` (`web/store.ts:91-411`, `mobile/types.ts:150-507`). The rest goes through an app writer (section 4) until phase 2 renames them.

| Concern | Web | Mobile |
| --- | --- | --- |
| Chat list load | `chatsState: 'loading' \| 'ready' \| 'error'` (`store.ts:47,96`) | `chatsLoad: LoadState`, `'loaded'` not `'ready'` (`types.ts:79,158`) |
| First history page | `historyState` + `historyStateFor` (`store.ts:98,104`) | `historyLoad` (`types.ts:163`) |
| Open chat | `activeChatId: string \| undefined` (`store.ts:407`) | `activeChatId: string \| null` (`types.ts:176`) |
| Topic gone notice | `{ chatId, message }` (`store.ts:132`) | `{ groupId, message }` (`types.ts:294`) |
| Group detail | `groupInfos[chatId]` + `groupInfo(chatId)` (`store.ts:117,410`) | closure map by group id + `groupDetailsRevision` (`types.ts:301,307`) |
| Pins | `pinsByChat`, `pinsReady` in the atom (`store.ts:393-395`) | closure `Map` + revision (`mobile/effects/pins.ts:54-76`) |
| Prefs | `chatPrefs` record in the atom (`store.ts:218`) | closure `chatPrefRows` (`mobile/effects/runtime.ts:127`) |
| Refresh the list | `refreshChats()` debounced (`realStore.ts:1358-1360`) | `reloadChats()` loud, may reboot (`mobile/effects/history.ts:484-493`) |

### 2.3 Real behaviour differences

"Visible" means a user would notice; those are the questions in section 8.

| # | Difference | Web | Mobile | Winner and why | Visible |
| --- | --- | --- | --- | --- | --- |
| R1 | Mentions of a received message | mapped onto `ui.mentions` (`realStore.ts:1146-1149`) | never set (`real-store.ts:1348-1411`) | web: the composer sends mentions on both sides, so mobile drops what the sender meant | yes, Q1 |
| R2 | Mention name in a corrected message | group member, else text at range, else localpart (`realStore.ts:1081-1098`) | text at range only (`real-store.ts:523-535`) | web: mobile now has the member names (`real-store.ts:1204-1215`) | barely, Q1 |
| R3 | Reverted edit restores the first-seen text | yes (`realStore.ts:369-376,494-511`) | no base-text map (`real-store.ts:652-664`) | web: superset; failed edits already restore a snapshot on both (`messageActions.ts:121-122`, `events.ts:259-260`) | no |
| R4 | Linking two ids moves the origin, author and base-text maps | yes (`realStore.ts:251-253`) | no (`real-store.ts:409-416`) | web: without it an author is found only under the old id (`real-store.ts:465-467`) | no |
| R5 | `linkLocalToServer` also writes the alias root | no (`realStore.ts:314-318`) | yes (`real-store.ts:426-428`) | mobile: a chip tap that already canonicalised still finds the server id | no |
| R6 | Voice, attachment and forward failure | `status: 'failed'` + reason (`realStore.ts:747-776`), 60 s deadline and run tokens (`send.ts:64-106`), Delete (`send.ts:487`) | `failed: true` only, status stays `sending` (`real-store.ts:988-997,1088-1103`), no deadline (`send.ts:300-301`) | web: a hung upload ends on its own; mobile keeps the stuck clock. Text stays as it is on both (D-1, `simplify-plan.md:167`) | yes, Q2 |
| R7 | XMPP connect failure | retry after 2, 5, 15, 30, 60 s (`constants.ts:13`, `lifecycle.ts:234-259`) | offline until the next resume (`mobile/effects/lifecycle.ts:115-119,137-141`) | web, for both | yes, Q3 |
| R8 | Resume | none on web | reconnect when not online, wait for an in-flight boot (`mobile/effects/lifecycle.ts:184-223`) | keep mobile's behind a port flag; web unchanged | no |
| R9 | `start()` twice | restarts the session (`lifecycle.ts:79`) | no-op (`mobile/effects/lifecycle.ts:232-234`) | mobile: idempotent, no second core | no |
| R10 | `stop()` and the ledger | kept; `signOut` clears (`lifecycle.ts:108-120,140-175`) | cleared (`real-store.ts:1757-1773`) | core keeps it on `stop()` and has `reset()`; the mobile adapter calls `reset()` from `stop()` | no |
| R11 | Failed pref write | restores the pre-write snapshot (`prefs.ts:111-118`) | re-merges the saved rows, keeps what landed meanwhile (`events.ts:336-367`) | mobile | no (phase 2) |
| R12 | Where pins live | atom (`pins.ts:16-19`) | closure + revision (`mobile/effects/pins.ts:54-76`) | web: selectors read state, no revision trick | no (phase 2) |
| R13 | Pin and unpin errors | `pinsError` on both, "Could not pin the message. Try again." / "Could not unpin the message. Try again." (`pins.ts:115,149`) | unpin only, "Could not unpin. Try again." (`mobile/effects/pins.ts:219`) | web texts | yes, Q4 (phase 2) |
| R14 | Group detail cache | per chat (`groupMembers.ts:40-46`) | per group, one GET for all topic rows (`mobile/effects/groups.ts:89-151`) | mobile | no (phase 2) |
| R15 | Create a topic, group or channel | opens it and returns the chat JID (`groups.ts:123-147,271-325`) | returns the group id, no open (`mobile/effects/groups.ts:325-352,453-503`) | keep per-app facades (navigation differs) | n/a (phase 2) |
| R16 | Topic gone while open | General + notice by chat + URL replace (`history.ts:426-466`) | topics screen + notice by group (`mobile/effects/history.ts:110-123`) | adapter hook; same intent | n/a |
| R17 | `applyTopicRow` on an archived topic | drops the row (`groups.ts:61-64`) | keeps it, applies prefs (`mobile/effects/groups.ts:271-291`) | web's drop plus mobile's prefs | no (phase 2) |
| R18 | Sticker retry | no re-enqueue (`send.ts:692-700`) | enqueues the signature again (`mobile/effects/send.ts:525-531`) | web: a failed first send was never echoed, so its queue entry is still there; mobile leaves a stale second entry that a later identical sticker's echo would consume. Add a test first | no |
| R19 | Empty or too large file, bad recording | silent return on size 0 (`send.ts:513`) | inline banner (`mobile/effects/send.ts:544-551,629-638`) | keep in each facade: it is input validation, not pipeline | no |
| R20 | Stale error banner on the next send | kept | cleared (`mobile/effects/send.ts:62-67,433,572,668`) | mobile | yes, Q4 |

Same-behaviour details a worker must keep: mobile sends `undefined` options for a plain text and its test pins that (`mobile/effects/send.ts:373-386`, `real-store.mentions.test.ts:160-167`); web sends `{}` (`send.ts:408-419`) and no web test pins it, so the core uses `undefined`.

## 3. One lifetime design

**Decision:** the core takes web's `makeLifetime` (`web/effects/runtime.ts:78-118`) and keeps its names, so `web/effects/runtime.test.ts` passes unchanged. Mobile keeps `makeLife`, `makeRunners`, `isClosed`, `onClose`, `lift`, `recover`, `orElse` as thin adapters, so `mobile/effects/runtime.test.ts` passes unchanged too.

The two designs are the same tree under different names:

| Lifetime | Web | Mobile | Core |
| --- | --- | --- | --- |
| `start()` to `stop()` | store Scope (`runtime.ts:83-86`) | `session` Scope (`mobile/effects/runtime.ts:95`) | store |
| One boot attempt | session Scope, child of the store (`runtime.ts:102-108`) | `generation` Scope, not a child (`mobile/effects/runtime.ts:96-101`) | session |
| One XMPP connection attempt | `Scope.fork(session.scope)` (`lifecycle.ts:321-334`) | none: the core lives until `stop()` (`mobile/effects/lifecycle.ts:134-136,260-269`) | attempt Scope in `core/lifecycle.ts` |
| Keyed timers (typing, debounce, drafts, send deadlines) | `forkKeyed` / `cancel` (`incoming.ts:187-195`, `history.ts:344`, `polling.ts:131,138`, `send.ts:72`) | hand-kept `Map<key, Fiber>` and loose fibers (`events.ts:58-67,117-144`, `polling.ts:69-70,101-106,139-171`) | `forkKeyed` |

**Why web's, grounded in the tests that pin it:**

1. Both pin the same rule, so nothing is lost: a fork starts at once and its synchronous part runs inline (`web/effects/runtime.test.ts:19-25`; `mobile/effects/runtime.test.ts:20-21`, by `startImmediately: true` at `mobile/effects/runtime.ts:293-295`).
2. Mobile's two Scope tests map one to one: "restarting the generation closes the old scope" (`mobile runtime.test.ts:13-27`) is "a new session closes the previous one and keeps the store fibers" (`web runtime.test.ts:58-72`); "ending the session runs its finalizers once" (`mobile :29-43`) is "closing the store interrupts every fiber and leaves no timer behind" (`web :27-40`).
3. The keyed runner is tested (`web runtime.test.ts:42-56`) and replaces mobile's five hand-kept maps and timer variables listed above, which have only indirect tests (`mobile/effects/events.test.ts:23-95`).
4. A failed fork is logged and does not stop the others (`web runtime.test.ts:74-85`, guard at `runtime.ts:45-48`). A failing mobile fork is never observed unless someone joins it (`mobile/effects/runtime.ts:288-296`).
5. Nesting the session inside the store (`runtime.ts:55,106`) closes everything with one `closeStore()`; mobile closes two unrelated Scopes in order (`mobile/effects/runtime.ts:106-111`).

**What the core adds from mobile** (each with a new core test):

- `fork` returns the fiber. Mobile awaits the in-flight boot with `Fiber.await` (`mobile/effects/lifecycle.ts:162-179,190-193`). `FiberSet` runners already return it; web throws it away at `runtime.ts:65-67`.
- `Fibers.onClose(finalizer)` for listeners tied to a Scope (mobile `onClose`, `mobile/effects/runtime.ts:69-71`; web `onStoreClose`, `runtime.ts:97-99`).
- `Fibers.isOpen()`, for "did a newer boot supersede me?". Mobile checks `isClosed(generation)` (`mobile/effects/history.ts:221-223`), web compares session identity (`history.ts:375,385`, `prefs.ts:26-28`); both keep working.
- A rollback handler never runs on interruption. Mobile pins it (`mobile runtime.test.ts:64-71`). Web uses `Effect.catchCause` (for example `messageActions.ts:50,119`); a probe on `effect` 4.0.2 (run by T-0896 with `node`, not a repo test) showed that neither `catchCause` nor `catch` runs its handler when the fiber is interrupted from outside. T2 turns that probe into a core test.

The mobile adapter after T4: `life.session()` is the store Scope, `life.generation()` is the current session Scope, `restartGeneration()` is `beginSession()`, `endSession()` is `closeStore()` followed by reopening the store, which `makeLifetime` already does on first use (`runtime.ts:83-86`).

## 4. The ports

One `StorePorts` value, read through one `Context.Service` as both apps do today (`web/effects/ports.ts:198`, `mobile/effects/ports.ts:80`). The sketch below is a design, not code to copy; a worker checks every Effect API in `node_modules/effect/dist/*.d.ts`.

```ts
// packages/client-core/src/store/ports.ts (sketch)
import type { Effect } from 'effect';
import type { ChatPrefRow, ChatSummary } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';

/** What the core reads of the signed-in user and of an XMPP token. */
export interface CoreMe { id: string; name: string; jid?: string | null }
export interface CoreXmppToken { jid: string; token: string; service: string; domain: string }

/** The API calls the core makes. `E` is the app's `/api/chats` entry. */
export interface CoreApi<E> {
  getMe(): Promise<CoreMe>;
  getChats(): Promise<E[]>;
  getContacts(): Promise<{ jid: string; name: string }[]>;
  getXmppToken(): Promise<CoreXmppToken>;
  /** Optional: an app without it reads no prefs (mobile `chatPrefs` is optional today). */
  listChatPrefs?(): Promise<ChatPrefRow[]>;
}

/** The app's `/api/chats` mapping, until phase 2 shares one schema. */
export interface ChatRows<E> {
  summariesFor(entry: E): ChatSummary[];
  /** The group id of every row of a group entry (both `rememberGroupIds`). */
  groupIdsOf(entry: E): ReadonlyArray<readonly [chatId: string, groupId: string]>;
}

export interface Visibility {
  isVisible(): boolean;
  /** Window focus on web, AppState `active` on mobile. Returns the unsubscribe. */
  onFocus(handler: () => void): () => void;
}

/** The same shape in both apps today. */
export type DraftHubEvent =
  | { type: 'draft'; chatJid: string; turnId: string; text: string }
  | { type: 'end'; chatJid: string; turnId: string; outcome: 'sent' | 'failed' };
export type OpenDraftStream = (onEvent: (event: DraftHubEvent) => void) => () => void;

/** Synchronous key-value storage, or none (mobile today). */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Bytes on their way out (T10). `F` is `File` on web, `PickedFile` on mobile. */
export interface OutgoingBytes<F> {
  describe(file: F): Omit<Attachment, 'url'> & { localUrl?: string };
  /** Web reads the image size; mobile returns undefined. */
  measure(file: F): Effect.Effect<{ width: number; height: number } | undefined, unknown>;
  /** Slot + PUT; reports progress; resolves the served URL. */
  upload(core: XmppCore, file: F, onProgress: (fraction: number) => void, key: string): Effect.Effect<string, unknown>;
  /** Mobile aborts the PUT of `key`; web has no cancel. */
  cancel?(key: string): void;
}

/** Voice (T10). `V` is `Blob` on web, `RecordedVoice` on mobile. */
export interface VoiceOut<V> {
  convert(recording: V): Effect.Effect<{ durationMs: number; audio: unknown }, unknown>;
  upload(core: XmppCore, audio: unknown, onProgress: (fraction: number) => void, key: string): Effect.Effect<string, unknown>;
}

export interface Notifications {
  syncBadge(chats: readonly ChatSummary[]): void; // web: `badge.ts:11-19`; mobile: no-op
  dismissChat(chatId: string): void;              // web: `badge.ts:22-24`; mobile: no-op
}

export interface StorePorts<E, F, V> {
  readonly api: CoreApi<E>;
  readonly rows: ChatRows<E>;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  readonly now: () => Date;
  readonly visibility: Visibility;
  readonly drafts: OpenDraftStream;
  readonly storage: KeyValue | null;
  readonly notifications: Notifications;
  readonly bytes: OutgoingBytes<F>;
  readonly voice: VoiceOut<V>;
  /** Behaviour switches that differ today (R7, R8). */
  readonly flags: { connectRetry: boolean; reconnectOnResume: boolean };
}

/**
 * The per-app state names (section 2.2), until phase 2 renames them. Navigation
 * lives here too, because "topic gone" moves the view differently per app (R16).
 */
export interface AppWriters {
  activeChatId(): string | undefined;
  setActiveChat(chatId: string | undefined): void;
  setChatsLoad(load: 'loading' | 'ready' | 'error'): void;
  setHistoryLoad(chatId: string, load: 'loading' | 'ready' | 'error'): void;
  clearHistoryMarker(chatId: string): void;
  onOpenChat(chatId: string): void; // which topic notice survives
  onTopicGone(was: ChatSummary, general: ChatSummary | undefined, quiet: boolean): void;
  onJumpTarget?(chatId: string, messageId: string): void; // mobile only
}

/** Loaders that stay per app until phase 2 (pins, groups, prefs, folders). */
export interface CoreFx {
  loadPins(chatId: string, loud: boolean): Effect.Effect<void>;
  ensureGroupMembers(chatId: string): Effect.Effect<void>;
  loadPrefRows: Effect.Effect<ChatPrefRow[]>;
  loadFolders: Effect.Effect<void>;
}

// One `Context.Service` class carries `StorePorts`, as `web/effects/ports.ts:198` does today.
```

**Mapped to today's code:**

| Port | Web today | Mobile today |
| --- | --- | --- |
| `api` | `realApi` over `@/lib/api`, cookie (`web/effects/ports.ts:200-246`) | `createChatApi(getSessionToken)` and siblings, bearer (`mobile/effects/ports.ts:110-116`) |
| `rows` | `summariesFor` (`chatRows.ts:161`); group ids `realStore.ts:1069-1077` | `summariesFor` (`real-store.ts:196`); group ids also map `entry.chatJid` (`real-store.ts:1273-1282`) |
| `createXmpp` | `createXmppCore` (`ports.ts:273`) | same (`mobile/effects/ports.ts:120`) |
| `now` | `ports.ts:271` | `mobile/effects/ports.ts:124` |
| `visibility` | `document.visibilityState` (`ports.ts:255-257`) + window `focus` (`polling.ts:41-45`) | `appState.current() === 'active'` (`real-store.ts:359-361`) + `appState.subscribe` (`polling.ts:93-97`, `lifecycle.ts:242-247`) |
| `drafts` | `subscribeToDrafts`, `EventSource` (`ports.ts:276`) | `subscribeToDrafts` over XHR with bearer (`mobile/effects/ports.ts:126-133`) |
| `storage` | `localStorage` or null (`ports.ts:249-253`) | null: no persistence today (audit F1 i) |
| `notifications` | `@/lib/push` via `badge.ts` | no-op |
| `bytes` | `AttachmentPort` (`apps/web/src/lib/attachments.ts:214-218`) | `uploader` + `statSize` + `core.requestUploadSlot` inside the store (`mobile/effects/send.ts:103-149`, `apps/mobile/src/lib/attachment-ports.ts:55-66`) |
| `voice` | `VoicePort` (`apps/web/src/lib/voice.ts:306-309`) | `VoicePort` with progress and key (`apps/mobile/src/lib/voice.ts:293-301`) |
| `flags` | `{ connectRetry: true, reconnectOnResume: false }` | `{ connectRetry: false, reconnectOnResume: true }` until Q3 |
| `AppWriters` | `historyState`, `chatsState`, `activeChatId: undefined`, notice by chat, `replaceState` (`history.ts:24-47,426-466`) | `historyLoad` with `'loaded'`, `chatsLoad`, `activeChatId: null`, notice by group, `jumpTarget` (`real-store.ts:1438-1457`, `mobile/effects/history.ts:110-123,435`) |
| `goToLogin`, sign-out | stay in the web adapter (`lifecycle.ts:122-179`) | stay in `apps/mobile/src/auth/session.ts` |

There is no clock port beyond `now`: both stores use `Effect.sleep` for timers and the tests drive them with `vi.useFakeTimers` (`web runtime.test.ts:12-17`).

## 5. Target layout

`packages/client-core/src/store/`, imported as `@zilar/client-core/store` (one explicit subpath next to `.` in `packages/client-core/package.json:6-8`). Metro sends every bare import made inside `client-core` back to the mobile app (`apps/mobile/metro.config.js:49-74`), and mobile already depends on chat-core, xmpp-core, protocol and api-contract (`apps/mobile/package.json:21-26`), so the new package dependencies resolve on device too. `src/store/index.ts` is a barrel with one marked section per task, as `packages/api-contract/src/index.ts` does for its chains, so parallel tasks never edit the same line.

| Module | Content | Source | Est. lines | Task |
| --- | --- | --- | ---: | --- |
| `rows.ts` | the 8 pure helpers, `FINISHED_TURNS_MAX` | `web/effects/chatRows.ts:6-12,194-263`, `web/effects/polling.ts:120-127` | 110 | T1 |
| `lifetime.ts` | `makeLifetime`, `Fibers`, `Lifetime` | `web/effects/runtime.ts` | 150 | T2 |
| `ledger.ts` | ids, aliases, origin ids, authors, base texts, edits, reactions, mentions, `withEdits`, previews, reply quotes, sender and reactor names, `toUiMessage`, the message mutators | `web/realStore.ts:182-1203` | 900 | T3 |
| `ctx.ts` | `CoreCtx`, `CoreState`, `AppWriters`, `CoreFx`, the mutable memory (cursors, loading sets, pending outgoing, group ids) | `web/effects/ctx.ts`, `mobile/effects/runtime.ts:116-153` | 140 | T6 |
| `ports.ts` | section 4, plus `testPorts` | both `ports.ts` | 160 | T6, extended by T8 and T10 |
| `reads.ts` | last read, persisted when `storage` is set | `web/effects/reads.ts:22-50` | 50 | T6 |
| `incoming.ts` | message, echo, typing, displayed, occupants, presence | `web/effects/incoming.ts` | 230 | T6 |
| `actions.ts` | react, edit, delete, typing send | `web/effects/messageActions.ts` | 170 | T6 |
| `history.ts` | first page, older pages, previews, pending open, `openAtMessage`, list refresh and merge | `web/effects/history.ts` | 470 | T6 |
| `polling.ts` | list and pins polls, draft stream and timers | `web/effects/polling.ts` | 190 | T8 |
| `lifecycle.ts` | start, stop, boot, connect with retry, resume, `reset()` | `web/effects/lifecycle.ts:76-120,181-355`, `mobile/effects/lifecycle.ts:154-223` | 330 | T8 |
| `send.ts`, `send-failure.ts` | optimistic insert, echo signatures, deadline, retry, forward, bytes and voice through ports | `web/effects/send.ts`, `web/effects/sendFailure.ts` | 780 | T10 |

About 3.7k lines in core after the 10 tasks. Each app keeps an adapter:

- **Web (about 1.3k):** `realStore.ts` as the facade and state init (`realStore.ts:1316-1548` today), `effects/ports.ts` (live adapters), `store.ts` (types and selectors), `chatListCache.ts`, `effects/badge.ts`, and until phase 2 `effects/groups.ts`, `groupMembers.ts`, `pins.ts`, `prefs.ts`.
- **Mobile (about 1.6k):** `real-store.ts` as the facade, `effects/ports.ts` (bearer API, AppState, XHR drafts, uploader, voice), `types.ts`, the `Life` adapter in `effects/runtime.ts`, and until phase 2 `effects/groups.ts`, `pins.ts` and the prefs and folders actions of `effects/events.ts`.

These counts are estimates from the source lines above, not measurements.

## 6. Migration order and task split

Rules for every task:

- The facades stay: `createRealChatStore(deps)` and every export of `web/realStore.ts:114-146` and `mobile/real-store.ts:72-78,97,110,196,223`, the `StoreApi` return type, and both `RealStoreDeps`. Existing store tests are not edited; a task that needs a new test adds a new test file.
- A core module is extracted from web first (the more complete side), behind the web facade; mobile adopts it in its own task.
- Mobile tasks run `pnpm phone:smoke` and their timer tests 3 times. Tasks marked "live" get Julio's check on web and the emulator, as T-0836 did.
- Allowed files are full repo paths. Every task that adds a core module also adds one line in its own section of `packages/client-core/src/store/index.ts`.

### T1, pilot: store package wiring and pure row helpers

- **Core:** `packages/client-core/package.json` (dependencies `@zilar/chat-core`, `@zilar/protocol`, `@zilar/xmpp-core`, `@zilar/api-contract` as `workspace:*`; export `"./store": "./src/store/index.ts"`), new `packages/client-core/src/store/index.ts`, `packages/client-core/src/store/rows.ts`, `packages/client-core/src/store/rows.test.ts`; `pnpm-lock.yaml`.
- **Web:** `apps/web/src/store/effects/chatRows.ts` re-exports the 7 helpers from `:6-12,194-263` instead of defining them; `apps/web/src/store/effects/polling.ts` re-exports `withoutDraft` (`:120-127`); `apps/web/src/store/effects/constants.ts` re-exports `FINISHED_TURNS_MAX` (`:30`).
- **Mobile:** `apps/mobile/src/store/real-store.ts` imports the helpers and deletes `:80-95` (`rememberFinishedDraftMessage`), `:99-101`, `:137-163`, `:924-940` and `:999-1008` (the last two sit inside the closure; `h.clearFailure` keeps its name); `apps/mobile/src/store/effects/polling.ts` re-exports `withoutDraft` and `FINISHED_TURNS_MAX` (`:23-35`).
- **Guards:** `apps/web/src/store/effects/chatRows.test.ts` (unchanged; imports from `./chatRows`), `apps/web/src/store/realStore.test.tsx`, `apps/mobile/src/store/real-store.test.ts`, `apps/mobile/src/store/selector-stability.test.ts`, `pnpm phone:smoke` (proves Metro resolves the subpath).
- **Risk:** low. The one new thing is the subpath export on Metro; the vitest `dedupe` list already covers `effect` (`apps/mobile/vitest.config.mts:11`).
- **Size:** core +130, web -80, mobile -75.

### T2: the lifetime in core (core + web)

- **Core:** new `packages/client-core/src/store/lifetime.ts`, `packages/client-core/src/store/lifetime.test.ts`; index line. `makeLifetime` takes a `Context.Context<R>` instead of the web `PortsShape`; `fork` and `forkKeyed` return the fiber; add `Fibers.onClose` and `Fibers.isOpen` (section 3). The core test carries the mobile cases: finalizers run once, a closed session reads closed, no handler runs on interruption.
- **Web:** `apps/web/src/store/effects/runtime.ts` becomes `makeLifetime(ports) = core.makeLifetime(Context.make(Ports, ports))` plus the type re-exports.
- **Guards:** `apps/web/src/store/effects/runtime.test.ts` (unchanged), `apps/web/src/store/realStore.test.tsx` 3 times.
- **Risk:** low. **Parallel:** with T3.

### T3: the message ledger in core (core + web)

- **Core:** new `packages/client-core/src/store/ledger.ts`, `packages/client-core/src/store/ledger.test.ts`; index line. `createMessageLedger({ get, set, contacts, memberName, occupantNick, mediaToken })` over a `LedgerState` that both state types satisfy (`messagesByChat`, `chats`, `edits`, `reactions`, `contacts`, `me`). The message type is `StoreMessage = UiMessage & { localUri?: string; uploadProgress?: number }`, the shape of mobile's `MobileMessage` (`apps/mobile/src/lib/types.ts:35-38`), so a retraction strips the upload fields as mobile does (`real-store.ts:679-690`); web never sets them, so its messages pass through unchanged.
- **Web:** `apps/web/src/store/realStore.ts` replaces `:182-1203` with the ledger; `apps/web/src/store/effects/ctx.ts` (`Kernel` becomes the ledger type plus the few helpers left).
- **Behaviour:** R5 (mobile's `linkLocalToServer`) lands here, with a new core test. Nothing else changes on web.
- **Guards:** `apps/web/src/store/realStore.test.tsx` (mentions `:803-865`, reactions `:1475-1745`, edits and deletes `:1746-2183`, stickers `:3389`, send failure `:3457-3904`), `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`.
- **Risk:** medium: the largest move, and the ledger reads after its own writes (`refreshEdits`, `migrateReactionTargets`). **Parallel:** with T2.

### T4: mobile on the core lifetime (mobile)

- **Mobile:** `apps/mobile/src/store/effects/runtime.ts` (`makeLife` and `makeRunners` become adapters over the core lifetime, same exports and signatures), `apps/mobile/src/store/effects/events.ts` (typing and refresh timers become `forkKeyed`, `:57-144`), `apps/mobile/src/store/effects/polling.ts` (draft timeouts and the two poll Scopes, `:69-171`). `real-store.ts` is not touched: it keeps calling `makeLife()` (`:295`) and `makeRunners(ports, life)` (`:1746`).
- **Guards:** `apps/mobile/src/store/effects/runtime.test.ts` (unchanged), `effects/events.test.ts`, `effects/history.test.ts:66`, `effects/send.test.ts:75`, `real-store.test.ts:620-833` (resume and boot), `:868-1122` (drafts), `integration.test.ts`; 3 runs; `pnpm phone:smoke`.
- **Risk:** medium-high (resume, drafts). **Parallel:** with T5 and T6. **After:** T2.

### T5: mobile on the core ledger, tests first (mobile)

- **Mobile:** `apps/mobile/src/store/real-store.ts` replaces the ledger (`:390-922`), the shared mutators (`updateMessageStatus` `:944`, `markStickerFailed` `:975`, `markAttachmentFailed` `:988`, `updateMessageAttachment` `:1023`, `updateMessageVoice` `:1107`), the sender names (`:1190-1271`) and `toUiMessage` (`:1348-1411`). It keeps the mobile-only upload mutators (`:1010-1019`, `:1047-1103`) and `forwardOriginFor` (`:1152-1188`) until T10, and the group-id and member helpers (`:1273-1346`). New `apps/mobile/src/store/real-store.ledger.test.ts`.
- **Same result, different code:** mobile's `updateMessageVoice` merges and clears the failure flag (`:1107-1150`), web's replaces (`apps/web/src/store/realStore.ts:695-713`); the result is the same because a mobile retry clears the flag first (`apps/mobile/src/store/effects/send.ts:685`).
- **Tests first:** commit, on the old code, tests for what must not change: alias linking through the echo, a pending edit resolved when the target loads, a retraction stripping `localUri`. Then a second commit with the new expectations for R1-R4.
- **Behaviour:** R1 and R2 change what a user sees (Q1); R3 and R4 do not. If Julio declines Q1, the ledger takes a `mapIncomingMentions` flag that mobile sets to false.
- **Guards:** `apps/mobile/src/store/real-store.test.ts:1459-2255`, `real-store.mentions.test.ts`, `real-store.forward.test.ts`, `real-store.voice.test.ts`, `real-store.attachments.test.ts`.
- **Risk:** medium. **Parallel:** with T4 and T6. **After:** T3.

### T6: incoming, message actions and history in core (core + web), tests first

- **Core:** new `ctx.ts`, `ports.ts`, `reads.ts`, `incoming.ts`, `actions.ts`, `history.ts` and their tests in `packages/client-core/src/store/`; index lines.
- **Web:** `apps/web/src/store/effects/incoming.ts`, `messageActions.ts`, `history.ts`, `reads.ts` become bindings or are deleted; `apps/web/src/store/effects/ctx.ts`; `apps/web/src/store/effects/ports.ts` (builds the core ports from `RealStoreDeps`); `apps/web/src/store/realStore.ts` (the ctx wiring, `:1207-1314`).
- **Tests first** (new `apps/web/src/store/realStore.incoming.test.tsx`, on the old code): the typing line clears after 5 s and on `paused` (web has no such test; mobile has `effects/events.test.ts:23-60`); an echo that arrives before `sendMessage` resolves; two identical texts sent quickly link in order; the echo of a reply.
- **Guards:** `apps/web/src/store/realStore.test.tsx:491-1131,1405-1474,2184-2415`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/effects/history.test.ts`, `apps/web/src/store/realStore.topics.test.tsx` (topic gone).
- **Risk:** medium-high (send echo, paging). It can be split into incoming plus actions, then history, if the diff passes 800 lines; both halves touch `realStore.ts`, so they chain. **Parallel:** with T4 and T5. **After:** T2, T3.

### T7: mobile on core incoming, actions and history (mobile)

- **Mobile:** `apps/mobile/src/store/real-store.ts` (`handleMessage` and the other handlers `:1459-1651`, `recordRead` `:363-372`, `setHistoryLoad` and `clearSupersededMarker` `:1438-1457`, the `h` and `fx` wiring), `apps/mobile/src/store/effects/events.ts` (typing and the react, edit and delete actions; prefs and folders stay), `apps/mobile/src/store/effects/history.ts` (keeps `loadPrefRows`, `loadFolders`, `reloadChats` and `jumpTarget` as adapter code), `apps/mobile/src/store/effects/runtime.ts` (`StoreHelpers` shrinks).
- **Guards:** `apps/mobile/src/store/real-store.test.ts:293-833,1123-1458,1823-2255`, `effects/events.test.ts`, `effects/history.test.ts`, `real-store.topics.test.ts`, `real-store.general-only.test.ts`, `integration.test.ts`; `pnpm phone:smoke`.
- **Risk:** medium-high. **Parallel:** with T8. **After:** T4, T5, T6.

### T8: polling, drafts and lifecycle in core (core + web), live

- **Core:** new `polling.ts`, `lifecycle.ts` and tests; `ports.ts` gains `visibility`, `drafts`, `notifications`, `flags`. The XMPP attempt Scope stays (web `lifecycle.ts:321-334`); mobile's "await the in-flight boot on resume" joins it behind `flags.reconnectOnResume`; `start()` becomes idempotent (R9); `stop()` keeps the ledger and `reset()` clears it (R10).
- **Web:** `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/lifecycle.ts` (keeps `signOutStore`, the cached paint and `pagehide` as adapter code), `apps/web/src/store/effects/ports.ts` (focus adapter), `apps/web/src/store/realStore.ts` (start and stop).
- **Tests first:** a web test for a rejected `connect()` that retries (no test covers `lifecycle.ts:336-341` today), and `start()` twice without `stop()`.
- **Guards:** `apps/web/src/store/realStore.test.tsx:1161-1209` (pins poll), `:1290-1312`, `:2184-2415`, `:2416-2723` (drafts), `apps/web/src/store/effects/runtime.test.ts`, `apps/web/src/store/reload.test.tsx:318`.
- **Risk:** high (connect, reconnect). **Parallel:** with T7. **After:** T6.

### T9: mobile on core polling and lifecycle (mobile), live

- **Mobile:** `apps/mobile/src/store/effects/polling.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/ports.ts` (`AppStateLike` becomes `visibility`), `apps/mobile/src/store/effects/runtime.ts` (the `Life` adapter goes once nothing uses it), `apps/mobile/src/store/real-store.ts` (`teardown`, start and stop).
- **Behaviour:** R7 only if Julio says yes to Q3 (`flags.connectRetry`).
- **Guards:** `apps/mobile/src/store/real-store.test.ts:620-833,868-1122`, `integration.test.ts`, `effects/events.test.ts:81`, `effects/history.test.ts:66`, `effects/send.test.ts:75`; 3 runs; `pnpm phone:smoke`; Julio on the emulator: background, foreground, airplane mode.
- **Risk:** high. **After:** T7, T8.

### T10: the send pipeline in core (core + web + mobile), tests first, live

- **Core:** new `send.ts`, `send-failure.ts` (moved from `apps/web/src/store/effects/sendFailure.ts`) and tests; `ports.ts` gains `bytes` and `voice`.
- **Web:** `apps/web/src/store/effects/send.ts`, `apps/web/src/store/effects/sendFailure.ts` (re-export), `apps/web/src/store/effects/ports.ts` (attachment and voice adapters), `apps/web/src/store/realStore.ts` (facade lines `:1481-1507`).
- **Mobile:** `apps/mobile/src/store/effects/send.ts` (keeps the inline validation, R19), `apps/mobile/src/store/effects/ports.ts` (uploader, `statSize`, voice into `bytes` and `voice`), `apps/mobile/src/store/real-store.ts` (`forwardOriginFor` `:1152-1188` and the upload-progress mutators).
- **Tests first:** R18 (two failed sticker sends, then a later identical sticker links to the right bubble); a mobile hung upload under the 60 s deadline (new expectation, only with Q2).
- **Behaviour:** R6 (Q2), R18, R20 (Q4). Text sends keep D-1.
- **Guards:** web `realStore.test.tsx:536-626,2724-3218,3253-3456,3457-3904`, `realStore.forward.test.tsx`, `realStore.media.test.tsx`; mobile `real-store.voice.test.ts`, `real-store.attachments.test.ts`, `real-store.forward.test.ts`, `real-store.test.ts:2256-2517`, `effects/send.test.ts`, `real-store.mentions.test.ts:143-167`.
- **Risk:** high. Split into a web half and a mobile half if the diff passes 800 lines. **After:** T8 (web `ports.ts`) and T9 (mobile `ports.ts`).

### Order and parallel groups

| Wave | Tasks | Why they do not collide |
| --- | --- | --- |
| 1 | T1 | alone: `package.json` and the lockfile |
| 2 | T2, T3 | `web/effects/runtime.ts` vs `web/realStore.ts` + `web/effects/ctx.ts`; new core files; own index sections |
| 3 | T4, T5, T6 | mobile `effects/runtime.ts`, `events.ts`, `polling.ts` vs mobile `real-store.ts` + one new test file vs web files and new core files |
| 4 | T7, T8 | mobile files vs web files and new core files |
| 5 | T9 | mobile lifecycle; Julio's live check |
| 6 | T10 | both apps; Julio's live check |

## 7. Risks on the hot paths

Test line counts: web 6,082 (`realStore.test.tsx` 3,904, `realStore.topics.test.tsx` 614, `realStore.forward.test.tsx` 370, `reload.test.tsx` 351, the rest under 130); mobile 8,785 (`real-store.test.ts` 2,517, `real-store.prefs-pins.test.ts` 630, `real-store.attachments.test.ts` 572, `chat-store.test.ts` 508, `real-store.voice.test.ts` 485, the rest under 400).

| Hot path | Covered by | Missing, so a task adds it first |
| --- | --- | --- |
| Send echo matching | web `realStore.test.tsx:536` (echo after the ack), `:676` (read before echo), `:3389` (two stickers, one emoji), `:3826` (echo of a failed send); mobile `real-store.test.ts:369,435,2326,2453`, `real-store.attachments.test.ts:251`, `real-store.voice.test.ts:371`, `real-store.forward.test.ts:343` | echo before `sendMessage` resolves; two identical texts in a row; the echo of a reply (the signature includes `replyTo.id`, `realStore.ts:209-211`). T6 adds them. R18 sticker retry: T10 |
| History paging | web `realStore.test.tsx:1070` (older pages), `:1096-1131` and `:1273` (`openAtMessage`), `:2266-2415` (pending open, dedupe, superseded marker), `effects/history.test.ts:17-75`, `reload.test.tsx:249-350`; mobile `real-store.test.ts:594`, `:1243-1437`, `:1622` (older-page edits), `effects/history.test.ts:46,66` | two `loadOlder` calls at once (the `loadingOlder` guard, `history.ts:76`); `loadOlder` while the first page is still loading. T6 adds both |
| Reconnect and resume | web `realStore.test.tsx:1290` (status), `:1301` (fresh token), `:2247` (list retry), `:2282` (token failure retry), `:2311` (wait for online), `reload.test.tsx:318`; mobile `real-store.test.ts:620-833` (resume, boot dedupe, stop and start during boot), `:1420`, `integration.test.ts:164` | a rejected `connect()` on either side (no test calls `connect` with a rejection); `start()` twice. T8 adds them; T9 adds the mobile ones |
| Typing | web `realStore.test.tsx:707,750` (own reflections), `:783` (member name); mobile `real-store.test.ts:467,510,539`, `effects/events.test.ts:23,42,81` (clear after 5 s, restart, stop) | web has no test for the 5 s clear or a `paused` state. T6 adds them before moving `incoming.ts` |

Other risks:

- **Read after set.** Both stores read state right after a `set` inside one action (`openAtMessage` `history.ts:292-334`; `react` `messageActions.ts:39-46`). The core keeps the synchronous `StoreApi` (`packages/client-core/src/atom-store.ts:51-66`); do not move state into many atoms (`docs/audit/simplify-plan.md:159`).
- **Stable empty selectors.** Mobile returns shared empty arrays (`real-store.ts:221,1798`, `mobile/effects/pins.ts:13`), guarded by `selector-stability.test.ts`. Core accessors keep that rule.
- **Ordering inside an event.** XMPP listeners are synchronous and the stores rely on it (`web/effects/lifecycle.ts:261-263`, `docs/audit/simplify-plan.md:158`). The core keeps `on()` callbacks.
- **Stale state after sign-out on mobile (unverified).** Mobile `stop()` keeps `messagesByChat` (`real-store.ts:1757-1773`) and the provider keeps one store instance across sign-ins (`chat-store-provider.tsx:64-85`). Not checked on a device; T9 should look at it.

## 8. Questions for Julio

Each one changes what a user sees. The recommendation is the side that wins in 2.3.

**Lead decision, 2026-10-10:** Julio was asleep and had asked the lead to decide alone, so the lead took the recommended answer on all four: yes to Q1, Q2, Q3 and Q4. Each makes the two apps behave the same way and can be reverted with a flag or a text change.
- **The flags:** `mapIncomingMentions` and `flags.connectRetry` stay in the core, so a "no" from Julio is a one-line change.
- **Where they land:** T5 (Q1), T9 (Q3) and T10 (Q2, Q4).
- **Live check:** they are on Julio's live-check list in `work/NOW.md`.

- **Q1 (R1, R2):** Should received @mentions be highlighted on mobile, as on web? Today mobile drops them from received messages. Recommended: yes.
- **Q2 (R6):** Should a mobile voice message, attachment or forwarded copy that fails or hangs show "Not sent" with the reason after at most 60 s, as on web? Text messages stay as they are (D-1). Recommended: yes.
- **Q3 (R7):** Should mobile retry the chat connection by itself after 2, 5, 15, 30 and 60 s, as web does, instead of waiting until the app comes back to the foreground? Recommended: yes.
- **Q4 (R13, R20):** One set of pin error texts (web's: "Could not pin the message. Try again."), and a stale error banner clears on the next send on web too (mobile's rule)? Recommended: yes to both.

## 9. Phase 2 (specs after this split)

- Pins, prefs and folders in core (R11, R12, R13).
- Groups, topics, channels, roles and invite links in core, keyed by group id (R14, R15, R17); needs one `GroupDetail` type (`apps/mobile/src/lib/chat-api.ts:70-82` vs the contract type re-exported at `apps/web/src/lib/api.ts:168`).
- One `ChatEntry` schema in `packages/api-contract/src/chats.ts` and one `summariesFor` (F1g), then `ports.rows` goes away. Keep mobile's lenient row parsing (audit F5).
- State-name unification (2.2), then `AppWriters` shrinks to navigation.
- The mock stores on the core (plan 4.4).
