# Chat scroll performance audit (T-1997, 2026-10-18)

Scope: why the phone chat scrolls janky on Android (0.2.12), why older messages load
slowly, and the "several small scrolls, then a jump, then 4 fps" effect Julio saw when
scrolling up. Static reading only: no emulator run, no profiler, no source change.
Line numbers are from `1583e487b`.

Every finding is marked **confirmed by code** (the behaviour follows from the cited
lines) or **suspected** (plausible, needs the measurement in section 5). Cost estimates
are educated guesses for a release build on a mid-range Android phone or the emulator.
They are **not measured**; the lead's baseline in section 5 replaces them.

Stack: Expo `~57.0.25`, React Native `0.86.3` (new architecture), Reanimated `4.5.1`,
Gesture Handler `~2.32.0`, TrueSheet `3.11.16` (`apps/mobile/package.json:19,33,64,67,69`).
No FlashList or LegendList is installed. Earlier list work: PERF-2 in
`docs/audit/performance-audit.md` (rendering every row, unmemoised row) is fixed; this
audit starts from the current tuned `FlatList`.

---

## 1. Ranked causes

Impact: what Julio feels. Effort: S = under half a day, M = about a day, L = several days.

| # | Cause | Impact | Effort | Where |
| --- | --- | --- | --- | --- |
| C1 | Older history is requested only half a screen before the end, with no prefetch, so a fling hits the end of the list before the page arrives | Very high (the "slow loading" and the "small scrolls") | S | `message-list.tsx:346-351`, `VirtualizedList.js:1527-1590` |
| C2 | Every row mounts its own message menu: two native TrueSheet views, 4 store subscriptions, ~14 closures | High (mount cost on every row that scrolls in) | M | `message-bubble.tsx:339-364`, `message-bubble-actions.tsx:82-197`, `message-actions-sheet.tsx:226-354`, `apps/mobile/src/components/ui/action-sheet.tsx:85-130` |
| C3 | Every row mounts a full gesture stack: ReanimatedSwipeable (9 shared values, 4 animated styles, Tap + Pan, an eagerly rendered SVG action) plus a second Tap detector | High (mount cost, UI-thread work) | M | `swipe-to-reply.tsx:13-72`, `bubble-gesture.tsx:45-61` |
| C4 | A history page lands as a burst of store updates: one or two per reaction stanza, one to three per edit stanza, each walking the whole loaded list; then an O(page × loaded) merge | High (the stutter when a page arrives) | M | `history.ts:61-86`, `ledger-reactions.ts:38-87,107-111`, `ledger-edits.ts:105-151,327-360` |
| C5 | Every change to the chat's messages re-renders every mounted cell, because `selection` is a new object on each chat-screen render | Medium-high | S | `use-chat-screen.ts:39,140-144`, `message-list.tsx:241,266`, `message-list-row.tsx:178` |
| C6 | Rows subscribe to whole arrays or do O(n) lookups in selectors (contacts, chats, all messages of the chat) | Medium | S-M | `entity-avatar.tsx:38-39`, `person-pressable.tsx:12-14`, `message-bubble.tsx:72-95`, `reply-quote.tsx:24-28`, `media-bubble.tsx:73-78`, `attachment-body.tsx:53-55` |
| C7 | Work after mount in rows: a SecureStore (Keystore) read per avatar, image and sticker, and link previews that always render empty first and grow later | Medium | S | `session-token.ts:8-17`, `avatar.tsx:50-69`, `media-source.ts:25-35`, `link-preview-card.tsx:85-109` |
| C8 | The `FlatList` engine itself: no recycling, windowing on the JS thread, batches of 10 rows every 50 ms, inversion and Android's native anchor correction | Medium (structural ceiling) | L | `message-list.tsx:308-357`, `VirtualizedList.js:704-768,1807,2038-2041`, `MaintainVisibleScrollPositionHelper.kt:106-138` |
| C9 | Text parsing that is not memoised: code-block split, link split, mention split, inline Markdown, two copies of the meta (one hidden) with tick SVGs | Low-medium (mostly mount time) | S | `plain-bubble-body.tsx:153-190`, `link-text.tsx:55-91`, `markdown-text.tsx:241` |
| C10 | The day separator's key is the first message of the day, so each older page of the same day unmounts it and mounts a new one | Low | S | `packages/chat-core/src/messages.ts:70` |
| C11 | The offline cache builds a snapshot on every store change and stringifies up to 2,500 messages on the JS thread 2 s after the last change | Low | S | `offline-cache-sync.ts:41-53`, `offline-cache.ts:142-145,274,279-289` |
| C12 | `onScroll` on the JS thread with `scrollEventThrottle={16}` | Low (our handler is cheap) | none | `use-message-list-scroll.ts:144-168` |

C1 explains "the slow loading of old messages" and the "little scroll, 4 or 5 times".
C4 and C8 explain the "boom, back to normal". C2, C3, C5 to C7 and C9 explain the
"4 fps" right after it, and why scrolling down is janky too (section 2.3).

---

## 2. Julio's three symptoms, end to end

### 2.1 From `onEndReached` to rows on screen (confirmed by code)

1. **Trigger.** `onEndReachedThreshold={0.5}` (`message-list.tsx:346`). `VirtualizedList`
   calls `onEndReached` only when the last item is inside the render window **and** the
   distance to the end is at most 0.5 × viewport. That is about 350 to 450 dp on a phone
   (`VirtualizedList.js:1574-1590`). It fires once per content length (`:1589`) and
   re-arms only after the user leaves the threshold (`:1611-1613`).
