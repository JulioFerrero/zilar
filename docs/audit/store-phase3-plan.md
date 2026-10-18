# Store phase 3: the app-side wiring both apps still write twice

Counted at `b28e534bd`, after the phase 2 merge. Paths are repo-relative; every claim
carries `file:line`. Line counts come from `wc -l` on the same tree.

"Same behaviour, different code" means the two apps do the same thing with different
identifiers or field names. "Platform" means the difference is the runtime (browser vs
React Native) and must stay behind a port in the app.

## 1. Inventory

### 1.1 Ports

Core already offers the shape both apps implement: `CorePorts` in
`packages/client-core/src/store/ports.ts:95-112`, the minimal `CoreApi` in
`packages/client-core/src/store/ports.ts:35-58`, the `SessionCheck` result in
`packages/client-core/src/store/session-check.ts:8`, and the session-gone handling in
`packages/client-core/src/store/session-check.ts:27-65`.

| Piece | Core | Web adds | Mobile adds | Verdict |
| --- | --- | --- | --- | --- |
| Session check | result type `session-check.ts:8`; consumer `session-check.ts:27-65` | `effects/ports.ts:86-103`: `getMe`, 401→gone, other→unknown | `effects/ports.ts:122-154`: missing token→gone, then the same 401 rule | Same behaviour, different code (one mobile branch) |
| Session gone | `ports.ts:111` port only | `effects/ports.ts:111-125`: clears chat/message caches, owner and handle caches, push device, then sign-out and `/login` | `effects/ports.ts:157-170`: dynamic-import auth store, `signOut` | Platform: the side effects differ |
| Draft stream | wire contract and backoff `draft-events.ts:30,44` | `effects/ports.ts:161-235`: `EventSource`, jittered reopen | `apps/mobile/src/lib/drafts.ts:77-244`: SSE over `XMLHttpRequest`, paused while backgrounded | Platform transport; wire contract already shared |
| Visibility | `Visibility` `ports.ts:64-67` | `effects/ports.ts:334-363`: `visibilityState` + `hasFocus` | `effects/ports.ts:236-254`: `AppState` | Platform |
| Bytes / voice | interfaces `ports.ts:114-158`; pipeline `send/attachment.ts:133`, `send/voice.ts:109` | `effects/ports.ts:398-422`: `File`/`Blob` and object URLs | `effects/ports.ts:60-119`: URI + uploader + stat, cancel/progress | Platform |
| Notifications | `Notifications` `ports.ts:85-88` | `effects/ports.ts:371-380`: app badge / in-tab dismissal | `real-store.ts:291-298`: mobile push badge | Platform |
| Flags / XMPP | `StoreFlags` `ports.ts:90-93` | `effects/ports.ts:369,431`: no resume reconnect | `effects/ports.ts:272-293,299`: stable resource, 15 s watchdog, resume reconnect | Platform |
| API surface | 9 calls `ports.ts:35-58` | ~50 calls `effects/portTypes.ts:37-114`, mapped `effects/ports.ts:275-326` | 10 domain factories `effects/ports.ts:202-212,298-305` | Same HTTP contract, different client split; out of this plan's scope |
| Test ports | `testCorePorts` `ports.ts:175-194` | `testPorts` `effects/ports.ts:466-499` | `PortsTest` `effects/ports.ts:342-373` | Platform shapes; no task |

### 1.2 Lifecycle

Core already owns the sequence: `startStore:102`, `retryBoot:113`, `stopStore:142`,
`reset:160`, `reconnect:183`, `boot:235` in
`packages/client-core/src/store/lifecycle.ts`; `suspendStore:21` and `wakeCore:38`; the
connection, retry ladder and listeners in `packages/client-core/src/store/connect.ts:101-178`;
polling in `packages/client-core/src/store/polling.ts:128-143`.

