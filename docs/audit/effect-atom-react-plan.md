# Replacing zustand with `@effect/atom-react`: audit and ordered plan

Status: audit (T-0521), 2026-10-08. Written from the code, from the published
`@effect/atom-react@4.0.2` tarball, and from `effect@4.0.2`'s `.d.ts`. No code
and no `package.json` changed.

Julio overruled `docs/audit/effect-everywhere-plan.md` §2.6 (keep zustand) on
2026-10-07: `@effect/atom-react` replaces zustand on web and mobile
(`docs/ROADMAP_EFFECT.md:15`). This document is the API facts, the store maps,
the migration shape and the ordered, small tasks. It supersedes §2.6 and §2.7's
"zustand stays" recommendation; §2.7's Hermes warnings still stand.

Every claim cites a `file:line` or a `.d.ts` path. Unknowns are listed as
questions at the end, not guessed.

## 0. Verified package facts

- `@effect/atom-react` publishes `4.0.2`. `pnpm view @effect/atom-react@4.0.2`
  returns: `peerDependencies = { react: '>=19.0.0 <20.0.0', effect: '^4.0.2',
  scheduler: '>=0.25.0 <0.28.0' }`; `exports['.'] = './dist/index.js'`.
- It is **not installed** in this repo. `effect@4.0.2` is present in the
  workspace store (`node_modules/.pnpm/effect@4.0.2`); the React package is not.
- Web has React 19.3 (`docs/audit/effect-everywhere-plan.md:109`); mobile has
  React 19.2.3 (`:122`). Both satisfy the React peer range.
- The package re-exports five modules (published tarball paths):
  `dist/index.d.ts`, `dist/Hooks.d.ts`, `dist/RegistryContext.d.ts`,
  `dist/ScopedAtom.d.ts`, `dist/ReactHydration.d.ts`. The atom core it builds on
  is `effect/reactivity` (`dist/reactivity/Atom.d.ts`,
  `AtomRegistry.d.ts`, `AsyncResult.d.ts`, `AtomRef.d.ts`).

## 1. API facts for `@effect/atom-react` 4.0.2

### How an atom is defined

All builders live in `effect/reactivity/Atom.d.ts`; `@effect/atom-react`
re-exports the React hooks only.

- `Atom.make(value)` → a writable state atom; `Atom.make((get) => value)` → a
  read-only derived atom; `Atom.make(effect)` or `Atom.make(stream)` → an
  `AsyncResult` atom (`Atom.d.ts:253-312`).
- `Atom.writable(read, write)` for a hand-written read/write pair
  (`Atom.d.ts:245`).
- `Atom.fn(f)` → a writable async-function atom whose value is an
  `AsyncResult`; writing an argument starts the computation (`Atom.d.ts:618`,
  `567`). `Atom.fnSync` is the synchronous twin (`Atom.d.ts:513`).
- `Atom.family(f)` memoises an atom factory per argument, with WeakRef caching
  where available (`Atom.d.ts:692`). This is the per-chat/per-group atom swap
  (see §4).
- `Atom.map` / `Atom.mapResult` derive a value from an atom and keep the write
  input of a writable source (`Atom.d.ts:1020`, `:1060`).

### Reading and writing outside React (tests and actions)

Two layers:

- A standalone registry: `AtomRegistry.make(options?)` returns an
  `AtomRegistry` with synchronous `get(atom)`, `set(atom, value)`,
  `update(atom, f)`, `modify(atom, f)`, `subscribe(atom, f, { immediate? })`,
  `refresh(atom)`, `reset()` and `dispose()` (`AtomRegistry.d.ts:59-81`,
  `:119-124`). This is what tests and non-React actions use.
- Effect-returning readers/writers that require the `AtomRegistry` service:
  `Atom.get` (`Atom.d.ts:1417`), `Atom.set` (`:1453`), `Atom.update` (`:1479`),
  `Atom.modify` (`:1426`), `Atom.refresh` (`:1527`), `Atom.mount` (`:1540`),
  `Atom.getResult` (`:1512`).

`Atom.batch(f)` defers listener notification until `f` returns
(`Atom.d.ts:1309`) — this is how a multi-atom write stays a single React
update (see §4 and §6).

### The registry, its React provider and its scoping

- `AtomRegistry.make` = one registry = one independent atom store;
  "the same atom can hold different values in different registries"
  (`AtomRegistry.d.ts:1-8`).
- `RegistryProvider` creates one `AtomRegistry` and passes it through
  `RegistryContext` (`RegistryContext.d.ts:58`); it forwards `initialValues`,
  `scheduleTask`, `timeoutResolution` and `defaultIdleTTL` only when the
  registry is created. "Option changes after the first render do not rebuild the
  registry"; on unmount disposal is delayed briefly and cancelled by a quick
  remount (same declaration).
- `RegistryContext` defaults to a standalone registry when no provider is
  present (`RegistryContext.d.ts:30`), so hooks work in tests without a
  provider.
- `ScopedAtom.make(factory)` returns `{ use(), Provider, Context }`; the
  provider creates the atom once for its lifetime and the value passed to the
  factory is fixed at mount (`ScopedAtom.d.ts:59`, `:120`). This is the
  provider-owned atom for per-session state.
