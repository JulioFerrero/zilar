---
id: T-1997
title: "Claude performance audit: why the phone chat scrolls janky (Android), why older messages load slowly, and the stutter when a page of history arrives — ranked causes with file:line and a concrete fix plan (FlashList v2 / LegendList / tuned FlatList), written to docs/audit/chat-scroll-perf.md"
status: merged
milestone: M5
branch: task/T-1997-claude-audit-chat-scroll
model: anthropic/claude-opus-5-5
effort: high
estimate: 45 min
---

# T-1997: Chat scroll performance audit

## Spec (written by Claude, do not edit)

### Why
On 2026-10-18 Julio said this about the live 0.2.12 Android app:
> the scroll up and the scroll down in the chat is super junky and sluggish, and the slow loading of old messages is horrible and one time, scrolling up, instead of normal scroll, just did like a little scroll, like 4 or 5 times with small scroll and then boom returned to scroll normal almost in 4 fps

He wants it as smooth as Telegram or WhatsApp. This task only **finds**: it is read-only, and later tasks build the fix. Unlike the security audits, the findings are not secret: write them to a doc in the repo.

### Facts (read by the lead on 2026-10-18)
- **Stack.**
  - Expo `~57.0.25`, React Native `0.86.3` on the new architecture, `react-native-reanimated` `4.5.1` (`apps/mobile/package.json`).
  - No FlashList or LegendList is installed.
- **The list.** `apps/mobile/src/components/chat/message-list.tsx` renders a React Native `FlatList` (`:308-360`):
  - `inverted`;
  - `initialNumToRender={20}`, `windowSize={11}`, `maxToRenderPerBatch={10}`;
  - `maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 40 }}`;
  - `onEndReachedThreshold={0.5}`, where `onEndReached` calls `loadOlder(chat.id)`;
  - `onScroll` with `scrollEventThrottle={16}`;
  - no `getItemLayout`.
- **Its data.** It is rebuilt with `[...entries].reverse()` on every change (`:202`).
- **Row components.** `renderItem` is a `useCallback` with about 24 dependencies (`:229-290`).
- **History.** `packages/client-core/src/store/history.ts`: `loadOlder` (`:254`) pages through XMPP MAM, `PAGE_HISTORY_MAX = 50` (`packages/client-core/src/store/history-core.ts:9`).
- **Store reads in rows.**
  - Each `EntityAvatar` (`apps/mobile/src/components/chat/entity-avatar.tsx:38-39`) subscribes to the whole `contacts` and `chats` arrays of the store.
  - `message-bubble.tsx` subscribes to `state.chats.find(...)` and others (`:72-95`).
- **Files on the render path** (all in `apps/mobile/src/components/chat/`):
  - `message-list-row.tsx`, `message-bubble.tsx`, `message-bubble-content.tsx`, `message-bubble-decor.tsx`, `message-bubble-actions.tsx`, `bubble-gesture.tsx`;
  - `markdown-text.tsx`, `markdown-decision.ts`, `markdown-table.tsx`, `plain-bubble-body.tsx`;
  - `media-bubble.tsx`, `file-bubble.tsx`;
  - `use-bubble-reveal.ts`, `use-message-list-scroll.ts`, `jump-scroll.ts`.

### What to find (each finding needs `file:line`, a mechanism and a cost estimate)
1. **Per-frame work during a scroll.**
   - Row re-renders triggered by store changes: whole-array selectors, new object props, unstable callbacks.
   - Expensive render work per row (Markdown parsing, link detection, date formatting, emoji splitting) that is not memoised.
   - Gesture or animation handlers on every row (reveal, swipe-to-reply, long-press).
   - Image decoding.
   - JS-thread work in `onScroll`.
2. **Loading older messages.**
   - What happens from `onEndReached` to rows on screen: the network round trips, how the 50-message page is processed and merged, how many store updates and re-renders it causes.
   - Why the inverted list combined with `maintainVisibleContentPosition` on Android can produce the "several small scrolls, then a jump, then 4 fps" effect.
   - When the next page should start loading so that a normal fling never reaches the end. Consider prefetching.
3. **The list engine.** Compare three options for this app (React Native 0.86 on the new architecture, Expo 57):
   - keep a tuned `FlatList`;
   - move to FlashList v2 (`@shopify/flash-list` 2.x: `maintainVisibleContentPosition`, `startRenderingFromBottom` for chat, no inversion);
   - move to LegendList.

   Recommend one, with the exact props, the migration steps and the risks: jump-to-message, the unread divider, keeping position when older pages arrive, staying at the bottom for new messages, and the reveal animation.
4. **The web chat.** Briefly check whether the web chat (`apps/web`) has the same row re-render causes, so the fix plan covers both apps where they share code (`packages/client-core`).

### Output
- **A new doc, `docs/audit/chat-scroll-perf.md`,** containing:
  - a ranked table of causes (impact, effort, `file:line`);
  - one section per cause;
  - the list-engine recommendation;
  - a fix plan split into 3 to 6 small worker tasks, each with exact files (at most 400 lines per file) and how the lead will measure it. The lead uses `adb shell dumpsys gfxinfo app.zilar.chat framestats` on the Android emulator while scrolling, and the time from `onEndReached` to rows rendered.
