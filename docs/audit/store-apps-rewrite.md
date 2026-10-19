# Store apps rewrite map: web and phone store layers

Counted on 2026-10-19 at `86ba47817` (branch `task/T-2234-audit-store-apps`), with
`wc -l`. Scope is the two app store directories, 5,591 lines:

- web `apps/web/src/store/` — 2,720 lines (22 production files);
- phone `apps/mobile/src/store/` — 2,871 lines (15 production files).

Tests are not in the counts. They total 916 lines on web and 2,034 on the phone; a
rewrite rewrites or deletes them with the code they cover.

Four of the seven phase-3 extractions in `docs/audit/store-phase3-plan.md` had
already landed before this map was written: `createSessionCheck` (T1),
`createCoreLocals`/`createCoreLedger`/`bridgeLocals` (T2), `createMessageCacheWriter`
(T6) and `ChatStoreActions`/`ChatStoreCommonState` (T7). What remains duplicated is
the wiring around them. This document measures that remainder.

Terms:

- **platform** — the difference is the runtime (browser vs React Native) and stays
  in the app behind a port.
- **same rule** — both apps encode the same rule and it belongs once in
  `packages/client-core/src/store/`.

Every `file:line` is repo-relative.

## 1. Behaviour list

The behaviours each app store adds on top of `client-core`. Numbers are used in
part 2.