- On the Effect side, `AtomRegistry.layer` / `layerOptions` provide a registry
  as a service and dispose it when the layer scope closes
  (`AtomRegistry.d.ts:150-163`).

### How an Effect-backed atom runs, and how it is interrupted

- `Atom.make(effect, { initialValue?, uninterruptible? })` runs the Effect and
  exposes `AsyncResult<A, E>` (`Atom.d.ts:261-275`). The Effect's environment is
  `Scope.Scope | AtomRegistry` — the atom owns a Scope whose lifetime is the
  node's (`Atom.d.ts:261`, `Atom.mount` `:1540`).
- `Atom.fn(f)` runs `f` per written argument and exposes the run as an
  `AsyncResult` atom (`Atom.d.ts:618`). `AtomResultFn` writes accept the
  argument plus the `Reset` and `Interrupt` control symbols
  (`Atom.d.ts:567-610`). **Writing `Atom.Interrupt` interrupts the currently
  running computation**; `Atom.Reset` returns it to `Initial`
  (`Atom.d.ts:581-610`).
- A layer-backed runtime is built with `Atom.runtime` / `Atom.context()`; the
  memo map is registry-scoped by default or shared when a `Layer.MemoMap` is
  passed (`Atom.d.ts:320-433`). `atomRuntime.atom(...)`, `.fn(...)`,
  `.pull(...)` and `.subscriptionRef(...)` run with that layer
  (`Atom.d.ts:339-367`).
- Disposing a node (no subscribers, provider unmount, `registry.dispose()`)
  closes the atom's Scope, running Effect finalizers and interrupting the fiber
  (`AtomRegistry.d.ts:73-81`, `:119-124`, `:303-329`).

### The selector / memo equivalent

- `useAtomValue(atom)` or `useAtomValue(atom, (value) => derived)`
  (`Hooks.d.ts:52`), `useAtom(atom)` for value + setter (`:197`),
  `useAtomSet`, `useAtomMount`, `useAtomRefresh`, `useAtomSubscribe`,
  `useAtomSuspense`, `useAtomInitialValues` (all in `Hooks.d.ts`).
- React re-render gating is by atom identity and value equality. The default is
  `Object.is`; a structural comparison needs `Atom.withEquality` on the atom
  (`Atom.d.ts:806-835`). `Atom.map` / `Atom.mapResult` / `Atom.family` are the
  memo primitives. `useAtomRef`, `useAtomRefProp`, `useAtomRefPropValue` read
  `AtomRef` subtrees (`Hooks.d.ts`).
- **Consequence:** a selector that returns a fresh array/object every call is a
  loop. Compare `apps/mobile/src/store/selector-stability.test.ts:9` — it was
  written because `pins(chatId)` returned a new `[]` and React hit "Maximum
  update depth exceeded". Web has the same shape today
  (`apps/web/src/store/realStore.ts:3528` `messages`, `:3855` `pins`), so web
  readers must not move to selectors until those are stable (§6).

## 2. Map of the web store

Files: `apps/web/src/store/store.ts` (1,863 lines, mock `createChatStore` at
`:828`/`:835`), `apps/web/src/store/realStore.ts` (4,809 lines,
`createRealChatStore` at `:769`), provided by
`apps/web/src/store/ChatStoreProvider.tsx` (47 lines).

**How web reads today.** `useChatStore()` selects the **whole** state:
`useStore(api, (state) => state)` (`ChatStoreProvider.tsx:46`). Every one of the
42 consumer files that calls `useChatStore()` therefore re-renders on any state
change and reads fields off `store.`. Components that need a fresh read at call
time use `useChatStoreApi()` (`ChatStoreProvider.tsx:37`) and
`storeApi.getState().<action>` (e.g.
`apps/web/src/routes/ChatView.tsx:88`). No component uses a narrow selector;
there is no per-field `useStore(api, selector)` anywhere but the provider
(grep for `useStore(` under `apps/web/src` = 1 non-test hit).

Consumer files (42 non-test, `useChatStore`/`useChatStoreApi`): `routes/` —
NotificationsPage, AppRoutes, ChatShell, GroupHandleRoute, FoldersPage, ChatView;
`components/` — SearchBar, InviteDialog, ForwardPicker, Composer, FolderTabs,
MessageSearchResult, ChatListItem, ExplorePage, PinsPanel, FolderEditorDialog,
ChatMediaPanel, ChatHeader, MessageBubble, ChatList, NewGroupDialog, MessageList,
ChatActionsMenu, TaskStrip, ContactProfileRow, TopicPanel, ChatBackgroundDialog,
FolderRail, ChannelComposerBar, PinnedBanner, ChannelPanel,
MessageSearchResults, VisibilitySection, TopicRow, NewChatButton,
NewTopicDialog, GroupPanel, approvals/AlwaysAllowedList, ais/NewAiDialog,
ais/AiPanel.

### Slices of `ChatStoreState` (`store.ts:132-452`)