2. **Store call.** `loadOlder(chat.id)` reads the cursor and forks `loadOlderPage`
   (`history.ts:254-257`). `loadingOlder` drops duplicate calls (`history.ts:52-55`).
3. **Network.** One XMPP MAM query, `max: PAGE_HISTORY_MAX = 50`
   (`history.ts:58-60`, `history-core.ts:9`). This is one round trip plus server time.
   Estimate: 150 to 600 ms on mobile data.
4. **Processing, one synchronous JS task** (`history.ts:61-86`):
   - `ingestHistoryReactions`: for **each** reaction stanza, `applyReactionUpdate` does
     one `set` (`ledger-reactions.ts:75`). Then `refreshReactions` maps every loaded
     message and may do a second `set` (`ledger-reactions.ts:38-62,86`).
   - `ingestHistoryEdits`: for **each** correction or retraction, `applyEditUpdate` does
     one `set` (`ledger-edits.ts:108`), then `resolvePendingEdits` (a possible `set`,
     `:176`), then `refreshEdits` (`:116`). `refreshEdits` maps the whole list and runs
     `withReplyQuote`, which does a `list.find` per message that has a reply. That is
     O(n × replies) and a possible `set` (`:327-360`, `:303-312`). AI chats are full of
     corrections (progress cards, live edits), so they pay the most.
   - `toUiMessage` for each of the 50 stanzas (`history.ts:63-65`).
   - The merge filters the page against everything loaded with a nested
     `loaded.some(sameMessage)`, which is O(page × loaded) alias lookups. It then re-sorts
     the whole list (`history.ts:72-79`, `rows.ts:102-107`).
   - `refreshEdits` again (`history.ts:85`) and `applyChatReadMark`, which maps the list
     and may do another `set` (`history.ts:86`, `reads.ts:82-111`).
5. **Fan-out.** Every `set` notifies every listener synchronously (`atom-store.ts:51-65`).
   That includes every mounted row's selectors: about 100 mounted rows with 10 to 16
   `useChatStore` subscriptions each, which is 1,000 to 1,600 selector calls per `set`.
   Several are O(chats) or O(messages) (C6). The offline-cache listener also builds a
   snapshot on every `set` (C11). React batches the re-renders, but the selector calls
   run once per `set`.
6. **List rebuild** (`message-list.tsx:111-203`): `filterBlockedMessages`, `groupMessages`
   (copy and sort of every message, `messages.ts:57-58`), new `ListEntry` objects for
   every row (`:172-195`), and `[...entries].reverse()` (`:203`). The chat screen also
   re-renders (it subscribes to `messagesByChat[chatId]`, `use-chat-screen.ts:39`).
   That creates a new `selection`, and therefore a new `renderItem`, so every mounted cell
   re-renders to the `MessageListRow` level (C5).
7. **Mounting.** The 50 new rows (about 55 entries with separators) sit at the inverted
   list's end. `VirtualizedList` mounts them in batches of `maxToRenderPerBatch=10` every
   `updateCellsBatchingPeriod` (default 50 ms, `VirtualizedList.js:1807`). It mounts as
   the window reaches them, up to 5 viewports past the screen (`windowSize={11}`). Each
   heavy row (C2, C3) then starts its own async work (C7).

Estimated total from trigger to the first new rows on screen: network (150 to 600 ms) +
processing (10 to 80 ms in a text chat, more in an AI chat with many corrections) + the
first mount batch (30 to 100 ms). The request also starts only half a screen before the
end.

### 2.2 "Several small scrolls, then boom, then 4 fps" (suspected, strongly supported)

1. **Small scrolls.** A normal Android fling moves at several thousand dp per second.
   The request starts half a screen from the end (2.1, step 1), so the fling reaches the
   end of the content well before the page arrives. Android stops it at the edge, with
   the Android 12+ stretch overscroll. Each new swipe also hits the edge, and with the
   stretch it looks like "a little scroll" that springs back. Four or five swipes cover
   the round trip.
2. **Boom.** The page lands (2.1, steps 4 to 6) in one long JS task, the content grows,
   and the next swipe scrolls freely again.
3. **4 fps.** The user is now scrolling straight into rows that are not mounted yet. Each
   10-row batch is one long JS task: about 30 to 100 ms for text rows, more for group
   rows with avatars and for media rows. It is followed by a UI-thread mount of a few
   hundred native views, including 20 `TrueSheetView` hosts that each push a Fabric state
   update (C2) and about 30 gesture handlers (C3). The JS thread cannot keep up with the
   scroll events, the window falls behind, and blank space and dropped frames follow
   until the window catches up.
   - Right after mount, every avatar, image and sticker does a Keystore read and renders
     a second time (C7). Every link preview renders empty and then grows (C7).
   - When a row below the native anchor changes height, Android's
     `MaintainVisibleScrollPositionHelper` corrects the offset on that mount transaction
     (`MaintainVisibleScrollPositionHelper.kt:106-114`) and recreates the fling
     (`ReactScrollView.java:1374-1414`). The user sees small jumps.
4. **Later.** About 2 s after the last store change, the offline cache stringifies its
   snapshot on the JS thread (C11): one more hitch if the user is still scrolling.

### 2.3 Why scrolling down is janky too (confirmed by code)

`FlatList` does not recycle. Rows more than 5 viewports from the screen are unmounted
(`windowSize={11}`), and scrolling back mounts them again from scratch, with C2, C3, C7
and C9 every time. Every message change also re-renders every mounted cell (C5). During
an AI reply, a draft frame arrives about every 150 ms, so that happens about 7 times a
second while the user scrolls.

