---
id: T-2189
title: "Phone: one settings screen shell — AisScreenShell and RefreshScroll go, every settings screen uses SettingsScreenShell; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2189-phone-one-shell
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2189: One phone settings screen shell

## Spec (written by Claude, do not edit)

### Why
The phone has three ways to draw the same screen frame (safe area, header, scroll with pull-to-refresh). One shell gives readers one place to look, and the other two go.

### Facts (the lead read these on 2026-10-19)
1. `apps/mobile/src/components/settings/screen-shell.tsx`: `SettingsScreenShell` is used by most settings screens. Its props:
   - `title`, `subtitle`, `onBack`, `right`, `tabName`;
   - `onRefresh` (its own `usePullToRefresh` spinner) or a ready `refreshControl`;
   - `scroll`, `contentClassName`, `contentPaddingBottom`, `footer`, `after`.
2. `apps/mobile/src/components/ais/screen-shell.tsx` (18 lines): `AisScreenShell` only calls `SettingsScreenShell` with `scroll` defaulting to `false`. It is used by `apps/mobile/src/app/(tabs)/ais.tsx:285`, `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/app/settings/approvals.tsx` and `apps/mobile/src/app/settings/routines.tsx:224`.
3. `apps/mobile/src/components/settings/refresh-scroll.tsx` (37 lines): `RefreshScroll` is a `ScrollView` with a `RefreshControl`. Three screens draw `SafeAreaView` + `ScreenHeader` + `RefreshScroll` by hand:
   - `apps/mobile/src/app/settings/blocked.tsx:68-75`;
   - `apps/mobile/src/app/settings/contacts.tsx:173-180`;
   - `apps/mobile/src/app/settings/requests.tsx:85-98`.

   Each passes `refreshing` and `refresh` from `useFocusList`.
4. `apps/mobile/src/app/settings/machines.tsx:367-375` draws `SafeAreaView` + `ScreenHeader` (`:300`) + `ScrollView` + `RefreshControl` by hand.

### Steps
1. Delete `AisScreenShell`. Its four users render `SettingsScreenShell` with `scroll={false}`, or keep the `scroll` value they pass today.
2. `blocked.tsx`, `contacts.tsx`, `requests.tsx` and `machines.tsx` render `SettingsScreenShell`:
   - pass `title`, `subtitle` and `onBack` as their `ScreenHeader` does now;
   - keep their pull-to-refresh by passing `refreshControl={<RefreshControl refreshing={refreshing} tintColor={MUTED_FOREGROUND} onRefresh={refresh} />}`, so the spinner still follows `useFocusList`'s `refreshing`;
   - keep each screen's content padding (`contentClassName`/`contentPaddingBottom`) and any content that sits outside the scroll (`after` or `footer`).
3. Delete `RefreshScroll` once nothing imports it.
4. Change nothing a user can see: the same header, subtitle, padding, keyboard behaviour and pull-to-refresh. If one screen cannot match without a new shell prop, add at most one small optional prop to `SettingsScreenShell`, or skip that screen and say why.
5. No new tests.
6. Report the line counts per file.