| Piece | Core | Web adds | Mobile adds | Verdict |
| --- | --- | --- | --- | --- |
| start/stop/retry | `lifecycle.ts:102,113,142` | `effects/lifecycle.ts:39-44` delegates | `effects/lifecycle.ts:351-363` delegates | Already shared |
| Reset per user | `lifecycle.ts:160-177` clears the ledger patch and shared maps | `effects/lifecycle.ts:48-100` adds caches, push device, store fields, ledger reset | `real-store.ts:102-136` adds app maps, store fields, ledger reset; `effects/lifecycle.ts:353-361` calls it | Same behaviour, different code |
| Boot rows | `lifecycle.ts:268-279` calls the app's `applyBoot` | `effects/lifecycle.ts:192-206`: `mergeWithPainted` then prefs | `effects/lifecycle.ts:238-248`: prefs over `freshRows`, no painted merge | Same behaviour, different code; the mobile path drops the painted previews |
| Cache paint | codecs `chat-list-cache.ts:54-112`, `message-cache.ts:244-279` | `effects/lifecycle.ts:152-190`: localStorage, messages and pins, `pagehide` save | `effects/lifecycle.ts:37-98,149-168,188-233`: files, offline hydrate, focus/background timers | Platform storage; same paint order |
| Cache write throttle | none | `effects/lifecycle.ts:117-150`: one timer per store, `saveMessages` | `offline-cache.ts:72-133`: debounce, ordered writes, `clear` fence | Same behaviour, different code |
| Hooks object | `StoreAppHooks` `ctx.ts:78-96` | `effects/storeContext.ts:93-130` | `effects/lifecycle.ts:170-274` | Same behaviour, different code |
| Context adapter | `CoreCtx` `ctx.ts:98-121` | `effects/storeContext.ts:82-200` + `effects/ctx.ts:27-68` | `effects/lifecycle.ts:113-348` + `real-store.ts:259-345` | Same behaviour, different code |

### 1.3 History

Core already owns the loads: `openHistory:251`, `loadOlderPage:148`, `loadPreview:199`,
`openAtMessage:351`, `flushPending:238`, `canLoadHistory:91` in
`packages/client-core/src/store/history.ts`; row merging in
`packages/client-core/src/store/chat-rows.ts:61-86`; delivery marks in
`packages/client-core/src/store/delivered.ts:141`.

| Piece | Core | Web adds | Mobile adds | Verdict |
| --- | --- | --- | --- | --- |
| Context / field names | `HistoryState.historyState` `history.ts:21-31` | Store already uses the core names: `effects/ctx.ts:27-33` | maps `historyLoad`↔`historyState` twice: `effects/history.ts:29-107` and `effects/lifecycle.ts:116-134,277-287` | Same behaviour, different code; duplicated inside mobile too |
| openChat | `loadOlder`, `openHistory`, `pruneInactiveChats` | `effects/history.ts:88-122`: active chat, prune, read, unread pref, members, pins, pending open | `effects/history.ts:302-330`: same order plus group detail and pins poll | Same behaviour, different code |
| Unread mark on open | none | inside `effects/history.ts:106-114` | `effects/events.ts:51-66` | Same behaviour, different code |
| Refresh chat list | `mergeChatRows` `chat-rows.ts:61-86`, `applyChatDelivery` `delivered.ts:141`, `flushPending` | `effects/history.ts:147-248`: fetch, merge, topic-gone URL, join rooms, previews | `effects/history.ts:155-183,188-224,236-247`: fetch, merge, topic-gone state, group detail/members, previews | Same behaviour, different code except the web URL move `207-214` |
| Search reveal window | none | `effects/history.ts:32-75`: web list window | none | Platform UI |

### 1.4 Chat actions and send

Core already owns every send: exports in `packages/client-core/src/store/send.ts:17-39`,
text `send/text.ts:9`, attachment `send/attachment.ts:133`, voice `send/voice.ts:109`,
sticker `send/sticker.ts:56`, forward `send/forward.ts:144`, retry text
`send/retry-text.ts:47`, pipeline and timeout `send/pipeline.ts:7,60`, outbox
`send/outbox.ts:37,279`; message actions in `actions.ts:18,48,123,169,176`; delete/clear
in `delete-own.ts:40,80`; pins in `pins.ts:117,141,181`.

