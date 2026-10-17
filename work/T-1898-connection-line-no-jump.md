---
id: T-1898
title: "Smoother connection line: the phone waits 1.5 s before showing 'Connecting…' (useDelayed twin of web), and on web and phone the line floats over the top of the chat list instead of pushing the chats down; the phone chat header's status also waits 1.5 s"
status: merged
milestone: M5
branch: task/T-1898-connection-line-no-jump
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1898: The connection line never makes the chats jump

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:** "if i close the app and open again i will not like the 'connecting' that moves all the chats down, and 1second later disapear to move again all the chats up, all this connection system needs to be smoother".

### Facts (read by the lead on 2026-10-17)
- **Phone:**
  - `apps/mobile/src/app/(tabs)/index.tsx:40-41` computes `connection = connectionLabel(status)` with no delay and passes it to `ChatList` (`:200`);
  - `apps/mobile/src/components/chat/chat-list.tsx:102-106` **inserts** a row `<View className="border-b border-divider px-3 py-1"><Text …>{connection}</Text></View>` between `FolderTabs` and the list, so the list moves down and back up;
  - `apps/mobile/src/lib/connection.ts` gives the label;
  - the chat header uses the same label with no delay (`apps/mobile/src/components/chat/chat-header.tsx:117,122`). It sits in the subtitle (no jump), but it still flashes.
- **Web:**
  - `apps/web/src/components/ChatList.tsx:61` already uses `useDelayed(statusLabel(storeStatus), CONNECTION_BANNER_DELAY_MS)`; the constant is 1500, in `apps/web/src/components/chatList/rowsSelector.ts:5`;
  - but it still **inserts** a row (`ChatList.tsx:157-161`), which jumps after a slow reconnect.
- **`useDelayed`** (`apps/web/src/lib/useDelayed.ts`): returns `value` once it has stayed the same for `delayMs`; clearing is immediate. The phone has no twin. Phone timers use `runLater` / `interruptFiber` from `apps/mobile/src/lib/effect/timers`.

### Steps
1. **Phone helper:** new `apps/mobile/src/lib/use-delayed.ts`, the same contract as the web `useDelayed`, with a React state + `runLater`/`interruptFiber` (or `setTimeout`), cleared on change and unmount. Include its doc comment.
2. **Phone chat list:** in `index.tsx`, `const connection = useDelayed(connectionLabel(status), 1500)`.
3. **Phone chat header:** `chat-header.tsx` uses `useDelayed(connectionLabel(status), 1500)` the same way.
4. **Phone `chat-list.tsx`:** stop inserting the row. Wrap the area below `FolderTabs` in `<View className="flex-1">` (keep the existing children order) and render the label as an overlay:
   ```tsx
   <View pointerEvents="none" className="absolute left-0 right-0 top-2 z-10 items-center">
     <View className="rounded-full border border-divider bg-surface-raised px-3 py-1">
       <Text className="text-[12px] text-muted-foreground">{connection}</Text>
     </View>
   </View>
   ```
   The list never changes position. Keep `accessibilityLiveRegion="polite"` on the text.
5. **Web `ChatList.tsx`:** the same overlay. Give the list region `relative`, and render the label as `absolute inset-x-0 top-2 z-10 flex justify-center pointer-events-none` with a pill `rounded-full border border-border bg-surface-raised px-3 py-1 text-[12px] text-muted-foreground`. Remove the inserted row, keep `useDelayed`, and keep `role="status"` / `aria-live="polite"` if the row had them (add them otherwise).
6. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/lib/use-delayed.ts`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/components/chat/chat-list.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/web/src/components/ChatList.tsx`
- `work/T-1898-connection-line-no-jump.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A reconnect under 1.5 s shows nothing** on phone and web.
- **A longer one** shows a small "Connecting…" pill over the top of the list, and the chats never move.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/lib/use-delayed.ts`, the phone twin of the web
  `useDelayed`: it returns `value` only once it has stayed the same for
  `delayMs` (a `runLater` fiber that is interrupted on change and unmount),
  and returns `undefined` at once when the value clears or changes. Clearing
  is done with a render-phase state adjustment, the same pattern the screens
  already use, so the lint rule against `setState` in an effect stays happy.
- `apps/mobile/src/app/(tabs)/index.tsx`: the chat list now reads
  `useDelayed(connectionLabel(status), 1500)`.
- `apps/mobile/src/components/chat/chat-header.tsx`: the header subtitle uses
  the same delayed label, so it no longer flashes on a quick reconnect.
- `apps/mobile/src/components/chat/chat-list.tsx`: the connection row is gone;
  the area below `FolderTabs` is wrapped in `<View className="flex-1">` (same
  children order) and the label is now a `pointerEvents="none"` pill at
  `absolute left-0 right-0 top-2 z-10`, with `accessibilityLiveRegion="polite"`
  on the text. The chats never move.
- `apps/web/src/components/ChatList.tsx`: the inserted row is gone;
  `ChatListBody` is wrapped in `relative flex min-h-0 flex-1 flex-col` and the
  label is a `pointer-events-none absolute inset-x-0 top-2 z-10 flex
  justify-center` pill (`rounded-full border border-border bg-surface-raised
  px-3 py-1 text-[12px] text-muted-foreground`) with `role="status"` and
  `aria-live="polite"`. `useDelayed` and `CONNECTION_BANNER_DELAY_MS` are
  unchanged.
- No tests, per the spec (UI only). No new dependencies.

### Checks run

- `pnpm install`: done, 16.4s, no errors.
- `pnpm gate` from the repo root (final run):

  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/mobile
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- While iterating I ran `pnpm exec oxlint apps/mobile/src/lib/use-delayed.ts`
  (single file) after the first gate run failed on
  `react(set-state-in-effect)`; it reported no problems. No other single test
  files were needed for this UI change.

### Notes for the lead

- Lint rejects `setState` inside an effect (`react(set-state-in-effect)`), so
  the phone hook clears the settled value during render (conditional, like the
  existing `lastChatsLoad` / `lastSearchChatParam` adjustments) instead of in
  the effect. Behaviour: a value clears immediately; a value that changes and
  comes back waits out a fresh 1.5 s.
- The web banner constant stays `CONNECTION_BANNER_DELAY_MS = 1500` in
  `rowsSelector.ts`; the phone uses the spec's literal `1500` in both call
  sites. If you'd rather have one shared constant for the phone, say so and I
  can export it from `use-delayed.ts` in a follow-up.
- `role="status"` + `aria-live="polite"` were not on the old row, so I added
  them as the spec asks.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `1a9056506`.
- **The phone hook:** `useDelayed` matches the web contract. A value shows after it has held for 1.5 s, and clearing is immediate. The chat list and the chat header both use it.
- **The pill:** on both apps, "Connecting…" is a pill floating over the list (phone `pointerEvents="none"`, web `pointer-events-none`), so the chats never move. The inserted rows are gone.
- **Not shown on the emulator or in web mock:** both are always online. It goes on the live-check list: close and reopen the app, and a reconnect under 1.5 s shows nothing.
