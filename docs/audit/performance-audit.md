# Performance, battery and scalability audit (2026-10-11)

Scope: apps/web, apps/mobile, apps/server, packages/client-core, packages/xmpp-core,
deploy/ejabberd. Static reading only: no load test, no service was run. Each finding
is marked **confirmed by code** (the behaviour follows from the cited lines) or
**suspected** (plausible, needs the measurement in section 3). Line numbers are from
main at 54d08c1a6.

Severity: P1 = user-visible slowness, battery drain or a scaling cliff on the one
small Coolify box soon; P2 = waste worth fixing; P3 = minor.

## 1. Summary (top 10, P1 first)

| Id | Sev | Platform | One line |
| --- | --- | --- | --- |
| PERF-1 | P1 | web, mobile, ejabberd | One MAM query per chat, unbounded concurrency, at every connect and reconnect, plus 2 store updates per chat |
| PERF-2 | P1 | mobile | Message FlatList renders every loaded message at once (`initialNumToRender = entries.length`) and the row is not memoised |
| PERF-3 | P1 | web | Message list is a plain `items.map` (no windowing) and `messagesByChat` is never pruned: DOM and memory grow with every page and every chat opened |
| PERF-4 | P1 | server | `GET /api/chats` does ~8-10 queries per group (topics N+1) and every client polls it every 60 s plus on focus |
| PERF-5 | P1 | server | Each push publish IQ (one per device per message) runs the allowed-archives fan-out, up to 3 archive scans with 300 ms sleeps and 2-4 queries per candidate row |
| PERF-6 | P1 | mobile | XMPP socket stays open in background with a 30 s client ping and a 60 s server ping: a radio wake every 30 s |
| PERF-7 | P2 | web, mobile | Every presence or MUC occupant stanza rebuilds the whole `chats` array, re-rendering every `state.chats` subscriber |
| PERF-8 | P2 | server | Search computes `to_tsvector` over up to 5 000 rows per query with no index, plus a second `xml LIKE` scan for edits |
| PERF-9 | P2 | server | Drafts SSE: one long-lived HTTP stream with a 25 s heartbeat per web tab and per foregrounded phone, AI chat or not |
| PERF-10 | P2 | ejabberd | `mod_push_keepalive` with no `resume_timeout` keeps hibernated sessions (and their ack queues) for the 72 h default |

Counts: P1 x 6, P2 x 8, P3 x 4 (18 findings).

## 2. Findings by area

### 2.1 Clients: store updates and rendering

**PERF-2 (P1, mobile, confirmed by code).** `apps/mobile/src/components/chat/message-list.tsx:219`
sets `initialNumToRender={Math.max(entries.length, 1)}`, so the FlatList mounts every
loaded entry on first render and loses its windowing on the first paint; no
`windowSize`, `maxToRenderPerBatch` or `removeClippedSubviews` (lines 214-275). The
row, `MessageListRow` at `apps/mobile/src/components/chat/message-list-row.tsx:52`, is
a plain function (only `MessageBubble` at `message-bubble.tsx:381` is `memo`), and
`renderItem` at `message-list.tsx:252-275` is an inline arrow that passes ~20 props,
so every store tick that touches the list (typing, presence, a draft frame every
150 ms) re-runs the row for every entry. Cost: after 4 pages of history (200
messages) each draft frame re-renders ~200 rows. Smallest fix: `initialNumToRender`
to ~20 with `windowSize={7}` and `maintainVisibleContentPosition` (the scroll hooks in
`use-message-list-scroll.ts` already handle `onScrollToIndexFailed`), wrap
`MessageListRow` in `memo`. Files: `message-list.tsx`, `message-list-row.tsx`.

