---
id: T-1310
title: "Mobile home like Telegram: swipe left/right between chat folders (All chats, Personal, AIs and custom folders) with the tab underline following the swipe"
status: merged
milestone: M5
branch: task/T-1310-mobile-swipe-folders
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1310: Swipe between chat folders (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: "in the home, needs to be like Telegram, I need to navigate the categories of chats: All chats, Personal, AIs". Today the folder chips (`apps/mobile/src/components/chat/folder-tabs.tsx`, 94 lines) switch only by tap, and the list (`apps/mobile/src/components/chat/chat-list.tsx`) shows one folder at a time.

### What to build
1. **A horizontal pager under the folder tabs:** each folder is a page holding its own chat list, and swiping left or right moves to the next or previous folder, as in Telegram.
   - Use `react-native-pager-view` if the app already has it, otherwise `react-native-gesture-handler` plus `react-native-reanimated`, which the app already uses (cite `package.json`). **No new dependency** unless it's already installed.
   - Only the visible page and its neighbours render their lists.
2. **The tabs follow the pager:**
   - the active tab's indicator (underline, or the existing active-chip style) follows the swipe progress;
   - tapping a tab animates to that page;
   - the tab row scrolls to keep the active tab visible when there are many custom folders.
3. **Behaviour:**
   - the search field and the pull-to-refresh keep working;
   - the unread badge on each tab stays;
   - the swipe never conflicts with a chat row's long-press or swipe actions (if any; cite them);
   - the selected folder is remembered the way it is today (cite it).
4. **No tests** (UI). Keep every file at most 400 lines; put the pager in a new `apps/mobile/src/components/chat/folder-pager.tsx`.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/folder-tabs.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/app/(tabs)/index.tsx` (or wherever the home list mounts; cite it), and `apps/mobile/package.json`.

### Allowed files
`apps/mobile/src/components/chat/folder-tabs.tsx`, `apps/mobile/src/components/chat/folder-pager.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/components/chat/chat-list-*.tsx`, `apps/mobile/src/app/(tabs)/*.tsx`, `work/T-1310-mobile-swipe-folders.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:** swiping left on the home moves from All chats to Personal to AIs, the tab indicator follows, and tapping a tab jumps to it.

---

## Report (written by the worker when done)

### Status
Done, gate green. One design tradeoff needs the lead's call (see Open questions): the
pager owns horizontal drags on the list, so the row swipe-to-reveal actions are
pre-empted there; the same Pin/Mute/Archive actions stay on the long-press sheet.

### What I did
- Added `apps/mobile/src/components/chat/folder-pager.tsx`: a horizontal pager built on
  `react-native-gesture-handler` 2.32.0 and `react-native-reanimated` 4.5.1 (both already in
  `apps/mobile/package.json`, lines 61-62 — no new dependency; the app does not have
  `react-native-pager-view`). One page per folder sits side by side under the tab row; the
  track translates with a drag (rubber-band past the first/last page), settles on a distance
  or flick, and reports the page. Only the visible page and its two neighbours mount
  (`first = index-1`, `last = index+1`). A shared `progress` value (continuous page position)
  is written on the UI thread during the drag/tap animation.
- `folder-tabs.tsx`: kept the chips ("All chats" + one per folder) and the unread badges.
  The raised active-chip look is now two stacked layers (the `bg-surface` chip and the
  `segment` pill) whose opacities cross-fade with `progress`, so the indicator follows the
  swipe and the tap animation. The row now scrolls to keep the active chip visible
  (`scrollRef.scrollTo` off each chip's `onLayout`), needed when a swipe turns to a chip
  that was off-screen. The `Icon`/`folderIcon` selection moved to a module-level
  `chipGlyph` (the same pattern as `apps/mobile/src/app/settings/folders.tsx`) so oxlint's
  `react(static-components)` rule is satisfied.
- `chat-list.tsx`: composes `FolderTabs` over `FolderPager`. It owns the shared `progress`,
  the `openSwipeRef` shared by all pages, and maps `activeFolder` to a page index. The
  connection line, the swipe-error line and the load-error banner stay fixed above the
  pager (so they do not swipe with the pages). `onIndexChange` writes the store's
  `activeFolder` through `onSelectFolder`.
- Added `apps/mobile/src/components/chat/chat-list-page.tsx`: one folder's body — its own
  `chatListModel(chats, { folder, search })` (memoised), the `FlatList` with skeleton/empty/
  error states, the `RefreshControl`, and the Archived entry. Only the mounted pages compute
  their model.
- `apps/mobile/src/app/(tabs)/index.tsx`: passes `chats` and `search` to `ChatList` instead
  of a single folder's `rows`/`archived`, so every page can build its own rows. The
  active-folder model is still computed for the search dropdown (`chatMatches`).

Search and pull-to-refresh: `search` reaches each page's model, and each page keeps its own
`RefreshControl` wired to the screen's `onRefresh`. The selected folder is remembered as
today: `setActiveFolder` -> store `activeFolder` (`apps/mobile/src/store/real-store.ts:362`;
default `'all'` in `apps/mobile/src/store/effects/user-state.ts:67`).

### Files changed
- `apps/mobile/src/components/chat/folder-tabs.tsx` (changed)
- `apps/mobile/src/components/chat/folder-pager.tsx` (new)
- `apps/mobile/src/components/chat/chat-list.tsx` (changed)
- `apps/mobile/src/components/chat/chat-list-page.tsx` (new)
- `apps/mobile/src/app/(tabs)/index.tsx` (changed)
- `work/T-1310-mobile-swipe-folders.md` (this report)

All are inside the task's Allowed files.

### Commands and results
- `pnpm gate` (repo root), real output:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.3s)
  PASS  lint  (0.7s)
  PASS  typecheck  (5.0s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/mobile  (1.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- While working I ran only targeted helpers on my own files, not the gate steps:
  `pnpm exec oxlint` on the five files and `pnpm exec prettier --write` on them, to clear
  the `react(immutability)` / `react(static-components)` findings. No unit test was added
  (the spec says no tests; this is UI).

### Deviations from the spec
- The spec says the swipe must not conflict with a row's swipe actions. It cannot fully:
  the row `Swipeable` (`apps/mobile/src/components/chat/chat-row-swipe.tsx`, T-1204) and the
  pager both claim horizontal drags. The row pan activates at 10 px
  (`react-native-gesture-handler` `DEFAULT_DRAG_OFFSET`), the pager pan at 6 px, so a drag
  starting on a row pages the list and the row's reveal never opens there. Its actions are
  not lost: the long-press sheet (`chat-actions-sheet.tsx`) offers the same Pin/Unpin,
  Mute/Unmute and Archive/Unarchive, and long-press/tap/vertical scroll are untouched (the
  pager pan fails on vertical movement and does nothing without movement). A full
  coexistence would need the row components to take a gesture relation, and
  `chat-row-swipe.tsx` / `chat-rows.tsx` are outside the Allowed files.
- I could not run the emulator, so the acceptance gesture is unverified by me; the lint,
  types and the nearest mobile tests pass.

### Open questions
1. Pager vs row swipe: is the pager owning horizontal drags acceptable given the same
   actions stay on long-press, or should the row swipe win (which would stop list swiping
   between folders and fail the acceptance gesture)? I kept the acceptance behavior.

### Round (fix round 1, fresh session)

Findings from `PREREVIEW.md`:

- **Fixed: finding 1 (should-fix).** `apps/mobile/src/components/chat/folder-pager.tsx`:
  the `pan` handed to `GestureDetector` was rebuilt on every render, so a re-render that
  landed mid-swipe (incoming chat, unread change, a search keystroke) replaced the
  in-flight gesture, `onEnd` never fired and the track/tabs stranded between pages. The
  pan is now memoised (`useMemo` over `[motion, count, width, handleIndexChange]`) and the
  fresh `onIndexChange` prop is stabilised through a new `useStableIndexChange` hook (a
  `useRef` + `useEffect` latest-closure, the same pattern as `useStableHandler` in
  `use-stable-handlers.ts`), so the pan keeps one identity across ordinary re-renders.
- **Nits 2 and 3: not touched.** Both are marked cosmetic by the pre-review and neither is
  on a line this round changed (only `folder-pager.tsx` changed), so per the fix-round
  rules they are left as they are. Follow-up **F1** (pager owns horizontal drags, so the
  row `Swipeable` reveal is pre-empted on list pages) is the lead's call and is unchanged.

Tests added: **none**. The spec says "No tests (UI)", `AGENTS.md` gives UI code no tests,
and the fix is a React hook composition with no pure seam; the mobile package has no
component renderer (no RN testing library, and adding a dependency is out of scope). The
finding names no test.

Commands:
- `pnpm exec oxlint apps/mobile/src/components/chat/folder-pager.tsx` and
  `pnpm exec prettier --check` on the same file: clean (the first attempt tripped
  `react(refs)` on a `useCallback`/`useMemo` that read the ref inline; the custom hook
  clears it).
- `pnpm gate` (repo root), real output:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (2.3s)
  PASS  lint  (2.1s)
  PASS  typecheck  (6.5s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (2.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test was run: no test file was touched.

`status` stays `review`.

### Round (fix round 2, lead's emulator check 2026-10-13 02:18)

**Item 1 — every page after the first rendered empty and swiped nothing.**
Cause (as the lead found): `folder-pager.tsx` wrapped the *translated* track in
`GestureDetector`, and that track was `flex: 1` (one screen wide) with
`overflow: 'hidden'`. Pages are absolute at `left: page * width`, so page 1+ sat
outside the track's own one-screen box and was clipped; once translated by
`-width` the track's hit area was off-screen and got no touches.
Fix: `GestureDetector` now wraps a **static** `View` (`flex: 1,
overflow: 'hidden'`), and inside it the translated `Animated.View` track is
`flex: 1, width: count * width`. Page 1+ is inside the wider track, the viewport
stays one screen and is always the touch target. Added `View` to the
`react-native` import.

**Item 2 — horizontal swipe on "All chats" opened the row actions.**
Lead decision: while the folder tabs are shown, horizontal swipes belong to the
pager (Telegram for Android). `chat-list-page.tsx` now renders plain `ChatRow`s
(dropped `onPref` / `openSwipeRef`), so `chat-rows.tsx` returns the bare row.
Removed the now-unused plumbing: `onPref` / `openSwipeRef` from `chat-list.tsx`
and `onPref={actions.saveChatPref}` from `(tabs)/index.tsx`. `saveChatPref` is
still used by the long-press sheet (`chat-actions-host.tsx`), so the Pin/Mute/
Archive actions stay available there and the swipe-error line keeps its source.
`chat-row-swipe.tsx` and `chat-rows.tsx` were **not** edited (outside Allowed
files). `ChatList` always shows the folder tabs, so the whole home list is plain;
the only other `ChatRow` caller (search results) never passed `onPref`, so no
other list changed.

**Item 3 — self-check by reading the code:**
- Page 2 ("AIs") renders its rows: the mounted range is `index ± 1`, each page is
  a `ChatListPage` with `folder={folders[page - 1]}` building its own
  `chatListModel(chats, { folder, search })`, and the page at `left: width` now
  sits inside the `count * width` track instead of being clipped.
- Tapping a tab animates to it: `FolderTabs.onSelect` → `onSelectFolder` → store
  `activeFolder` → `index` → the `useEffect` calls `animateToPage` (`withTiming`
  on `translateX` and `progress`).
- The indicator follows the drag: the pan's `onUpdate` writes `progress`, and
  each chip's `useAnimatedStyle` reads it to cross-fade the raised look.
I could not run an emulator here; this is a code read plus the type check and
gate below, not a live check.

Commands:
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json`: 0 errors.
- `pnpm exec oxlint` / `pnpm exec prettier --check` on the four changed files:
  clean.
- `pnpm gate` (repo root), real output:
  ```
  gate: waiting for a free gate slot
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (3.0s)
  PASS  format  (4.0s)
  PASS  lint  (3.4s)
  PASS  typecheck  (9.2s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (2.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No unit test added: the spec says "No tests (UI)".

`status` stays `review`.

### Round (fix round 3, fresh session, 2026-10-13)

Findings from `PREREVIEW.md` (HEAD `e240fc8`): must-fix=0, should-fix=1, nit=2,
follow-up=0. Steps below were re-derived in this session, not carried over.

- **Fixed: finding 1 (should-fix).** `apps/mobile/src/components/chat/folder-pager.tsx`
  now settles a cancelled/failed drag instead of stranding the track and the tabs
  between pages. `onEnd((event, success) => …)` early-returns when `success` is
  false, and a new `.onFinalize((_event, success) => …)` snaps the track and
  `progress` to the nearest page (`Math.round(-translateX / width)`, clamped to
  `[0, count - 1]`) when `success` is false, without reporting a page. I read the
  vendored `react-native-gesture-handler` 2.32.0 source
  (`GestureDetector/useAnimatedGesture.ts:148-164`): `END` runs
  `onEnd(success=true)` then `onFinalize(success=true)`; `FAILED`/`CANCELLED` run
  `onEnd(success=false)` only when the gesture was previously active, then
  `onFinalize(success=false)`. The `success` flag therefore settles exactly once
  on every path, the normal-release fling/distance commit in `onEnd` is unchanged,
  and a cancel never double-commits or leaves a half-raised chip.
- **Nits 2 and 3: not touched.** `folder-tabs.tsx` (mid-swipe text contrast) and
  `chat-list.tsx` (screen-level `archivedOpen` opens the footer on every mounted
  neighbour page) are cosmetic, the pre-review marked both as nits, and neither is
  on a line this round changed (only `folder-pager.tsx` changed). Per the
  fix-round rules they are left as they are.
- **Follow-ups: none** in the pre-review.

Tests: **none added.** The finding names no test; the Spec says "No tests (UI)"
and `AGENTS.md` gives UI code no tests. A new `*.test.ts` would also be a path
outside this task's Allowed files (the four chat sources, `(tabs)/*.tsx`, and this
task file), so the gate's scope check would fail. No test file was touched, so no
single test was run.

Disagreements: none, but one note. The pre-review's literal suggestion — a plain
`.onFinalize()` that always snaps to `Math.round(-translateX / width)` — would also
run right after `onEnd` on every normal release and could override a flick commit
with the *nearest* page (breaking fling), and `onEnd` already fires on a cancel when
the gesture was active (`useAnimatedGesture.ts:160-162`). Gating both handlers on
the built-in `success` flag keeps the nearest-page snap exactly for the cancel/fail
case the finding describes and leaves the normal-release commit in `onEnd`.

Commands:
- `pnpm gate` (repo root), real output:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (2.2s)
  PASS  lint  (1.4s)
  PASS  typecheck  (6.0s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (3.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  The first gate run failed `format` on the new `.onFinalize` block
  (`[warn] apps/mobile/src/components/chat/folder-pager.tsx`); I ran
  `pnpm exec prettier --write` on that one file and the gate above then passed.
- No single test was run: no test file was touched.

`status` stays `review`.

### Round (fix round 4, lead's emulator crash 2026-10-13 02:51)

**The first horizontal swipe crashed the app.**
`com.facebook.jni.CppException: [Worklets] Tried to synchronously call a Remote
Function … at folderPagerTsx2`. `onEnd`/`onFinalize` run on the UI thread as
worklets (RNGH workletises the gesture callbacks), but they called
`animateToPage` — a plain JS function with no `'worklet'` directive — so
Reanimated tried to make the UI Runtime synchronously call a Remote Function.

Fix: `animateToPage` in `apps/mobile/src/components/chat/folder-pager.tsx` now
starts with `'worklet';`. It is also called from the JS-side `useEffect` (line
150); calling a worklet function from the JS thread is fine, it just runs there.
The `withTiming` writes it performs are the same on either thread.

Callbacks and what they call (the gesture is `Gesture.Pan()` built in
`makePan`):
- `onStart(() => …)`: shared values only — reads `motion.translateX.value`,
  writes `motion.startX.value`.
- `onUpdate((event) => …)`: `Math`/arithmetic, and reads/writes
  `motion.translateX.value` / `motion.progress.value` — shared values only.
- `onEnd((event, success) => …)`: `Math.round`/`max`/`min`, `animateToPage(...)`
  (now a worklet), and `runOnJS(onIndexChange)(target)` — the one non-worklet
  callback, bridged with `runOnJS` as before.
- `onFinalize((_event, success) => …)`: `Math.max`/`min`/`round` and
  `animateToPage(...)` (now a worklet).

No other plain JS helper is called from a gesture callback; `runOnJS` is the
only bridge to JS.

Commands:
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json`: 0 errors.
- `pnpm gate` (repo root), real output:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.6s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.1s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/mobile  (1.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No unit test added (the Spec says "No tests (UI)"; a new test file is also
  outside this task's Allowed files) and no test file was touched.

`status` stays `review`.

## Review (written by Claude)

**Lead, 2026-10-13: approved after 2 lead fix rounds and 2 auto rounds.**
- **Lead round 1:**
  - pages after the first were blank and wouldn't swipe, because the track was translated and clipped; now there's a static clipped outer view and a translated inner track;
  - the lead decided that with folder tabs shown, horizontal swipes belong to the pager, and row actions stay on long-press.
- **Lead round 2:** the first swipe crashed the app (`animateToPage` called on the UI thread without `'worklet'`).
- **Lead's check on the emulator (mock release build):**
  - swipe left: All chats → Personal (Marta, Luis, Ana) → AIs (Dev AI, Marketing AI);
  - swipe right goes back, and tapping "All chats" jumps there;
  - a row tap opens the chat, and long-press still shows Pin, Mute and Archive;
  - 0 FATAL entries in logcat.
- **Lead's checks after the rebase:** mobile tsc: 0 errors; the largest file is 231 lines.