### 2.4 When the next page should start

- A page is 50 messages. At 60 to 70 dp per row, that is about 3,000 to 3,500 dp, or 4
  to 5 phone screens.
- A hard fling covers 3 to 6 screens.
- The round trip plus processing takes 0.2 to 0.7 s.

To make sure a fling never reaches the end:

- **Trigger at 3 viewports from the end** (`onEndReachedThreshold={3}` now,
  `onStartReachedThreshold={3}` after the FlashList migration). The window already
  reaches 5 viewports, so `cellsAroundViewport.last` is the last item early enough.
- **Prefetch one page ahead.** When a page lands, `hasMore` is still true, and the reader
  is within 3 viewports of the new end, request the next page at once. Do not wait for a
  scroll event (`VirtualizedList` re-arms only on scroll, `:1611-1613`). The loaded buffer
  above the reader is then about two pages.
- Keep `PAGE_HISTORY_MAX = 50` for the first page (fast open). Pages 2 and later can go to
  100 when the measurement shows that the MAM round trip dominates. That is a one-constant
  change in `history-core.ts`, measured before and after.
- A page that fails today is retried only after the reader scrolls out of the threshold
  and back (`VirtualizedList.js:1611-1613`). With a 3-viewport threshold that is rare, but
  the prefetch path should retry once after 1 s.

---

## 3. One section per cause

### C1. Late request, no prefetch (confirmed by code)

- **Where:** `message-list.tsx:346-351`. The `VirtualizedList.js:1527-1590` gate is
  described in 2.1, step 1.
- **Mechanism:** see 2.1 and 2.2.
- **Cost:** every fling into history hits the end once per page. That is the whole
  "slow loading" complaint.
- **Fix:** set the threshold to 3 and add the one-page prefetch from 2.4. The prefetch
  lives in `use-message-list-scroll.ts`, which knows the last offset, the viewport and
  the content height.

### C2. One message menu per row (confirmed by code)

- **Where:** `message-bubble.tsx:339-364` renders `BubbleActionsSheet` in every bubble.
  `message-bubble-actions.tsx:82-85` adds 4 store subscriptions and `:113-197` 14 inline
  closures. `MessageActionsSheet` builds about 7 `ActionSheetItem` elements on every render
  (`message-actions-sheet.tsx:139-224`). It renders one `ActionSheet` (`:228`) plus a
  second `ActionSheet` or a `ConfirmDialog` (`:296-354`). Each `ActionSheet` is a
  `TrueSheet` (`apps/mobile/src/components/ui/action-sheet.tsx:85-130`).
- **Mechanism:** `TrueSheet` loads its content lazily (`TrueSheet.tsx:117-122,574-586`),
  but it always mounts its host native view (`:519-573`). On Android every
  `TrueSheetView` builds a `TrueSheetViewController` (a `ReactViewGroup`,
  `TrueSheetView.kt:41`, `TrueSheetViewController.kt:110-116`) and registers a lifecycle
  listener (`TrueSheetView.kt:74-80`). On the first state wrapper it pushes a Fabric state
  update with the screen size (`TrueSheetView.kt:52-61`). An own-DM row mounts two of
  them; other rows mount one plus an idle `Modal`.
- **Cost (estimate):** about 10 React components, 4 selectors, 1 to 2 native host views
  and 1 to 2 Fabric state commits per row. That is roughly 25 to 40 % of a text row's
  mount time. It is paid on every row that scrolls in, in both directions.
- **Fix:** one menu host per list. The row's long-press calls `openMenu(message)` through
  the existing `MessageMenuProvider` context (`message-menu-context.tsx`). `MessageList`
  keeps one `{ message, albumMembers } | null` target and renders a single
  `BubbleActionsSheet` and confirm. The per-row `menuOpen` and `confirmOpen` state
  (`message-bubble.tsx:67-68`) goes away, which also removes the main hazard for
  recycling (C8).

### C3. Gesture stack per row (confirmed by code)

- **Where:** `swipe-to-reply.tsx:53-72` wraps every row in RNGH `ReanimatedSwipeable`. In
  `react-native-gesture-handler@2.32.0`, `ReanimatedSwipeable.tsx` creates 9 shared values
  (`:92-103`) and 3 `useAnimatedStyle` mappers (`:372,402,568`). It builds a Tap and a Pan
  gesture (`:482,502`) and calls `renderLeftActions` eagerly (`:383`). That renders
  `ReplyAction` with one more animated style and a lucide `Reply` SVG
  (`swipe-to-reply.tsx:13-25,58`). Inside it, `BubbleGesture` adds one more
  `GestureDetector` with a Tap (`bubble-gesture.tsx:45-61`). That gesture is rebuilt
  whenever the message object changes (`:55`).
- **Mechanism:** each row registers 3 native gesture handlers and about 4 UI-thread
  mappers, creates 10 shared values and mounts one SVG that nobody sees until a swipe.
- **Cost (estimate):** 20 to 35 % of a text row's mount time, plus mapper upkeep on the
  UI thread while the row is mounted.
- **Fix:** one `GestureDetector` per row with `Gesture.Race(pan, doubleTap)`:
  - The pan uses `activeOffsetX([-1000, 12])` and `failOffsetY([-8, 8])`, so vertical
    scrolls never activate it.
  - One shared value for the X translation and one animated style for the bubble.
  - The reply icon is a plain absolute `View` whose opacity comes from the same shared
    value. Mount the SVG only after the pan has started (a state flip on `onStart`, run
    on JS).
  - The haptic and the reply stay on `runOnJS`.