**PERF-3 (P1, web, confirmed by code).** `apps/web/src/components/MessageList.tsx:284-330`
renders `items.map(...)` into one flex column: no virtualisation. Pages are 50
messages (`packages/client-core/src/store/history.ts:12`) and `loadOlderPage`
(`history.ts:110-133`) only appends. Nothing ever removes a chat's messages:
`messagesByChat` is written in `incoming.ts:76-78`, `ledger-mutators.ts:38-60`,
`ledger-edits.ts:244-276`, `ledger-reactions.ts:62` and never deleted outside
sign-out (`lifecycle.ts:123-124`, `ledger.ts:72-76`). A day of browsing 30 chats
keeps 30 arrays plus their DOM when the chat is open. Smallest fix: cap each chat
at e.g. 300 messages when it is not the active chat (one helper in
`packages/client-core/src/store/rows.ts`, called from `openChat`), and on web
render only the last ~150 items with a "load more" sentinel; a windowing library
is a bigger task. Files: `MessageList.tsx` (346 lines, so the pruning goes in
client-core), `packages/client-core/src/store/history.ts`.

**PERF-7 (P2, web+mobile, confirmed by code).** `handlePresence` and
`handleOccupants` (`packages/client-core/src/store/incoming.ts:225-255`) do
`chats: state.chats.map(...)`, a new array on every event, and xmpp-core emits
`occupants` on every MUC presence (`packages/xmpp-core/src/core-effect/presence.ts:48`),
so joining a 30-member room fires 30 array rebuilds. Subscribers of the whole
array: the mobile tab bar `apps/mobile/src/app/(tabs)/_layout.tsx:30`, the home
list `(tabs)/index.tsx:30`, `forward-sheet.tsx:71`, `use-chat-actions.ts:24`,
`message-search-list.tsx:83`, `channel-screen.tsx:63`, `group-list-item.tsx:54`.
Web is better: `ChatList.tsx:35` goes through the cached `createRowsSelector`
(`apps/web/src/components/chatList/rowsSelector.ts:23-48`), which still recomputes
on every new array. Smallest fix: in `handlePresence`/`handleOccupants` return
`state` unchanged when the matched chat's `online`/`onlineCount` did not change
(already the pattern in `polling.ts:170-176`); on mobile the tab badge should
select the unread sum (a number), not the array.

**PERF-13 (P3, web+mobile, confirmed by code).** The id ledger stores every
alias, server id, origin id, author and base text twice (`ledger-ids.ts:120-169`),
cleared only by `reset()` (`ledger.ts:72-76`). Growth is linear in messages seen;
~200 bytes per message is fine for weeks but it is the one map that never shrinks.
Fix: prune with PERF-3 (drop ids of messages pruned from `messagesByChat`).

**OK, noted:** `useStoreSelector` is `useSyncExternalStore` with `Object.is`
(`packages/client-core/src/atom-store.ts:82-88`); no selector in either app
builds a new object or array inline (grepped for `?? []`, `.filter(`, `.map(`,
`({` inside `useChatStore(`); `MessageBubble`, `ChatListItem`, `TopicRow` and
`MarkdownText` are memoised on web; `finishedTurns` is capped at 50
(`rows.ts:6`, `polling.ts:137-150`).

### 2.2 Clients: history, polling, keepalives, startup

**PERF-1 (P1, confirmed by code).** After every successful connect,
`packages/client-core/src/store/lifecycle.ts:366-369` runs `loadPreview` for
every chat with `concurrency: 'unbounded'`. `loadPreview` (`history.ts:157-204`)
sends one MAM query (`max: 1`, `history.ts:11`) per chat and then calls
`ctx.set` twice (lines 177-185 and 192-194), each notifying every listener
(`atom-store.ts:62-63`). Cost: with 40 chats, 40 MAM IQs in one burst at every
connect, every reconnect (`connectXmpp` runs again after each retry,
`lifecycle.ts:257-265`) and on every phone resume that lost the socket, plus 80
store updates that each re-render the chat list; on ejabberd 40 archive queries
per user per connect, concentrated at a deploy restart when every client
reconnects at once. The query is wasted whenever `lastMessage` is already known
(line 181 only fills an empty one). Smallest fix: skip chats whose `lastMessage`
and cursor are already known (web paints them from `chatListCache.ts`), run the
rest with `concurrency: 4`, and batch the two `ctx.set` into one. Files:
`history.ts`, `lifecycle.ts` (371 lines: the skip test goes in `history.ts`).