| # | Slice | Fields / actions (store.ts) | Primary web readers (via whole-state `useChatStore`) |
| --- | --- | --- | --- |
| S1 | Session & connection | `currentUserId:133`, `me:134`, `status:135`, `mediaTrustedHosts:398`, `start:412`, `stop:413`, `signOut:411` | ChatList, ChatView, Composer, MessageList, ChatHeader, TopicPanel, ChannelPanel, TopicRow, NewChatButton, ChannelComposerBar, GroupPanel, NewTopicDialog; `ChatStoreProvider.tsx:30-31` calls `start`/`stop` |
| S2 | Chat list, search, folders | `chats:152`, `chatsState:137`, `contacts:153`, `search:414`, `setSearch:415`, `searchChat:417`, `setSearchChat:418`, `activeFolder:420`, `setActiveFolder:421`, `folders:423`, `setFolders:424`, `refreshChats:180`, `retryChats:147`, `refreshGeneralTopic:149`, `archivedChats:316` | ChatShell, ChatList, SearchBar, ChatListItem, FolderRail, FolderTabs, FoldersPage, FolderEditorDialog, ForwardPicker, NewChatButton, ContactProfileRow, NewTopicDialog, MessageSearchResult(s), PinsPanel, ChatMediaPanel, Composer |
| S3 | Messages & history | `messages:154`, `messagesByChat:428`, `historyState:139`, `historyStateFor:145`, `retryHistory:151`, `openChat:328`, `loadOlder:329`, `hasMore:330`, `openAtMessage:336`, `historyComplete:449`, `activeChatId:448` | ChatView, MessageList, ChatListItem, ChatHeader, TopicRow, PinsPanel, PinnedBanner, Composer, ChatMediaPanel, MessageSearchResults |
| S4 | Send & message actions | `sendText:337`, `sendVoice:338`, `sendAttachment:339`, `sendSticker:341`, `forwardMessages:348`, `retrySticker:354`, `retryAttachment:356`, `retryVoice:358`, `deleteFailedMessage:360` | Composer, ForwardPicker, MessageBubble |
| S5 | Reactions, edits, action errors | `react:365`, `reactions:441`, `editTarget:370`, `startEdit:372`, `cancelEdit:374`, `editMessage:379`, `deleteForEveryone:384`, `actionError:386`, `edits:447` | MessageBubble, Composer, ChatView |
| S6 | Typing & drafts | `typing:317`, `drafts:322`, `finishedDraftMessages:327`, `sendTyping:399` | ChatListItem, ChatHeader, TopicRow, MessageList |
| S7 | Chat prefs & backgrounds | `chatPrefs:259`, `refreshChatPrefs:261`, `defaultBackground:263`, `refreshDefaultBackground:265`, `setPinned:267`, `setMuted:269`, `setArchived:271`, `setChatBackground:273`, `setDefaultBackground:276`, `setChatBackgroundImage:279`, `setDefaultBackgroundImage:282` | ChatActionsMenu, ChannelComposerBar, ChatBackgroundDialog, MessageList |
| S8 | Pins | `pins:286`, `pinsLoaded:288`, `loadPins:290`, `canPin:298`, `pinFor:300`, `pinMessage:305`, `unpinMessage:307`, `pinsPanel:309`, `setPinsPanel:311`, `pinsError:313`, `dismissPinsError:315`, `pinsByChat:434`, `pinsReady:436` | PinsPanel, PinnedBanner, MessageBubble, ChatView |
| S9 | Groups, topics, channels | `groupMembers:156`, `groupInfo:158`, `groupInfos:451`, `refreshGroupInfo:160`, `addGroupAi:162`, `removeGroupAi:164`, `listMyAis:166`, `topicNotice:173`, `dismissTopicNotice:175`, `createTopic:185`, `patchTopic:191`, `addTopicAi:193`, `removeTopicAi:195`, `addTopicMember:197`, `removeTopicMember:199`, `setTopicRoles:204`, `refreshTopicRow:210`, `leaveTopic:212`, `createChannel:219`, `leaveChannel:228`, `changeChannelRole:233`, `setGroupVisibility:238`, `joinPublicGroup:247`, `setMembersCanCreateTopics:249`, `setGroupBackground:251`, `setGroupListener:253`, `createGroup:400`, `createInvite:410` | TopicPanel, TopicRow, GroupPanel, ChannelPanel, ChannelComposerBar, NewTopicDialog, NewGroupDialog, ChatHeader, ChatBackgroundDialog, VisibilitySection, GroupHandleRoute, ExplorePage, TaskStrip, AlwaysAllowedList, NewChatButton, Composer |
| S10 | Media gallery | `loadChatMedia:296` (returns a page; stores nothing) | ChatMediaPanel |
| S11 | Push pair | `setPushPair:391` | NotificationsPage |

`groupInfos` is stored in S9 but read inside the chat-list slice (S2) too; keep
it in one atom and read it from both.

### Long-lived resources owned by `start()` / `stop()`

`createRealChatStore` creates the store body at `realStore.ts:787` and holds
private, non-reactive handles:

- `core: XmppCore` (the XMPP client) — set in `connectXmpp`
  (`realStore.ts:3188-3189`), disconnected in `stop` (`:4687-4691`), reconnect
  scheduling `scheduleConnectRetry` / `connectRetryTimer`
  (`:3139-3152`), retry delays `CONNECT_RETRY_DELAYS_MS` (`:165`).
- XMPP event subscriptions `unsubscribers` pushed by `subscribe(current)`
  (`:2757-2769`), torn down in `stop` (`:4659-4662`).