### C4. History page lands as a burst of store updates (confirmed by code; shared, also hits web)

- **Where and mechanism:** 2.1, steps 4 and 5.
- **Cost (estimate):**
  - Text chat: 3 to 6 `set` calls per page, each fanning out to about 1,000 selector
    calls. That is 10 to 40 ms of JS.
  - AI chat with 20 corrections in a page: 40+ `set` calls, each `refreshEdits` an
    O(n × replies) walk. That is 50 to 200 ms of blocked JS at the worst moment, while
    the user is scrolling.
- **Fix (all in `packages/client-core`):**
  - `ingestHistoryReactions` applies all of a page's reaction updates into one
    `reactions` value, with one `set` and one `refreshReactions`.
  - `ingestHistoryEdits` applies all corrections first, then calls `resolvePendingEdits`
    and `refreshEdits` once.
  - The merge builds a `Set` of alias roots once: O(page + loaded).
  - `refreshEdits` builds an id-to-message `Map` once instead of `list.find` per reply.
  - The whole page, plus the read mark, ends in one `set`. If that is awkward, add a
    `batch(fn)` to `atom-store.ts` that holds back listener notification until `fn`
    returns.
  - This is message-pipeline code, so it needs tests (AGENTS.md "Tests"): the same final
    state as today and the count of store notifications per page.

### C5. All mounted cells re-render on every message change (confirmed by code)

- **Where:**
  - `use-chat-screen.ts:140-144` builds `selection = { ids, onToggle, onStart }` as a new
    object on every render.
  - The chat screen re-renders on every `messagesByChat[chatId]` change (`:39`, used by
    `forwardSelected` at `:146`) and on every `chat` summary change (`:24`).
  - `MessageList` puts `selection` in `renderItem`'s dependencies (`message-list.tsx:241,266`),
    and `areRowPropsEqual` compares it by identity (`message-list-row.tsx:178`).
  - `chat` is compared the same way (`:172`). It changes on every new message (its
    `lastMessage`), unread count and presence update.
- **Mechanism:** a new `renderItem` makes `FlatList` re-render every mounted cell.
  `MessageListRow`'s memo fails on `selection`, and `MessageBubble`'s memo stops it one
  level lower.
- **Cost (estimate):** about 100 cells × (CellRenderer + row + album provider) is 3 to
  8 ms per message change. During an AI reply that is about 7 times a second.
- **Fix:**
  - Memoise `selection` on `selectedIds`, or better, pass only `selectedIds` and the two
    stable handlers.
  - Read `messagesByChat` inside `forwardSelected` through `useChatStoreApi().getState()`
    instead of subscribing, if nothing else needs the subscription. The worker checks the
    other uses.
  - Pass the row only the fields it reads (`chat.kind`, not `chat`).

### C6. Whole-array and O(n) selectors in rows (confirmed by code)

- **Where:**
  - `entity-avatar.tsx:38-39` and `person-pressable.tsx:12-14` subscribe to the whole
    `contacts` and `chats` arrays, so any contact or chat change re-renders every avatar
    and sender name.
  - `message-bubble.tsx:76-78` (`rendersMarkdown` does `chats.find`) and `:95`
    (`chats.find`) do an O(chats) lookup per row per store update. `:72` and `:79` read
    `mediaTrustedHosts` and `me.jid`, which are the same for every row.
  - `reply-quote.tsx:24-28` does `messagesByChat[chatId].find` on every store update for
    every reply row.
  - `media-bubble.tsx:73-78` and `attachment-body.tsx:53-55` subscribe to the chat's
    whole message array. Every media row therefore re-renders on every message change,
    reaction or receipt, and recomputes `photosOf(messages)` over all loaded messages.
    The array is only needed when the viewer opens.
- **Cost (estimate):** O(rows × chats) comparisons per store update. For example, 100
  rows × 2 finds × 200 chats is 40k comparisons, about 1 to 3 ms. On top of that, every
  media row re-renders and walks all messages on every message change.
- **Fix:**
  - Compute the per-chat facts once in `MessageList`: the Markdown rule input, `isDm`,
    `meJid`, `mediaTrustedHosts` and `isGroup`. Hand them down through one memoised
    context.
  - Avatars and person rows select the one primitive they need, for example
    `state.contacts.find(...)?.avatarUrl`. The result is a string, so it is stable.
  - `ReplyQuote` selects the referenced text or a deleted flag, not the message.
  - Media rows read the message list from `getState()` when the viewer opens.

### C7. Work after mount in rows (confirmed by code)

- **Where:**
  - `getSessionToken` has no cache. Every call is a dynamic import plus
    `SecureStore.getItemAsync`, which is a Keystore decrypt on Android
    (`session-token.ts:8-17`, `secure-session-storage.ts:50-52`).
  - Callers: `Avatar` on every mount (`avatar.tsx:53-69`), `useMediaSource` for every
    image and album tile (`media-source.ts:25-35`) and `StickerMessage`
    (`sticker-message.tsx:44-60`). Each renders a second time when the token resolves.
  - `LinkPreviewCard` starts in `{ kind: 'loading' }` even when the URL is cached
    (`link-preview-card.tsx:92,99-109`), so every mount renders nothing and then grows
    the row a frame later. It also calls `useGlobalSearchParams()` per row (`:85`), which
    subscribes every link row to the router state, and builds an API client per row
    (`:91`).
