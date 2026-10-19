---
id: T-2226
title: "Web message list on virtua: the hand-made window (WINDOW=150, grow, prepend compensation) becomes a virtua VList with shift + scrollToIndex, keeping every scroll behaviour"
status: merged
milestone: M5
branch: task/T-2226-web-list-virtua
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2226: Web message list on virtua

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: "List libraries" (prefer libraries over hand-rolled code). The web message list draws the newest 150 items and grows by hand, with prepend compensation, so the DOM keeps every row as you scroll up. `virtua` (MIT, small, built for chat: `shift` for prepends, `scrollToIndex`, `reverse`) only draws what is on screen.

### Facts (read by the lead on 2026-10-19)
1. **`apps/web/src/components/MessageList.tsx`** (740 lines):
   - `useMessageWindow` (`:203-270`): `WINDOW = 150`, `grow`, a reveal set for jump targets;
   - the scroll logic inside `MessageList` (`:330-520`): initial scroll, prepend compensation through `prependScrollHeight`, bottom pinning within `NEAR_BOTTOM_PX = 80` for new messages, a growing draft and the AI reveal (with a `ResizeObserver`), a scroll-to-bottom key, the older-page load (`store.loadOlder`), and a stuck-load guard;
   - `anchorAt`, `scrollToAnchor`, `useScrollMemory` and `useInitialScroll` (`:627-740`): the per-chat position memory, and opening at the unread divider.
2. **Jumps from elsewhere.** `scrollToMessage(id)` (`apps/web/src/lib/scrollToMessage.ts`, 30 lines) finds the DOM row. It is called from `PinnedBanner`, `PinsPanel`, `MessageSearchResults`, `MediaBody`, `AisHereKey`, `ChatView` and `MessageBubble` (the reply quote). The store's reveal set (`apps/web/src/store/effects/history.ts:54-60`) asks the list to draw a message that is not rendered yet.
3. **Mock test bed.** The Viernes room (`viernes@rooms.zilar.test`) has an 800-message backlog paged 50 at a time (`packages/mock-backend/src/domains/messages/threads/long.ts`).

### Steps
1. `pnpm --filter @zilar/web add virtua`. The lockfile pins it.
2. **Render the rows in a virtua `VList`** (or `Virtualizer` in the existing scroll container if that keeps the layout simpler), with `shift` set while older items are prepended. Delete `useMessageWindow`'s windowing and the `prependScrollHeight` compensation.
3. **Keep every behaviour below.** Each one must work in the Viernes room:
   - First open lands at the unread divider when there are unread messages, else at the bottom.
   - Reopening a chat restores the reading position. Use virtua's `cache` and offset, or keep `useScrollMemory` if that is shorter.
   - `scrollToMessage(id)` still reaches a message that is far above and not drawn, and highlights it as today. Route it through the list (`scrollToIndex`), keeping its exported signature so the 7 callers do not change.
   - Scrolling to the top loads older pages with no visible jump.
   - New messages, a growing draft and the AI reveal keep the view at the bottom only when the reader was within 80 px of it. The scroll-to-bottom key still works.
   - The stuck older-load guard, the unread divider, the day separators and `MessageAnnouncer` stay.
4. **Stop rule:** net at least −80 over `apps/web` (not counting `pnpm-lock.yaml`), with every behaviour kept. If either fails, stop and say which in the Report.
5. Comments follow `docs/COMMENTS.md`. Keep the "why" lines that still apply.

### Allowed files
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/MessageListRow.tsx`
- `apps/web/src/lib/scrollToMessage.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `work/T-2226-web-list-virtua.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; no new tests (UI).
- Net at least −80 in `apps/web`.
- The lead checks every behaviour in step 3 in web mock (Viernes, Dev team › General, a DM), against main:
  - the rendered row count after scrolling up 300 messages is far below main's;
  - nothing jumps on prepend;
  - a pin, a search hit and a reply quote all jump and highlight.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

### What I did

- Added `virtua` (`^0.53.5`) to `apps/web`.
- Replaced the hand-made window (`WINDOW = 150`, `grow`, `prependScrollHeight`) with one `VList` over all render items, so only the rows on screen are in the DOM.
- Prepends shift in place: `shift` is true only while an older page is loading and the first message actually changed, so an appended message during that window is not mistaken for a prepend.
- Kept the initial position: a remembered anchor, else the unread divider (`scrollToIndex`), else the bottom (`scrollTo`). The divider, day separators and `MessageAnnouncer` are unchanged.
- Replaced the DOM-based scroll memory with a per-chat anchor read from the virtua handle (`findItemIndex` + `getItemOffset`). A reopened chat returns to the same message and pixel offset, or to the bottom if that is where the reader was.
- `scrollToMessage` keeps its exported signature and DOM pulse. When the row is not drawn it asks the mounted list to `scrollToIndex`, then pulses the row once virtua renders it. The seven callers are unchanged.
- Older paging starts at the top (`offset < 80`), the 8 s stuck guard and the `hasMore` stop remain. The "Loading older messages" line is now an overlay at the top of the list so it does not change item sizes while a page is in flight.
- New messages, a growing draft and the AI reveal pin the bottom only when the reader is within `NEAR_BOTTOM_PX` (80). Virtua's `onResize` replaces the old `ResizeObserver`; the scroll-to-bottom button and its pending count still work.
- Updated the reveal comment in `history.ts`; the reveal store itself is unchanged.

### Files changed

- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/MessageListRow.tsx`
- `apps/web/src/lib/scrollToMessage.ts`
- `apps/web/src/store/effects/history.ts` (comments only)
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `work/T-2226-web-list-virtua.md`

