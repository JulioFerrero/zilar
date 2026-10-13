---
id: T-1331
title: "Phone navigation like Telegram (docs/audit/nav-plan.md): three tabs Chats, AIs, Settings — the Profile tab goes; the Settings profile card opens the own profile screen (today's Profile tab content), and /profile still works as a link"
status: merged
milestone: M5
branch: task/T-1331-mobile-three-tabs
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1331: Phone three tabs

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, approved "Simplify like Telegram". The plan is `docs/audit/nav-plan.md`. The phone has four tabs (`apps/mobile/src/components/nav/floating-tab-bar.tsx:37-40`): Chats, AIs, Settings, Profile. The Settings hub already starts with a profile card (`apps/mobile/src/app/(tabs)/settings.tsx`, `ProfileHeaderCard`), so the Profile tab repeats it. Telegram keeps your profile at the top of Settings.

### What to build
1. **Three tabs:** remove the `profile` entry from `FLOATING_TABS` (`floating-tab-bar.tsx:40`).
   - The bar lays out three equal tabs; check the comment at `:217` ("four equal tabs") and the width maths.
   - Drop the tab's avatar-ball profile loading in `apps/mobile/src/app/(tabs)/_layout.tsx` (`useProfileApi`, `:35-57`) if nothing else uses it.
2. **Own profile screen:** move `apps/mobile/src/app/(tabs)/profile.tsx` (278 lines) out of the tab group to a stack route, `apps/mobile/src/app/me.tsx`.
   - It keeps its content: Set photo, Edit info, Settings (that button now just goes back, or is removed, since Settings is where you came from; your call, say which), username and email.
   - Give it a back button like the other stack screens.
   - **`/profile` must still open it.** Use a redirect file or the router config (cite how other redirects are done in `apps/mobile/src/app/+native-intent.tsx`), so old links and notifications keep working.
3. **The Settings profile card** (`ProfileHeaderCard`, `settings.tsx:72-110`) opens `/me`. Check what it opens today and cite it.
4. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/nav-plan.md`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/+native-intent.tsx`.

### Allowed files
`apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/me.tsx`, `apps/mobile/src/app/profile.tsx`, `apps/mobile/src/app/+native-intent.tsx`, `apps/mobile/src/app/_layout.tsx`, `work/T-1331-mobile-three-tabs.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the Android mock build:**
  - three tabs;
  - Settings card → own profile with back;
  - the link `zilar://profile` opens the own profile.

---

## Report (written by the worker when done)

### What I did
1. **Three tabs.** Removed the `profile` entry from `FLOATING_TABS`
   (`floating-tab-bar.tsx:40`), so the bar renders three equal tabs (the bar's
   doc comment now says "three equal tabs" instead of "four"; the width maths is
   `flex: 1` per tab, so nothing else changed). Dropped the Profile tab's
   avatar-ball loading from `(tabs)/_layout.tsx` (the `useProfileApi` /
   `getSessionToken` / `personSeed` effect at old `:35-57`) and the now-dead
   `TabProfile`, `TabProfileFace`, `avatarFailedFor` and `profile` prop in
   `floating-tab-bar.tsx`; nothing else referenced them (grep across
   `apps/mobile/src`).
2. **Own profile screen.** Moved `(tabs)/profile.tsx` to the stack route
   `apps/mobile/src/app/me.tsx` (`git rm` the old file). It keeps its content
   (Set photo, Edit info, Settings, username, email) and gained a back button
   (`IconButton` + `ChevronLeft`, `goBackOrHome(router)`) in the header, the
   same pattern as `u/[handle].tsx:251-256`.
   - **Decision on the "Settings" action key:** it now calls `router.back()`,
     since you reach this screen from Settings. I did *not* remove it, because
     `ProfileView` (`components/profile/profile-view.tsx`) is outside this
     task's Allowed files and its `onOpenSettings` prop is required, so it must
     be passed something. The key and the header back both return to the screen
     you came from.
