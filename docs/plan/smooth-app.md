# A smoother app: cold opens, resumes and jumps

Julio, 2026-10-17: "the connection with the app to be smoother, not only UI… cards test is
slow to load in like 500ms or higher". The connection line (T-1898) and the Settings profile
spinner (T-1899) are being fixed separately and are not repeated here.

**Method.** The web timings below are the lead's measured facts (Chrome paint + resource
timings, cold load of the "cards test" topic, chat.zilar.app, 2026-10-17). Everything else is
code reading; no phone timings were measured, so the phone sections describe order and
blocking, not milliseconds. Line numbers are from this branch.

Measured web cold open: FCP 0.21 s (list from cache); `/api/xmpp/token` 0.33 → 0.41 s;
topic messages and card photos at ~1.3 s (`card-media` at 1.31 s, image painted at 1.36 s).
A warm switch between chats is 72 ms. **The wait is connect + history, not rendering.**

## 1. The cold-open timeline

### Web (chat.zilar.app, cold load of `/c/<topic>`)

1. **Session.** `better-auth` `useSession()` (`apps/web/src/auth/AuthProvider.tsx:107`); the
   chat store only starts once `auth.status === 'authenticated'`
   (`apps/web/src/store/ChatStoreProvider.tsx:54-79`). In parallel, the auth provider already
   fires `GET /api/me` for the handle/avatar (`AuthProvider.tsx:122-136`).
2. **Cached list paints** (FCP 0.21 s). `prepareStart` reads localStorage and sets
   `chats`/`chatsState: 'ready'` (`apps/web/src/store/effects/lifecycle.ts:124-141`,
   `apps/web/src/store/chatListCache.ts:9-11,62-111`). There is no message cache, so the
   thread has nothing to paint.
3. **Boot fetches.** `getMe`, `getChats`, `getContacts`, prefs run together
   (`packages/client-core/src/store/lifecycle.ts:199-208`), then `readLastRead` from
   localStorage (`:218`), then the boot result is written (`:221-228`).
4. **XMPP token.** *Only now* does `connectXmpp` call `api.getXmppToken()`
   (`packages/client-core/src/store/connect.ts:116`) — 0.33 s in the measurement. It is
   serialized behind step 3 even though nothing in it depends on the boot data.
5. **WebSocket, SASL, bind.** `current.connect()` (`connect.ts:161`); SASL/bind/stream
   management are done inside `@xmpp/client` and resolve at `online`
   (`packages/xmpp-core/src/core-effect/lifecycle.ts:249-278`). There is no roster fetch on
   connect: XMPP `roster` pushes only force a chat-list refresh (`connect.ts:97`); the
   "roster" the app joins is the MUC occupant list (`core-effect/lifecycle.ts:209-217`).
6. **`online` → first flush.** The status listener sets `online` and flushes the pending open
   (`connect.ts:72-77,169-170`). A **DM** page starts here.
7. **MUC joins — every group and every topic, one after another.** `joinGroups`
   (`connect.ts:171`, `apps/web/src/store/effects/groupMembers.ts:139-153`) loops the whole
   `chats` list and `yield*`s each `joinRoom`, and every join waits for the room's own
   presence (`packages/xmpp-core/src/core-effect/operations.ts:99-122`). Each topic row is its
   own room, so a user with a handful of groups pays one round trip per topic.
8. **`groupsJoined`.** Set only after the last join (`connect.ts:172`). Only then does
   `canLoadHistory` stop refusing group/topic chats (`history-core.ts:99-102`), and
   `flushPending` (`connect.ts:173`) starts the MAM page (`history.ts:183-185`).
9. **Previews.** `loadPreviews` then fires MAM for every chat without a `lastMessage`, four
   at a time (`connect.ts:174`, `previews.ts:17-28`), competing with the open page.

**What waits on what that need not:**

- **Token after the session fetches** (step 4). It can start with step 3; the token is valid
  for up to 600 s (`apps/server/src/xmpp/token.ts:9`), so a few hundred ms of prefetch is safe.