- Topic poll: `startChatsPolling` / `stopChatsPolling`, `chatsPollTimer`
  `window.setInterval(..., TOPIC_REFRESH_INTERVAL_MS)` plus a `focus` listener
  (`:2197-2233`, interval `:163`).
- Pins poll: `startPinsPolling` / `stopPinsPolling`, `pinsPollTimer`
  `setInterval(..., PINS_REFRESH_INTERVAL_MS)` plus a `focus` listener
  (`:2151-2195`).
- Draft stream: `closeDraftStream = openDrafts(handleDraftEvent)`
  (`:2527-2532`), closed in `stop` (`:4652-4653`); draft fallback timers
  `draftTimeouts` (`:805`), `DRAFT_END_FALLBACK_MS` / `DRAFT_IDLE_MS`
  (`:242`/`:246`).
- Typing timers `typingTimers` (`:790`, cleared `:4663-4666`); per-send
  timeouts `sendTimeouts` + run tokens (`:844-845`, cleared `:4667-4671`);
  `refreshTimer` (`:824`, cleared `:4672-4675`).
- `pagehide` listener added in `start` (`:4645-4647`), removed in `stop`
  (`:4684-4686`), for `saveChatList` (`:810-818`).
- `boot(gen)` loads `/api/chats` etc., starts the draft stream and both polls,
  then connects XMPP (`:3084-3134`).
- `stop()` tears all of the above down and disconnects
  (`:4650-4692`).

The mock store's `start`/`stop`/`signOut` are no-ops (`store.ts:1487-1489`).

### Out-of-store caches and side state

- `chatListCache.ts` is a `localStorage` cache (persist-like): read
  `:44-78`, write `:80-108`, key/version at `:8-9`. `start` reads it
  (`realStore.ts:4635-4643`), `boot` merges it (`:3117-3121`), `saveChatList`
  writes it on every painted-list change (`:810-817`, called at `:3221`).
  Migrating state to atoms must not touch this.
- Private maps that never enter React: `cursors`, `pendingOutgoing`,
  `pendingAttachments`, `pendingVoices`, `messageAliases`, `messageServerIds`,
  `messageOriginIds`, `messageAuthors`, `messageBaseTexts`, `groupIds`,
  `groupMembers`, `groupInfos`, `loadingGroupMembers`, `loadingOlder`,
  `loadingHistory`, `quietArchiveIds` (`realStore.ts:834-873`). They are the
  store's own bookkeeping and stay as plain module state, next to the registry.

## 3. Map of the mobile store

Files: `apps/mobile/src/store/types.ts` (507 lines, `ChatStoreState` at `:150`),
`apps/mobile/src/store/chat-store.ts` (1,595 lines, mock `createChatStore` at
`:358`), `apps/mobile/src/store/real-store.ts` (4,356 lines,
`createRealChatStore` at `:365`), provider
`apps/mobile/src/store/chat-store-provider.tsx` (88 lines, `useChatStore` at
`:69`, `useChatStoreApi` at `:82`), and the separate auth store
`apps/mobile/src/auth/session-store.ts` (142 lines, `createAuthStore` at
`:69`).

**How mobile reads today.** Unlike web, `useChatStore(selector)` already takes a
selector (`chat-store-provider.tsx:69-75`), and every screen selects the exact
field it needs (e.g. `app/(tabs)/index.tsx:48-56`,
`app/chat/[id].tsx:59-127`, `components/chat/message-list.tsx:101-125`). That is
why mobile is the stronger candidate for atoms: the reader cut-over is mostly
already done. Test callers use the whole `store.getState()` / `store.setState()`
surface, exactly like web, and
`apps/mobile/src/store/selector-stability.test.ts:9` pins stable selector
references.

Measured readers: 27 non-test files call `useChatStore`, 8 call `useAuthStore`,
5 call `useSession` — 37 unique non-test files. (The task front matter states 51
mobile files; the wider count including tests/indirect imports is 37-51
depending on the pattern. Treated as an open question, §7.)

### Slices of `ChatStoreState` (`types.ts:150-507`)