| # | Behaviour | Web | Phone | Verdict |
|---|-----------|-----|-------|---------|
| 1 | HTTP client for the chat API | `effects/portTypes.ts:37-114` (50 methods), `effects/ports.ts:254-305` (50-name adapter) | `effects/ports.ts:270-305` (domain factories), `real-store.ts:239-261` (`CoreApi` projection) | platform: the app owns its client split |
| 2 | Decode/validate at the boundary | `@/lib/api` (already decoded) | `lib/*-api.ts` (already decoded) | platform |
| 3 | Session check (401 → gone, other → unknown, missing phone token → gone) | `effects/ports.ts:84` | `effects/ports.ts:126-129` | same rule, already core (`createSessionCheck`) |
| 4 | Session gone: clear caches/device, sign out, go to `/login` | `effects/ports.ts:92-114` | `effects/ports.ts:131-145` | platform: side effects differ |
| 5 | Draft stream transport and its reopen policy | `effects/ports.ts:116-214` (`EventSource`, 1 s→30 s jitter) | `lib/drafts.ts` (XHR-SSE, paused while backgrounded) | platform transport; reconnect state machine is same rule |
| 6 | Visibility and focus (`visible && hasFocus` on web, `AppState === active` on phone) | `effects/ports.ts:313-342` | `effects/ports.ts:211-229` | platform |
| 7 | Background policy (web `pagehide` flush; phone 10 s grace then suspend, reconnect on focus) | `effects/lifecycle.ts:186-193` | `effects/lifecycle.ts:141-168` | platform policy, same shape |
| 8 | Outgoing attachment bytes (classify, size, upload, local preview) | `effects/ports.ts:377-393` | `effects/ports.ts:63-111` | platform |
| 9 | Outgoing voice bytes (convert, upload) | `effects/ports.ts:396-401` | `effects/ports.ts:113-123` | platform |
| 10 | Notifications and badge | `effects/ports.ts:350-359`, `effects/badge.ts:10-17` | `real-store.ts:271-278` | platform |
| 11 | XMPP connection policy (retry flags, stable resource, watchdog, resume reconnect) | `effects/ports.ts:348` | `effects/ports.ts:231-268` | platform |
| 12 | Store assembly: locals, ledger, text outbox, `CoreCtx`, app hooks | `effects/storeContext.ts:41-167`, `effects/locals.ts:8-42`, `effects/ctx.ts:18-68` | `real-store.ts:184-345`, `effects/helpers.ts:21-143`, `effects/runtime.ts:93-115`, `effects/locals.ts:10-45` | same rule (app maps/hook bodies stay) |
| 13 | Initial per-user state and teardown | `realStore.ts:34-91`, `effects/lifecycle.ts:48-105` | `real-store.ts:78-141` | same rule |
| 14 | start / stop / retry boot / resume | `effects/lifecycle.ts:39-44` | `effects/lifecycle.ts:276-295` | same rule, already core |
| 15 | Boot merge: fresh rows + prefs + same-user paint | `effects/lifecycle.ts:196-210` | `effects/lifecycle.ts:170-183` | same rule |
| 16 | Chat-list cache (storage, owner check, codec) | `chatListCache.ts:9-45` | `effects/lifecycle.ts:28-56`, `offline-cache.ts:23-60` | platform storage; same codec (`client-core`) |
| 17 | Message cache writer (debounce, order, clear fence, local-URL strip) | `messageCache.ts:65-94` | `offline-cache.ts:16-20`, `offline-cache-sync.ts:24-52` | same rule, writer already core |
| 18 | Cache paint before boot | `effects/lifecycle.ts:156-194` | `effects/lifecycle.ts:84-103,123-140` | platform storage, same paint order |
| 19 | Cache flush on hide/background | `effects/lifecycle.ts:130-154,186-193` | `effects/lifecycle.ts:152-161` | platform trigger; same save rule |
| 20 | Open chat, open at message, older page, retry history | `effects/history.ts:67-97`, `effects/chatActions.ts:226-237` | `effects/history.ts:182-241` | same rule |
| 21 | Chat-list refresh, merge, topic-gone navigation, join new rooms, previews | `effects/history.ts:102-198` | `effects/history.ts:94-180` | same rule (web URL rewrite is platform) |
| 22 | Unread mark on open (numeric read + pref) | `effects/history.ts:89-93` | `effects/history.ts:227-231` | same rule |
| 23 | Prefs: mute, archive, pin, unread mark, backgrounds | `effects/prefs.ts:18-191` | `effects/events.ts:84-130` | same rule (web background columns are app-only) |
| 24 | Folders (load + CRUD) | `effects/chatActions.ts:302-307` (load/commit only) | `effects/events.ts:131-169`, `effects/history.ts:80-91` | same rule; web CRUD lives outside the store |
| 25 | Pins and media panel (load, pin/unpin, trusted media, cached pins) | `effects/pins.ts:17-100` | `effects/pins.ts:49-169` | same rule (phone URL resolve is platform) |
| 26 | Chat action facade (thin calls, guards) | `effects/chatActions.ts:64-136,202-329` | `effects/events.ts:94-130`, `effects/send.ts:111-166`, `effects/pins.ts:107-159` | same rule, guards stay |
| 27 | Send facade: empty/oversize/voice guards, local URI, cancel | `effects/chatActions.ts:64-136` | `effects/send.ts:42-166` | platform guards and bytes |
| 28 | Group/topic actions and group caches | `effects/groupActions.ts` (out of scope) | `effects/groups.ts`, `group-actions.ts` (out of scope) | same core, different signatures: keep per app |
| 29 | Provider: build store, start on auth, stop on cleanup, re-enable push | `ChatStoreProvider.tsx:16-91` | `chat-store-provider.tsx:161-220` | platform |
| 30 | Store hooks/selectors | `ChatStoreProvider.tsx:93-105` | `chat-store-provider.tsx:222-241` | platform |
| 31 | Search reveal window | `effects/history.ts:20-63` | none | platform UI (web only) |
| 32 | Sidebar grouping and sorting | `store.ts:46-143` | none | platform UI (web only) |

Behaviours 1-11 and 27 are platform by construction. 3, 14, 17 are already one
implementation in core; the app lines are adapters. 12, 13, 15, 20-26 are the
same-rule block this map targets.

## 2. Twin logic

"Both lines" counts only the lines that implement the rule, excluding app-specific
branches (noted). Sum: **1,717 same-rule lines**, 31% of the 5,591.