- **This task file's Report:** a 5-line summary.
- **Read only.** Change no source file.

### Allowed files
- `docs/audit/chat-scroll-perf.md`
- `work/T-1997-claude-audit-chat-scroll.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The doc exists, with ranked causes, `file:line` references, the engine recommendation and the task split.
- No source file changed.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/chat-scroll-perf.md`. No source file changed. I only read code (mobile, web, `client-core`, `chat-core`, and the installed `VirtualizedList`, TrueSheet, RNGH `ReanimatedSwipeable` and RN Android scroll sources). I also checked the FlashList v2 and LegendList 3 docs and their npm versions.

5-line summary:
1. **Slow loading and the small scrolls:** the older page is requested only half a screen before the end, with no prefetch. A fling hits the wall before the MAM page arrives (C1, `message-list.tsx:346-351`, `VirtualizedList.js:1527-1590`). The fix is a threshold of 3 viewports plus a one-page prefetch.
2. **Stutter when a page lands:** the shared `client-core` store applies the page as a burst of `set` calls, one or two per reaction stanza and one to three per edit stanza. Each one walks the whole list and fans out to about 1,000+ row selectors. The merge is O(page × loaded) (C4, `history.ts:61-86`). AI chats pay the most.
3. **4 fps and janky scrolling both ways:** every row is very expensive to mount:
   - 1 to 2 native TrueSheet hosts per row for the long-press menu (C2);
   - a full ReanimatedSwipeable stack with 9 shared values, Tap + Pan and an eagerly drawn SVG, plus a second Tap detector (C3);
   - a Keystore read per avatar, image and sticker, and link previews that grow after mount (C7).

   `FlatList` mounts these 10 at a time every 50 ms and never recycles them.
4. **Re-render fan-out:** `selection` is a new object on every chat-screen render (`use-chat-screen.ts:140`). Every message change therefore re-renders every mounted cell (C5). Rows also subscribe to whole `contacts`/`chats`/messages arrays (C6). Web has C4 and C10 through shared code, plus per-row menus and whole-array avatar selectors.
5. **Plan:** six worker tasks. W1 is the shared store batch. W2 to W4 cut the mobile row cost: prefetch and fan-out first, then one menu and one gesture per row, then the row leaves. W5 is web parity. W6, FlashList v2, comes only if the measurement after W4 still misses the target. LegendList 3 is the fallback.

### Checks run
- `pnpm install`: done (53.8 s).
- `pnpm gate`: exit 0. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (5.7s)
  PASS  format  (1.7s)
  PASS  lint  (4.7s)
  PASS  typecheck  (2.8s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I ran no tests: the task is doc-only.
- I ran no emulator and no profiler. Every cost in the doc is an estimate from the code and is labelled as one. Section 5 of the doc is the baseline protocol for the lead.

### Notes for the lead
- **Decision needed (security), W4:** C7 needs the session token cached in JS memory. Today every avatar, image and sticker mount does a SecureStore/Keystore read (`session-token.ts:8-17`). I propose a module-level cache that is cleared on sign-in, sign-out and session change. I did not decide this; please confirm before W4.
- **Decision needed (dependency), W6:** FlashList v2 is a new dependency. Expo 57's `bundledNativeModules.json` lists `@shopify/flash-list` `2.0.2`, while npm `latest` is `2.3.3`. Install it with `npx expo install`. W6 is conditional on the measurement after W4.
- **Order:** W2, then W3, then W4 must run one after another (they share `message-bubble.tsx` and `message-list.tsx`). W1, W5 and W6's spike do not overlap with them.
- **Files near the 400-line limit:** `ledger-edits.ts` (399), `media-bubble.tsx` (396), web `MessageBubble.tsx` (394). The plan marks them net-negative. `history.test.ts` is already 474 lines, so W1's tests go in a new file.
- **Side finding:** after a failed older-page load, `onEndReached` re-fires only once the reader scrolls out of the threshold and back (`VirtualizedList.js:1611-1613`). W2's prefetch includes one retry.

### Round 2 (fix round)
- **Finding 1 (should-fix), fixed:** the C2 table row and the C2 section cited `action-sheet.tsx:85-130`, which read as `components/chat/`. Both now cite `apps/mobile/src/components/ui/action-sheet.tsx:85-130`. I checked that the `TrueSheet` element starts at line 85 there.
- **Findings 2 and 3 (nits):** not touched, per the round rules (they are on lines I did not change).
- **Tests:** none added or run. This is a doc-only change with no behaviour fix.
- **Disagreements:** none.
- **Gate:** `pnpm gate` finished with exit 0. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (3.0s)
  PASS  format  (0.9s)
  PASS  lint  (1.9s)
  PASS  typecheck  (2.1s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

## Review (written by Claude)

Approved: a clean pre-review after one round, with 3 citation nits.
- **What the doc covers.**
  - It ranks 12 causes and traces Julio's three symptoms end to end.
  - It recommends FlashList v2, but only after the row diet.
  - It splits the fix into six worker tasks (W1 to W6), each with its files and how to measure it.
- **Next.** The lead runs W1 (history page in one store update) and W2 (prefetch and no re-render fan-out) first, then W3 and W4 in sequence. W6 runs only if the measurement still misses the target.