- **The open topic's MAM after every room join** (steps 7-8). The open room's join is the only
  one that matters for its history; the rest can follow in the background.
- **`loadPreviews` right behind the open page** (step 9). Dozens of preview MAMs at
  concurrency 4 can add a queue delay to the page the user is waiting for.
- Minor: `getMe` is requested twice per load, once by auth and once by the boot
  (`AuthProvider.tsx:126`, `lifecycle.ts:203`).

### Phone (cold start, opening a topic)

Same shared boot (`packages/client-core/src/store/lifecycle.ts:188-240`), with these differences:

1. `prepareStart` paints the chat list **asynchronously** (file read) and hydrates the
   offline message cache (`apps/mobile/src/store/effects/lifecycle.ts:146-160,107-126`). If a
   chat is opened from a notification in the first ~100 ms, the skeleton can paint before the
   cache lands.
2. Boot is the same four fetches, then `readLastRead`, then `applyBoot`
   (`lifecycle.ts:199-209`), then folders/drafts/polling (`:225-237`), then `connectXmpp`.
3. Token → connect → `online` → `joinGroups`, also **sequentially over every group row**
   (`apps/mobile/src/store/effects/groups.ts:202-221`), then `groupsJoined`, then the open
   page. So the phone pays exactly the same join tax as web, plus the chat-list file read.
4. The phone's advantage is only that the **cached messages paint first**: the list renders
   messages whenever it has rows, regardless of `historyLoad`
   (`apps/mobile/src/components/chat/message-list.tsx:128,289`;
   `apps/mobile/src/store/list-views.ts:58-61`). The MAM page then replaces them in place
   (`packages/client-core/src/store/history.ts:197-216`).

## 2. The resume timeline (phone)

1. `AppState` → `active` calls `coreReconnect` (`apps/mobile/src/store/effects/lifecycle.ts:172-175`).
2. `reconnect` waits for an in-flight boot, or wakes the core and then sets `online` itself
   (`packages/client-core/src/store/lifecycle.ts:142-186`); `wake()` runs a normal reconnect
   and resumes the stream when ejabberd kept it
   (`packages/xmpp-core/src/core-effect/suspend.ts:91-107`).
3. **Is the status set to `connecting`?** Not by the store: `reconnect` never writes
   `connecting`/`reconnecting`; it writes `online` on success (`:173`) and `offline` on
   failure (`:184`). The library's own reconnect reports `reconnecting`
   (`core-effect/lifecycle.ts:236-238,262`) after `suspend()` put the status at `offline`
   (`suspend.ts:82`), so a suspended resume is `offline → reconnecting → online` for as long
   as the socket takes. An away shorter than the 10 s grace throws nothing away — and if the
   socket died during that window, `connect()` returns immediately because the status still
   says `online` (`core-effect/lifecycle.ts:250`), so nothing notices until the keepalive does.
4. **Every room is rejoined on resume**, suspended or merely backgrounded
   (`lifecycle.ts:170-179`), sequentially again, before `flushPending`.
5. Missed messages while suspended are **not** fetched; only a pending open chat is
   (`lifecycle.ts:181`, `online.ts:18-21`). The stream carries what it can.
6. **Focus loaders** — every `useFocusEffect` that sets a loading state, so returning to the
   screen blanks it or spins: `app/me.tsx:69,86` (T-1899), `app/(tabs)/settings.tsx:155,153`
   (T-1899), `app/(tabs)/ais.tsx:83,102`, `app/explore.tsx:125,129`,
   `app/settings/contacts.tsx:61,86`, `app/settings/integrations.tsx:84,88`,
   `app/settings/blocked.tsx:49,74`, `app/settings/requests.tsx:57,83`,
   `app/settings/notifications.tsx:123,162`, `app/settings/devices.tsx:127,150`,
   `app/u/[handle].tsx:110,116`, `components/chat/request-rows.tsx:46-54`. The chat screen
   itself refetches the **open chat's first history page on every focus** (returning from
   Group info, the profile…) — `use-chat-screen.ts:98-110` → `effects/history.ts:283-312` →
   `openHistory`, which has no "already loaded" guard (`history.ts:168-179`).