| # | Slice | Fields / actions (types.ts) | Primary mobile readers (narrow selector) |
| --- | --- | --- | --- |
| M1 | Session & connection | `currentUserId:151`, `me:152`, `status:153`, `mediaTrustedHosts:210`, `start:505`, `stop:506` | index, chat-list-item, topic-row, group-list-item, message-list, chat-header, channel-screen, message-bubble, attachment-body, voice-message; provider `:61-62` |
| M2 | Chat list, search, folders | `chatsLoad:158`, `chats:159`, `contacts:160`, `search:164`, `activeFolder:166`, `folders:168`, `foldersLoaded:175`, `reloadChats:245`, `setSearch:494`, `setActiveFolder:495`, `setFolders:496`, `createFolder:498`, `updateFolder:500`, `deleteFolder:502`, `reorderFolders:504` | index, folders, folder/[id], `(tabs)/_layout`, group/[id], forward-sheet, group-list-item, message-search-list, channel-screen, new-chat-button, `u/[handle]` |
| M3 | Messages & history | `messagesByChat:161`, `messages:211`, `historyLoad:163`, `activeChatId:176`, `historyComplete:177`, `hasMore:212`, `openChat:213`, `openAtMessage:235`, `jumpTarget:240`, `clearJumpTarget:242`, `loadOlder:243`, `retryHistory:247` | message-list, chat/[id], message-search-list, group-list-item, `dev/whistle` |
| M4 | Send & message actions | `sendText:248`, `sendTyping:249`, `sendAttachment:251`, `retryAttachment:253`, `cancelAttachment:255`, `sendVoice:257`, `retryVoice:259`, `cancelVoice:261`, `sendSticker:263`, `retrySticker:265`, `forwardMessages:272` | chat/[id], composer, forward-sheet |
| M5 | Reactions, edits, action errors | `edits:184`, `reactions:189`, `editTarget:201`, `actionError:203`, `react:278`, `startEdit:280`, `cancelEdit:282`, `editMessage:284`, `deleteForEveryone:286`, `dismissActionError:288` | chat/[id], composer, tool-detail-sheet |
| M6 | Typing & drafts | `typing:178`, `drafts:194`, `finishedDraftMessages:199` | chat-list-item, topic-row, chat-header, message-list |
| M7 | Chat prefs & pins | `setChatPref:326`, `pins:331`, `pinsError:333`, `refreshPins:335`, `pinFor:337`, `canPin:343`, `pinMessage:345`, `unpinMessage:347`, `dismissPinsError:349`, `stopPinsPoll:354` | chat/[id], message-list, channel-composer-bar |
| M8 | Groups, topics, channels, roles | `groupMembers:220`, `groupIdForChat:228`, `groupDetailsRevision:301`, `groupDetail:307`, `ensureGroupDetail:314`, `refreshGroupDetail:317`, `ownedAis:319`, `topicNotice:294`, `dismissTopicNotice:296`, `createTopic:367`, `patchTopic:372`, `archiveTopic:374`, `addTopicAi:376`, `removeTopicAi:378`, `addTopicMember:380`, `removeTopicMember:382`, `leaveTopic:384`, `listTopicMembers:386`, `listTopicAis:388`, `setTopicRoles:484`, `topicRoles:489`, `refreshTopicRoles:493`, `groupRoles:458`, `refreshGroupRoles:460`, `createGroupRole:463`, `renameGroupRole:465`, `deleteGroupRole:467`, `setGroupRoleMembers:473`, `createChannel:410`, `createGroup:420`, `leaveChannel:430`, `listChannelMembers:436`, `changeChannelRole:445`, `listInviteLinks:394`, `createInviteLink:399`, `revokeInviteLink:404`, `previewJoinLink:447`, `joinByLink:452` | group/[id], chat/[id], channel-screen, channel-composer-bar, new-chat-button, join/[token] |
| M9 | Media gallery | `loadChatMedia:362` (returns a page; stores nothing) | media-sheet |
| M10 | Auth/session (separate store) | `status`, `me`, `bootstrap`, `signIn`, `setName`, `signOut` (`session-store.ts:36-47`) | AuthFlow, NameForm, settings/profile, `_layout`, RequireAuth, settings, welcome/handle, stickers, sticker-pack |

### Long-lived resources owned by `start()` / `stop()`

`createRealChatStore` opens at `real-store.ts:365`; `start`/`stop` at
`:4289`/`:4307`:

- `started` guard, `generation`, `appState.subscribe` for foreground reconnect
  (`:4298-4303`), `startTopicsPolling(generation)` (`:4304`), `runBoot`
  (`:4305`).
- XMPP core `createXmpp` + `core` (`:3099-3100`), event `unsubscribers`
  (`:4314-4317`), disconnect in `stop` (`:4347-4351`).
- Topic poll `topicsPollTimer` + `removeTopicsPollListener`
  (`:1945-1973`); pins poll `pinsPollTimer` + `removePinsPollListener`
  (`:1884-1914`); interval constants `TOPIC_REFRESH_INTERVAL_MS` (`:195`) and
  `PINS_REFRESH_INTERVAL_MS` (`:198`).
- Draft stream `closeDraftStream` (`:4326-4327`) plus draft fallback timers;
  typing timers (`:4318-4321`); `refreshTimer` (`:4322-4325`).
- Private state cleared in `stop`: `groupDetails`, `groupRolesById`,
  `topicRolesById`, `messageAliases`, `messageAuthors`, `messageOriginIds`,
  `messageServerIds`, `pendingUploads` (`:4330-4346`). These are non-reactive
  and stay plain module state.
- Mobile also has `AppState` (React Native) rather than `window` focus, injected
  as `AppStateLike` (`chat-store-provider.tsx:22-28`).

## 4. The migration shape

**Recommended shape: one registry per provider, one atom per slice, actions stay
plain functions that take the registry, and a `StoreApi`-shaped compatibility
object (`store.getState()` / `store.setState()` / `store.subscribe()`) backed by
the atoms so 42 + 37 readers and the store tests move gradually.**

Why this shape:

- `RegistryProvider` already scopes state to a React subtree and disposes it on
  unmount (`RegistryContext.d.ts`), which is exactly the provider ownership the
  two `ChatStoreProvider`s already have (`ChatStoreProvider.tsx:34`,
  `chat-store-provider.tsx:65`). One registry per provider keeps the
  "a reload gives the next user a fresh store" behaviour (`realStore.ts:778`).
