---
id: T-1348
title: "Mobile sheets native via @lodev09/react-native-true-sheet (lead switched from gorhom, whose releases crash on reanimated 4.5/new arch): rebuild the kit BottomSheet and ActionSheet on TrueSheet (drag to close, backdrop, keyboard) keeping their props so the 18 call sites don't change"
status: merged
milestone: M5
branch: task/T-1348-gorhom-sheets
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1348: Mobile sheets on gorhom

## Spec (written by Claude, do not edit)

### Why
The library audit (`docs/audit/library-plan.md`, row 7). Julio, 2026-10-13: "can we do the same with similar components… use a library or something native".
- **Today:** the mobile kit sheets are a fade-in RN `Modal` with a tappable backdrop and a static rounded panel. There's no drag-to-dismiss and no slide-up spring:
  - `apps/mobile/src/components/ui/bottom-sheet.tsx` (73 lines; props `visible`, `onClose`, `closeLabel`, `title`, `maxHeightClassName`, `children`; `:8-18`);
  - `apps/mobile/src/components/ui/action-sheet.tsx` (130; `ActionSheet` props `:10-21` and `ActionSheetItem` props `:86-97`).
- **Callers:** 11 files import `ui/bottom-sheet` and 7 import `ui/action-sheet`.
- **Keyboard:** T-1345 just moved keyboard handling to `react-native-keyboard-controller` (`KeyboardProvider` in `apps/mobile/src/app/_layout.tsx:99`).

### Library rule (Julio, 2026-10-13)
Use the named library; don't hand-roll its behaviour.
- **First check it:** `npm view @gorhom/bottom-sheet version time.modified peerDependencies`. The audit saw 5.2.14 (2026-05-09), with peers RNGH >=2.16.1 and reanimated >=3.16.0 || >=4.0.0-. The app has RNGH ~2.32.0, reanimated 4.5.1 and Expo SDK 57 on the new architecture.
- **Version:** pin an exact version at least two weeks old.
- **If it doesn't fit** (for example, a known reanimated 4.5 or new-arch break in its issues), set `status: blocked` and report.
- **No tests** (UI). Every file stays at most 400 lines.

### What to build
1. **Add `@gorhom/bottom-sheet`.** Mount `BottomSheetModalProvider` in `apps/mobile/src/app/_layout.tsx`, inside the existing `GestureHandlerRootView` (find it and cite it) and the `KeyboardProvider`.
2. **Rebuild `BottomSheet`** on `BottomSheetModal`:
   - opened and closed from `visible` with `present()` / `dismiss()`; `onDismiss` calls `onClose`;
   - `enableDynamicSizing`, capped near 85% of the screen (honour `maxHeightClassName` as a max height, or document the mapping);
   - `BottomSheetBackdrop`, where a tap closes it, with `accessibilityLabel={closeLabel}`;
   - pan down to close; the handle and colours match the current look (`bg-surface`, `border-border-strong`, rounded top);
   - content in `BottomSheetScrollView` with `keyboardShouldPersistTaps="handled"`;
   - keyboard: use the library's keyboard props (`keyboardBehavior="interactive"`, `android_keyboardInputMode="adjustResize"`) so text inputs in sheets stay visible. Say whether the call-site `TextInput`s need `BottomSheetTextInput`; if they do, list them and don't change them (report only);
   - the Android back button closes the sheet.
3. **Rebuild `ActionSheet`** on the same base. Keep `ActionSheetItem` as is.
4. **Don't edit call sites.** If one breaks (for example, a sheet that opens another sheet, or a nested `Modal`), name it in the Report.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/app/_layout.tsx`, `work/T-1345-keyboard-controller.md`, `docs/audit/library-plan.md`.

### Allowed files
`apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ui/sheet-backdrop.tsx`, `work/T-1348-gorhom-sheets.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's emulator check:** a kit sheet (for example New chat, or a chat's action sheet) slides up, drags down to close, and a backdrop tap closes it.
- **Julio's phone check.**

---

## Report (written by the worker when done)

Status: done, awaiting review. I did not push, merge or switch branches.

The lead's decision (2026-10-13) replaced `@gorhom/bottom-sheet` with
`@lodev09/react-native-true-sheet`, so I followed that message. The Spec body above still describes
the gorhom build (`### Library rule`, `### What to build`); I did not edit it (Claude owns it) and
built to the lead's message instead. The title/front matter already name TrueSheet.