## 3. Cache gaps

### Web: a message cache like the phone's

Today only the chat list is cached (`chatListCache.ts:9-11`, 200 chats, no bodies). Proposal:

- **Storage:** new `apps/web/src/store/messageCache.ts`, the twin of
  `apps/mobile/src/store/offline-cache.ts`, in `localStorage` under `zilar:messages`, versioned
  (`chatListCache.ts:9-10` is the shape to copy), payload `{ version, userId, messages:
  Record<chatId, encoded UiMessage[]> }`.
- **Size:** the newest **50 messages of the 30 most recent chats** (the phone's numbers,
  `offline-cache.ts:23-24`), plus a byte cap (~1.5 MB) that drops the oldest chats first —
  a browser gives us ~5 MB and the cache must never be able to break the page
  (`chatListCache.ts:140-142` already swallows quota errors).
- **Read:** in `prepareStart`, after the list paint (`effects/lifecycle.ts:124-141`), only when
  the payload's `userId` matches the painted user (`chatListCache.ts:75-77`); on a mismatch
  drop it. `MessageList` already renders rows when it has any (`MessageList.tsx:156-163`) and
  `openHistory` merges the page over them (`history.ts:197-216`), so no view changes.
- **Write:** throttled (~2 s, like `OFFLINE_CACHE_WRITE_DELAY_MS`, `offline-cache.ts:27`) on
  store changes for the recent chats, plus on `pagehide` (`effects/lifecycle.ts:136-139`).
- **Never stored:** the XMPP token or any credential, cookies, media bytes (only the URLs the
  rows already carry), `sending`/`failed`/`local-*` messages,
  `blob:`/`data:` preview URLs — the same rules as the phone
  (`offline-cache.ts:100-104,107-124`).
- **Sign-out clears it:** add it to `resetUserState` (`effects/lifecycle.ts:49-103`), which
  runs on both sign-out and `switchUser`.

### Phone: does `offline-cache.ts` cover topics and card messages?

- **Topics: yes, in principle.** Topic rows are ordinary chat rows
  (`packages/client-core/src/store/chat-rows.ts:129-179`) and the snapshot keeps the first 30
  rows of `chats` (`offline-cache.ts:183-199`, `offline-cache-sync.ts:40-46`). **Gap:** 30 is
  small for a list where every group contributes one row per topic, and the slice is taken in
  display order (pinned first, `effects/lifecycle.ts:205`), so a pinned old group's topics can
  crowd out the topic the user is about to open. A chat opened from a notification that sits
  outside the 30 is not cached at all.
- **Card messages: yes.** The message schema is `StructWithRest` (`offline-cache.ts:65-76`) and
  encode only strips local-only upload fields (`:127-142`), so `payload`/`card` blocks and
  attachments survive intact. Media **bytes** are not cached, but card tiles already reserve
  their height (`apps/mobile/src/components/chat/blocks/images-block.tsx:33,111`), so the card
  paints at full size and the photos fill in without moving anything.
- **Read on a cold open of a topic: yes.** `hydrateOfflineCache` fills `messagesByChat` before
  boot (`effects/lifecycle.ts:107-126`) and the list prefers any rows over the loading state
  (`message-list.tsx:289`, `list-views.ts:58-61`). The page then replaces them in place. The
  only hole is the async hydrate (secure store + file) racing a notification deep link.
- **Not covered:** per-chat cursors (so "older" waits for the page — acceptable), pins, and the
  contact-request rows.

## 4. The jump sweep

Skipping T-1898 (connection line) and T-1899 (Settings profile spinner).