- One atom per slice lets a reader migrate to `useAtomValue(atom, selector)`
  and get the narrow re-renders web does not have today, while other readers
  keep the compatibility object. The slice boundary is already drawn by the
  code (see the tables in §2/§3).
- Actions as plain functions taking the registry keep the existing call sites
  (`store.sendText(...)`, `storeApi.getState().refreshChats()`) working, and
  keep them testable without React, matching the Effect guide's "Effect inside,
  promises at the edges" (`docs/EFFECT_GUIDE.md:12-32`).

### The compatibility object

```
interface CompatStore<T> {          // same surface as zustand's StoreApi
  getState(): T
  setState(partial: Partial<T> | ((state: T) => Partial<T>)): void
  subscribe(listener: (state: T) => void): () => void
  getInitialState(): T
}
```

Implementation rules:

1. `getState()` assembles the slice atom values from the registry, with the
   action functions layered on. `registry.get(atom)` is synchronous
   (`AtomRegistry.d.ts:65`), so an action that sets then reads still sees the
   new value (see §6).
2. `setState(partial)` accepts a plain partial **or** an updater, because tests
   call both (`apps/web/src/store/realStore.topics.test.tsx:299`,
   `apps/web/src/routes/ChatView.test.tsx:128`). It writes each key's slice atom
   through `registry.set` (`AtomRegistry.d.ts:68`).
3. A single `setState` (and each store action that writes several keys) runs
   inside `Atom.batch` (`Atom.d.ts:1309`) and notifies `subscribe` listeners
   once, at the end. This preserves the pinned "in one update" behaviour:
   `apps/web/src/store/realStore.test.tsx:2690` and
   `apps/mobile/src/store/real-store.test.ts:894`.
4. `subscribe` wraps `registry.subscribe(atom, ...)` for every slice atom and
   re-emits the assembled state. It is the escape hatch for the one non-React
   subscriber (`apps/web/src/store/realStore.test.tsx:2696`).

### Per-argument state

Slices keyed by chat/group/role (`messagesByChat`, `pinsByChat`, `edits`,
`reactions`, `groupInfos`, `historyState`, `typing`, `drafts`, roles) can use
`Atom.family` (`Atom.d.ts:692`) so `useAtomValue(messagesAtom(chatId))` is
narrow. The selector functions (`messages(chatId)`, `pins(chatId)`,
`groupDetail(groupId)`, …) stay exported and must return a **stable** empty
value when the key is absent, or `Object.is` loops — the mobile test at
`selector-stability.test.ts:9` pins this and web needs the same fix before its
readers move (`realStore.ts:3528`, `:3855`).

### Where `start()` / `stop()` fit

They stay the lifecycle entry points (the providers call them,
`ChatStoreProvider.tsx:30-31`, `chat-store-provider.tsx:61-62`). Their bodies
become Effect programs that acquire the XMPP client, polls and stream with
`Effect.acquireRelease` / `Effect.scoped` and run on a runtime tied to the
registry, so `stop()` interrupts the fibers and runs every finalizer. The
current teardown list in `realStore.ts:4650-4692` and
`real-store.ts:4307-4353` is the checklist for that task (§5 W10/M6).

## 5. Ordered task list

Each task is ~400 changed lines or less, keeps behaviour, and has its own
tests that must pass unchanged. "Tests" names the files that gate it. Web goes
first; mobile follows the web pattern. Sizes: S ≤ 0.5 day, M 1–2 days.

**Parallelism:** each lane's first task (W1, M1) is serial and must land before
the rest of its lane. Inside a lane the slice tasks touch the same
`store.ts`/`realStore.ts`, so W2–W8 and M2–M4 are serial. Reader cut-overs
(W9, M5) can run file-by-file **in parallel** with the last slice tasks once
that slice's atoms exist. M1 can start as soon as W1's shape is reviewed, but
not before.

### Web lane