| Piece | Core | Web adds | Mobile adds | Verdict |
| --- | --- | --- | --- | --- |
| Send facade | all functions above | `effects/chatActions.ts:69-141`: thin calls, empty voice/file guards `80-82,111-113`, object URL `64-67` | `effects/send.ts:42-166`: same calls, size/voice guards `123-155`, local URI `78-90`, cancel `102-109` | Platform guards and bytes; keep |
| Message actions | `actions.ts:18-181` | `effects/chatActions.ts:244-268` delegates | `effects/events.ts:114-125` delegates | Already shared |
| Unread mark on open | none | `effects/history.ts:106-114` | `effects/events.ts:51-66` | Same behaviour, different code |
| Folders / prefs | `folders.ts:17-33`, `prefs.ts:64-88` | `effects/prefs.ts:20-80` adapters | `effects/events.ts:104-190` adapters and folder CRUD | Same behaviour, different code; folder CRUD is API wiring, not store wiring |

The message hot path (send, ledger, incoming) is already in core. Phase 3 must not
rewrite it; it may only rebuild the context that feeds it (task T2).

### 1.5 Store shell and context

Core already offers `CoreState`/`CorePatch` (`ctx.ts:23-40`), `CoreCtx` (`ctx.ts:98-121`),
`createMessageLedger` (`ledger.ts:36`), `makeLifetime` (`lifetime.ts:64`) and the test
ports above. It has no shared locals, no shared initial state and no shared action
interface.

| Piece | Core | Web | Mobile | Verdict |
| --- | --- | --- | --- | --- |
| Locals | none | `effects/locals.ts:49-72`, 20 fields | `effects/locals.ts:38-70`, 24 fields; 16 are common | Same behaviour, different code |
| Ledger + CoreCtx | `ledger.ts:36`, `ctx.ts:98-121` | `effects/storeContext.ts:45-200` | `real-store.ts:259-345` + `effects/helpers.ts:27-36` | Same behaviour, different code |
| Nick / group ids | none | `effects/storeContext.ts:63-79` | `effects/helpers.ts:66-75,138-144` | Same behaviour, different code |
| Initial state / teardown | `lifecycle.ts:160-177` | `realStore.ts:43-100` + `effects/lifecycle.ts:48-100` | `real-store.ts:79-136` | Same behaviour, different code |
| State/action types | none | `store.ts:238-395` (~55 members overlap) | `types.ts:221-317` (~55 members overlap) | Same behaviour, different code |
| Group actions | phase 2 functions `group-actions.ts:34-299` | `store.ts:183-236` types + `effects/groupActions.ts:1-140` | `types.ts:38-128` types + `effects/groups.ts:1-326`, `group-actions.ts:1-272` | Same core, different API signatures; keep |
| Sidebar grouping | none | `store.ts:46-138` `groupChats` | none | Web-only UI |
| Runners | `lifetime.ts:64-101` | `effects/runtime.ts:1-16` | `effects/runtime.ts:81-100,217-235` | Mostly shared; the mobile `Life` wrapper is app-specific |

### 1.6 Provider

There is no shared provider, and there should not be one: the providers are framework
glue. Web builds the store after mock XMPP loads (`ChatStoreProvider.tsx:24-43`), starts
and stops on auth (`50-71`), and re-enables the push pair (`73-80`). Mobile resolves
`expo-router` params and mock deps (`chat-store-provider.tsx:161-170`), starts on auth
(`174-186`), and runs native push registration (`188-217`). The only shared rule is
"start on authenticated, stop on cleanup" (`ChatStoreProvider.tsx:50-71` vs
`chat-store-provider.tsx:174-186`), about 10 lines each. Extracting it would add a core
file and a hook for no net saving, so it stays.

## 2. Tasks

Order is a dependency order, not a priority order. Tasks in the same wave touch disjoint
files and can run in parallel. Every task is 30-60 minutes and ends with `pnpm gate`.