**PERF-6 (P1, mobile, confirmed by code for the timers; battery cost suspected).**
The client pings after 30 s without a received stanza and waits 15 s
(`packages/xmpp-core/src/core-effect/config.ts:39-40`, `lifecycle.ts:218-256`);
the server pings every 60 s (`deploy/ejabberd/ejabberd.yml:260-263`). Each server
ping resets the idle timer, so the steady state is a stanza every 30 s in each
direction. The mobile visibility port only reacts to `active`
(`apps/mobile/src/store/effects/ports.ts:104-113`); nothing disconnects or
lengthens the ping when the app goes to background, and the native push path
already exists for wake-ups (`apps/mobile/src/lib/push/background.ts:139`,
ejabberd `mod_push` lines 270-275). Cost: a radio wake every 30 s while Android
lets the JS timers run (Doze eventually stops them, then the socket dies without
a clean close and `mod_stream_mgmt` queues until `resume_timeout`). Smallest fix:
on `background`, raise `keepaliveMs` to 0 (disabled) or 5 min via
`XmppCoreOptions`, or disconnect after 30 s in background and rely on FCM; raise
`mod_ping.ping_interval` to 180. Files: `apps/mobile/src/store/effects/ports.ts`,
`packages/client-core/src/store/lifecycle.ts`, `deploy/ejabberd/ejabberd.yml`.

**PERF-11 (P2, web+mobile, confirmed by code).** Two 60 s polls while visible
plus both on every focus: `/api/chats` and the open chat's pins
(`packages/client-core/src/store/polling.ts:16-17, 85-96, 104-119`), and
`scheduleChatsRefresh` on every roster push and invitation
(`lifecycle.ts:293-295`). On a phone every return to the app costs a full chat
list (see PERF-4 for the server side) and a pins GET. Cost: with 500 daily
active users a steady ~8 `/api/chats` per second. Smallest fix: poll at 5 min
when the XMPP socket is `online` (roster and invited pushes already trigger a
refresh), keep 60 s only when `offline`; pins only on focus and on the chat's
own messages. File: `polling.ts`.

**PERF-12 (P2, mobile, confirmed by code).** Cold start: the root gates on five
fonts (`apps/mobile/src/app/_layout.tsx:56-77`, `return null` until loaded), then
the store boots with no chat list cache (`apps/mobile/src/store/effects/lifecycle.ts:131`
`saveChatList: () => {}`), so the first list paint waits for `/api/chats` and the
previews wait for the XMPP connect plus PERF-1. Web paints the cached list first
(`apps/web/src/store/chatListCache.ts`). Smallest fix: port `chatListCache` to
mobile behind the existing `saveChatList` hook using AsyncStorage. Files:
`apps/mobile/src/store/effects/lifecycle.ts`, new `apps/mobile/src/store/chat-list-cache.ts`.

**PERF-14 (P3, web, suspected; measure: `vite build` size report).** Routes and
`MarkdownText` are lazy (`apps/web/src/routes/AppRoutes.tsx:21-40`,
`MessageTextBody.tsx:10`), but `vite.config.ts` has no `manualChunks`, 142 files
import from `effect` and the main chunk also carries `better-auth`, `radix-ui`
and `lucide-react`. Measure before acting; a `manualChunks` split of
`effect`/`react`/`radix` is a 10-line change in `apps/web/vite.config.ts`.

**PERF-15 (P3, mobile, confirmed by code).** Images go through `expo-image`
(`message-bubble-content.tsx:143`, `gif-cells.tsx:50`) which caches on disk by
default; no `recyclingKey` is set on list images, so a recycled row briefly shows
the previous image. Not a perf bug, noted for the FlatList work in PERF-2.

### 2.3 Server