- **Cost (estimate):** one Keystore round trip (several ms of native work) and one extra
  render per avatar, image or sticker mount, plus a late height change per link row. The
  height changes are what make the Android anchor correct the offset (2.2, step 3).
- **Fix:**
  - Cache the token in memory and clear it on sign-in and sign-out (a decision for the
    lead, see the Report).
  - Read the token through a hook that starts from the cached value, so a mount renders
    once.
  - Initialise `LinkPreviewCard` state from `previewCache` synchronously.
  - Compute the mock flag and the API client once at module or list level.

### C8. The `FlatList` engine (confirmed by code; cost suspected)

- **Where:**
  - `message-list.tsx:308-357`: `inverted`, `initialNumToRender={20}`, `windowSize={11}`,
    `maxToRenderPerBatch={10}`, MVCP `{ minIndexForVisible: 1, autoscrollToTopThreshold: 40 }`,
    and no `getItemLayout`.
  - On Android, inversion applies `transform: [{ scale: -1 }]` to the scroll view and to
    every cell (`VirtualizedList.js:2038-2041`). RN moved Android from `scaleY: -1` to
    `scale: -1` to avoid the old Android 13 text slowdown, so this is no longer a big cost
    by itself.
  - MVCP is done twice: the JS window shift in `getDerivedStateFromProps`
    (`VirtualizedList.js:704-768`) and the native anchor correction on every mount
    transaction (`MaintainVisibleScrollPositionHelper.kt:106-138`).
- **Mechanism:**
  - No recycling: every row that enters the window is mounted from scratch, and every
    row that leaves it is destroyed.
  - The window is computed on the JS thread from scroll events. When JS is busy (C2 to
    C7), the window lags and blank space shows.
  - Batches of 10 rows every 50 ms are long JS tasks with heavy rows.
- **Cost:** sets the ceiling. With C1 to C7 fixed, a tuned `FlatList` should be "OK", not
  "Telegram". Telegram and WhatsApp recycle row views.
- **Fix:** section 4.

### C9. Text parsing that is not memoised (confirmed by code)

- **Where:**
  - `PlainBubbleBody` runs `splitCodeBlocks` and `previewUrl` (`splitLinks`) on every
    render (`plain-bubble-body.tsx:153-155`).
  - `LinkText` runs `splitMentions`, `splitLinks` and `parseLightInline` on every render
    (`link-text.tsx:55,75,91`).
  - Every outgoing text row draws two `BubbleInlineMeta`, one of them hidden to reserve
    the width, and each draws `Ticks`, a lucide SVG (`plain-bubble-body.tsx:101-114,170-186`).
  - `MarkdownText` is memoised (`markdown-text.tsx:232`), but its `trailing` prop is
    rebuilt when the message object changes (`message-bubble-content.tsx:139-153`).
    Every mount parses again (`markdown-text.tsx:241`).
- **Cost (estimate):** 0.2 to 1 ms per text row, mostly at mount. Long AI Markdown
  replies cost more.
- **Fix:**
  - Wrap the parse results in `useMemo` keyed on `text` and `mentions`.
  - Draw the hidden meta copy without `Ticks`: a fixed-width spacer `View` reserves the
    same width.
  - Key the Markdown `trailing` on the primitive fields it shows (time, status, edited,
    generating), not on `message`.

### C10. Day-separator key (confirmed by code; shared)

- **Where:** `groupMessages` keys a separator as `separator-${first.id}` (`messages.ts:70`).
- **Mechanism:** when an older page adds messages from the same day, the old separator
  (keyed by the previous oldest message) unmounts and a new one mounts above it. The
  boundary row's `firstInGroup` can also flip, which changes its height when the sender
  name appears. This happens right at the top edge, where the reader is looking.
- **Cost:** one small visible jump per page at the boundary.
- **Fix:** key separators by local day (`separator-YYYY-MM-DD`). The boundary regroup
  stays, because it is correct. Web uses the same function, so check that web uses the
  id only as a key (one grep).

### C11. Offline cache (confirmed by code)

- **Where:** `offline-cache-sync.ts:41-53` builds `offlineSnapshot(...)` for 50 chats on
  every store `set`, including the per-stanza `set` calls of C4. 2 s after the last
  change it runs `encodeOfflineCache`, a `JSON.stringify` of up to 50 chats × 50 messages
  on the JS thread (`offline-cache.ts:29,142-145,274`).
- **Cost (estimate):** under 0.5 ms per `set` for the snapshot, plus one 10 to 40 ms
  stringify that can land during a scroll.
- **Fix:** skip scheduling when `chats`, `messagesByChat` and the pins are the same
  references as last time. Run the write after `InteractionManager.runAfterInteractions`,
  or only when the app goes to the background and every 30 s.

### C12. `onScroll` (confirmed by code, low)

`handleScroll` (`use-message-list-scroll.ts:144-168`) only updates refs, and it sets
state only when "at bottom" flips. Keep it. `VirtualizedList`'s own per-event work is
part of C8.

---

## 4. The list engine

### 4.1 Options for this app (React Native 0.86, new architecture, Expo 57)