### Allowed files
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/components/settings/refresh-scroll.tsx`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/settings/approvals.tsx`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `work/T-2189-phone-one-shell.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `AisScreenShell` and `RefreshScroll` are gone; the four screens above use `SettingsScreenShell`.
- Phone emulator, mock mode, checked by the lead: the AIs tab, Edit Dev-1, Approvals, Routines, Blocked, Contacts, Requests and Machines look as before, and pull-to-refresh works on Contacts and Machines.
- Product lines are at least 50 lower.

---

## Report (written by the worker when done)

### What I did
- Deleted `apps/mobile/src/components/ais/screen-shell.tsx` (`AisScreenShell`) and `apps/mobile/src/components/settings/refresh-scroll.tsx` (`RefreshScroll`); nothing imports either any more.
- The four `AisScreenShell` users now render `SettingsScreenShell` directly:
  - `(tabs)/ais.tsx` and `ais/[id].tsx` keep `scroll`;
  - `approvals.tsx` and `routines.tsx` pass `scroll={false}` (they embed their own `ScrollView`, as before).
- `blocked.tsx`, `contacts.tsx`, `requests.tsx` and `machines.tsx` now render `SettingsScreenShell`:
  - `blocked`/`contacts`/`requests` keep their `useFocusList` spinner via `refreshControl={<RefreshControl refreshing={refreshing} tintColor={MUTED_FOREGROUND} onRefresh={refresh} />}`, keep `p-4` content padding through `contentClassName="p-4"`, keep the old `paddingBottom: 32` through `contentPaddingBottom={32}`, and move the mock-data strip outside the scroll into `after`.
  - `machines` uses the shell's own `onRefresh={reload}` (same `usePullToRefresh` hook and spinner as its hand-rolled `RefreshControl`), keeps `gap-4 p-4` through `contentClassName`, keeps `paddingBottom: 32`, and moves `AddMachineSheet` + `ConfirmDialog` into `after`. Its local `MachinesHeader` and `usePullToRefresh` call were removed.
- Added one optional prop to `SettingsScreenShell`, `keyboardAvoidance` (default `true`): machines passes `false` to keep its old `ScrollView` keyboard setup (no drag-dismiss, no automatic insets).

### Files changed and line counts (final `wc -l`, diff vs main)
- `apps/mobile/src/app/settings/machines.tsx` — 456 lines (+111/−140)
- `apps/mobile/src/app/settings/contacts.tsx` — 397 lines (+65/−66)
- `apps/mobile/src/app/settings/requests.tsx` — 238 lines (+91/−92)
- `apps/mobile/src/app/settings/blocked.tsx` — 164 lines (+56/−57)
- `apps/mobile/src/app/settings/approvals.tsx` — 610 lines (+4/−3)
- `apps/mobile/src/app/settings/routines.tsx` — 309 lines (+3/−3)
- `apps/mobile/src/app/(tabs)/ais.tsx` — 511 lines (+3/−3)
- `apps/mobile/src/app/ais/[id].tsx` — 743 lines (+3/−3)
- `apps/mobile/src/components/ais/screen-shell.tsx` — deleted (18 lines, +0/−18)
- `apps/mobile/src/components/settings/refresh-scroll.tsx` — deleted (37 lines, +0/−37)
- `work/T-2189-phone-one-shell.md` — status + Report

Product lines: +336/−422 = 86 lines fewer, above the 50-line target.

### Commands run and real results
- `pnpm install --silent`: exit 0, no output.
- `pnpm gate` (first run): FAIL at format — Prettier listed `blocked.tsx`, `contacts.tsx`, `machines.tsx`, `requests.tsx` as unformatted.
- `pnpm exec prettier --write` on the changed screens (only the failing files): all written, no errors.
- `pnpm gate` (final): `GATE PASS`. Summary lines:
  - `gate: 11 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.2s)`
  - `PASS  lint  (0.6s)`
  - `PASS  typecheck  (0.7s)`
  - `PASS  effect  (0.4s)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
- No single test file was run: the gate reports no nearby mobile tests and the spec says no new tests.

### Problems, deviations from the spec, open questions
- `machines.tsx` keeps its old keyboard setup: `SettingsScreenShell` now has one optional `keyboardAvoidance` prop (default `true`), and machines passes `false` so the scroll view only sets `keyboardShouldPersistTaps="handled"`, as its hand-rolled `ScrollView` did.
- Everything else is unchanged: same headers, subtitles, back actions, `p-4` padding, `paddingBottom: 32`, mock strip position, sheets/dialogs outside the scroll, and pull-to-refresh driven by `useFocusList`/`usePullToRefresh`.

### Blocked / needs a decision
- (none)

### Round (fix for PREREVIEW finding 1)
- Fixed finding 1 (should-fix, machines keyboard behaviour): added `keyboardAvoidance?: boolean` to `SettingsScreenShell` (default `true`). When `false` the scroll view uses `keyboardDismissMode="none"` and `automaticallyAdjustKeyboardInsets={false}`; `keyboardShouldPersistTaps="handled"` stays. `machines.tsx` passes `keyboardAvoidance={false}`, matching its previous hand-rolled `ScrollView`.
- Tests added: none. The finding names no test, the change is UI-only, and the spec says "No new tests" (AGENTS.md: UI code gets no tests).
- `pnpm gate` (from the repo root): `GATE PASS`. Summary lines:
  - `gate: 12 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `WARN size` for four files already over 400 lines before this round; `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
- No disagreements: the finding was correct and is fixed.

## Review (written by Claude)

Approved; the pre-review was clean after one autofix round. Net −82.

The phone now has one settings screen shell. Gone:
- `AisScreenShell`, a wrapper that only flipped `scroll`;
- `RefreshScroll`.

Blocked, Contacts, Requests and Machines use `SettingsScreenShell`, with their `useFocusList` spinner passed as `refreshControl`. The AIs tab, Edit AI, Approvals and Routines pass `scroll={false}`.

**Phone emulator smoke passed:** the AIs tab, Edit Dev-1, Approvals, Routines, Blocked, Contacts, Requests and Machines all look as before. A pull-to-refresh on Machines keeps the list on screen.
