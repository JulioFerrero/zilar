---
id: T-1934
title: "Phone chat list: the Archived (N) entry and its rows scroll inside the list (ListFooterComponent) instead of a fixed block under it that slides under the bottom bar"
status: merged
milestone: M5
branch: task/T-1934-phone-archived-in-list
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1934: Archived chats scroll with the list

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:**

> also problems with the archived chats lol the archives chats goes under the bottom part is super broken in android and ios

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/chat-list-page.tsx`** (151 lines):
  - the `FlatList` (`:76-120`) has `contentContainerStyle={{ paddingBottom: 180 }}`, a `ListHeaderComponent` and a `ListEmptyComponent`;
  - **after** the `FlatList`, a sibling `View` (`:121-148`) holds the "Archived (N)" toggle (`Pressable` with the `Archive` icon), and `archivedOpen ? archived.map(<ChatRow …/>) : null`.
- **The cause:** that block is outside the scroll view. It sits fixed at the bottom of the page, under the new-chat button and the tab bar. Opening it pushes rows past the screen edge, where they can't be scrolled to.

### Steps
1. **`chat-list-page.tsx`:**
   - Move the whole archived block (the toggle and the rows, unchanged) into the `FlatList`'s `ListFooterComponent`, rendered only when `archived.length > 0`.
   - Delete the sibling `View` and the wrapping fragment if it is no longer needed.
   - Keep `paddingBottom: 180`, so the footer clears the floating button and bar at the end of the scroll.
2. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/chat-list-page.tsx`
- `work/T-1934-phone-archived-in-list.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The "Archived (N)" entry** sits at the end of the chat list and scrolls with it.
- **Opening it** lists the archived chats inside the scroll, all reachable above the bottom bar and the new-chat button.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Moved the whole "Archived (N)" block — the toggle `Pressable` and the opened archived `ChatRow`s, unchanged — from a sibling `View` after the `FlatList` into the `FlatList`'s `ListFooterComponent`, rendered only when `archived.length > 0`.
- Deleted the now-unneeded wrapping fragment around the `FlatList`; the list is the only child of the return. Kept `contentContainerStyle={{ paddingBottom: 180 }}`.
- `apps/mobile/src/components/chat/chat-list-page.tsx` is 151 lines (limit 400). Only that file changed besides this task file.

### Checks run
- `pnpm install` — completed, exit 0.
- `pnpm gate` — exit 0, ended with `GATE PASS`:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (7.5s)
  PASS  format  (2.2s)
  PASS  lint  (3.0s)
  PASS  typecheck  (6.9s)
  PASS  effect  (2.4s)
  PASS  tests @zilar/mobile  (4.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single-file test runs: the spec says no tests (UI change).

### Notes for the lead
- The "Archived (N)" entry now sits at the very end of the chat list and scrolls with it; opening it extends the footer, so the archived rows are inside the scroll view and clear the bottom bars at the end of the scroll via `paddingBottom: 180`.
- I did not run a simulator or phone check here, so the lead's phone smoke should confirm reachability on Android and iOS.
- No deviations from the spec, no new dependencies, no changes outside the Allowed files.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `30642a735`.
- **Smoke:** passes on the emulator (mock, `/`). The first run failed transiently, and the rerun passed.
- **Checked on screen:** I archived Marta's chat from the long-press sheet.
  - "Archived (1)" now sits at the end of the chat list and scrolls with it.
  - Opening it shows Marta's row inside the scroll, fully above the tab bar and the new-chat button.