### Commands run

- `pnpm install` — done in 20.4s (17 workspace projects, 1155 packages).
- `pnpm --filter @zilar/web typecheck` — passed.
- `pnpm gate` — **GATE PASS**:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.7s)`
  - `PASS  typecheck  (2.5s)`
  - `PASS  effect  (0.4s)`
  - `PASS  build @zilar/server  (0.5s)`
  - `PASS  tests @zilar/web  (3.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `WARN  size: apps/web/src/components/MessageList.tsx: 623 lines (main 740); limit 400 (soft limit 400; fine when keeping the file whole saves lines)`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
- No single test files were run: the change is UI and adds no tests, so the gate's `tests @zilar/web` step is the test run.
- Net over `apps/web` excluding `pnpm-lock.yaml` (`git diff --numstat apps/web`): **−88** (MessageList −117, MessageListRow −2, scrollToMessage +30, history 0, package.json +1).

### Problems / deviations

- I did not run the web app in a browser, so the visual checks in step 3 (divider landing, no jump on prepend, pin/search/quote jumps) are implemented but not observed here; the lead's mock check covers them.
- The scroll memory keeps the per-chat `{ messageId, offset, bottom }` in a module-level map (as before) instead of using virtua's `cache`; the spec allowed keeping `useScrollMemory` if shorter, and this version reads offsets from the virtualizer so an off-screen anchor is reachable.
- The "Loading older messages" line moved from the content flow to a top overlay, as noted above.

### Open questions

None.

### Round 1 (pre-review fixes)

**Findings fixed:** #1 (must-fix) — the three non-bottom initial-scroll branches (`pendingJump`/reveal, restored anchor, unread divider) now update the `atBottom` state as well as `atBottomRef`, so the scroll-to-bottom button appears immediately after reopening a chat above the bottom. Because the initial position is chosen in a layout effect and the lint rule `react(set-state-in-effect)` rejects a synchronous `setState` there, the state update goes through `markAtBottomAfterCommit` (`queueMicrotask`) while the ref stays synchronous for scroll events in the same tick.

**Not changed:** #2 is a nit and not on a line this round changes; left as is per instructions.

**Tests added:** none. The task spec says "no new tests (UI)", the finding names no test, and `apps/web` has no `MessageList` test harness.

**Gate:** `pnpm gate` — **GATE PASS**:
- `PASS  install (frozen)  (1.7s)`
- `PASS  format  (0.6s)`
- `PASS  lint  (0.8s)`
- `PASS  typecheck  (0.7s)`
- `PASS  effect  (0.4s)`
- `PASS  build @zilar/server  (0.5s)`
- `PASS  tests @zilar/web  (4.2s)`
- `scope: every changed file is inside the Allowed files`
- `WARN  size: apps/web/src/components/MessageList.tsx: 629 lines (main 740); limit 400 (soft limit 400; fine when keeping the file whole saves lines)`
- `GATE PASS`

No single test files were run: the round is UI-only and adds no tests.

**Disagreements:** none.

### Round 2 (lead review fixes)

**Fixed 1 (open at the bottom):** the initial scroll target (fresh bottom, restored bottom, or unread divider) is now kept as a `ScrollTarget` and re-applied by `handleResize` while virtua's row measurements change, until 400 ms pass without a resize. During that window `handleScroll` reports `atBottom` from the target instead of the not-yet-final `scrollSize`, so the jump-to-latest button does not appear and the bottom is not abandoned early. Explicit jumps and the scroll-to-bottom button cancel the settle. The initial bottom target (and the restored bottom) now ends on the measured last row rather than the estimated height.

**Fixed 2 (scroll memory one row off):** `useScrollMemory.restore` now returns a re-applicable target (`scrollToIndex(index, { align: 'start', offset: -anchor.offset })`) instead of scrolling once. The same settle loop re-applies it as the anchor row is measured, so the saved message and pixel offset are restored exactly even when the row was off screen and virtua only had an estimate. The save format (`messageId`, `offset`, `bottom`) is unchanged.

**Behaviour re-checked in code:** the unread path still targets `dividerIndex` (`align: 'start'`, unchanged), the no-unread path targets the bottom, and the 8 s stuck-load guard, prepend `shift`, `hasMore` stop, `MessageAnnouncer` and day separators are untouched.

**Tests added:** none, as the spec says "no new tests (UI)" and `apps/web` has no `MessageList` test harness.

**Gate:** `pnpm gate` — **GATE PASS**:
- `PASS  install (frozen)  (1.0s)`
- `PASS  format  (1.2s)`
- `PASS  lint  (0.7s)`
- `PASS  typecheck  (0.7s)`
- `PASS  effect  (0.4s)`
- `PASS  build @zilar/server  (0.5s)`
- `PASS  tests @zilar/web  (3.8s)`
- `scope: every changed file is inside the Allowed files`
- `WARN  size: apps/web/src/components/MessageList.tsx: 671 lines (main 740); limit 400 (soft limit 400; fine when keeping the file whole saves lines)`
- `GATE PASS`

**Not verified here:** I could not open the web mock in a browser in this session (no dev server may be started), so the bottom distance and the exact anchor restore still need the lead's Playwright check.

**Disagreements:** none.

### Round 3 (stop-rule trim)

**Fixed 1 (should-fix, stop rule):** trimmed only task-added scroll code in `MessageList.tsx`
(working diff 27+/75−, net −48), restoring the stop rule: net over `apps/web` vs the
branch base is now **−88** (was −40). Mechanical compression, no behaviour change:
- folded `markAtBottomAfterCommit` into `markAtBottom`: the ref stays synchronous for
  scroll logic and the state update is always deferred via `queueMicrotask`, the same
  guarantee the wrapper gave the layout effect, now uniform (button visibility still
  updates before paint, since microtasks run first);
- merged the restored-vs-fresh initial target with `??` into one `markAtBottom` +
  `startSettle` pair; inlined the single-use `addPending` wrapper;
- collapsed single-statement guards/branches to one line in the prepend/added block,
  `handleResize`, `handleScroll`, the register/reveal effects, `scrollToBottom`, and
  `useScrollMemory`; shortened the two fix-round WHY comments.
Pre-existing lines (the stuck-load `Effect` guard, the `hasMore` effect, the VList JSX,
the row wrapper) are untouched.

**Nits #2 (`scrollToMessage`) and #3 (settle re-arm):** semantics unchanged. #2's file is
untouched. #3's `handleResize` was reflowed by the trim but still re-applies the target
on every resize with no cap and no user-scroll cancel, exactly as the finding describes;
bounding that would change behaviour and is the lead's call.

**Tests added:** none. The finding names no test, the spec says "no new tests (UI)", and
UI code gets no tests per AGENTS.md. No single test files were run; the gate's
`tests @zilar/web` step is the test run.

**Gate:** `pnpm gate` — **GATE PASS**:
- `PASS  install (frozen)  (1.3s)`
- `PASS  format  (1.4s)`
- `PASS  lint  (0.9s)`
- `PASS  typecheck  (3.1s)`
- `PASS  effect  (0.5s)`
- `PASS  build @zilar/server  (0.5s)`
- `PASS  tests @zilar/web  (6.1s)`
- `scope: every changed file is inside the Allowed files`
- `WARN  size: apps/web/src/components/MessageList.tsx: 623 lines (main 740); limit 400 (soft limit 400; fine when keeping the file whole saves lines)`
- `GATE PASS`

**Disagreements:** none.


## Review (written by Claude)

Approved after 2 auto rounds and 1 lead round. Net −88 (stop rule −80), plus virtua 0.x in `apps/web`.

**What changed:** the web message list renders through virtua's `VList` instead of a 150-item window with manual prepend compensation. `scrollToMessage` registers a jump for rows not yet drawn.

**Lead checks** (web mock, Playwright, branch vs main):
- Viernes (800 messages) opens at the bottom: distance 0, the same as main.
- The DOM holds 10–13 bubbles while scrolling the whole backlog (main holds 226).
- An older page does not move the reader's top message.
- The pin jump in Ana's DM lands with the outline.
- Scroll memory comes back to the same top message, but about 225 px short (main is exact). Accepted here: the list rewrite (map T-2230, step 2) re-lands this list on the shared row builder, and its spec asks for an exact restore.

## Review (written by Claude)

Approved after 2 auto rounds and 1 lead round. Net −88 (stop rule −80), plus virtua 0.x in `apps/web`.

**What changed:** the web message list renders through virtua's `VList` instead of a 150-item window with manual prepend compensation. `scrollToMessage` registers a jump for rows not yet drawn.

**Lead checks** (web mock, Playwright, branch vs main):
- Viernes (800 messages) opens at the bottom: distance 0, the same as main.
- The DOM holds 10–13 bubbles while scrolling the whole backlog (main holds 226).
- An older page does not move the reader's top message.
- The pin jump in Ana's DM lands with the outline.
- Scroll memory comes back to the same top message, but about 225 px short (main is exact). Accepted here: the list rewrite (map T-2230, step 2) re-lands this list on the shared row builder, and its spec asks for an exact restore.