| Twin | Web | Phone | Same-rule lines | App-only part |
|------|-----|-------|-----------------|---------------|
| Ledger + locals + context + hooks | `effects/storeContext.ts:41-167` (127), `effects/locals.ts:8-42` (35), `effects/ctx.ts:18-68` (51) | `real-store.ts:184-345` (162), `effects/locals.ts:10-45` (36), `effects/runtime.ts:93-115` (23) | 300 | web `File` vs phone `PickedFile`; group member map shapes |
| Initial state + teardown | `realStore.ts:34-91` (58), `effects/lifecycle.ts:48-105` (58) | `real-store.ts:78-141` (64), `real-store.ts:194-224` (31) | 150 | cache/device hooks |
| Boot merge | `effects/lifecycle.ts:196-210` (15) | `effects/lifecycle.ts:170-183` (14) | 26 | none |
| History open / openAt / older | `effects/history.ts:67-97` (31), `effects/chatActions.ts:226-237` (12) | `effects/history.ts:182-241` (60) | 66 | web reveal window |
| Chat-list refresh | `effects/history.ts:102-198` (97) | `effects/history.ts:94-180` (87), `:140-146` (7) | 150 | web URL replace `174-181`; phone group detail hooks |
| Unread mark on open | `effects/history.ts:89-93` (5) | `effects/history.ts:227-231` (5) | 10 | none |
| Prefs adapters | `effects/prefs.ts:18-191` (174) | `effects/events.ts:84-130` (47), `effects/history.ts:69-78` (10) | 200 | web background columns |
| Folders | `effects/chatActions.ts:302-307` (6) | `effects/events.ts:76-82,131-169` (46) | 40 | phone CRUD, web elsewhere |
| Pins/media | `effects/pins.ts:17-100` (84) | `effects/pins.ts:49-169` (121) | 180 | phone `resolveMediaUrl` 7 lines |
| Action + send facade | `effects/chatActions.ts:64-136` (73), `:202-329` (128) | `effects/events.ts:94-130` (37), `effects/send.ts:42-166` (125), `effects/pins.ts:107-159` (53) | 260 | file/voice guards, cancel, local URI |
| Cache orchestration | `effects/lifecycle.ts:121-154` (34), `:156-194` (39), `chatListCache.ts` (45) | `offline-cache-sync.ts:24-52` (29), `effects/lifecycle.ts:28-56` (29), `:76-103` (28), `:123-140` (18) | 150 | localStorage vs file-system |
| Store/action types | `store.ts:145-295` (151) | `types.ts:130-229` (100) | 180 | group API signatures |
| Session check | `effects/ports.ts:84` (1) | `effects/ports.ts:126-129` (4) | 5 | none (already core) |

Why these are twins, not platform differences:

- The ledger/context maps (`messageAuthors`, `messageOriginIds`, `pendingOutgoing`,
  `pendingAttachments`, `sendRuns`, `finishedTurns`) are the same names and the same
  lifecycle on both sides. Web `effects/storeContext.ts:133-150` and phone
  `real-store.ts:194-224` are the same 20-field copy with different type aliases.
- Teardown clears the same set in the same order: web
  `effects/lifecycle.ts:76-104` (state, maps, ledger), phone
  `real-store.ts:104-138` (timers, maps, state, ledger). The only real difference is
  which cache/device hooks run.
- `openChat` runs the same five steps on both sides: set active, clear quiet marks /
  topic notice, `openChatCore` with an unread-mark hook, load members/detail, refresh
  pins. Web `effects/history.ts:76-97`; phone `effects/history.ts:215-241`.
- `refreshChats` runs the same pipeline: generation/session check, fetch chats +
  prefs in parallel, map rows, `mergeFreshChats`, topic-gone branch, `flushPending`,
  `adoptNewRows` with join/preview hooks. Web `effects/history.ts:122-198`; phone
  `effects/history.ts:94-180`.
- Prefs are the same adapter over core `updatePref`/`optimisticPrefRow`, with the
  same saved-vs-painted split. Web `effects/prefs.ts:37-94`; phone
  `effects/events.ts:84-130`.
- Pins are the same `PinsStore` over core `loadPins`/`pinMessage`/`unpinMessage`.
  Web keeps pins in state; phone keeps them in two maps plus an epoch fence
  (`effects/pins.ts:54-95`). The epoch is a phone-only solution to a bug web avoids
  by aborting with the session; a shared store contract should expose one
  generation check for both.
- The API facades are thin by design, but both spell out every operation twice:
  web's 128-line `ChatActions` object and phone's `EventActions` + `Send` +
  `PinActions` pick-lists name the same 45 methods.

The one genuine platform split in the block is the number stored in
`currentUserId` (`''` on web, `CURRENT_USER_ID` on phone) and the value of
`activeChatId` (`undefined` vs `null`). A rewrite must pick one shape in core
(`string | undefined`) and let the phone adapter map it at the UI edge; today the
difference leaks into `types.ts:202` and `real-store.ts:89`.