3. **`/profile` still opens it.** Added `apps/mobile/src/app/profile.tsx`, a
   redirect file: `<Redirect href="/me" />`. `+native-intent.tsx` already hands
   a `zilar://profile` deep link through unchanged (line 98 returns any
   `zilar://` input as-is) and a bare `/profile` path unchanged
   (`rewriteBarePath`), so the redirect file is enough; I did not need to edit
   `+native-intent.tsx`.
4. **Settings card.** `ProfileHeaderCard` opened `/settings/profile` today
   (`settings.tsx:220`, `onPress={() => router.push('/settings/profile')}`).
   It now opens `/me`. Also fixed the two "Profile tab" mentions in that card's
   comment.

### Files changed (all inside Allowed files)
- `apps/mobile/src/components/nav/floating-tab-bar.tsx` — three tabs, profile avatar code removed.
- `apps/mobile/src/app/(tabs)/_layout.tsx` — three triggers, profile load removed.
- `apps/mobile/src/app/(tabs)/profile.tsx` — deleted (moved, `git rm`).
- `apps/mobile/src/app/(tabs)/settings.tsx` — card opens `/me`; comment.
- `apps/mobile/src/app/me.tsx` — new own profile stack screen with back.
- `apps/mobile/src/app/profile.tsx` — new `/profile` → `/me` redirect.
- `work/T-1331-mobile-three-tabs.md` — status + this report.

### Commands and real results
- `pnpm install` → done (15.4s).
- First `pnpm gate` → `FAIL format` on `apps/mobile/src/components/nav/floating-tab-bar.tsx`; fixed with `pnpm exec prettier --write` on the changed files.
- Final `pnpm gate` (from the repo root) → **GATE PASS**:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files were run: this is UI-only (no tests, per AGENTS.md and the task).

### Notes / open questions
- `components/profile/profile-view.tsx:85` still has a doc comment saying the
  loading "`(tabs)/profile.tsx` screen owns the loading". That file is outside
  the Allowed files, so I left it. One-line follow-up if you want it accurate.
- I could not run the Android mock build (not part of Checks); the acceptance
  items above the gate are the lead's phone smoke.

### Round (fix round, 2026-10-13)

- **Finding 1 (should-fix) — fixed.** `apps/mobile/src/app/me.tsx:264` used
  `onOpenSettings={() => router.back()}`, which is a no-op when `/me` opens cold
  (e.g. a `zilar://profile` notification tap redirects here with no history).
  Now `onOpenSettings={() => router.push('/settings')}`, always opening Settings;
  updated the screen's doc comment to match the new behaviour. Commit
  `T-1331: fix finding 1 - Settings key opens /settings instead of router.back()`.
- **Finding 2 (nit) — corrected here, no code change.** The original What-I-did
  text cited `+native-intent.tsx` line 98 for the `zilar://` passthrough; the
  logic is in `apps/mobile/src/lib/web-link.ts:98` (`if (input.startsWith('zilar://')) return input;`).
  The finding confirms the conclusion (the redirect file is enough) is correct.
  Left the original sentence untouched (nit, not a line I changed) and record
  the correction here.
- **Tests:** none added or adjusted. Per AGENTS.md and the Spec ("No tests (UI)")
  UI nav changes get no tests, and the finding names no test for this fix.
- **Gate (from the repo root):** **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No single test files were run: UI-only change with no nearby tests.

### Disagreements

None. The follow-up (`profile-view.tsx:85` stale doc comment) is outside the
Allowed files, so it stays untouched.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (1 follow-up); the packet is current for `d79fb133`.**
- **Lead's emulator check** (Android mock build of this branch):
  - the tab bar shows Chats, AIs and Settings;
  - tapping the Settings profile card opens "Profile" (ball, You, online, Set photo / Edit info / Settings, email) with a back button, and back returns to Settings;
  - the `zilar://profile` deep link opens the same screen.