- Wave 1, parallel: T1, T2, T3, T7.
- Wave 2, parallel: T4, T5.
- Wave 3: T6.

### T1: one session check

- Core adds `createSessionCheck({ getMe, getToken? })` in
  `packages/client-core/src/store/session-check.ts`: `getToken` absent means web's rule;
  present and empty means gone; then 401→gone, anything else→unknown (mirrors today's
  `apps/mobile/src/store/effects/ports.ts:122-154` and
  `apps/web/src/store/effects/ports.ts:86-103`).
- App files that shrink: `apps/web/src/store/effects/ports.ts:86-103` becomes one call;
  `apps/mobile/src/store/effects/ports.ts:122-154` becomes one call with `getToken`.
- Allowed files:
  - `packages/client-core/src/store/session-check.ts`
  - `apps/web/src/store/effects/ports.ts`
  - `apps/mobile/src/store/effects/ports.ts`
- Existing tests: `apps/mobile/src/store/effects/session-check.test.ts:6-55`;
  `packages/client-core/src/store/lifecycle.test.ts:384-482` (gone vs unknown);
  `apps/web/src/store/realStore.lifecycle.test.tsx:69-108`.
- Expected net: core +22, web -15, mobile -25, **net -18**.
- Hot path: no send/ledger. It guards the reconnect ladder, so a hung check can still
  leave "Connecting…"; the core's `catchCause → unknown` (`session-check.ts:46`) must stay.

### T2: one core context (locals, ledger, CoreCtx)

- Core adds to `packages/client-core/src/store/ctx.ts`:
  `CoreLocals`, `createCoreLocals()`, `createCoreContext({ get, set, ports, rt, api, hooks })`.
  The factory builds the ledger (`createMessageLedger` `ledger.ts:36`), `nick`, the
  pending maps, the text outbox, `CoreCtx` (`ctx.ts:98-121`) and default `CoreHooks`
  (`ctx.ts:46-59`). App hooks override only what is platform-specific.
- App files that shrink or go: `apps/web/src/store/effects/storeContext.ts:45-200` becomes
  a factory call plus the app hooks; `apps/web/src/store/effects/locals.ts:49-72` spreads
  the core locals; `apps/web/src/store/effects/ctx.ts:27-68` extends the core type.
  `apps/mobile/src/store/real-store.ts:259-345` becomes a factory call;
  `apps/mobile/src/store/effects/helpers.ts:27-36,138-144` drops the ledger and `nick`;
  `apps/mobile/src/store/effects/runtime.ts` shared fields come from `CoreLocals`;
  `apps/mobile/src/store/effects/locals.ts:38-70` spreads the core locals.
- Allowed files:
  - `packages/client-core/src/store/ctx.ts`
  - `apps/web/src/store/effects/storeContext.ts`
  - `apps/web/src/store/effects/ctx.ts`
  - `apps/web/src/store/effects/locals.ts`
  - `apps/mobile/src/store/real-store.ts`
  - `apps/mobile/src/store/effects/helpers.ts`
  - `apps/mobile/src/store/effects/runtime.ts`
  - `apps/mobile/src/store/effects/locals.ts`
- Existing tests: `packages/client-core/src/store/ledger.test.ts:1-955`,
  `incoming.test.ts:41-493`, `send.test.ts:1-996`;
  `apps/web/src/store/realStore.ledger.test.tsx:1-250`,
  `realStore.incoming.test.tsx:1-229`, `realStore.send.test.tsx:1-279`;
  `apps/mobile/src/store/real-store.ledger.test.ts:138-360`,
  `real-store.incoming.test.ts:80-244`, `real-store.send.test.ts:141-305`.
- Expected net: core +110, web -70-8-28, mobile -55-17-8-28, **net -104**.
- Hot path: yes (ledger, incoming, send). The task moves bindings, not algorithms; a
  wrong `memberName`, `occupantNick`, `mediaToken`, `isVisible` or pending-map reference
  loses or duplicates messages.

### T3: one history context and one openChat