## 3. Slop by rule

### One home per piece of logic

| Where | Lines | Cost |
|-------|-------|------|
| The 1,717 twin lines in part 2 | 1,717 | about 1,250 after app-only parts stay |
| Phone maps the same context twice: `effects/history.ts:23-48` builds `historyCtx`, `effects/lifecycle.ts:211-274` builds `lifecycleCtx`, both copying `cursors`, `loadingHistory`, `loadingOlder`, `lastRead`, `pendingOutgoing`, `core` from `s`/locals | 26 + 64 | 60 (one `CoreCtx` factory) |
| Web `bridgeLocals` bridges 7 fields (`effects/storeContext.ts:156-164`) but copies 20 more by value at `:133-150`; phone bridges 7 (`real-store.ts:225-233`) and copies 31 at `:194-224` | 20 + 31 | 45 (copy only the app map, bridge the rest) |
| `effects/chatRows.ts:4-14` re-exports 10 core names; `effects/constants.ts:1-5,10-15` re-exports 7 more | 15 + 11 | 26 (import core directly) |
| `effects/runtime.ts:1-16` wraps `makeLifetime` for one caller | 16 | 16 |
| `effects/chatRows.ts` on the phone wraps `summariesFor` (`:21-23`) and `isUpdateStanza` (`:10-16`), both unused through this path | 23 | 23 |

### Trust the types and the contract

| Where | Lines | Cost |
|-------|-------|------|
| Web `StoreCtx` repeats `started`, `boot`, `cachedUserId`, `connectRetryAttempt`, `connectRetryPending` (`effects/ctx.ts:35-44`) and then `effects/storeContext.ts:128-131` re-initialises them | 10 | 10 |
| Phone `StoreState` repeats 15 fields already in `CoreLocals` (`effects/runtime.ts:93-115`) and `real-store.ts:194-224` copies every one | 23 + 31 | 54 |
| Phone `CoreApi` guards every optional method and casts: `real-store.ts:244-259` (16 lines, four `as Promise<unknown>`) | 16 | 16 |
| Phone optional API guards repeated: `effects/events.ts:76-82`, `:112-115`, `:124-127`; `effects/ports.ts:282-283` | 15 | 12 (one helper, or make the ports required) |
| Web `defaultStorage` wraps a synchronous `window.localStorage` in `Effect.try` (`effects/ports.ts:307-311`) for no async work | 5 | 5 |
| Phone `startPinsPolling(chatId)` ignores its argument (`real-store.ts:353-355`, declared `runtime.ts:175`) | 1 | 1 |
| Phone `setChatMessage` re-implements the ledger's base-text rule (`effects/helpers.ts:122-127`) | 6 | 6 |

### No layers that do nothing

| Where | Lines | Cost |
|-------|-------|------|
| Web `effects/runtime.ts` (above) and the one-line lifecycle delegates `effects/lifecycle.ts:39-44` | 22 | 22 |
| Web lifecycle wrappers with one caller: `rememberGroupIds` `:217-219`, `refreshChatsNow` `:221-223`, `refreshActiveChatPinsNow` `:225-227`, `joinGroupsNow` `:229-236` | 20 | 20 |
| Web `chatActions.ts:64-136`: 11 wrapper functions that only forward to core; `:205-328` repeats the forwarding in the object | 73 + 124 | 130 (keep only the four guards) |
| Web `applyPrefsWithUnreadMark` alias and `applyPrefs` wrapper (`effects/prefs.ts:52-60`) | 9 | 6 |
| Web `readPorts` + `portsLayer` + `PortsLive` (`effects/ports.ts:428-431,483-486`) for one caller | 8 | 5 |
| Phone `readChatListCache`/`writeChatListCache`/`clearChatListCache` (`effects/lifecycle.ts:34-56`) wrap one file port | 23 | 12 |
| Phone `makePushPair` (`real-store.ts:143-165`) wraps one core action | 23 | 18 |
| Phone `checkSession` wrapper (`effects/ports.ts:126-129`) wraps one core call | 4 | 3 |
| Phone `isVisible` in helpers (`effects/helpers.ts:24-26`) duplicates the ports rule and is the one core actually receives (`real-store.ts:264`) | 3 | 3 |

### Data over branches