**PERF-4 (P1, confirmed by code).** `apps/server/src/chats/api.ts:154-163`: for
every group entry, `visibleTopics` (1 query for the topics, 1 for membership and
1 for private topic membership, `apps/server/src/topics/access.ts:177-200`) then
`toTopicViews` (`loadTopicViewParts`, `topics/views.ts:164-207`: ~7 queries in a
`Promise.all`). Cost: a user in 10 groups pays ~5 + 10 x (3 + 7) = ~105 queries
per `/api/chats`, and PERF-11 asks for it every 60 s per visible client. This is
the first scaling cliff on one Postgres. Smallest fix: one `visibleTopics` for
all group ids (`WHERE group_id = ANY(...)`) and one `toTopicViews` call over all
rows (its loader already takes `rows[]` and uses `sql.in(groupIds)`), i.e. move
the loop into a single batched call. Files: `chats/api.ts`, `topics/access.ts`
(a `visibleTopicsForGroups` variant), `topics/views.ts`.

**PERF-5 (P1, confirmed by code).** Per publish IQ, `newestMessageForUserEffect`
(`apps/server/src/push/archive-scan.ts:52-130`): `allowedArchives`
(`search/service.ts:86-127`: 3 queries plus one `visibleTopics` per group, the
same N+1 as PERF-4), then up to 3 rounds (`ARCHIVE_LOOKUP_ATTEMPTS = 3`,
line 11) of `readNewestCandidates` (`LIMIT 25`, line 174) with 300 ms sleeps,
and for each unseen fresh row `resolveCandidate` runs 2-4 queries
(`candidates.ts:53-78` topic + `canSeeTopic` + group, `148-170` two `chat_prefs`
reads). ejabberd publishes one IQ per device per message, so a 20-member group
with 1.5 devices each costs ~30 scans x (~15 + 25 x 3) queries per message.
Every scan is serialised per node (`component.ts:47-67`), not per user. Smallest
fix: cache `allowedArchives` per user for 60 s in a `Map` with a size cap, batch
`resolveCandidate` lookups (one `topics WHERE room_localpart = ANY`, one
`chat_prefs WHERE user_id = $1 AND chat_jid = ANY`), and skip the 300 ms retry
when the trigger's row was already seen. Files: `push/archive-scan.ts`,
`push/candidates.ts`, `search/service.ts`. Tests: the message pipeline tests in
`push/candidates.test.ts` and `push/delivery.test.ts` cover this area.

**PERF-8 (P2, confirmed by code; cost suspected, measure: EXPLAIN ANALYZE).**
`apps/server/src/search/archive-query.ts:53-66` filters with
`to_tsvector('simple', translate(lower(txt), ...)) @@ to_tsquery(...)` over a
12-month window (`routes.ts:33`) capped at 5 000 rows (`routes.ts:34`); the
tsvector is computed per row on every search because the ejabberd `archive`
table has no expression index for it. The edits query (`archive-query.ts:97`)
adds `xml LIKE '%urn:xmpp:message-correct:0%'` over the same scope, a second
full read of the rows. Only the 30/min rate limit (`routes.ts:27-28`) bounds it.
Smallest fix: a hand-written migration (per `docs/audit` rules, run by
`migrateSql`) creating a GIN index on the same expression over `archive`, and
drop the LIKE scan in favour of `txt IS NULL AND xml LIKE ...` limited to the
first pass's timestamps. Files: a new `apps/server/drizzle/0048_archive_search_idx.sql`,
`search/archive-query.ts`.

**PERF-9 (P2, confirmed by code).** `apps/server/src/drafts/api.ts:64-100`
streams `Stream.fromEffectRepeat` with a 25 s heartbeat (line 24) per
subscriber; both clients open it unconditionally once per store
(`packages/client-core/src/store/polling.ts:216-236`; web `EventSource` in
`apps/web/src/lib/drafts.ts:47`, mobile XHR in `apps/mobile/src/lib/drafts.ts:149`,
which at least follows `AppState`). Cost: 2 long-lived connections per client
(WS + SSE) on the one Node process and one Coolify proxy; a heartbeat write every
25 s to users who have no AI. Smallest fix: open the stream only when
`state.chats` has an `isAI` chat (and close it when none is left), in
`startDraftStream`. File: `polling.ts`.

