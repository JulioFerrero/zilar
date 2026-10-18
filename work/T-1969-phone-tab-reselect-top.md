---
id: T-1969
title: "Phone parity: tapping the active bottom tab (Chats, AIs, Settings) scrolls its list to the top, like Telegram and WhatsApp"
status: merged
milestone: M5
branch: task/T-1969-phone-tab-reselect-top
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-1969: Re-tapping the active tab scrolls to the top (phone)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, chose this from the Telegram/WhatsApp gaps in `docs/audit/ui-consistency.md` §6 item 2.

Today, tapping the tab you are already on does nothing (`components/nav/floating-tab-bar.tsx` only navigates). In Telegram and WhatsApp, it scrolls that tab's list back to the top.

### Facts (read by the lead on 2026-10-18; paths under `apps/mobile/src/`)
- **The tab bar.** `components/nav/floating-tab-bar.tsx` (136 lines).
  - `FLOATING_TABS` (`:31-33`) names the tabs `index` (Chats), `ais` and `settings`.
  - `FloatingTabButton` (`:50-89`) gets `selected` from `useTabTrigger(...).trigger?.isFocused`, and spreads `triggerProps` (which carry the press handler) onto `TabTrigger`.
- **Chats.** Each folder page is a `FlatList` in `components/chat/chat-list-page.tsx:75`. The pager in `components/chat/chat-list.tsx` holds one page per folder.
- **AIs.** The tab renders through `components/ais/screen-shell.tsx`, whose `ScrollView` is at `:41`. The route is `app/(tabs)/ais.tsx`.
- **Settings.** The tab renders through `components/settings/screen-shell.tsx`, whose `ScrollView` is at `:35`. The route is `app/(tabs)/settings.tsx`.
- **Shared shells.** Both shells are also used by sub-screens, so the new behaviour must be opt-in.

### Steps
1. **New `lib/tab-reselect.ts`** (small). A tiny emitter:
   - `emitTabReselect(name: string)`;
   - `onTabReselect(name, fn): () => void` (returns an unsubscribe);
   - a hook `useScrollToTopOnReselect(name: string | undefined, scrollToTop: () => void)` that subscribes while mounted and focused (`useIsFocused` from `@react-navigation/native`, or skip the focus check if the tab bar only shows on root tabs) and does nothing when `name` is `undefined`.
2. **The tab bar** (`floating-tab-bar.tsx`). When the pressed tab is already `selected`, call `emitTabReselect(tab.name)` instead of navigating. Otherwise keep `triggerProps`' own press.
3. **Chats** (`chat-list-page.tsx`). Keep a ref on the `FlatList` and use `useScrollToTopOnReselect('index', () => ref.current?.scrollToOffset({ offset: 0, animated: true }))`. Every folder page may scroll; that's harmless.
4. **The shells.** Add an optional `tabName?: string` prop to `ais/screen-shell.tsx` and `settings/screen-shell.tsx`. Keep a ref on the `ScrollView` and use the hook with `scrollTo({ y: 0, animated: true })`.
5. **The tab routes.** Pass `tabName="ais"` in `app/(tabs)/ais.tsx` and `tabName="settings"` in `app/(tabs)/settings.tsx`.
6. **No tests** (UI). Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/lib/tab-reselect.ts`
- `apps/mobile/src/components/nav/floating-tab-bar.tsx`
- `apps/mobile/src/components/chat/chat-list-page.tsx`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `work/T-1969-phone-tab-reselect-top.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks on the emulator (mock):
- scroll Chats down and tap Chats: the list goes back to the top;
- the same on Settings;
- tapping another tab still switches tabs.

The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/lib/tab-reselect.ts`: a tiny emitter with `emitTabReselect`, `onTabReselect` (returns unsubscribe) and `useScrollToTopOnReselect(name, scrollToTop)`. The hook does nothing for `undefined`, keeps the callback in a ref so inline lambdas do not resubscribe, and subscribes only while mounted. I skipped the `useIsFocused` check because the floating bar exists only in `(tabs)/_layout.tsx`, so a re-tap can only target a root tab.
- `floating-tab-bar.tsx`: `FloatingTabButton` now owns `onPress`; when the tab is already selected it calls `emitTabReselect(tab.name)` and does not navigate, otherwise it forwards to `triggerProps.onPress`.
- `chat-list-page.tsx`: keeps a ref on the `FlatList` and scrolls it to offset 0 on a re-tap of `index` (Chats). Every folder page subscribes; the spec notes that is harmless.
- `ais/screen-shell.tsx` and `settings/screen-shell.tsx`: optional `tabName?: string` prop; the `ScrollView` has a ref and scrolls to `y: 0` on re-tap. Sub-screens pass no `tabName`, so the shared shells stay opt-in.
- `app/(tabs)/ais.tsx` passes `tabName="ais"`, `app/(tabs)/settings.tsx` passes `tabName="settings"`.

Files changed: the seven allowed source files plus the task file. No other file touched.

### Checks run
No single test files were run: the spec says no tests (UI only), and `pnpm gate` ran the mobile tests anyway.

`pnpm gate` (from the repo root), full output tail:
```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.5s)
PASS  lint  (1.1s)
PASS  typecheck  (5.1s)
PASS  effect  (1.8s)
PASS  tests @zilar/mobile  (3.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The first gate run failed only on `format` for `lib/tab-reselect.ts`; I ran `pnpm exec prettier --write` on that one file and re-ran the gate, which passed as above.

### Notes for the lead
- I did not run the emulator, so the phone behaviour (scroll to top on Chats/Settings, tab switching still works) is unverified by me; it needs the lead's smoke check.
- The hook has no focus check by design (see above). If the bar were ever rendered outside root tabs, subscribers on other mounted tabs would also scroll.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean. The lead checked on the emulator (mock build of `d23d3a27c`):
- **Chats:** scroll the list down, tap Chats, and the list is back at the top (Theo and Nora first).
- **Settings:** scroll down to Sign out, tap Settings, and it is back at the profile card.
- **Switching:** tapping AIs from Settings still switches tabs.