| Where | Lines | Cost |
|-------|-------|------|
| Phone view switches `chatsListView` / `messagesListView` / `emptyChatsText` (`types.ts:142-177`) are three `if` chains over the same two inputs | 36 | 18 (two `Record<LoadState, …>` tables plus one ternary) |
| Phone send refusals: size checks `effects/send.ts:121-131` and voice validation `:136-147` interleave policy with the call | 23 | 6 (one refusal table keyed by reason) |
| Web `compareNewestFirst` (`store.ts:127-132`) re-implements a core-safe comparator | 6 | 6 |
| Web `groupChats` (`store.ts:46-143`) mixes filtering, folder matching and three comparators in one 98-line function | 98 | 20 (a row pipeline plus two comparators) |

### Use the platform and libraries we have

| Where | Lines | Cost |
|-------|-------|------|
| Draft transport: web `effects/ports.ts:116-214` (99) and phone `lib/drafts.ts` (168, outside this scope) carry the same reopen/backoff/pause logic around different transports | 267 | 140 (one core state machine, two `open`/`close` adapters) |
| Chat-refresh debounce written twice: web `effects/history.ts:102-113` (12), phone `effects/events.ts:55-67` (13) | 25 | 17 (one core `scheduleRefresh`) |
| `prefsByJid`: web `effects/util.ts:9-15`; phone keying lives in `lib/chat-prefs.ts` | 7 | 4 |
| `fromPromise`: web `effects/util.ts:4-6` duplicates core `ctx.ts:221-222` | 3 | 2 |
| Trusted-media URL resolution: phone `effects/pins.ts:21-27`; web passes a predicate from `lib/attachments` | 7 | 4 (one core hook already exists in `sanitizeMediaItems`) |

### No speculative code

| Where | Lines |
|-------|-------|
| Dead exports and fields listed in part 4 | 28 |

### Comments

Comments in scope re-describe the old structure or the next line rather than a WHY.
Examples: web `effects/ports.ts:89-91` (restates `sessionGone`),
`effects/ctx.ts:16-17` (restates the interface), `effects/lifecycle.ts:121`
(restates the WeakMap), phone `real-store.ts:175-176` (restates the empty array),
`:314` (restates the outbox), `effects/helpers.ts:121` (restates the next line).
They do not need to survive the rewrite; the behaviour they describe does.

## 4. Dead code

Proved with `git grep -n <symbol> apps/web/src` / `apps/mobile/src` on this tree.

| Symbol | Location | Proof | Lines |
|--------|----------|-------|-------|
| `PREVIEW_HISTORY_MAX`, `PAGE_HISTORY_MAX`, `SEND_TIMEOUT_MS` | `apps/web/src/store/effects/constants.ts:6-9` | Only the definitions appear in `apps/web/src`; core exports the same values at `packages/client-core/src/store/history.ts:13-14` and `send/pipeline.ts:7` | 3 |
| `isMockMode` re-export | `apps/web/src/store/ChatStoreProvider.tsx:14` | Every importer uses `@/mock/gate`; none imports it from the provider | 2 |
| `PortsShape.openDrafts` | `apps/web/src/store/effects/ports.ts:239` | Written at `:414` and `:468`; never read. Core reads the other field, `ports.drafts` (`packages/client-core/src/store/draft-stream.ts:158`) | 2 |
| `SessionGoneStorage` export | `apps/web/src/store/effects/ports.ts:87` | Used only in the `sessionGone` signature in the same file | 1 |
| `firstToken` | `apps/mobile/src/store/effects/runtime.ts:95`, `real-store.ts:198` | Set to `undefined`, never read | 2 |
| `isUpdateStanza` | `apps/mobile/src/store/effects/chat-rows.ts:10-16`, re-exported at `real-store.ts:173` | No consumer in `apps/mobile/src` | 8 |
| `onClose`, `closeScope` | `apps/mobile/src/store/effects/runtime.ts:50-56` | No callers in the mobile store (the `onClose()` hits elsewhere are React component props) | 7 |
| `PortsShape.isVisible` | `apps/mobile/src/store/effects/ports.ts:196`, set at `:292` and `:339` | Core receives `helpers.isVisible` (`real-store.ts:264`); no reader of `ports.isVisible` | 3 |