**PERF-16 (P2, suspected; measure: EXPLAIN on `archive`).** The push candidate
query (`archive-scan.ts:174`) and search scope (`archive-query.ts:58-62`) use
`username = ANY(rooms) OR (username = own AND bare_peer = ANY(peers)) ORDER BY
timestamp DESC LIMIT n`. With ejabberd's stock `(username, timestamp)` index the
planner must bitmap-OR one range per room and sort; for a user in 30 rooms that
is 31 index probes per IQ. Verify with `EXPLAIN (ANALYZE, BUFFERS)` on the live
archive; if it sorts, split into one query per scope side with `LIMIT 25` each.

**PERF-17 (P3, confirmed by code).** `recentlyNotified` is capped at 500 ids per
node (`push/delivery.ts:252-263`) but nodes are never removed when a device
unsubscribes; growth is bounded by devices ever seen x 500 ids (~50 KB each), so
only a concern after many thousands of devices. `component.ts:62-67` drops
finished chains, `rate-limit.ts:36-49` prunes, `auth.ts:68` is per user: fine.

**Checked and fine:** app-table hot lookups all have an index or unique
constraint (`topics.room_localpart` 0018:27, `groups.room_localpart` 0003:24,
`push_subscriptions.node` 0031:18, `chat_prefs(user_id, chat_jid)` PK 0024:8,
`group_members` PK + `user_id` 0046:1, `contacts` PK 0003:7 + `contact_user_id`
0046:7, `pinned_messages.chat_jid` 0025:14). Sessions are served from the 5 min
cookie cache (`auth.ts:20, 92`). The push save takes a per-user advisory lock
inside one transaction (`push/store.ts:86`): short, no contention expected. No
synchronous KDF on a hot path: `createHash` and `timingSafeEqual` only
(`invite-links/tokens.ts:74-91`, `actions/canonical.ts:92`). `/api/chats` JSON
carries no `lastMessage` (clients fetch it via MAM, PERF-1), so its size is
dominated by topics per group; it is the query count, not the bytes, that hurts.

### 2.4 ejabberd (`deploy/ejabberd/ejabberd.yml`)

**PERF-10 (P2, confirmed by config; memory cost suspected).** `mod_push_keepalive: {}`
(line 275) extends every pushable session's stream-management `resume_timeout`
to its default of 72 h; `mod_stream_mgmt` (lines 252-253) only sets
`resend_on_timeout` and keeps the defaults `queue_type: ram` and
`max_ack_queue: 5000`. Each phone that drops its socket (PERF-6) leaves a
hibernated c2s process with up to 5 000 queued stanzas for three days. Fix: set
`mod_push_keepalive: resume_timeout: 3600` (1 h is plenty with FCM wakes) and
`mod_stream_mgmt: max_ack_queue: 1000`.

**PERF-18 (P3, confirmed by config).** `mod_mam` (lines 229-232) has
`default: always` with no `cache_size`/`cache_life_time`, and `mod_ping` sends a
ping every 60 s to every session (line 262). Both are defaults; the ping interval
is covered in PERF-6. `max_stanza_size: 262144` (line 86) is fine for text
chats.

## 3. Measurements to take (cheap)

1. **Boot MAM burst (PERF-1):** in the web console with `localStorage.debug` for
   xmpp-core, count `<iq type='set'><query xmlns='urn:xmpp:mam:2'>` sent in the
   first 5 s after login; expect one per chat. On ejabberd: `ejabberdctl
   stats` before/after a reconnect storm, or `pg_stat_statements` top by calls
   for the `archive` select.
2. **Mobile render cost (PERF-2, PERF-7):** React DevTools profiler on the
   emulator with "Highlight updates"; open a 200-message chat, trigger one typing
   event, count re-rendered rows (target: 0-2, now all).
3. **Web DOM growth (PERF-3):** `document.querySelectorAll('[data-message-id]').length`
   (or the bubble class) after scrolling 5 pages; `performance.memory.usedJSHeapSize`
   after opening 20 chats.