### Library check (before coding)

- `npm view @lodev09/react-native-true-sheet version time.modified peerDependencies peerDependenciesMeta`
  → latest `3.11.18` (published 2026-10-02); peers `react`/`react-native` `*`,
  `react-native-reanimated >=4`, `react-native-worklets *`, `@radix-ui/react-dialog >=1`,
  `@radix-ui/react-presence >=1`, `@react-navigation/core >=7`; **every peer except
  `react`/`react-native` is `optional: true`** in `peerDependenciesMeta`, so no new required peers
  (the `@radix-ui/*` and `@react-navigation/*` ones are the web/navigation extras).
- **Version pinned: `3.11.16`.** `npm view ... time --json`: `3.11.16` 2026-09-27, `3.11.17`
  2026-09-30, `3.11.18` 2026-10-02. Today is 2026-10-13, so two weeks is 2026-09-29 → **3.11.16 is the
  newest 3.x at least two weeks old** (`3.11.17` is 13 days old). The 4.0 lineup is beta only; not used.
- **Fits the app.** README compatibility table: 3.7+ → React Native 0.81+ / Expo SDK 54+; the app is
  RN 0.86.3 / Expo SDK 57. 3.0+ is **new-architecture (Fabric) only** and the app is on the new
  architecture. `react-native-reanimated` and `react-native-worklets` are optional peers (the app has
  4.5.1 / 0.10.1 anyway). The package's `codegenConfig` is a Fabric view (`TrueSheetSpec`).