`visibleChats` is *not* dead: `apps/web/src/components/chatList/rowsSelector.ts:3,43`
uses it even though the comment at `selectors.ts:22-24` says the list does not.
`flushMessageCache` and `readChatListCache` are live but exported for no external
caller (one internal call each); removing the `export` is part of the rewrite, not
dead code.

## 5. Lean target structure

### 5.1 What moves to `client-core`

| Module | Adds | Budget |
|--------|------|--------|
| `store/ctx.ts` | `createStoreApp({ get, set, ports, rt, hooks })` returns `{ ctx, locals, ledger, outbox }`; builds the core ctx, default hooks and bridges every shared field | 90 |
| `store/lifecycle.ts` | `resetUserStore(ctx, hooks)` = `stop` + `reset` + shared maps + app hook for caches/store fields | 45 |
| `store/history.ts` | `createHistoryCtx(ctx)` and `openChatBase(ctx, chatId, hooks)` (active, quiet marks, unread hook, members/pins hooks) | 55 |
| `store/history.ts` | `refreshChatsBase(ctx, hooks)` (fetch, generation check, merge, topic-gone hook, flush, adopt/join/preview hook) | 80 |
| `store/prefs.ts` | `createPrefsController({ get, set, api, now, extraColumns? })` over `updatePref`/`optimisticPrefRow` | 45 |
| `store/actions.ts` | `createBrowseActions({ ctx, rt, prefs, ... })` for open/close/markRead/loadOlder/retry; group actions stay app-side | 50 |
| `store/draft-stream.ts` | `openDraftStream({ createTransport, isPaused? })` owning attempt/reset/backoff; web and phone supply only the transport | 60 |
| `store/chat-list-cache.ts`, `store/message-cache.ts` | small `encodeFor(owner)`/`readFor(owner)` helpers removing the last per-app owner checks | 20 |
| **Total** | | **+445** |

Core store today is 12,793 lines; after the rewrite it is about 13,238. This is the
only place where line count grows.

### 5.2 Web target: 983 lines (from 2,720, -64%)

| File | Owns (platform only unless noted) | Budget |
|------|-----------------------------------|--------|
| `effects/ports.ts` | 50-call API adapter, localStorage port, EventSource transport, visibility, bytes/voice, notifications, flags, test ports | 190 |
| `effects/session.ts` | session-gone side effects: cache clears, owner/handle caches, push device, `authClient.signOut`, `/login` | 45 |
| `effects/cache.ts` | chat-list + message cache ports, pagehide flush, hydrate (shared paint order from core) | 75 |
| `effects/context.ts` | `createStoreApp` call, app hooks type and app locals: badge, in-tab notification, group members, pins refresh, previews | 80 |
| `effects/history.ts` | `openChatBase` hooks, reveal window, topic-gone URL rewrite, refresh hooks | 55 |
| `effects/actions.ts` | web-only actions: search, searchChat, folders, closeChat, background setters | 80 |
| `effects/prefs.ts` | background preset/image columns over the shared controller | 30 |
| `effects/pins.ts` | media-token trusted filter; core does load/pin/unpin | 25 |
| `effects/badge.ts` | app badge sync | 10 |
| `realStore.ts` | store shell, initial state spread, group actions merge | 60 |
| `store.ts` | types and exports; group API types stay | 80 |
| `chat-list.ts` | `groupChats`, folder filter, group sort | 80 |
| `selectors.ts` | folder/visibility selectors | 30 |
| `chatListCache.ts` | localStorage read/write/clear | 25 |
| `messageCache.ts` | localStorage port + caps; writer from core | 45 |
| `ChatStoreProvider.tsx` | mock/real store creation, auth start/stop, push re-enable, hooks | 55 |
| **Total** | | **965** |

### 5.3 Phone target: 1,022 lines (from 2,871, -64%)