4. **`/api/chats` query count (PERF-4):** enable `log_min_duration_statement = 0`
   for 60 s on the Coolify Postgres, hit `/api/chats` once, count statements in
   the log; also `pg_stat_statements` ordered by `calls`.
5. **Push cost (PERF-5):** server log lines per publish IQ with timing (the
   component already logs warnings); count queries per IQ as in 4 while one
   group message is sent to a 5-member group with phones.
6. **Battery (PERF-6):** Android `adb shell dumpsys batterystats --reset`, leave
   the app in background 30 min, `dumpsys batterystats | grep -A5 zilar` for
   wakelocks and "Mobile radio active"; compare with the socket closed.
7. **Search (PERF-8, PERF-16):** `EXPLAIN (ANALYZE, BUFFERS)` of the two queries
   from `archive-query.ts` and the one from `archive-scan.ts:174` with a real
   user's scope arrays, on the live DB read replica role.
8. **Connections (PERF-9):** `ss -tn state established | wc -l` on the server
   with N clients open; expect 2N + proxies.
9. **Bundle (PERF-14):** `pnpm --filter @zilar/web build` and read the chunk
   sizes Vite prints; flag any chunk over 500 kB gzipped.
10. **ejabberd memory (PERF-10):** `ejabberdctl connected_users_number` versus
    `ejabberdctl stats processes` after a day; a large gap is hibernated sessions.

## 4. Fix plan (ordered by impact, then size)

1. **T-A: batch `/api/chats` topics (PERF-4).** `topics/access.ts` gains
   `visibleTopicsForGroups(db, groupIds, userId)`; `chats/api.ts` calls it once
   and `toTopicViews` once. Small, server only, no new tests (existing contract
   tests cover the shape).
2. **T-B: skip known previews, bound the boot MAM burst (PERF-1).** In
   `packages/client-core/src/store/history.ts`: return early when
   `chat.lastMessage !== undefined && ctx.cursors[chat.id] !== undefined`; one
   `ctx.set` instead of two; `lifecycle.ts:366` `concurrency: 4`. One test in
   `history.test.ts` (message pipeline). Small.
3. **T-C: mobile list windowing and memo (PERF-2, PERF-15).**
   `initialNumToRender` 20, `windowSize` 7, `maintainVisibleContentPosition`,
   `memo(MessageListRow)`, `recyclingKey` on list images. Mobile only, check on
   the emulator with the profiler. Medium.
4. **T-D: cheap presence updates and a numeric badge selector (PERF-7).**
   `incoming.ts` returns `state` when nothing changed; `(tabs)/_layout.tsx`
   selects the unread sum. Small, both apps.
5. **T-E: push scan batching and allowed-archives cache (PERF-5).** Cache in
   `push/service.ts` deps, batched lookups in `candidates.ts`. Medium; message
   pipeline tests in `candidates.test.ts` updated.
6. **T-F: background keepalive policy and ejabberd timers (PERF-6, PERF-10,
   PERF-18).** Mobile ports pass `keepaliveMs: 0` while backgrounded and
   reconnect on `active`; `ejabberd.yml` `ping_interval: 180`,
   `mod_push_keepalive.resume_timeout: 3600`, `max_ack_queue: 1000`. Small
   config, needs a live check on the emulator (resume must still reconnect).
7. **T-G: prune `messagesByChat` and the ledger for inactive chats, web list
   cap (PERF-3, PERF-13).** `rows.ts` helper + call in `openChat`; web renders the
   tail with a sentinel. Medium.
8. **T-H: slower polls when online, drafts stream only with AIs (PERF-11,
   PERF-9).** `polling.ts` interval by status; `startDraftStream` gated on an AI
   chat. Small; `polling.test.ts` adjusted.

Later, after measurement 7: the `archive` GIN index migration and the edits-scan
rewrite (PERF-8, PERF-16); after measurement 9: `manualChunks` (PERF-14); after
measurement 1 on the box: the mobile chat list cache (PERF-12).