| # | Where | What moves | Fix |
|---|-------|-----------|-----|
| W1 | Pinned banner above the thread: `apps/web/src/components/PinnedBanner.tsx:56-89`, mounted at `routes/ChatView.tsx:256`, pins load on mount `:234-236` | The whole thread drops ~48 px when the pins answer | Cache the pin snapshot with the chat list and paint it with the first frame; when unknown, reserve the banner's height |
| W2 | Contact-request rows at the top of the chat list: `components/chatList/ChatListBody.tsx:110`, `RequestRows.tsx:151-160` | Up to 3 rows appear above every chat after the requests load | Same: cache the pending request rows/count with the chat list (or a fixed-height placeholder while unknown) |
| W3 | Chat-list "Couldn't load chats / Retrying…" row: `ChatListBody.tsx:82-105` | Inserts a row above the list on a background refresh failure | Show it as an overlay/toast, or reserve the row only when `chats` is empty |
| W4 | Message list: `components/MessageList.tsx:156-163`, skeleton `Skeleton.tsx:37-58` | Skeleton (empty until 300 ms) → 50 bubbles → scroll settles on the newest | Covered by the message cache (§3); the skeleton then only shows for a chat never opened on this device |
| W5 | Topic people line: `components/topic/TopicPeopleLine.tsx:98-123,159-167` | Orb avatars and names swap to real pictures when the group detail lands (count itself is right) | Paint the cached group detail's avatars (page cache) or keep the orbs until the images decode; no layout height changes |
| W6 | AI status line above the composer: `components/topic/AiStatusLine.tsx:47-50`, mounted at `routes/ChatView.tsx:297` | A row appears/disappears when an AI starts or finishes, resizing the thread | Reserve the row's height for topics with any AI activity (fixed slot, text fades in) |
| P1 | Pinned banner: `apps/mobile/src/components/chat/pinned-banner.tsx:50-53`, mounted at `app/chat/[id].tsx:104,144,182` | Thread drops when pins arrive on open | Same as W1, using the offline cache |
| P2 | Contact requests as `ListHeaderComponent`: `components/chat/chat-list-page.tsx:81`, `request-rows.tsx:46-54` | Rows pop in above the list after the focus fetch | Same as W2 (cache the rows with the chat list) |
| P3 | Archived bar at the bottom: `chat-list-page.tsx:121-135` | Grows out of the bottom edge once archived chats are known | Cache archived rows with the chat list, or reserve the row when the cache says there are archived chats |
| P4 | Message list: `components/chat/message-list.tsx:289-303`, skeleton `components/chat/skeleton.tsx:105-135` | Skeleton → cached messages → page: only the first shows for a chat outside the 30-row window | Widen the cache to 50 chats and always include the active chat (§3) |
| P5 | Chat screen before the chats load: `app/chat/[id].tsx:33-42` | Whole-screen skeleton swaps for the real header + thread on a cold deep link | Start the offline-cache and list-file reads in the root bootstrap behind the splash (`app/_layout.tsx:112-121`) and keep it up for their (bounded) wait, so the first chat frame already has data |
| P6 | AI status line: `components/chat/ai-status-line.tsx:26-28`, mounted at `components/chat/chat-composer-dock.tsx:249` | Composer dock grows a row when an AI starts | Same as W6 |
| P7 | Focus loaders listed in §2.6 | Screens blank/spin on every return | Keep the last data and only show the spinner when there is none |

Not a jump, checked and fine: card images reserve their height
(`apps/web/src/components/message/blocks/ImagesBlock.tsx:40-59`,
`apps/mobile/src/components/chat/blocks/images-block.tsx:33,111`); photo bubbles reserve the
aspect ratio (`apps/web/src/components/ImageMessage.tsx:46,60`,
`apps/mobile/src/components/chat/media-bubble.tsx:276-283`); the unread divider is inside an
anchored list (`apps/web/src/components/useMessageListScroll.ts:52-72`); the version banner is
`fixed` (`apps/web/src/components/ClientVersionBanner.tsx:19-22`); folder tabs always render
the "All chats" tab (`apps/web/src/components/FolderTabs.tsx:18-22`,
`apps/web/src/components/ChatList.tsx:162`); a refresh reorders rows by recency and pins by
design (`apps/web/src/store/effects/history.ts:228-233`) and the cached list is written in
that order (`chatListCache.ts:113-143`).

