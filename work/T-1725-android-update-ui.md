---
id: T-1725
title: "Android updater UI as drawn (docs/design/mockups/updater): the update dialog (ready on Wi-Fi, ask on mobile data, downloading with a progress well) mounted at the root, and the Settings › This app version row with Check, Download or Install"
status: merged
milestone: M5
branch: task/T-1725-android-update-ui
model: auto
effort: default
depends_on: [T-1724]
estimate: 45 min
---

# T-1725: Android updater UI

## Spec (written by Claude, do not edit)

### Why
Julio asked for an in-app updater and approved these boards as drawn on 2026-10-16. Read `git show main:docs/design/mockups/updater/README.md` and the five `.dc.html` boards in that folder first.

T-1724 built the logic with no UI: `apps/mobile/src/lib/use-app-update.ts`, with `useAppUpdate()` and `startAppUpdateChecks()`. Read its final API on main before you start; the state and action names below come from its spec.

### Facts (the lead read them on 2026-10-16)
- **The kit dialog:** `apps/mobile/src/components/ui/confirm-dialog.tsx:34-90`. A fade `Modal` over `bg-black/40`, a `max-w-xs rounded-2xl border border-border-strong bg-surface p-4` card, a 16 px semibold title, a 14 px muted message, and right-aligned kit `Button`s (`ghost` cancel, then the primary).
  - It takes no custom body, so the update dialog is a new component in the same shell.
- **Kit pieces:** `IconTile` (`components/ui/icon-tile.tsx`, 34 px), `IconButton` (40 px), `Card` and `SectionLabel` (`components/ui/card.tsx`), `ListRow` (`components/ui/list-row.tsx`), and `Text`.
- **The phone Settings hub** is `apps/mobile/src/app/(tabs)/settings.tsx` (254 lines). Its groups render at `:216-223`, then a `Card` with the Sign out `ListRow` (`:224-237`). The new **This app** group goes between them.
- **The root layout** is `apps/mobile/src/app/_layout.tsx` (134 lines), with `SessionBootstrap` at `:52-60` as the pattern for a run-once effect.