| | Tuned `FlatList` | FlashList v2 (`@shopify/flash-list` 2.x) | LegendList (`@legendapp/list` 3.x) |
| --- | --- | --- | --- |
| Recycling | No | Yes, by item type | Opt-in (`recycleItems`) |
| Chat layout | `inverted` (transform) | No inversion: `maintainVisibleContentPosition.startRenderingFromBottom`, `onStartReached` | No inversion: `alignItemsAtEnd`, `initialScrollAtEnd`, `maintainScrollAtEnd`, `onStartReached` |
| Keep position on prepend | Native MVCP, plus the JS window shift | On by default: native MVCP with a scroll-anchor view plus a JS offset correction | `maintainVisibleContentPosition={{ data: true, size: true }}` |
| Stay at bottom | Our own follow logic (`use-message-list-scroll.ts:234-258`) | `autoscrollToBottomThreshold`, `animateAutoScrollToBottom` | `maintainScrollAtEnd`, `maintainScrollAtEndThreshold` |
| Native code | None (core) | None (JS only, new architecture only) | None (JS only) |
| Expo | Core | Listed in Expo's `bundledNativeModules.json` (`"@shopify/flash-list": "2.0.2"`). npm `latest` is 2.3.3 | Not listed. npm `latest` is 3.6.0 (v3 left beta after 56 betas) |
| Extras that matter here | none | `getItemType`, `useRecyclingState`, `onBlankArea` for measuring | `experimental_adaptiveRender` (cheap rows during fast flings), keyboard-controller integration, a DOM build for web |
| Maintainer | Meta | Shopify | Mostly one maintainer (Legend) |
| Migration risk | None | Medium (recycling hazards, reversed data order) | Medium (same hazards if recycling is on, faster-moving API) |

### 4.2 Recommendation: FlashList v2, after the row diet

1. **The row diet comes first (W2 to W4 in section 6), whichever engine is chosen.**
   - It is the main cost: C2, C3, C5 to C7 and C9 are paid on every mount and every
     message change.
   - It removes the per-row state that makes recycling unsafe.
   - After it, a tuned `FlatList` with C1 fixed may already be good enough. The lead
     decides from the measurements in section 5.
2. **If the measurement after the diet still misses the target, move to FlashList v2.**
   - Recycling removes most of the remaining mount cost, and that is what makes Telegram
     smooth.
   - It is JS only and listed by Expo for this SDK.
   - It has first-class chat props with no inversion.
   - It is maintained by a large team.
   - LegendList is the fallback if the one-day FlashList spike fails its acceptance (an
     Android prepend jump or an unstable unread landing). Its `adaptiveRender` is
     attractive for heavy rows, and its DOM build could later replace web's 150-row window.
3. **Do not migrate before the diet.** With today's rows, recycling would reuse cells that
   keep `menuOpen`, `confirmOpen`, `handoffOpen`, the reveal's `Animated.Value` and
   `SmoothTextReveal`, the media viewer state and the link-preview state of another
   message (see the risks below).

### 4.3 FlashList v2 props for `MessageList`

`entries` stays in date order (oldest first), and the `reverse()` goes
(`message-list.tsx:203`). Every index in `use-message-list-scroll.ts` becomes an index
into date order.

```tsx
<FlashList
  ref={listRef}
  data={entries}
  keyExtractor={(entry) => entry.key}
  getItemType={rowType} // 'divider' | 'separator' | 'text-in' | 'text-out' | 'media' | 'card' | 'sticker' | 'voice'
  renderItem={renderItem}
  maintainVisibleContentPosition={{
    startRenderingFromBottom: true,
    autoscrollToBottomThreshold: 0.2, // fraction of the viewport per the docs example; confirm the unit in the spike
    animateAutoScrollToBottom: true,
  }}
  onStartReached={loadOlderIfMore}
  onStartReachedThreshold={3}
  initialScrollIndex={dividerIndex ?? undefined}
  initialScrollIndexParams={{ viewOffset: -viewportThird }}
  drawDistance={viewportHeight} // start at one viewport; tune with onBlankArea
  keyboardDismissMode="interactive"
  keyboardShouldPersistTaps="handled"
  contentContainerStyle={{ paddingTop: 8, paddingBottom: chat.topic !== undefined ? 44 : 8 }}
  showsVerticalScrollIndicator={false}
  scrollEventThrottle={16}
  onScroll={handleScroll}
/>
```

### 4.4 Migration steps

1. Add `@shopify/flash-list` with `npx expo install @shopify/flash-list`. That picks the
   SDK-tested version. It is a new dependency, so it needs the lead's approval.
2. Drop `inverted`, `reverse()`, `windowSize`, `initialNumToRender`, `maxToRenderPerBatch`
   and `onScrollToIndexFailed` (FlashList does not support it), at
   `message-list.tsx:312-337`.
3. "At bottom" becomes
   `contentSize.height - layoutMeasurement.height - contentOffset.y < 40`.
   `jumpToBottom` becomes `scrollToEnd({ animated: true })`.
4. Following new messages: `autoscrollToBottomThreshold` covers "I was at the bottom".
   My own outgoing message still calls `scrollToEnd` explicitly
   (`use-message-list-scroll.ts:250-252`). The `handleContentSizeChange` re-pin
   (`:182-220`) should no longer be needed. Remove it only after the spike shows it.
5. Saved spot (WUX-28): offsets from the top change as pages are prepended. Save the key
   of `getFirstVisibleIndex()` instead of an offset. Restore with `initialScrollIndex`,
   which replaces the restore loop in `:182-213`.
6. Recycling hazards. Each state below must reset when the cell gets another message:
   - `message-bubble.tsx:70` `handoffOpen`: use `useRecyclingState(false, [message.id])`.
     `menuOpen` and `confirmOpen` are gone after W3.
   - `use-bubble-reveal.ts:37` (`Animated.Value`) and `use-smooth-text.ts:241`
     (`SmoothTextReveal` created once): key the reveal on `message.id` by wrapping the
     bubble body in a component keyed on `message.id`, only for rows with a
     `revealTurnId` or a draft. Plain rows never animate.
   - `media-bubble.tsx:75` viewer, `file-bubble.tsx:63` opened,
     `sticker-message.tsx:38` broken, `link-preview-card.tsx:92-96` state, and
     `avatar.tsx:52` `failedUrl` (already compared to the URL, so safe): use
     `useRecyclingState` or derive from props.
   - Gesture shared values (after W3, one X translation): reset to 0 when the message id
     changes.