- Core adds to `packages/client-core/src/store/history.ts`:
  `createHistoryCtx({ get, set, ports, rt, k, fx, core, ... })` plus
  `historyStateOf`/`historyPatchOf` for the `historyState` field, and
  `openChatBase(ctx, chatId, hooks)` (prune, record read, clear the manual unread mark via
  a hook, pending open, `openHistory`) with hooks for group detail/members, pins and the
  topic notice.
- App files that shrink or go: `apps/mobile/src/store/effects/history.ts:29-107` becomes a
  factory call; `:302-330` becomes `openChatBase` plus mobile hooks;
  `apps/mobile/src/store/effects/events.ts:51-66` is deleted;
  `apps/mobile/src/store/effects/lifecycle.ts:116-134,277-287` reuses the shared mapping.
  `apps/web/src/store/effects/history.ts:88-122` becomes `openChatBase` plus web hooks.
- Allowed files:
  - `packages/client-core/src/store/history.ts`
  - `apps/web/src/store/effects/history.ts`
  - `apps/mobile/src/store/effects/history.ts`
  - `apps/mobile/src/store/effects/lifecycle.ts`
  - `apps/mobile/src/store/effects/events.ts`
- Existing tests: `packages/client-core/src/store/history.test.ts:95-236,485-503`
  (including the mobile adapter at `166`); `apps/mobile/src/store/real-store.history.test.ts:99-203`;
  `apps/mobile/src/store/real-store.incoming.test.ts:104-130`;
  `apps/web/src/store/realStore.history.test.tsx:76-158`,
  `realStore.incoming.test.tsx:100-141`.
- Expected net: core +75, web -20, mobile -70-16-10, **net -41**.
- Hot path: history paging and unread. A wrong `historyLoad` mapping leaves a skeleton or
  clears the marker too early; a wrong hook sends a read mark for a closed chat.

### T4: one chat-list refresh

- Core adds `refreshChats(ctx, hooks)` to `packages/client-core/src/store/history.ts`:
  fetch chats and prefs in parallel, check the session/generation, map rows, apply
  delivery, `mergeChatRows`, remember group ids, decide the open-topic-gone case through a
  hook, `flushPending`, join new rooms through `fx.joinGroups` and `loadPreview`.
- App files that shrink or go: `apps/web/src/store/effects/history.ts:147-248` keeps the
  fetch error type and the URL replace (`207-214`) as hooks; the merge/join/preview body
  goes. `apps/mobile/src/store/effects/history.ts:155-247` keeps group detail/members as
  hooks; the merge/topic-gone/preview body goes.
- Allowed files:
  - `packages/client-core/src/store/history.ts`
  - `apps/web/src/store/effects/history.ts`
  - `apps/mobile/src/store/effects/history.ts`
- Existing tests: `packages/client-core/src/store/chat-rows.test.ts:41-83`,
  `delivered.test.ts:76-136`, `history.test.ts:302-344`;
  `apps/web/src/store/effects/history.test.ts:59-79`;
  `apps/mobile/src/store/real-store.history.test.ts:301-330`,
  `real-store.lifecycle.test.ts:93-231`.
- Expected net: core +85, web -67, mobile -52, **net -34**.
- Hot path: yes (incoming list state and reconnect). The generation check must land
  before any `set`, or a refresh that resolves after `stop()` overwrites the next user.

### T5: one sign-out reset

- Core adds `resetUserStore(ctx, hooks)` to `packages/client-core/src/store/lifecycle.ts`:
  `stop()`, the existing `reset()` (`:160-177`), then the shared maps (`cursors`,
  `groupIds`, `groupMembers`, `loadingHistory`, `loadingOlder`, `sendRuns`, pending
  bytes/voices) and a hook for the app's caches and store fields.
- App files that shrink or go: `apps/web/src/store/effects/lifecycle.ts:48-100` keeps the
  web cache and push-device hooks; `apps/mobile/src/store/real-store.ts:102-136` keeps the
  app map/field hook; `apps/mobile/src/store/effects/lifecycle.ts:353-361` calls the core.