### Steps
1. **New `apps/mobile/src/components/update/update-dialog.tsx`**, mounted once in `_layout.tsx`, which also calls `startAppUpdateChecks()` once. It's the `ConfirmDialog` shell with a header row: an `IconTile` with the lucide `Download` icon, the title, and a mono 12 px subtle line under it. Per state:
   - **`available`** (mobile data): "Update to Zilar <v>", the mono "<installed> → <v> · <MB> MB", the message "You're on mobile data. Download now?", and **Later** / **Download**;
   - **`downloading` with `quiet: false`:** "Downloading <v>", the mono "<done> of <total> MB", a recessed well (`bg-well`, a 1 px border, 8 px tall, fully rounded) with an accent fill at the progress width, and **Cancel**;
   - **`ready`:** "Zilar <v> is ready", the same mono line, "Install now? Your chats stay as they are.", and **Later** / **Install**;
   - **`failed`:** the last dialog with its alert line (as in `ConfirmDialog`'s `error`), and **Later** / **Try again**;
   - **every other state**, including a quiet download: no dialog. The Android back button means Later.
2. **New `apps/mobile/src/components/settings/app-version-row.tsx`**, plus a **This app** `SectionLabel` and `Card` in `settings.tsx` before the Sign out card. One `ListRow`-style row, by state:
   - **up to date or idle:** a phone `IconTile`, "Zilar <installed>" with the version in mono, "Up to date · checked HH:MM" (or "Not checked yet"), and a 40 px refresh `IconButton` labelled "Check for updates" that calls `checkNow()`, with a spinner while checking;
   - **`available`:** "Zilar <v> is available", "<installed> installed · <MB> MB", and a primary **Download**;
   - **`downloading`:** "Downloading <v>" with "<done> of <total> MB";
   - **`ready`:** a white 8 px dot, "Zilar <v> is ready", "<installed> installed · <MB> MB", and a primary **Install**;
   - **updater off** (dev or local build): "Zilar <installed>" and "Local build", with no key.
3. **Android only:** on iOS neither the dialog nor the row renders.
4. Keep every file under 400 lines. **No tests** (UI).

### Allowed files
- `apps/mobile/src/components/update/update-dialog.tsx`
- `apps/mobile/src/components/settings/app-version-row.tsx`
- `apps/mobile/src/lib/use-app-update.ts`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `work/T-1725-android-update-ui.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The dialog** and the This app row match the boards in `docs/design/mockups/updater/`, using the kit's components and sizes.
- **Only one check runs**, started from the root.
- **Nothing shows** on iOS or in a local build, apart from the version line.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

Two new components and two touched files, exactly the Allowed files:

- **`apps/mobile/src/components/update/update-dialog.tsx`** (new, 196 lines) — the root installer prompt. It is the `ConfirmDialog` shell (a fade `Modal` over `bg-black/40`, the `max-w-xs rounded-2xl border border-border-strong bg-surface p-4` card) with a header row: a 34 px `IconTile` holding the lucide `Download` icon, the 16 px semibold title and a mono 12 px `text-subtle-foreground` detail line. Per state: **`available`** → "Update to Zilar <v>", the mono "<installed> → <v> · <MB> MB", "You're on mobile data. Download now?", Later / Download; **`downloading` with `quiet: false`** → "Downloading <v>", the mono progress line, an 8 px fully rounded `bg-well` well with a 1 px `border-border` and a `bg-accent` fill at the progress width, Cancel; **`ready`** → "Zilar <v> is ready", the same mono line, "Install now? Your chats stay as they are.", Later / Install; **`failed`** → an "Update failed" header, the fixed message as the `accessibilityRole="alert"` line, Later / Try again; every other state (including a quiet download) renders nothing. The Android back button runs the dialog's dismiss action.
- **`apps/mobile/src/components/settings/app-version-row.tsx`** (new, 236 lines) — the Settings › This app row, one `ListRow`-style row (`flex-row items-center gap-3 px-3 py-2.5`): a phone `IconTile`, the title with the version in mono, a muted subtitle, and the state's key. **idle / up to date** → phone tile, "Zilar <installed>", "Up to date · checked HH:MM" (or "Not checked yet"), a 40 px `IconButton` labelled "Check for updates" calling `checkNow()`; **checking** → the same row with an `ActivityIndicator` in the key and "Checking…"; **available** → "Zilar <v> is available", "<installed> installed · <MB> MB", a primary Download; **downloading** → "Downloading <v>" and the progress line; **ready** → the white 8 px dot, "Zilar <v> is ready", "<installed> installed · <MB> MB", a primary Install; **updater off** → "Zilar <installed>" and "Local build" and no key. Android only.
- **`apps/mobile/src/app/_layout.tsx`** — imports and mounts `<UpdateDialog />` once inside the root `View`, and a run-once `useEffect` calls `startAppUpdateChecks()` once.
- **`apps/mobile/src/app/(tabs)/settings.tsx`** — a **This app** `SectionLabel` + `Card` with `AppVersionRow`, between the hub groups and the Sign out card, rendered only when `Platform.OS === 'android'`.

No tests (UI), per the spec. Both new files stay well under 400 lines.

### Checks run

`pnpm install` (as asked): done, no changes.

`pnpm gate` (from the repo root), the only check in the Spec:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (3.7s)
PASS  effect  (0.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no single test files: the spec says no tests, and the three changed folders have no test files, so the gate's nearest-test step had nothing to run. Two earlier gate runs failed and are fixed: one Prettier reformat in `update-dialog.tsx`, and one lint round where `oxlint`'s `react(refs)` refused a `useRef` read during render and `react(set-state-in-effect)` refused a sync `setState` in an effect (see the notes).

### Notes for the lead

- **`updaterOff()` re-derives a private check.** The row must show "Local build" in a dev or local build, but `use-app-update.ts` keeps `updateEnabled()` module-private and is not in this task's Allowed files, so the row repeats it: `__DEV__ || typeof Constants.expoConfig?.android?.versionCode !== 'number'`. If you would rather, expose an `enabled` flag (or `installedVersionCode`) from the hook in a follow-up and I will drop the duplicate.
- **The `downloading` state carries no `sizeBytes`.** T-1724's `{ status: 'downloading'; version; progress; quiet }` has no total, but the boards and Spec want "<done> of <total> MB". I keep the last size seen per version in a module-level `Map` (the updater store is module state too) and read it in both surfaces; a quiet download, whose total was never shown, falls back to a percentage. If you prefer, adding `sizeBytes` to the `downloading` state would remove the memo.
- **`failed` is a generic "Update failed" dialog, not literally the last one.** The `failed` state only carries `message`, so the last prompt's version/title is not recoverable; I show a header, the fixed message as the alert line and Later / Try again ("Try again" calls `checkNow()`, which re-offers or retries). Also, `later()` is a no-op from `failed` in T-1724, so that dialog's "Later" (and the back button) dismisses it locally instead of snoozing; the available/ready dialogs still use `later()` for the 24-hour snooze. Tell me if you wanted the previous prompt's title kept instead.
- **The auto check can raise the `failed` dialog in the background.** The store tags no auto-vs-manual source, so a failed auto check (e.g. offline at launch) shows the modal too. It is dismissible via Later. Flagging it as a possible follow-up rather than changing T-1724's frozen state.
- **The This app group is gated to Android in `settings.tsx`.** `AppVersionRow` returns `null` on iOS, which alone left an empty "THIS APP" card; the group is now only built on Android so iOS shows nothing, as the Spec's step 3 asks.
- Minor choices the Spec left open: the `checking` row subtitle is "Checking…"; the row's `failed` state shows the fixed failure sentence with the Check key; the row's `installing` state reuses the ready row. The available/downloading/ready rows use a download `IconTile` as the leading node, matching `PhoneSettingsUpdate.dc.html` (the ready row has both the tile and the inline white dot, exactly as the board draws them).

### Round (fix round)

Findings fixed (one commit each, both in `apps/mobile/src/components/update/update-dialog.tsx`):

- **Finding 1 (should-fix), commit `e7fb83edd`** — the local failure dismissal was keyed on the state object (`state === dismissedFailure`), so a same-message store emit resurfaced a dismissed modal (offline launch → auto check fails → Later → foreground return, where `setLastCheckedAt` mints a new object). The dismissal is now keyed on the failure message and cleared whenever the status leaves `failed`, so `Try again` or any new failure shows the dialog again while an unchanged failure stays dismissed.
- **Finding 2 (should-fix), commit `c813a450d`** — `failed` showed a generic "Update failed" header and lost the version. The dialog now keeps the last prompt's title/detail/message/progress (`PromptContext`, remembered across `installing` and `checking`) and adds the fixed alert line with Later / Try again, so a failed install still reads "Zilar 0.2.4 is ready". The generic header is kept only when no prompt preceded (e.g. idle → failed); the remembered prompt is dropped on `idle`/`upToDate` so a stale prompt cannot leak into a later failure. The failure dialog keeps its own `accessibilityLabel: 'Update failed'`.

Tests added: none. Both findings are UI behaviour in `update-dialog.tsx`; the Spec says "No tests (UI)", AGENTS.md says UI code gets no tests, and no Allowed file is a test file (a new test file would also fail the gate's scope check), so per the repo rules I changed no tests. Neither finding names a test. The behaviour was checked by reading the state transitions (`available`/`ready` → `installing`/`downloading` → `failed`, dismiss → same-message emit, dismiss → `checking` → `failed`), not by an automated test.

Files changed this round: `apps/mobile/src/components/update/update-dialog.tsx` only.

Checks run (single test files: none — the three changed folders have no test files):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (1.4s)
PASS  typecheck  (3.0s)
PASS  effect  (0.4s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`update-dialog.tsx` is 252 lines. The three follow-ups (auto/manual tag, expose `enabled`, add `sizeBytes` to the `downloading` state) need `apps/mobile/src/lib/use-app-update.ts`, outside the Allowed files, so they are left as they are. The two nits are not in lines this round changed, so they are untouched.

No disagreements: both findings were reproduced from the code and fixed as described.

### Round 2 (follow-ups, from the lead)

Added `apps/mobile/src/lib/use-app-update.ts` to the Allowed files. One commit per follow-up:

- **Follow-up 1, commit `55758b9ea`** — automatic check failures are silent. `runCheck(true)` (the launch check and the `AppState` foreground check) remembers the state it replaced and on failure restores it (usually `idle`/`upToDate`), keeping `lastCheckedAt` and setting no `failed`. Only a user-started action reports a failure: `failed` now carries `source: 'check' | 'download' | 'install'`. The root dialog renders `failed` only for the `download` and `install` sources; a manual `checkNow()` failure stays in the Settings row's second line with no dialog.
- **Follow-up 2, commit `703e4d85f`** — `useAppUpdate()` now returns `enabled: updateEnabled()`, and `app-version-row.tsx` uses it instead of its private `updaterOff()` (removed, with the `expo-constants` import).
- **Follow-up 3, commit `43a17d02d`** — `sizeBytes` is on the `downloading` state, so `KNOWN_SIZES` and `updateTotalBytes` are gone and `progressLine` takes a `number` total. `sizeBytes` was also added to `installing` so the row keeps its size line while installing (that line previously came from the memo).
- **Follow-up 4, commit `781d1f3ec`** — while `installing`, the row's Install key is a disabled kit `Button` showing an `ActivityIndicator` (accent-foreground, labelled "Installing") instead of a live Install button.

No tests added (UI; Spec "No tests (UI)"), and no test file is in the Allowed files. The gate now selects the `@zilar/mobile` tests because `use-app-update.ts` sits in `src/lib/` next to test files; it ran them and they passed. Line counts: `update-dialog.tsx` 232, `app-version-row.tsx` 231, `use-app-update.ts` 364.

`pnpm gate` (repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (2.7s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Round 3 (pre-review findings)

Findings fixed (one commit, in `apps/mobile/src/lib/use-app-update.ts`):

- **Finding 1 (should-fix), commit `067c16404`** — a failed quiet download set the store to `idle`, discarding a pending `available`/`ready` offer; on the Wi-Fi path `runCheck` never went through its own restore because `runDownload` swallowed the error. `runDownload` now takes the pre-check state as a `fallback` argument and, when `quiet`, restores it (instead of `idle`) both on a download error and on a cancel (`fileUri === null`). `runCheck` passes its `previous` into `runDownload(true, previous)`, so the ignored mobile-data offer (or a `ready` prompt whose APK vanished) survives the failed retry and the next check's 6-hour throttle no longer hides it. Non-quiet downloads are unchanged (`failed` / `available`).

Tests added: none. The Spec says "No tests (UI)" and no test file is in the Allowed files — a new `*.test.ts` would fail the gate's `scope` check — and neither finding names a test. `use-app-update.ts` sits in `src/lib/` rather than the crucial-code list in AGENTS.md, so per the repo rules I changed no tests. I verified the behaviour by reading the state transitions (`runCheck` capture of `previous` → `runDownload(true, previous)` → catch cancels to `previous`), not by an automated test.

Files changed this round: `apps/mobile/src/lib/use-app-update.ts` only (366 lines).

`pnpm gate` (repo root), the Spec's only check:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.0s)
PASS  effect  (0.4s)
PASS  tests @zilar/mobile  (1.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no single test files (`--reporter=dot`): no Allowed file is a test and the round added none. The gate's nearest-test step ran the `@zilar/mobile` tests and they passed.

### Disagreements

- **Finding 2 (nit, `apps/mobile/src/lib/use-app-update.ts:240-245,279-281`) is wrong, so I left the code as it is (accepted by the lead).** The auto-failure restore cannot roll back the freshly written timestamp: `setStatus` always overrides `lastCheckedAt` with the value currently in the store (`current = { ...next, lastCheckedAt: current.lastCheckedAt }`). By the time the `catch` runs its `setStatus(previous)`, line 246's `setLastCheckedAt(at)` has already set `current.lastCheckedAt = at`, so the restore keeps the new in-memory value; the comment "keeping `lastCheckedAt`" is accurate. Storage holds the same `at` from line 245, so there is no divergence. No change made (it is also a nit, on lines this round did not touch).

## Review (written by Claude)

**Approved and merged.** Julio approved the updater boards as drawn on 2026-10-16.

- **Pre-review:** clean after two automatic rounds, plus the lead's round 2:
  - a failed automatic check stays silent;
  - `enabled` and `sizeBytes` come from the store;
  - the Install key shows a spinner while installing;
  - a failed quiet download keeps a pending offer.
- **The lead read `update-dialog.tsx` against the boards:**
  - the `ConfirmDialog` shell (`bg-black/40`, a `max-w-xs rounded-2xl border-border-strong bg-surface p-4` card);
  - the download `IconTile`, a 16 px title, a mono 12 px line and the well with the accent fill;
  - the exact texts ("Update to Zilar <v>", "You're on mobile data. Download now?", "Zilar <v> is ready", "Install now? Your chats stay as they are."), with Later / Download / Install / Cancel / Try again.
- **Mounting:** the dialog is mounted once in `_layout.tsx`, which calls `startAppUpdateChecks()` once.
- **Sizes:** 232, 231, 263, 143 and 366 lines.
- **Not checked on a device:** the emulator stays off while Julio is at the PC (decisions 10-16). Julio checks it on v0.2.4.