| File | Owns (platform only unless noted) | Budget |
|------|-----------------------------------|--------|
| `effects/ports.ts` | domain API factories, stable XMPP resource, AppState, XHR draft transport, bytes/voice, test ports | 175 |
| `effects/lifecycle.ts` | start/stop/retry, 10 s background suspend + focus reconnect, cache hydrate/flush | 100 |
| `effects/history.ts` | group detail/members hooks, jump target, pins poll triggers | 60 |
| `effects/actions.ts` | prefs, folders CRUD, typing timers, shared browse actions | 80 |
| `effects/send.ts` | size/voice guards, local URI, cancel, retry | 85 |
| `effects/pins.ts` | pins store, epoch fence, media URL resolve | 70 |
| `effects/groups-cache.ts` | group member/roles caches, mention members (app-specific), renamed from `helpers.ts` | 45 |
| `effects/runtime.ts` | runners, `Life`, app `StoreState` fields | 40 |
| `effects/locals.ts` | app-only locals over `CoreLocals` | 12 |
| `real-store.ts` | store shell, user-state/teardown hook, group action wiring | 110 |
| `chat-store-provider.tsx` | store creation, auth start/stop, native push registration, hooks | 80 |
| `types.ts` | group API types, view helpers, app state extension | 100 |
| `offline-cache.ts` | file port + codec + user id | 40 |
| `offline-cache-sync.ts` | store watch + snapshot | 25 |
| **Total** | | **1,022** |

### 5.4 Files to delete

Web (8 files, 367 lines): `effects/storeContext.ts`, `effects/locals.ts`,
`effects/ctx.ts`, `effects/runtime.ts`, `effects/constants.ts`,
`effects/chatRows.ts`, `effects/reads.ts`, `effects/util.ts`. Their content is
either in the core additions, in `effects/context.ts`, or imported directly from
core.

Phone (1 file, 23 lines): `effects/chat-rows.ts`.
`effects/helpers.ts` is not kept as a 143-line mixed bag: its 45 group-only lines
become `effects/groups-cache.ts`, and `isUpdateStanza` (8 lines) is deleted as dead.
`effects/locals.ts` and `effects/runtime.ts` stay as the 12- and 40-line files in
the target table.

`effects/chatActions.ts` is not deleted, but drops from 329 to the 80-line budget in
`effects/actions.ts` after the wrappers go.

### 5.5 Totals

| | Today | Target | Change |
|---|---:|---:|---:|
| Web store | 2,720 | 965 | -1,755 (-65%) |
| Phone store | 2,871 | 1,022 | -1,849 (-64%) |
| App total | 5,591 | 1,987 | **-3,604 (-64%)** |
| Client-core store | 12,793 | 13,238 | +445 |
| Both sides | 18,384 | 15,225 | -3,159 (-17%) |

The app side more than halves while keeping every behaviour in part 1; the core pays
445 lines once instead of the apps paying 1,717 twice.

## 6. Order and risks

### 6.1 Rewrite order

Each step is mergeable alone and ends green. Line counts are the code removed plus
added in that step.

| Step | Work | Lines | Guard |
|------|------|------:|-------|
| 1 | **Core context + store shell.** Add `createStoreApp` and `resetUserStore`; move web `storeContext`/`locals`/`ctx`/`runtime` and phone `real-store` assembly/`helpers` ledger parts/`runtime`/`locals`. Delete web `storeContext`/`locals`/`ctx`/`runtime` and phone `chat-rows`; phone `helpers` shrinks to its group-only part. | ~1,300 | web `realStore.ledger/incoming/send`, phone `real-store.ledger/incoming/send` |
| 2 | **History open + refresh.** Add `createHistoryCtx`, `openChatBase`, `refreshChatsBase`; move web `effects/history.ts:67-198` and phone `:94-241`; delete phone `historyCtx` mapping and the unread-mark hook in `history.ts:227-231`. | ~950 | web `realStore.history`, phone `real-store.history` and `real-store.incoming` |
| 3 | **Prefs, folders, pins, actions.** Add the prefs controller and browse-action factory; reduce web `prefs`/`pins`/`chatActions` and phone `events`/`pins`/`send`/`pins actions` to adapters. | ~850 | web `effects/history.test`, phone `real-store.lifecycle` (prefs) |
| 4 | **Cache + sign-out.** Move `resetUserStore` calls into both lifecycles, finish the cache ports, delete web `reads`. | ~700 | web `switchUser`, phone `real-store.sign-out`, `offline-cache` |
| 5 | **Provider, types, dead code, budget.** Shrink providers, delete dead exports, run `wc -l` against part 5, delete step leftovers. | ~600 | gate + the manual checks below |

Step 1 is the riskiest because it moves the ledger binding, not the ledger code.
Step 2 is the second riskiest because it changes paging and unread. Steps 3-5 are
mostly deletions.