7. Remove explicit `key` props on item roots inside `renderItem`. Keys inside `.map()` are
   fine.

### 4.5 Risks and how the spike checks them

- **Jump to message** (`jump-scroll.ts`, `use-message-list-scroll.ts:260-301`):
  `scrollToIndex` works on rows that are not measured yet and corrects itself. Keep the
  80/200/400 ms retries. Check: a search jump to a message 3 pages up lands centred.
- **Unread divider:** the first paint lands on `initialScrollIndex`. Check: a chat with
  37 unread opens on the divider with no visible jump. The divider must stay on the same
  message after an older page is prepended (the index moves by the page size).
- **Keeping position when older pages arrive:** MVCP is on by default. Check: flinging
  up through 5 pages never jumps. Watch for FlashList's known issue "data re-ordering can
  cause items to move": our merge only prepends, and it re-sorts only on equal
  timestamps.
- **Staying at the bottom:** check new messages from someone else while at the bottom,
  while scrolled up (the badge count stays right), and my own message while scrolled up.
- **Reveal animation:** the draft and its final message share a key (`draftEntryKey`), so
  the same cell keeps the reveal. Check: an AI reply streams and then swaps with no
  flash.
- **Keyboard:** `keyboardDismissMode="interactive"` passes through to the `ScrollView`.
  Check opening the keyboard at the bottom and while scrolled up.

---

## 5. How the lead measures

Use a release build (`expo run:android --variant release`) on the emulator. Use one group
chat with at least 600 messages (avatars, replies, reactions, links, images) and one AI DM
with many cards and corrections.

**Frames:**

```bash
adb shell dumpsys gfxinfo app.zilar.chat reset
# 10 flings toward older messages, then 10 back
for i in $(seq 10); do adb shell input swipe 540 700 540 1900 120; sleep 0.4; done
for i in $(seq 10); do adb shell input swipe 540 1900 540 700 120; sleep 0.4; done
adb shell dumpsys gfxinfo app.zilar.chat framestats
```

Read "Janky frames", the 50th/90th/95th/99th percentile lines and "Number Slow UI
thread". Read the per-frame rows for the long tail.

**Page latency:** in a local, uncommitted profiling build, log `performance.now()` in
`onEndReached` and again in the first `onContentSizeChange` after `entries.length`
grows. Also count "wall hits": scroll events with `distanceFromEnd === 0` while a page
is in flight.

**Targets:** janky frames under 5 % for the script; p95 frame time at most 16 ms at
60 Hz; request to rows at most 400 ms against the local server; zero wall hits in the 10
flings.

**Baseline:** not measured in this task. The lead records it before W1.

---

## 6. Fix plan (worker tasks)

Each worker task lists its files with today's line count. No file may end above 400
lines; files marked "net-negative" are already close. W1, W5 and W6 can run in parallel
with the mobile chain (W2, then W3, then W4), because their files do not overlap. The
FlashList migration is conditional and comes last.

### W1. History lands in one store update (C4, C10; shared)

- **Files:**
  - `packages/client-core/src/store/history.ts` (327)
  - `packages/client-core/src/store/ledger-reactions.ts` (122)
  - `packages/client-core/src/store/ledger-edits.ts` (399, net-negative: move
    `ingestHistoryEdits` out)
  - a new `packages/client-core/src/store/ledger-history-ingest.ts`
  - `packages/client-core/src/store/ledger.ts` (134)
  - `packages/client-core/src/atom-store.ts` (only if a `batch` is used)
  - `packages/chat-core/src/messages.ts` (368, the separator key)
  - a new `packages/client-core/src/store/history-page.test.ts`
    (`history.test.ts` is already 474)
- **Work:**
  - Batch the reaction and edit ingestion per page.
  - Merge with a `Set`.
  - Use a `Map` in `refreshEdits`.
  - End the page in one notification.
  - Key separators by day.
- **Tests:**
  - The final state equals today's for the existing `history.test.ts` and
    `ledger.test.ts` cases.
  - A page with 5 reactions and 5 corrections notifies the store once.
- **Measure:** page latency in an AI DM, and the JS long-task length when the page lands
  (React Native DevTools Performance panel).

### W2. List quick wins: prefetch and no re-render fan-out (C1, C5, part of C6)

- **Files:**
  - `apps/mobile/src/components/chat/message-list.tsx` (361)
  - `use-message-list-scroll.ts` (304)
  - `message-list-row.tsx` (201)
  - `use-chat-screen.ts` (327)
  - `message-bubble.tsx` (373)
  - a new `apps/mobile/src/components/chat/chat-row-facts.tsx`
- **Work:**
  - Set `onEndReachedThreshold={3}` and add the one-page prefetch with a single retry
    (2.4).
  - Interim window tuning: `windowSize={9}`, `maxToRenderPerBatch={5}`,
    `updateCellsBatchingPeriod={32}`, `initialNumToRender={15}`.
  - Memoise `selection` (or pass the ids only) and read messages lazily in
    `forwardSelected`.
  - The row gets `isGroup`, not `chat`.
  - One memoised per-chat facts context replaces `message-bubble.tsx:72-95`.
