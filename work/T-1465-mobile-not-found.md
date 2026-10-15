---
id: T-1465
title: "Mobile: an unknown route shows a Zilar 'Page not found' state with 'Back to chats' instead of Expo Router's stock 'Unmatched Route' page and its Sitemap link"
status: merged
milestone: M5
branch: task/T-1465-mobile-not-found
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1465: Mobile "Page not found"

## Spec (written by Claude, do not edit)

### Why
On the emulator, the deep link `zilar://contacts` opened Expo Router's stock "Unmatched Route" page:
- a large white title in the system font;
- the path;
- "Go back" and "Sitemap" links.

It isn't D24, and Sitemap lists every route in the app. It shows for any `zilar://` path that has no route, for example from an old notification or a mistyped link. App Links under `/settings/` already fall back to `/settings` (`apps/mobile/src/lib/web-link.ts:15`).

### Facts (the lead read them on main, 2026-10-15)
- **There is no `+not-found` route:** `apps/mobile/src/app/` holds `_layout.tsx`, `+native-intent.tsx` and the route folders.
- **The pattern to copy:** the "Chat not found" state (`apps/mobile/src/app/chat/[id].tsx:42-55`), which is:
  - a `SafeAreaView` (`flex-1 items-center justify-center bg-background`, `edges={['top']}`);
  - `StateMessage` (`apps/mobile/src/components/ui/state-message.tsx`) with `kind="empty"`, a title, and the action `Back to chats` → `goBackOrHome(router)` (`apps/mobile/src/lib/navigation.ts:10`).

### What to build
1. **A new `apps/mobile/src/app/+not-found.tsx`** (expo-router's not-found route), exporting the default screen.
   - Use the same `SafeAreaView` and `StateMessage`, with `kind="empty"`, the title "Page not found" and no hint.
   - The action is `Back to chats` → `goBackOrHome(router)`, with `accessibilityLabel` "Back to chats".
   - Get the router with `useRouter()` from `expo-router`.
2. Hide the stack header for this screen, the same way other full-screen states do (for example with `<Stack.Screen options={{ headerShown: false }} />` if the root stack shows headers). Check `apps/mobile/src/app/_layout.tsx` before choosing.
3. Nothing else changes. The file stays well under 400 lines.

### Tests
None (UI).

### Allowed files
`apps/mobile/src/app/+not-found.tsx`, `work/T-1465-mobile-not-found.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead opens `zilar://contacts` on the emulator and sees the Zilar state.

---

## Report (written by the worker when done)

### What I did

Added `apps/mobile/src/app/+not-found.tsx`, the expo-router not-found route, following
the "Chat not found" pattern in `apps/mobile/src/app/chat/[id].tsx:42-55`:

- a `SafeAreaView` (`flex-1 items-center justify-center bg-background`, `edges={['top']}`);
- `StateMessage` with `kind="empty"`, `title="Page not found"` and no `hint`;
- action `Back to chats` → `goBackOrHome(router)`, with `accessibilityLabel: 'Back to chats'`;
- router from `useRouter()` (`expo-router`), whose return type is `ImperativeRouter`, the
  exact type `goBackOrHome` expects (`apps/mobile/src/lib/navigation.ts:10`).

### Header (spec point 2)

I checked `apps/mobile/src/app/_layout.tsx` first: the root stack renders
`<Stack screenOptions={{ headerShown: false }} />` (line 126), and nothing in
`apps/mobile/src` uses `Stack.Screen` (grep: no matches). Headers are already off for
every screen, so no `<Stack.Screen>` override was needed to hide the header for this
route.

### Files changed

- `apps/mobile/src/app/+not-found.tsx` (new, 20 lines)
- `work/T-1465-mobile-not-found.md` (status + this Report)

### Commands run (real results)

- `pnpm install` — "Done in 11.4s" (warnings only, no errors).
- `pnpm gate` — ends with `GATE PASS`. Summary lines:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- Single tests: none. The spec says "Tests: None (UI)", and the gate reported
  `SKIP tests @zilar/mobile (no nearby test files)`.

### Deviations / open questions

- None. The spec's step 2 is satisfied by the global `headerShown: false`; no per-screen
  `<Stack.Screen>` was added because the root stack does not show headers.
- Acceptance item 2 (the lead opens `zilar://contacts` on the emulator) needs the lead's
  device; I could not run it here.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- On the emulator, `zilar://contacts` shows "Page not found" with "Back to chats", which returns to Chats.
- **Note:** the first smoke still showed Expo's page, because the phone build's Metro cache missed the new route file. The bundle had no "Page not found". After clearing `$TMPDIR/metro-cache` it was right. The script fix is a separate task.
