---
id: T-1329
title: "Mobile profile polish: Settings' profile card has no avatar and no subtitle when the JID isn't loaded yet; Edit profile has three separate Save buttons (one Save like web/Telegram); a contact's page shows @handle three times"
status: merged
milestone: M5
branch: task/T-1329-mobile-profile-polish
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1329: Mobile profile polish

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: find more places where the UI doesn't look like Telegram. The lead's audit of the Android mock build found three problems.
1. **The Settings tab's profile card** shows an empty 64 px square where the avatar should be, "You", and an empty second line. The causes, in `apps/mobile/src/app/(tabs)/settings.tsx`:
   - `seed = me?.jid ?? null` (`:88`) with a blank `View` when null (`:96-97`);
   - the subtitle is `@handle` or `me?.email ?? ''` (`:106`).

   The Profile tab shows the ball and the email on the same build, because `apps/mobile/src/app/(tabs)/profile.tsx:57-62` derives the seed from the user id when the JID is unknown. Use the same derivation (share a helper rather than copying it), and the same email source as the Profile tab.
2. **Edit profile** (`apps/mobile/src/app/settings/profile.tsx`, 134 lines) has three Save buttons: "Save name", "Save bio" and "Save username". Web has one Save for name, username and bio (`apps/web/src/components/ProfileSettingsSection.tsx`). Telegram has one Done or checkmark.
   - Make one Save, at the bottom or as a header action, enabled when anything changed.
   - It saves the changed fields with the existing calls (cite them), shows one error line per failed field, and keeps the username validation.
3. **A contact's page** (`apps/mobile/src/app/u/[handle].tsx`, 333 lines) shows "@marta" as the header title, again under the name, and again in the Username row. Telegram has no header title on a profile. Drop the header title (keep the back button) and keep the line under the name and the Username row.
4. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`, `apps/mobile/src/app/settings/profile.tsx` and the components it renders, `apps/mobile/src/app/u/[handle].tsx`.

### Allowed files
`apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/profile/**/*.tsx`, `apps/mobile/src/components/profile/**/*.ts`, `apps/mobile/src/components/settings/**/*.tsx`, `apps/mobile/src/components/settings/**/*.ts`, `apps/mobile/src/lib/own-seed.ts`, `work/T-1329-mobile-profile-polish.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the Android mock build:**
  - the Settings card shows the ball and the email;
  - Edit profile has one Save;
  - `/u/marta` has no "@marta" header title.

---

## Report (written by the worker when done)

Status: review.

### What I did

1. **Settings profile card** (`apps/mobile/src/app/(tabs)/settings.tsx`)
   - Added `apps/mobile/src/lib/own-seed.ts` with `ownSeedFor(jid)`: returns
     `(userId) => personSeed(userId, domain)` from the own bare JID's domain, or
     `undefined` when no JID (and so no domain) is known. This is the exact
     derivation the Profile tab had inline, now shared.
   - The card always draws `<Avatar>` now: seed = `ownSeedFor(ownJid)?.(profile.id ?? me.id)`
     else the raw user id, so the empty 64 px `View` when the JID is not loaded is gone.
   - The subtitle uses the profile's email (`GET /me`, the source the Profile tab shows)
     with the session email as fallback, instead of the session email alone.
   - `(tabs)/profile.tsx` now uses the same `ownSeedFor` helper (removed its inline copy).
2. **Edit profile, one Save** (`apps/mobile/src/app/settings/profile.tsx`,
   `components/settings/{use-profile-settings,name-field,bio-field,handle-field}`)
   - Removed the three per-field Save buttons and their per-field "Saved." lines;
     the three field components are now input + error only.
   - Added one `Save` header action (`SettingsScreenShell`'s `right`, the same pattern as
     `settings/folder/[id].tsx`), enabled when anything changed and disabled while saving.
   - `useProfileSettings` now exposes `changed`, `saved`, `saveBusy`, `saveAll`. `saveAll`
     validates (empty username → "Choose a username", empty name → "Enter your name", the
     web rules), then runs one effect that saves the changed fields in order with the
     existing calls: `api.claimHandle` (`PUT /api/me/handle`), `setName` (`PATCH /me`),
     `updateBio` (carrying the freshly saved name). A failing field keeps its own error
     line and stops the run, so a bio save never reverts a rename that did not land.
   - One "Saved." line at the bottom of the form.
3. **Contact page** (`apps/mobile/src/app/u/[handle].tsx`): dropped the `@handle` header
   title, kept the back button and the line under the name and the Username row.

All changed files are at most 400 lines (largest: `use-profile-settings.ts`, 390).
No tests added (UI).

### Commands and results

- `pnpm install` — done, 16 workspace projects, no errors.
- `pnpm gate` — `gate: 10 changed file(s) against main`:
  ```
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.2s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (1.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (First gate run failed typecheck because of an over-narrow return annotation on the new
  action — `Effect.Effect<void>` pins the error channel to `never`; removed the annotation.
  Second run is the PASS above.)
- No single test files were run: the change is UI only.

### Deviations / notes

- The spec said "one error line per failed field"; the save is sequential and stops on the
  first failure (the web behaviour), so at most one field error shows per run. Each field
  still has its own line.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit); the packet is current for `b22ccdbc`.**
- **Lead's emulator check** (Android mock build of this branch):
  - the Settings card shows the green ball, "You" and "you@zilar.test";
  - Edit profile has one Save in the header (disabled until a change), and the per-field buttons are gone;
  - `/u/marta` has a back button only and no "@marta" title.
- **Lead's checks:** the largest file is `use-profile-settings.ts` (390 lines).
- **Follow-up (pre-existing):** the Edit profile avatar is a different (pink) ball than the Settings and Profile tab ball (green). It should use the same `own-seed` helper.