- Allowed files:
  - `packages/client-core/src/store/lifecycle.ts`
  - `apps/web/src/store/effects/lifecycle.ts`
  - `apps/mobile/src/store/effects/lifecycle.ts`
  - `apps/mobile/src/store/real-store.ts`
- Existing tests: `apps/web/src/store/effects/switchUser.test.ts:59-80`;
  `apps/mobile/src/store/real-store.sign-out.test.ts:90-170`;
  `packages/client-core/src/store/lifecycle.test.ts:129-150`.
- Expected net: core +40, web -40, mobile -25-6, **net -31**.
- Hot path: no send, but security-sensitive. A missed map leaks one account's chats,
  messages or retry bytes into the next session.

### T6: one debounced message-cache writer

- Core adds to `packages/client-core/src/store/message-cache.ts`:
  `createMessageCacheWriter({ read, write, remove, userId, select?, options })` with
  `schedule`, `flush`, `clear`, an ordered write chain and a clear fence, built on
  `encodeMessageCache` (`message-cache.ts:244-253`) and `selectCachedChats`
  (`message-cache.ts:184-198`).
- App files that shrink or go: `apps/web/src/store/messageCache.ts:21-86` becomes the
  localStorage port; `apps/web/src/store/effects/lifecycle.ts:117-150` drops its timer.
  `apps/mobile/src/store/offline-cache.ts:72-133` becomes the file port;
  `offline-cache-sync.ts` keeps only the store watch; `apps/mobile/src/store/effects/lifecycle.ts:37-98`
  drops the extra file helpers.
- Allowed files:
  - `packages/client-core/src/store/message-cache.ts`
  - `apps/web/src/store/messageCache.ts`
  - `apps/web/src/store/effects/lifecycle.ts`
  - `apps/mobile/src/store/offline-cache.ts`
  - `apps/mobile/src/store/offline-cache-sync.ts`
  - `apps/mobile/src/store/effects/lifecycle.ts`
- Existing tests: `packages/client-core/src/store/message-cache.test.ts:63-223`;
  `apps/web/src/store/messageCache.test.ts:56-165`;
  `apps/mobile/src/store/offline-cache.test.ts:87-170`.
- Expected net: core +75, web -26-14, mobile -58-4-37, **net -64**.
- Hot path: no live message path, but cold start. A late write after sign-out recreates
  the previous user's cache; a lost local-URL strip puts `file://`/`blob://` into the file.

### T7: one action and state type surface

- Core adds to `packages/client-core/src/store/actions.ts`: `ChatStoreActions` and
  `ChatStoreCommonState`, covering the fields both apps already declare identically:
  chats/contacts/messages/history, send and retry, edit/delete, reactions, typing, drafts,
  pins, prefs and folders. Group/topic APIs stay app-side because their signatures differ
  (`apps/web/src/store/store.ts:183-236` vs `apps/mobile/src/store/types.ts:38-128`).
- App files that shrink: `apps/web/src/store/store.ts:238-395` extends the core types and
  keeps only group, search and web-only members; `apps/mobile/src/store/types.ts:221-317`
  extends the core types and keeps only mobile-only members.
- Allowed files:
  - `packages/client-core/src/store/actions.ts`
  - `apps/web/src/store/store.ts`
  - `apps/mobile/src/store/types.ts`
- Existing tests: none runtime-specific; `pnpm gate` typecheck is the guard, plus the
  store tests above compile against the merged type.
- Expected net: core +75, web -78, mobile -42, **net -45**.
- Hot path: type-only, no runtime. A missed field is a compile error, not a lost message.

## 3. Risks and manual checks

"Hot path" covers send, the ledger, incoming, history paging and reconnect.

