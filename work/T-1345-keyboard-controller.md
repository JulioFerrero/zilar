---
id: T-1345
title: "Mobile keyboard on react-native-keyboard-controller: replace KeyboardAvoidingView + the manual Android keyboard height (use-keyboard-height.ts) with the library's KeyboardProvider / KeyboardAvoidingView / KeyboardStickyView, so the composer and sheets sit right above the keyboard on Android and iOS"
status: merged
milestone: M5
branch: task/T-1345-keyboard-controller
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1345: Mobile keyboard on keyboard-controller

## Spec (written by Claude, do not edit)

### Why
The library audit (T-1342, row 4).
- **Today:** mobile uses RN `KeyboardAvoidingView` (`behavior="padding"` on iOS only), plus a manual `keyboardDidShow` height in `apps/mobile/src/lib/use-keyboard-height.ts` (55 lines, `:42-55`) that pads Android sheets, because edge-to-edge doesn't resize the window.
- **Open bugs:** MUX-7 (the keyboard hides the latest messages, `docs/audit/mobile-ux-audit.md:37`) and MUX-20 (auth cards can be covered, `:53`).
- **Earlier Android fix rounds:** T-0254, T-0310, T-0313.

The users are:
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/ais/new.tsx`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`
- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`

### Library rule (Julio, 2026-10-13)
Use the named library; do **not** hand-roll its behaviour. First check it with `npm view <pkg> version time.modified peerDependencies` and confirm it fits the app (web: React 19 / Vite; mobile: Expo SDK 57, RN new architecture, reanimated 4.5.1, RNGH ~2.32.0). Pin an exact version at least two weeks old. If it does not fit, set `status: blocked` and report instead of hand-rolling. Every file stays at most 400 lines. **No tests** (UI). The plan is `docs/audit/library-plan.md` (T-1342, on branch `task/T-1342-library-audit` until it merges; the row is quoted below).

### What to build
1. **Add `react-native-keyboard-controller`** (audit: 1.22.7, 2026-10-12, peers reanimated >=3; use the newest version at least two weeks old) to `apps/mobile/package.json`.
   - It's a native module, so follow its Expo setup: no config plugin is needed for a prebuild app, but check its docs and say what you found.
   - Wrap the app in `<KeyboardProvider>` in `apps/mobile/src/app/_layout.tsx` (112 lines).
2. **Chat screen** (`app/chat/[id].tsx`): the composer rides the keyboard (`KeyboardStickyView`, or the library's `KeyboardAvoidingView` with `behavior="translate-with-padding"` or equivalent). The last message stays visible above the composer when the keyboard opens (MUX-7), on Android and iOS.
3. **Sheets and screens:** swap the RN `KeyboardAvoidingView` in each user listed above for the library's, on **both** platforms. Remove the manual Android padding and delete `use-keyboard-height.ts` once nothing imports it.
4. Keep the current look. Don't change any sheet's structure beyond the keyboard wrapper.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/use-keyboard-height.ts`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/app/_layout.tsx`, `docs/audit/mobile-ux-audit.md`.

### Allowed files
`apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/lib/use-keyboard-height.ts`, `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/app/ais/new.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `work/T-1345-keyboard-controller.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check:** an Android release build compiles, and the emulator shows the composer above the keyboard with the last message visible.
- **Julio's check on his phone.**

---

## Report (written by the worker when done)

Status: done, awaiting review. I did not push, merge or switch branches.

### What I did

**Dependency.** Added `react-native-keyboard-controller` to `apps/mobile/package.json`, pinned
to the exact version `1.22.6`. Chosen with `npm view`:

- `npm view react-native-keyboard-controller version time.modified peerDependencies` → newest is
  `1.22.7` (2026-10-12), peers `react-native-reanimated >=3.0.0`.
- Version list showed `1.22.6` was published 2026-09-29; `1.22.7` is one day old, so `1.22.6`
  is the newest version at least two weeks old. Peers: `react: *`, `react-native: *`,
  `react-native-reanimated: >=3.0.0` — fits the app's reanimated `4.5.1`. Exact pin, no caret.

**Expo setup (checked, as the spec asked).** The library's own installation page and the Expo
SDK 57 third‑party reference (`docs.expo.dev/versions/latest/sdk/keyboard-controller`) both say
the Expo install is only `npx expo install react-native-keyboard-controller`, that the package
supports React Native autolinking, and that the only required setup is wrapping the app in
`<KeyboardProvider>`. **No config plugin is needed** for this prebuild app, matching the task. It
is native code, so it needs a rebuild (pods / `android`/`ios` reassembly); the lead's release
build covers that.

**Provider.** `apps/mobile/src/app/_layout.tsx` now wraps the tree in `<KeyboardProvider>` inside
`GestureHandlerRootView` (around `ThemeProvider`). I kept the default `preload` (the docs note a
possible brief keyboard flash on launch with preload; see Open questions).

**Chat screen** (`app/chat/[id].tsx`). Swapped the three RN `KeyboardAvoidingView`s for the
library's, `behavior="padding"`, `style={{ flex: 1 }}`. The composer now rides the keyboard on
both platforms. MUX‑7 last‑message behaviour: the message list was already converted to an
`inverted` `FlatList` (`message-list.tsx:317-321`, offset 0 = newest/bottom), so shrinking the
list area (the KAV's `paddingBottom`) keeps the newest message at the bottom, above the composer
on iOS and Android. `message-list.tsx` is outside the Allowed files and is unchanged.

**Sheets and screens.** Swapped the RN `KeyboardAvoidingView` for the library's in
`app/ais/[id].tsx`, `app/ais/new.tsx`, `components/ais/tool-detail-sheet.tsx`,
`components/ui/bottom-sheet.tsx`, `components/stickers/telegram-import-sheet.tsx`,
`components/chat/new-chat-button.tsx` — all `behavior="padding"`, both platforms. Removed the
manual Android padding: `bottom-sheet.tsx` uses `paddingBottom: Math.max(insets.bottom, 16)` and
`new-chat-button.tsx` dropped `createSheetBottomPadding` plus the `keyboardHeight` padding and the
`scrollToEnd`‑on‑keyboard effect (the KAV now shrinks the scroll area). Deleted
`apps/mobile/src/lib/use-keyboard-height.ts` — nothing imports it; a grep across the repo confirms
the old test files for it are already gone.

**Behaviour choice:** I used `behavior="padding"` everywhere rather than `translate-with-padding`.
I read the installed source (`.../KeyboardAvoidingView/index.js`, `.../hooks.js`): the `padding`
branch interpolates the continuously updated keyboard `progress` on both platforms, which is the
smooth, reliable path; `translate-with-padding` on iOS only updates its `translate` shared value in
`onStart`/`onInteractive` and `padding` at `onStart`/`onEnd`. The task allows "or equivalent".

**Untouched:** `components/chat/composer.tsx` is in the Allowed list but needed no change (the
composer already sits above the KAV's padding; leaving it keeps the current look, per the spec).

No tests added: this is UI only and the spec says no tests. No file in the repo tested the removed
helpers.

### Files changed

- `apps/mobile/package.json`, `pnpm-lock.yaml` — add `react-native-keyboard-controller@1.22.6`
- `apps/mobile/src/app/_layout.tsx` — `<KeyboardProvider>`
- `apps/mobile/src/app/chat/[id].tsx` — 3× library KAV (chat)
- `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/app/ais/new.tsx` — library KAV
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx` — library KAV
- `apps/mobile/src/components/ui/bottom-sheet.tsx` — library KAV, manual padding removed
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` — library KAV
- `apps/mobile/src/components/chat/new-chat-button.tsx` — library KAV, manual padding + scroll effect removed
- `apps/mobile/src/lib/use-keyboard-height.ts` — deleted
- `work/T-1345-keyboard-controller.md` — this report

### Commands run

- `npm view react-native-keyboard-controller version time.modified peerDependencies` / `...@1.22.6 version peerDependencies` — see above.
- `pnpm install` (twice: before work, and again after adding the dependency): both finished, exit 0.
- No standalone test run: no test file covers these changed files (verified by grep), so there was
  nothing narrower than the gate's mobile test run to execute first.
- `pnpm gate` (from the repo root) — real summary:

  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.6s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (2.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Problems / deviations

- No device or emulator available here, so the runtime behaviour (composer above the keyboard, last
  message visible) is **not** verified by me. `pnpm gate` (install/format/lint/typecheck/effect/
  tests) passed; the lead's Android release build + emulator check and Julio's phone check remain.
- Chose `behavior="padding"` over `translate-with-padding` (see above); the task wording allowed
  "or equivalent".

### Open questions

- The library's `KeyboardProvider` preloads the keyboard at startup and its docs note this can
  briefly flash the keyboard on launch in some apps. I kept the default. If that shows up on
  device, the fix is `preload={false}` on `KeyboardProvider` plus a manual `KeyboardController.preload()`.
  Say the word and I can set it.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit); the packet is current for `a2b54e9f`.**
- **Lead's check:** an Android build of the branch compiles (arm64 release `a2b54e9f`). On the emulator (mock), Marta's chat with the keyboard open shows the composer right on top of the keyboard and the last messages moved up, still visible (MUX-7).
- **The nit:** the T-0254 scroll-to-end in the new-chat sheet was removed; Julio checks the tall create sheet on his phone.