- **No open issues** (the repo's GitHub issue search returned none), and I found no blocking break
  against Expo SDK 57 / RN 0.86 / reanimated 4.5.1 / `react-native-keyboard-controller`. So I proceeded.

### What I built

**Provider (`_layout.tsx`) — none needed.** `TrueSheetProvider` is a pass-through on native
(`src/TrueSheetProvider.tsx`: "no context is needed on native"); it exists to expose the static
`useTrueSheet()` helpers and the web renderer, which this ref-based usage does not need. So
`apps/mobile/src/app/_layout.tsx` is unchanged — there is no provider to mount. (It already wraps the
tree in `GestureHandlerRootView` and `KeyboardProvider`, `:98-99`.)

**`BottomSheet`** (`apps/mobile/src/components/ui/bottom-sheet.tsx`, 104 lines) rebuilt on `TrueSheet`
with the same props (`visible`, `onClose`, `closeLabel`, `title`, `maxHeightClassName`, `children`):

- `visible` drives `present()` / `dismiss()` from a ref, guarded by a `presented` ref so a mount with
  `visible={false}` never calls `dismiss()` on an unmounted sheet.
- `onDidDismiss` sets `presented=false` and calls `onClose`, so drag-down, a backdrop tap and the
  Android back button (native when `dismissible`, default true) all report back.
- `detents={['auto']}` sizes the panel to its content; `maxContentHeight` caps it near the share of the
  screen named by `maxHeightClassName` (`max-h-[85%]`→0.85, `[80%]`, `[70%]`; anything else → 85%).
- `backgroundColor={palette.surface}` (`#111111`), `cornerRadius={16}`, `grabber` on, `dimmed` on,
  `dismissible` on — drag-to-close and a tap-outside-close come natively.
- Content is a `ScrollView` with `keyboardShouldPersistTaps="handled"`; text inputs ride the keyboard
  natively (no `KeyboardAvoidingView`).
- The old hand-drawn grab handle is gone (the sheet draws a native grabber); `closeLabel` now labels
  the drag handle via `accessibilityOptions={{ grabberLabel: closeLabel }}`.

**`ActionSheet`** (`action-sheet.tsx`, 154 lines) rebuilt on the same `TrueSheet` base; `ActionSheetItem`
is unchanged. Same presentation (drag, backdrop, back, keyboard), the dividers between items are kept,
plus the `error` alert line.

**`maxHeightClassName` mapping and the `auto`/`scrollable` choice.** `@gorhom`'s `enableDynamicSizing`
equivalent here is `detents={['auto']}`. The library documents that `auto` is **not supported together
with `scrollable`** ("use fixed fractional detents instead"), and `scrollable` is what pins a
`ScrollView` and drives its iOS keyboard auto-scroll. I kept the task's `auto` and capped it with
`maxContentHeight`; the content is bounded by the same cap and scrolls within it (`nestedScrollEnabled`
for Android's BottomSheetDialog). Consequence: on iOS the sheet's native keyboard avoidance moves the
sheet, but the library's scroll-to-focused-input only runs in `scrollable` mode; see Open questions.

**Android back button** closes the sheet for free (`dismissible` default true;
`TrueSheet.handleBackPress` calls the native dismiss).

### Text inputs in sheets (report only — none changed)

The sheets render the kit `TextField` (a `TextInput` wrapper). In this library's v3 there is no
`BottomSheetTextInput` equivalent to adopt, so these need **no** change: `visibility-sheet` (2),
`forward-sheet` (2), `new-topic-sheet` (2), `invite-links-sheet` (4), `group-roles-sheet` (3).

### Nested overlays / call sites (report only — none changed)

- No call site renders one kit sheet inside another's children (every `bottom-sheet`/`action-sheet`
  importer renders its sheets at the top level), so nothing nests.
- `new-chat-button.tsx` renders the `ActionSheet` and a separate RN `<Modal>` as **siblings**, and
  closes the menu (`setMenuOpen(false)`) before opening the Modal — sequential, not nested. No other
  `<Modal>` user is a kit-sheet importer (`sticker-panel`/`attach-sheet`/`emoji-sheet`/`image-viewer`/
  `tool-detail-sheet` are not rendered inside a kit sheet).
- `message-actions-sheet`, `chat-actions-sheet` and `contact-list` each render two `ActionSheet`s but
  gate them with mutually exclusive `visible` (`visible && !confirmOpen` / `visible && confirmOpen`; an
  early return for the clear-history sheet), so two are never presented at once.
- Behaviour change to flag: `TrueSheet` lazy-mounts its content and unmounts it on dismiss, so a
  sheet's children now remount on each present (the old RN `Modal` kept them mounted).

### Files changed

- `apps/mobile/package.json`, `pnpm-lock.yaml` — add `@lodev09/react-native-true-sheet` pinned to `3.11.16`.
- `apps/mobile/src/components/ui/bottom-sheet.tsx` — rebuild on `TrueSheet`.
- `apps/mobile/src/components/ui/action-sheet.tsx` — `ActionSheet` on `TrueSheet`; `ActionSheetItem` unchanged.
- `work/T-1348-gorhom-sheets.md` — this Report.
- No `sheet-backdrop.tsx`: the native backdrop needs no custom component.
- `apps/mobile/src/app/_layout.tsx` — unchanged (no provider needed).

### Commands run

- `npm view @lodev09/react-native-true-sheet version time.modified peerDependencies peerDependenciesMeta`
  and `... time --json` — see above.
- `pnpm install` — finished, exit 0 (unchanged unrelated peer warning: `@types/react-dom 19.3.0` vs
  `@types/react 19.2.18`).
- `pnpm exec prettier --write apps/mobile/src/components/ui/{bottom-sheet,action-sheet}.tsx` — to fix the
  two files the gate's format step flagged.
- No standalone test run: no test imports these components (verified), so there is nothing narrower than
  the gate's mobile run.
- `pnpm gate` (repo root) — final real summary:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.3s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Problems / deviations

- **No provider mounted** (spec step 3): none is needed on native (see above), so `_layout.tsx` is
  untouched. This is not a skipped step.
- **`closeLabel` remap.** The old prop labelled the backdrop. The native sheet has no per-sheet backdrop
  element to label, so `closeLabel` now labels the drag handle (`accessibilityOptions.grabberLabel`);
  on iOS that string only applies when `grabberOptions` is set, so iOS falls back to the system grabber
  label. The prop is still required and used, and no call site changed.
- **Look.** The ActionSheet is now a full-width native sheet with the native grabber (rounded corners /
  `bg-surface`), not the old floating `rounded-2xl` card with side margins; the BottomSheet's grab
  handle is the native grabber rather than a hand-drawn pill. Colours and rounding match
  (`palette.surface`, radius 16).
- **`auto` + `scrollable`**: I did not enable `scrollable` because the library forbids it with `auto`;
  the cap plus `nestedScrollEnabled` bounds and scrolls the content instead.
- No device or emulator here, so slide-up, drag-to-close, a backdrop tap and the keyboard behaviour are
  **not** verified by me — only install/format/lint/typecheck/effect. The lead's Android build and the
  emulator/phone checks remain.
- The Spec body still describes the gorhom build (see the note at the top); I followed the lead's newer
  message.

### Open questions

- iOS keyboard scroll: with `auto` (no `scrollable`), does a focused `TextField` deep in a long sheet
  scroll into view, or only move with the sheet? If it does not, the fix is to switch the tall sheets to
  `scrollable` with fractional detents (e.g. `detents={[0.85]}`), at the cost of content-sizing. Flag
  for the lead's emulator check.
- Children now remount on each present (TrueSheet lazy-mounts). If any sheet relied on the old
  always-mounted Modal children, name it and I will adjust.

### Round (fix round, 2026-10-14)

**Findings fixed: must-fix 1** (opening the delete confirm killed the whole menu). PREREVIEW.md,
finding 1. `apps/mobile/src/components/ui/action-sheet.tsx` now keeps a `dismissedByEffect` ref:

- the `visible` effect sets it to `true` right before it calls `dismiss()`;
- `onDidDismiss` consumes and ignores exactly that dismissal instead of calling `onClose()`.

So a programmatic dismiss (the parent flipping `visible`) is no longer reported as a user close. A drag,
a backdrop tap and the Android back button still report through `onClose()`. This stops the main message
menu's own dismiss from calling `setMenuOpen(false)` and killing the sibling delete confirm
(`message-actions-sheet.tsx:124-126` and `:222-252`, and the `ConfirmDialog` paths whose
`visible={visible && confirmOpen}` depended on the killed `visible`). No call site changed.

**Tests added/adjusted: none.** Finding 1 named no test. The Spec says "No tests (UI)", `AGENTS.md`
says "UI code gets no tests", no test path is in the Allowed files, and no React render test library
(`@testing-library/react-native`) is installed (adding one is a dependency this task does not allow).
A test file would also land outside the Allowed files and show up in the gate's scope report, which
must stay clean. The behaviour is UI-only and stays with the lead's emulator check.

**Nits not touched.** Nit 1 (silent `runInBackground` failures) is out of scope for a fix round; the
follow-up (invite-links form state) still needs files outside Allowed.

**Gate result.** `pnpm gate` from the repo root, after the fix:

```
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.6s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

No standalone test run: there is no test near the change to run narrower than the gate's mobile step.

### Round 2 (lead fix round 2, 2026-10-14)

**Finding fixed: the native grabber overlapped the first content row** in both kit shells — the message
actions sheet's reactions row (over the 😂) and the delete confirm's "Delete message?" title.
`apps/mobile/src/components/ui/action-sheet.tsx` and
`apps/mobile/src/components/ui/bottom-sheet.tsx` now give the content `pt-6` (24 px) from the sheet's
top edge, so the first row clears the grabber on both platforms. No call site changed.

The library has no content-inset prop for the grabber: `grabberOptions.topMargin` only moves the pill
(default iOS 5 / Android 16; pill heights iOS 5 / Android 4, so the Android pill's bottom edge is
20 px), and `insetAdjustment` is only the system safe-area. So padding is the fix; 24 px clears the
Android pill (20 px) and the iOS one (10 px).

**Gate result.** `pnpm gate` from the repo root, after the fix:

```
PASS  install (frozen)  (0.9s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (2.7s)
PASS  effect  (0.5s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean after 1 auto round and 1 lead round (2 nits, 2 follow-ups); the packet is current for `69172d18`.**
- **Gorhom dropped:** the worker blocked correctly. Every 5.2.x release has open crashes on reanimated 4.5 / new arch (#2734, #2737), so the lead switched the task to the native `@lodev09/react-native-true-sheet` 3.11.16.
- **Lead's emulator checks (Android, mock):**
  - the chat actions sheet is native, with a grabber and a dimmed backdrop;
  - drag-down closes it;
  - Message menu → Delete opens the "Delete message?" confirm (the round-1 must-fix);
  - the grabber clears the reactions row (round 2).
- **Follow-ups accepted:**
  - in-sheet forms reset when reopened (fine, a fresh form);
  - iOS keyboard scrolling in long sheets: check on the iPhone.
