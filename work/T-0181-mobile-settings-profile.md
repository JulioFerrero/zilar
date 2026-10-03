---
id: T-0181
title: Mobile: settings hub, profile (name, avatar, @handle) and the handle step after sign-up
status: planned
milestone: M5
branch: task/T-0181-mobile-settings-profile
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0181: Mobile: settings hub, profile (name, avatar, @handle) and the handle step after sign-up

## Spec (written by Claude, do not edit)

### Why
Web has a settings area (`SettingsShell`, `ProfilePage`, `HandlePage`). The phone has no settings screen at all: no way to change your name or photo, or claim a @handle (so nobody can find you). Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/routes/ProfilePage.tsx`, `HandlePage.tsx`, `NamePage.tsx`, `apps/web/src/components/SettingsShell.tsx`, `ProfileSettingsSection.tsx`, `AvatarUploader.tsx`, `HandleSuffix.tsx`; client functions in `apps/web/src/lib/api.ts`: `checkHandle(handle)` (line ~1961), `claimHandle(handle)` (~1969), `uploadAvatar(kind, ownerId, blob)` and `removeAvatar(kind, ownerId)` (~2181-2224; `PUT/DELETE /api/avatars/user/<id>`).
- Server: `apps/server/src/handles/routes.ts` (`GET /api/handles/check`, claim) and `apps/server/src/avatars/`. Read them for the exact request and error shapes (taken, reserved, invalid, rate limited).
- Mobile already has `app/welcome/name.tsx` + `auth/NameForm.tsx` (the name step) and `expo-image-picker`. The chat list header (`apps/mobile/src/app/index.tsx`, around line 229) has IconButtons for "My AIs" and "Search"; there is no settings entry.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes or message text.

### What to build
1. `apps/mobile/src/lib/settings-items.ts`: the list of rows the settings hub shows (`{ id, title, icon, href, ownerOnly? }`). Start with Profile and My AIs (route `/ais`). Later tasks add one row each.
2. `apps/mobile/src/app/settings/index.tsx`: the hub (a list of those rows, user card on top). Add a Settings icon button (lucide `Settings`) to the chat list header.
3. `apps/mobile/src/app/settings/profile.tsx`: edit display name (same validation as `NameForm`), change or remove the avatar (image picker, upload as the web does, show the progress and errors), show and change the @handle with a live availability check (debounced `checkHandle`), claim with `claimHandle`, show the server's reason on failure.
4. `apps/mobile/src/app/welcome/handle.tsx`: the post-sign-up handle step, same as web `/welcome/handle` (with a Skip); route there after the name step exactly as web does after `NamePage`.
5. `apps/mobile/src/lib/profile-api.ts` (+ tests): `checkHandle`, `claimHandle`, `uploadAvatar`, `removeAvatar`.
6. Tests (Vitest): the API module (success and each error code), the hub list, the handle availability states, the avatar flow (picked, uploading, failed, removed).

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern: type guards or zod, an error class with `status` and `code`), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), plus the web files named above.

### Allowed files
`apps/mobile/src/app/settings/**`, `apps/mobile/src/app/welcome/handle.tsx`, `apps/mobile/src/app/welcome/name.tsx` (only the next route), `apps/mobile/src/app/index.tsx` (only the settings button), `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/profile-api.ts` and tests, `apps/mobile/src/components/settings/**`.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 settings profile handle avatar
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- Settings opens from the chat list; Profile edits the name, avatar and @handle against the real API.
- A new user lands on the handle step after the name step and can skip it.
- Errors from the server are shown in plain words; nothing is logged.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Notifications, stickers, machines and the other settings pages (later tasks), changing the email.

---

## Report (written by the worker when done)

## Review (written by Claude)