| # | Task | Files | Deps | Size | Tests unchanged |
| --- | --- | --- | --- | --- | --- |
| W1 | Add `@effect/atom-react@4.0.2` + `effect@4.0.2` to `apps/web`; add the registry provider and the compat `StoreApi`; move the **view-state pilot** slice (S2's `search`, `searchChat`, `activeFolder`, `folders`, `setSearch`, `setSearchChat`, `setActiveFolder`, `setFolders`) to atoms. Record `pnpm --filter @zilar/web build` before/after against the §3.1 baseline. | `apps/web/src/store/ChatStoreProvider.tsx`, new `apps/web/src/store/atom/*`, `apps/web/package.json` | — | M | `realStore.test.tsx`, `reload.test.tsx`, `search.test.ts`, `folders.test.ts`, `chatListCache.test.ts` |
| W2 | Move S1 (session/connection) + S2's list fields (`chats`, `chatsState`, `contacts`, `archivedChats`) to atoms; keep `start`/`stop` as-is for now. | `store.ts`, `realStore.ts`, `atom/*` | W1 | M | `realStore.test.tsx`, `reload.test.tsx` |
| W3 | Move S6 (typing + drafts, `finishedDraftMessages`) to atoms. | `store.ts`, `realStore.ts`, `atom/*` | W2 | S | `realStore.test.tsx` (draft block `:2645`) |
| W4 | Move S8 (pins) + S10 media + S11 push to atoms. | `store.ts`, `realStore.ts`, `atom/*` | W2 | M | `realStore.test.tsx` (pins `:1415`), `realStore.media.test.tsx` |
| W5 | Move S7 (chat prefs + backgrounds, including the optimistic rollback actions) to atoms. | `store.ts`, `realStore.ts`, `atom/*` | W2 | M | `realStore.test.tsx` (`:500`–`:717`) |
| W6 | Move S3+S4 (messages/history + send pipelines) to atoms, split send pipelines (text → attachment → voice → sticker → forward) if the diff exceeds ~400 lines. | `store.ts`, `realStore.ts`, `atom/*` | W3 | M | `realStore.test.tsx`, `realStore.forward.test.tsx`, `realStore.media.test.tsx` |
| W7 | Move S5 (reactions + edits + action errors) to atoms. | `store.ts`, `realStore.ts`, `atom/*` | W6 | M | `realStore.test.tsx` (`:2282`) |
| W8 | Move S9 (groups/topics/channels) to atoms, split topics vs channels if needed. | `store.ts`, `realStore.ts`, `atom/*` | W6 | M | `realStore.topics.test.tsx`, `realStore.forward.test.tsx` |
| W9 | Cut web readers over from `useChatStore()` to `useAtomValue(sliceAtom, selector)` file-by-file; make `messages()`/`pins()` empty results stable first; delete the whole-state compat hook and remove the zustand dependency once all 42 files are moved. | `apps/web/src/routes/**`, `components/**`, `store/*` | W2–W8 | M | every web test |
| W10 | Reimplement `start()`/`stop()` on `Effect` (`acquireRelease`/`scoped` + fibers) with the registry runtime: XMPP client, typing/send/draft timers, both polls, draft stream, `pagehide`. | `realStore.ts`, `atom/*` | W6 | L | `realStore.test.tsx`, `reload.test.tsx` |

### Mobile lane

| # | Task | Files | Deps | Size | Tests unchanged |
| --- | --- | --- | --- | --- | --- |
| M1 | Add `@effect/atom-react@4.0.2` + `effect@4.0.2` to `apps/mobile`; add the registry provider and compat `StoreApi`; move the view-state pilot slice (`search`, `activeFolder`, `folders`, `foldersLoaded`, `setSearch`, `setActiveFolder`, `setFolders`). Verify the Hermes bundle via `expo export` against §3.2. | `chat-store-provider.tsx`, new `store/atom/*`, `apps/mobile/package.json` | W1 | M | `chat-store.test.ts`, `real-store.folders.test.ts`, `selector-stability.test.ts`, `types.test.ts` |
| M2 | Move the M1 slice (session/connection) + M2's list fields (`chats`, `chatsLoad`, `contacts`) **and** the separate auth store (`auth/session-store.ts`: 8 `useAuthStore` readers, `bootstrap`/`signIn`/`signOut` persistence) to atoms. | `chat-store.ts`, `real-store.ts`, `types.ts`, `auth/session-store.ts`, `auth/AuthFlow.tsx`, `auth/NameForm.tsx`, `app/**`, `atom/*` | M1 | M | `real-store.test.ts`, `integration.test.ts`, auth tests, `types.test.ts` |
| M3 | Move M3–M6 (messages/history, send actions, reactions/edits, typing/drafts) to atoms, split if over budget. | `chat-store.ts`, `real-store.ts`, `atom/*` | M2 | M | `real-store.test.ts`, `real-store.attachments.test.ts`, `real-store.forward.test.ts`, `real-store.voice.test.ts`, `selector-stability.test.ts` |
| M4 | Move M7–M9 (prefs/pins, groups/topics/channels/roles, media) to atoms, split by area if over budget. | `chat-store.ts`, `real-store.ts`, `atom/*` | M2 | M | `real-store.prefs-pins.test.ts`, `real-store.topics.test.ts`, `real-store.roles.test.ts`, `real-store.channels.test.ts`, `real-store.groups-create.test.ts`, `real-store.media.test.ts` |
| M5 | Cut mobile screens from `useChatStore(selector)` to `useAtomValue`; delete the compat `StoreApi` and remove zustand once all readers are moved. | `app/**`, `components/**`, `store/*` | M3, M4 | M | every mobile test, `selector-stability.test.ts` |
| M6 | Reimplement mobile `start()`/`stop()` on `Effect` (XMPP core, both polls, draft stream, timers, `AppState` subscription) with the registry runtime. | `real-store.ts`, `atom/*` | M3 | L | `real-store.test.ts`, `real-store.general-only.test.ts` |

W10 and M6 are the largest; they may each be split into a per-resource pair if
the diff exceeds 400 lines.

## 6. Hazards

- **Atomic, single-update semantics are pinned.** `Atom.batch` must wrap every
  multi-key write or the two draft tests fail:
  `apps/web/src/store/realStore.test.tsx:2690` and
  `apps/mobile/src/store/real-store.test.ts:894` — "replaces the draft with a
  message that arrives before end, in one update". Both subscribe and assert
  that every notification has exactly one of `drafts[chat]` /
  `messages(chat)`, never both and never neither
  (`realStore.test.tsx:2695-2724`).
- **`subscribe` callers outside React.** Only one, in a test:
  `apps/web/src/store/realStore.test.tsx:2696` (`store.subscribe`). The
  provider's `useStore` (`ChatStoreProvider.tsx:46`) is the only production
  subscriber. Mobile has no `store.subscribe` caller; its non-React
  subscriptions are React Native `AppState`, not the store
  (`real-store.ts:1896`, `:1959`, `:4298`).
- **Whole-state selection on web.** `ChatStoreProvider.tsx:46`
  (`useStore(api, (state) => state)`) means web currently re-renders every
  consumer on any change. The atom cut-over must not accidentally make a
  selector return a fresh object per render or React will loop (next bullet).
- **Selector stability.** `apps/mobile/src/store/selector-stability.test.ts:9`
  pins that `pins()`, `messages()`, `groupDetail()`, `groupRoles()` and
  `topicRoles()` keep the same reference while nothing changed. Web's
  equivalents return a fresh `[]` each call
  (`apps/web/src/store/realStore.ts:3528` `messages`, `:3855` `pins`;
  `store.ts:1317`, `:1234`) and a fresh array in `groupMembers`
  (`realStore.ts:3529`). These must be memoised (or use `Atom.family` /
  `Atom.withEquality`, `Atom.d.ts:692`, `:806`) **before** web readers move to
  selectors.
- **Persist-like caching.** `apps/web/src/store/chatListCache.ts:44-108` writes
  the last chat list to `localStorage`; `start` reads it
  (`realStore.ts:4635-4643`), `boot` merges it (`:3117-3121`) and
  `saveChatList` writes it on every list change (`:810-817`, `:3221`). `stop`
  must keep it; the cache is not store state and does not move to atoms.
- **Actions read state synchronously right after setting it.** Must keep
  working with synchronous `registry.get`:
  - web `openAtMessage` calls `get().openChat(chatId)` then immediately reads
    `get().chats` / `get().messagesByChat` (`realStore.ts:3965-3968`;
    mock `store.ts:1373-1375`);
  - mobile `openAtMessage` does the same (`real-store.ts:3263-3268`);
  - web `react` reads `get().reactions[...]` and writes back
    ("read-modify-write", `realStore.ts:4023-4030`; mobile
    `real-store.ts:3748-3755`);
  - `saveChatList` reads `get()` right after a `set` in `connectXmpp`
    (`realStore.ts:3220-3221`).
- **`setState` accepts partials and updaters.** Tests use both forms
  (`apps/web/src/store/realStore.topics.test.tsx:299`,
  `apps/web/src/routes/ChatView.test.tsx:128`,
  `apps/web/src/routes/NotificationsPage.test.tsx:169`). The compat object must
  implement both, or those tests break.
- **Timers and process lifetime.** Web uses `window.setInterval`/`setTimeout`
  (`realStore.ts:2151-2233`, `:3139-3152`, `:805`, `:844`); mobile uses
  `setInterval`/`setTimeout` + `AppState`
  (`real-store.ts:1884-1973`, `:4298`). Effect's sleep/timers do not `unref`
  (`docs/EFFECT_GUIDE.md:170`), so W10/M6 must interrupt every fiber in `stop()`
  or the app/process will not go idle/exit.
- **Hermes.** `@effect/atom-react` and `effect/reactivity/Atom` use
  `WeakRef`/`FinalizationRegistry` (`docs/audit/effect-everywhere-plan.md:328`),
  which the plan flags as needing an on-device check (§2.7, §5.4). M1 must
  export the mobile bundle and run it once on device before M2 starts.
- **Bundle size.** Web +69.26 kB raw / +22.76 kB gzip for a minimal
  `effect`+`Schema` probe (`effect-everywhere-plan.md:378-391`); mobile
  +2,956,235 bytes (~2.82 MiB, ~32%) (`:401-420`). W1 and M1 must re-measure
  with `@effect/atom-react` actually imported, not rely on the probe numbers.

## 7. Open questions

1. **Mobile reader count.** The front matter says 51 mobile files read the
   stores; my grep finds 27 `useChatStore` + 8 `useAuthStore` + 5 `useSession`
   = 37 unique non-test files. Which count is authoritative, and does it include
   test files or indirect type imports?
2. **Registry lifetime vs `start()`/`stop()`.** Should the registry be owned by
   the provider (disposed on unmount) or by the store factory (survives
   `stop()`)? The provider already recreates the store per auth session
   (`ChatStoreProvider.tsx:22`), so provider ownership is the default; confirm.
3. **Do the mock and real stores converge on the same atoms?** `createChatStore`
   and `createRealChatStore` currently share `ChatStoreState` but differ in
   implementation. The plan migrates both behind one compat object; confirm that
   the mock store should move too (it is test-only but its tests gate).
4. **`start`/`stop` on Effect: same task as the state move, or later?** The
   shape is independent (W10/M6), but if the lead wants one atomic web cut-over,
   reorder.
5. **Bundle budget.** Is the atom-react cost acceptable on web, given §2.6
   argued the value is in pipelines, not the container? W1 measures it; a
   threshold that would stop the migration should be set before W1 runs.