### 6.2 Behaviours easy to lose

| Behaviour | Why it breaks | How the lead checks it |
|-----------|---------------|------------------------|
| Sign-out clears caches | Phone teardown (`real-store.ts:104-138`) clears maps, state, ledger and cached pins in a fixed order; a shared reset that misses one map leaks a DM's JID into the next account. Web `effects/lifecycle.ts:48-105` also clears the message-cache writer before the key clear. | Automated: `apps/web/src/store/effects/switchUser.test.ts`, `apps/mobile/src/store/real-store.sign-out.test.ts`. Manual: sign out → sign in as another user on web mock and emulator; the previous chat list must not paint. |
| Phone background/resume | `background` flushes the cache immediately, suspends after 10 s, and `active` reconnects (`effects/lifecycle.ts:141-168`); a rewrite that only keeps "stop/start" doubles the session or loses the socket. | `apps/mobile/src/store/real-store.lifecycle.test.ts`; emulator: background >10 s while offline, foreground, send a message. |
| Draft stream | Web reopens a CLOSED `EventSource` with jitter (`effects/ports.ts:198-204`); phone pauses its XHR stream while backgrounded and resumes. A shared state machine must keep both pause rules. | `packages/client-core/src/store/draft-events.test.ts` for the codec/backoff; emulator: AI draft in a DM, background/foreground mid-draft; web mock: restart the dev server while a draft streams. |
| Session gone | Only 401 means gone; a network failure is `unknown` and must not sign out (`session-check.ts`). The web side effect clears caches then navigates; phone signs out through the auth store. | `apps/mobile/src/store/effects/session-check.test.ts`, `packages/client-core/src/store/lifecycle.test.ts:384-544`. Manual: revoke the token on the server, open `/` and the emulator. |
| Topic gone while open | Web moves to General and rewrites the URL unless the client caused the removal (`effects/history.ts:149-186`); phone sets a notice and clears `activeChatId` (`effects/history.ts:103-116`). The quiet-archive flag is consumed in both branches. | `apps/web/src/store/realStore.history.test.tsx`, `apps/mobile/src/store/real-store.history.test.ts`; web mock: archive an open topic from its header (silent) and from another client (notice). |
| Unread mark on open | Opening a chat sends a numeric read mark and a pref write; a missing hook leaves the bold row or clears someone else's mark. | `apps/web/src/store/realStore.history.test.tsx`, phone `real-store.history.test.ts`; emulator: open a chat with unread, go back, reopen on another device. |
| Cached pins paint | Cold start seeds cached pins before the server answers (`effects/lifecycle.ts:172-183` web, `:101-102` phone); a rewrite that paints after boot drops the banner. | `apps/mobile/src/store/offline-cache.test.ts`; cold start with airplane mode. |
| Retry bytes | Attachments/voice are kept in `pendingAttachments`/`pendingUploads` and dropped by `forgetRetryBytes`; the web `File` and phone `PickedFile` are not interchangeable. | `realStore.send.test.tsx` / `real-store.send.test.ts`; manual: fail an upload offline, Retry on reconnect. |
| Push pair | The pair is bound to the XMPP session and must be re-enabled on every transition into `online` (web `ChatStoreProvider.tsx:73-80`, phone `chat-store-provider.tsx:188-217`). | Emulator: sign in, kill the socket, confirm the push toggle still works; web mock: reload and check the enable call. |
| Local URL strip | Web stores no `blob:`/`data:` and phone no `file://`/`data:` (`messageCache.ts:18-19`, `offline-cache.ts:11`); a missed strip leaks a device path into the next run. | `apps/web/src/store/messageCache.test.ts`, `apps/mobile/src/store/offline-cache.test.ts`. |

### 6.3 Manual checks after every step

- Web mock by URL: `/`, `/c/<dm-jid>`, `/c/<room-jid>` — send text, attachment,
  voice; reload; open a chat with unread; archive an open topic.
- Phone emulator: chat list, DM, group topic — send each kind; open an unread chat;
  background >10 s and resume; cold start in airplane mode then online.
- Sign-out/sign-in both directions on both apps; no previous chat, pin, badge or
  draft may survive.
- Read-only live look: tab title/badge count after a mute or a read on another
  device, and no `local-*` bubble after a restart.