| Task | Hot path | What can break | Tests that guard it |
| --- | --- | --- | --- |
| T1 | reconnect only | a check that never settles leaves "Connecting…"; a wrong result signs a live session out | mobile `session-check.test.ts:6-55`; core `lifecycle.test.ts:384-482` |
| T2 | yes: send, ledger, incoming | duplicate or lost echo, lost retry bytes, wrong unread because `isVisible`/`mediaToken` is bound to the wrong store | core `ledger.test.ts`, `incoming.test.ts`, `send.test.ts`; web `realStore.ledger/incoming/send`; mobile `real-store.ledger/incoming/send` |
| T3 | history paging, unread | endless skeleton from a wrong `historyLoad` map; a read mark sent for a chat that is closed; a jump that pages twice | core `history.test.ts:95-503`; mobile `real-store.history.test.ts:99-203`; web `realStore.history.test.tsx:76-158` |
| T4 | yes: incoming, history, reconnect | a stale refresh overwrites the next user's list; a new group row never joins; a duplicated preview; wrong unread | core `chat-rows.test.ts:41-83`, `delivered.test.ts:76-136`; web `effects/history.test.ts:59-79`; mobile `real-store.history.test.ts:301-330`, `real-store.lifecycle.test.ts:93-231` |
| T5 | sign-out, not send | previous account's chats, messages or bytes survive into the next session; a cache write recreates a cleared key | web `switchUser.test.ts:59-80`; mobile `real-store.sign-out.test.ts:90-170`; core `lifecycle.test.ts:129-150` |
| T6 | cold start, not send | duplicated preview after restart; `file://`/`blob://` stored; a post-sign-out write recreates the file | core `message-cache.test.ts:63-223`; web `messageCache.test.ts:56-165`; mobile `offline-cache.test.ts:87-170` |
| T7 | none | nothing at runtime; a missing member is a type error | `pnpm gate` typecheck |

Manual checks after each task:

| Task | Web mock screens by URL | Phone emulator routes | Sign-out / sign-in |
| --- | --- | --- | --- |
| T1 | `/login` after a revoked session; `/` stays usable on a transient failure | sign-in, then background/foreground while offline | yes, both apps |
| T2 | `/`, `/c/<dm-jid>`, `/c/<room-jid>`: send text, attachment, voice; reload | chat list, DM, group topic: send each kind; open a chat with unread | yes, both apps |
| T3 | `/c/<dm-jid>` open, reload, jump from search; check the unread divider | same routes; open a group topic before the rooms finish joining | yes, both apps |
| T4 | `/` refresh after a new message; archive/remove an open topic | reload the list; remove an open topic; join a new group | yes, both apps |
| T5 | `/` after sign-out shows no previous chat; sign in as another user | same on the emulator, kill and relaunch | yes, both apps, both directions |
| T6 | reload with the network off, then online; sign out | airplane mode cold start, then online; sign out and relaunch | yes, both apps |
| T7 | any screen compiles and opens | any screen compiles and opens | no special check |

Also check after every task: the browser tab title/badge does not keep a stale unread
count, and no `local-*` bubble survives a restart.

## 4. Total

| Task | Removed | Added | Net |
| --- | --- | --- | --- |
| T1 session check | 40 | 22 | -18 |
| T2 core context and locals | 214 | 110 | -104 |
| T3 history context and openChat | 116 | 75 | -41 |
| T4 chat-list refresh | 119 | 85 | -34 |
| T5 sign-out reset | 71 | 40 | -31 |
| T6 message-cache writer | 139 | 75 | -64 |
| T7 action/state types | 120 | 75 | -45 |
| **Total** | **819** | **482** | **-337** |

The estimate is about -340 net lines (gross -820/+480), with a ±20% margin. The point is
not only the count: after T1-T7 each of these has one implementation in
`packages/client-core/src/store/`: session check, store locals and ledger context, history
context and openChat, chat-list refresh, sign-out reset, cache writer and the action/state
type surface. The send pipeline, incoming and the ledger are not rewritten in phase 3;
only the context that feeds them moves.

Out of scope, and worth a later decision: the app API clients (`effects/portTypes.ts:37-114`
vs the mobile `lib/*-api.ts` factories), the group/topic action types, the provider
framework glue, and the web-only sidebar view helpers (`store.ts:46-138`).