## 5. Ordered tasks

Largest felt win first. Each is ≤ 45 worker minutes; every task lists both apps' twins where
they exist. **No new dependency in any of these.**

1. **Web: message cache** (45). `apps/web/src/store/messageCache.ts` (new),
   `apps/web/src/store/effects/lifecycle.ts` (prepareStart, pagehide, resetUserState),
   `apps/web/src/store/realStore.ts` if a test seam is needed; a test beside the module like
   `chatListCache`'s. §3.
2. **History waits for its own room, not all rooms** (45). `packages/client-core/src/store/
   {history-core,history,connect}.ts` (per-chat joined set instead of one `groupsJoined`;
   `flushPending` per ready room), `apps/web/src/store/effects/groupMembers.ts`,
   `apps/mobile/src/store/effects/{groups,history-ctx,runtime,locals}.ts`, both bindings of
   `groupsJoined` (`apps/web/src/store/effects/{locals,storeContext}.ts`,
   `apps/mobile/src/store/effects/{lifecycle,locals}.ts:288-293,88`). Joins may then run at
   concurrency 4 with the open room first.
   Tests: `packages/client-core/src/store/history.test.ts`,
   `apps/web/src/store/realStore.history.test.tsx`,
   `apps/mobile/src/store/real-store.history.test.ts`.
3. **Token in parallel with the boot** (20). `packages/client-core/src/store/lifecycle.ts`
   (fork `api.getXmppToken()` beside the four fetches), `connect.ts` (accept the prefetched
   token; keep the retry's fresh token). §1 step 4.
4. **Previews after the open chat** (20). `packages/client-core/src/store/previews.ts` and
   `connect.ts:174`: skip the active chat and start the preview pass only once its first page
   settled (or at concurrency 2 while a page is in flight).
5. **Phone: cache 50 chats and always the open one** (30).
   `apps/mobile/src/store/offline-cache.ts` (`MAX_CACHED_CHATS`, `offlineSnapshot` takes the
   active chat id), `offline-cache-sync.ts`, `offline-cache.test.ts`.
6. **Pins paint from the cache** (40): web `store/chatListCache.ts` + `components/PinnedBanner.tsx`
   + `routes/ChatView.tsx`; phone `store/offline-cache.ts` + `components/chat/pinned-banner.tsx`
   + `app/chat/[id].tsx`, both cache tests. Fixes W1/P1.
7. **Contact-request rows paint from the cache** (30): web `store/chatListCache.ts`,
   `components/chatList/RequestRows.tsx`; phone `lib/chat-list-cache.ts`,
   `components/chat/request-rows.tsx`. Fixes W2/P2.
8. **AI status line stops resizing the thread** (30): web
   `components/topic/AiStatusLine.tsx` + `routes/ChatView.tsx`; phone
   `components/chat/ai-status-line.tsx` + `components/chat/chat-composer-dock.tsx`. Fixes W6/P6.
9. **Focus loaders keep the content they have** (45): the screens in §2.6 except the two
   T-1899 ones (`me.tsx`, `(tabs)/settings.tsx`). Pattern: room for `status === 'loading'`
   only when there is no data, the way the chat list already keeps its rows
   (`apps/mobile/src/store/list-views.ts:41-52`). Fixes P7.
10. **Resume without a full rejoin** (30). `packages/client-core/src/store/lifecycle.ts`
    (`reconnect`: join only the open room and rooms joined since the last connect),
    `apps/mobile/src/store/effects/lifecycle.ts` (the hooks it passes). Also drop the
    per-focus history refetch: `apps/mobile/src/components/chat/use-chat-screen.ts` +
    `packages/client-core/src/store/history.ts` (skip when `historyState` is `ready`, keep
    `retryHistory` forcing). §2.