- **Measure:** wall hits (target 0), janky frames, and the count of row re-renders per
  incoming message (React DevTools "highlight updates": only the new row should flash).

### W3. Row diet: one menu, one gesture (C2, C3)

Runs after W2, because it touches `message-bubble.tsx` and `message-list.tsx`.

- **Files:**
  - `message-bubble.tsx`
  - `message-bubble-actions.tsx` (199)
  - `message-menu-context.tsx` (27)
  - a new `message-menu-host.tsx`
  - `message-list.tsx` (mount the host)
  - `swipe-to-reply.tsx` (74)
  - `bubble-gesture.tsx` (62)
- **Work:**
  - One `BubbleActionsSheet` and confirm per list, opened through context. Album members
    travel with the target.
  - Replace `ReanimatedSwipeable` and the separate Tap detector with one detector that
    races a pan and a double tap (C3).
- **Measure:**
  - Layout Inspector or `adb shell dumpsys activity top`: `TrueSheetView` count is 2 per
    screen, not 2 per row.
  - Janky frames for the scroll script.
  - Phone smoke: swipe to reply, double tap to react, long press for the menu, delete,
    album delete, and select mode.

### W4. Row leaves: no async work after mount, narrow selectors, memoised parsing (C6, C7, C9)

Runs after W3.

- **Files** (all in `apps/mobile/src/`):
  - `lib/session-token.ts` (17)
  - `components/chat/avatar.tsx` (114)
  - `lib/media-source.ts` (52)
  - `components/chat/sticker-message.tsx` (107)
  - `components/chat/link-preview-card.tsx` (175)
  - `components/chat/entity-avatar.tsx` (74)
  - `components/chat/person-pressable.tsx` (57)
  - `components/chat/reply-quote.tsx` (68)
  - `components/chat/media-bubble.tsx` (396, net-negative)
  - `components/chat/attachment-body.tsx` (236)
  - `components/chat/plain-bubble-body.tsx` (244)
  - `components/chat/link-text.tsx` (125)
  - `components/chat/message-bubble-content.tsx` (367)
- **Work:**
  - In-memory token cache with sign-in and sign-out invalidation, if the lead approves
    (see the Report).
  - Link previews start from the cache.
  - Primitive selectors, and the message list read from `getState()` when the viewer
    opens.
  - `useMemo` for the parses, and a hidden meta spacer with no `Ticks`.
- **Measure:** renders per row mount (1 instead of 2 for avatar, media and link rows),
  janky frames in the group chat, and no layout jump when a link row scrolls in.

### W5. Web parity for the shared causes (section 7)

- **Files:**
  - `apps/web/src/components/MessageBubble.tsx` (394, net-negative)
  - `apps/web/src/components/message/MessageMenu.tsx` (294)
  - `apps/web/src/components/EntityAvatar.tsx` (74)
- **Work:**
  - Mount `MessageMenu` only while it is open, or as one menu per list.
  - Primitive selectors in `EntityAvatar`.
  - `pinFor` becomes a pinned-id set computed once per list.
- **Measure:** Chrome Performance panel. Scroll a 300-message chat while an AI reply
  streams: no long tasks over 50 ms, and React Profiler shows only the draft row
  committing per frame.

### W6. List engine: FlashList v2 (C8), only if the post-W4 measurement misses the target

- **Files:**
  - `apps/mobile/package.json` (new dependency)
  - `pnpm-lock.yaml`
  - `message-list.tsx`
  - `use-message-list-scroll.ts`
  - `message-list-row.tsx`
  - `use-bubble-reveal.ts` (56)
  - `message-bubble.tsx`
  - `media-bubble.tsx`
  - `file-bubble.tsx` (164)
  - `sticker-message.tsx`
  - `link-preview-card.tsx`
- **Work:** sections 4.3 and 4.4. Start with a one-day spike that checks the risks in
  4.5 before the full migration. If the spike fails, LegendList 3.x with the same steps
  (`alignItemsAtEnd`, `initialScrollAtEnd`, `maintainScrollAtEnd`,
  `maintainVisibleContentPosition={{ data: true, size: true }}`, `recycleItems`).
- **Measure:** the full section 5 script. FlashList's `onBlankArea` reports blank space
  during the flings (target: under 1 % of frames show blank).

Not scheduled (low): C11, the offline cache. Fold it into W2 if W2 has room, or make it a
small task later.

---

## 7. Web chat (brief)

`apps/web` does not share row components with mobile. It shares `packages/client-core`
(store, history) and `packages/chat-core` (grouping).

- **Already better:**
  - Rows are memoised.
  - Handlers are stable (`useLatestCallback`, `MessageList.tsx:32,118-119`).
  - Selection is a `Set` of ids (`MessageListRow.tsx:22,96`).
  - The list renders a 150-row window that grows on demand (`useMessageWindow.ts:15`)
    instead of virtualising.
- **Same causes:**
  - C4 and C10 come from shared code, so W1 fixes them for web too.
  - Per-row menu: `MessageMenu` is mounted in every bubble (`MessageBubble.tsx:258,369`)
    and subscribes to `chats.find` per row (`MessageMenu.tsx:132`).
  - Whole-array avatars: `EntityAvatar.tsx:38-39`.
  - Per-row store reads: `MessageBubble.tsx:84-87` (`pinFor` per row,
    `mediaTrustedHosts`). `AttachmentBody.tsx:55` too.
- **Not applicable:** C1 (web pages through its own window and scroll hook), C2's
  TrueSheet, C3, C7's Keystore and C8.

W5 covers the web items.
