---
id: T-1959
title: "Phone UI consistency M3: Profile, Explore, Share, Edit profile, Contacts and Blocked use the shared ScreenHeader (56 dp back row + 28/600 title)"
status: merged
milestone: M5
branch: task/T-1959-phone-one-tap-headers
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 40 min
---

# T-1959: Phone one-tap headers (M3)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch **M3** of `docs/audit/ui-consistency.md` §5. The target is §1.2.

**What the lead saw on the emulator:**
- `/me`: back plus a 28 px title on the same row (`apps/mobile/src/app/me.tsx:228`);
- `/explore`: a shaded bar with title and subtitle;
- `/settings/profile`: a 20 px title with subtitle and Save.

### Facts (read by the lead on 2026-10-18)
- T-1948 (M1) adds `apps/mobile/src/components/ui/screen-header.tsx`: `ScreenHeader({ variant: 'root' | 'sub', title, subtitle?, onBack?, right?, bare? })`.
  - **`sub`:** a 56 dp back row, then the 28/600 title, then an optional 14 px subtitle.
  - **`bare`:** the row only.
  - **Read the merged file** for the exact API before using it.
- **The six screens** each draw their own header with `ChevronLeft`: `apps/mobile/src/app/me.tsx`, `apps/mobile/src/app/explore.tsx`, `apps/mobile/src/app/share.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/app/settings/contacts.tsx` and `apps/mobile/src/app/settings/blocked.tsx`.
  - If a screen already uses `SettingsScreenShell`, it got the new header in M1, and only its leftovers change.

### Steps
1. **In each of the six files,** replace the hand-made header (back key, title, subtitle, right action) with `ScreenHeader variant="sub"`, using the same title, subtitle, back handler and right action.
   - `/settings/profile` keeps Save as `right` in the back row.
   - `/me` uses `variant="sub" bare` above its profile body, as the audit's §1.2 exception says: the avatar, name and status stay as they are, with no second "Profile" title.
2. **Remove the now-unused imports** (`ChevronLeft`, local title styles).
3. **Nothing else changes:** no list, no body layout and no behaviour.
4. **No tests** (UI). Every file stays at 400 lines or fewer.

### Allowed files
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/app/share.tsx`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `work/T-1959-phone-one-tap-headers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On phone smoke screenshots of `/me`, `/explore`, `/share`, `/settings/profile`, `/settings/contacts` and `/settings/blocked`, every one shows the same 56 dp back row; all but `/me` show the 28/600 title under it.
- Save stays in the row on Edit profile.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Replaced the hand-made headers with the shared `ScreenHeader`:

- `apps/mobile/src/app/me.tsx`: `ScreenHeader variant="sub" bare title="Profile"` above the profile body, so there is no second "Profile" title; removed `ChevronLeft`, `IconButton` and `ICON` imports.
- `apps/mobile/src/app/explore.tsx`: `ScreenHeader variant="sub"` with title "Explore" and the existing subtitle; removed `ChevronLeft`, `IconButton` and `ICON`.
- `apps/mobile/src/app/share.tsx`: `ScreenHeader variant="sub" title="Send to"` inside `ShareFrame`; removed `ChevronLeft`, `IconButton` and `ICON`.
- `apps/mobile/src/app/settings/contacts.tsx`: `ScreenHeader variant="sub"` with title "Contacts" and subtitle "The people you can chat with."; removed `ChevronLeft`, `IconButton` and `ICON`.
- `apps/mobile/src/app/settings/blocked.tsx`: `ScreenHeader variant="sub"` with title "Blocked people" and subtitle "They are not told."; removed `ChevronLeft` and `IconButton`, kept `ICON` for the empty-state `Ban` icon.
- `apps/mobile/src/app/settings/profile.tsx`: **no change needed.** It already renders through `SettingsScreenShell`, which M1 changed to `ScreenHeader variant="sub"`, and it already passes Save as `right` in the back row. Its only header leftovers were already gone.

No list, body layout or behaviour changed. Longest touched file is 337 lines (`explore.tsx`).

### Checks run

`pnpm gate` (from the repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.1s)
PASS  lint  (1.3s)
PASS  typecheck  (5.2s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test run: the task says no tests for this UI change, and the gate reported no nearby test files for `@zilar/mobile`. I did not run the app, so the visual acceptance is left to the lead's phone smoke.

### Notes for the lead

- `/settings/profile` was already on the new header before this task, so it is unchanged; the Save button was already in the back row.
- `/me` now draws only the 56 dp row (no title), per the audit's §1.2 exception; the avatar/name/status body is untouched.
- `/explore` lost its `border-b border-divider bg-surface` bar, as intended by moving to the shared header.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 0 findings. The lead checked the phone smoke (mock build of `a092eca70`):
- **`/me`:** now has only the 56 dp back row (`bare`) above the avatar body, with no second "Profile" title.
- **`/explore`, `/share`, `/settings/contacts` and `/settings/blocked`:** the same back row, then the 28/600 title and the 14 px subtitle.

`/settings/profile` already took the header from T-1948 through the shell, so it needed no change. Explore's outlined filter chips are batch M7.
