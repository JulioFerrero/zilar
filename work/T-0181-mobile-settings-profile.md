---
id: T-0181
title: Mobile: settings hub, profile (name, avatar, @handle) and the handle step after sign-up
status: review
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

### What was built
Settings hub, profile editing (name, avatar, @handle) and the post-sign-up
handle step, mirroring web (`ProfilePage`, `HandlePage`, `NamePage`,
`SettingsShell`, `ProfileSettingsSection`, `AvatarUploader`):

- `apps/mobile/src/lib/profile-api.ts` (+ tests): `getMe` (handle +
  avatarUrl, optional like web's `meSchema`), `checkHandle`
  (`GET /api/handles/check`), `claimHandle` (`PUT /api/me/handle`),
  `uploadAvatar` (`PUT /api/avatars/user/<id>`; `fetch` blob path for
  tests, injected `expo-file-system` uploader for production since RN
  `fetch` cannot send binary bodies), `removeAvatar`. `ProfileApiError`
  carries `status` + `code`.
- `apps/mobile/src/lib/settings-items.ts` (+ tests): hub rows (Profile,
  My AIs); icon stored as an id (Vitest cannot load
  `lucide-react-native`), mapped to components in the screen.
- `apps/mobile/src/app/settings/index.tsx`: hub with user card on top;
  Settings lucide button added to the chat list header (`app/index.tsx`).
- `apps/mobile/src/app/settings/profile.tsx` + `components/settings/`:
  display-name edit (same validation as `NameForm`, saved through the
  session store), avatar control (image picker with square OS editor,
  picked preview, upload progress, failed/removed states, bearer-scoped
  same-origin picture load), handle editor with debounced (300 ms) live
  availability check, own-handle skip, claim with the server reason shown
  (`handle_taken`, `handle_reserved`, `handle_invalid`,
  `handle_change_too_soon` with the next-change date, `rate_limited`).
  Plain-logic half (`profile-logic.ts`: availability view model, friendly
  texts, `suggestHandleFor`) is hook-/JSX-free and fully tested, plus
  `renderToStaticMarkup` tests for the two controls.
- `apps/mobile/src/app/welcome/handle.tsx`: post-sign-up handle step with
  suggestion + Skip; `NameForm` now chains `name -> handle` when there is
  no explicit `from` (exactly like web's `NamePage`).
- `mock/profile.ts` (+ tests) and `use-profile-api.ts`: real-or-mock hook
  following `use-ais-api.ts`; mock mirrors check/claim/avatar semantics
  (reserved/invalid/taken, second claim 409s, avatar urls persist).

### Files changed
New: `lib/profile-api.ts(.test.ts)`, `lib/settings-items.ts(.test.ts)`,
`mock/profile.ts(.test.ts)`, `components/settings/{use-profile-api,
screen-shell, hub.ts(.test.ts), profile-logic.ts(.test.ts),
avatar-native.ts(.test.ts), avatar-control.tsx, handle-field.tsx,
settings-ui.test.tsx}`, `app/settings/{index,profile}.tsx`,
`app/welcome/handle.tsx`.
Edited: `app/index.tsx` (Settings button only), `auth/NameForm.tsx`
(next route only).

### Commands and real results
- `pnpm install`: ok (9.8s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (one `set-state-in-effect` hit fixed by mirroring the
  AI list's `load` + `useFocusEffect` pattern).
- `pnpm typecheck` (mobile): pass (one missing `saved` prop in a test
  fixed).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 settings profile
  handle avatar`: 7 files, 81 tests, all pass.
- Neighbours `auth lib/auth-api lib/ais-api components/ais/ais`: 9 files
  pass, 80 tests pass, 1 skipped (pre-existing skip).
- The lead tests on the emulator and the phone.

### Problems / deviations
- Web crops avatars in a canvas dialog; the phone has no canvas, so the OS
  picker sheet crops (`allowsEditing` + square aspect, quality 0.9). No
  256 KiB client resize: over-cap files refuse before upload with the
  server's wording.
- The screen passes an empty `Blob` with the native uploader (the blob is
  only used on the `fetch` path); documented in code.
- `NameForm` chains to `/welcome/handle` only when `from` is `/`; explicit
  `from` (join-by-link, login) is preserved, exactly like web.
- No emoji in UI, no new dependency, no server change.

### Security checklist
- Tokens ride only on same-origin avatar loads/uploads (the GIF-panel
  pattern); nothing (tokens, codes) is logged.
- Avatar PUT permission is server-checked; unknown vs. forbidden both 404.
- Handle clamp: unique index on the server, loser maps to 409; no
  check-then-insert on the client (claim failure just shows the reason).
- Screens are `RequireAuth`/`RequireUser` guarded; audit untouched (no
  server change).

### Open questions
None.

## Review (written by Claude)
