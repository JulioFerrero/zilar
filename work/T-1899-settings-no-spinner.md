---
id: T-1899
title: "Phone Settings opens with the profile card already drawn: no spinner on focus, the card renders at once from the last loaded profile (kept in memory across visits) or the session's name/email, and GET /me refreshes it silently; the card keeps a fixed height so nothing below moves"
status: merged
milestone: M5
branch: task/T-1899-settings-no-spinner
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1899: Settings without the jump

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:** "in settings every time i enter dont show my info, loads and then apear my info moving all the settings down".

### Facts (read by the lead on 2026-10-17)
In `apps/mobile/src/app/(tabs)/settings.tsx` (263 lines):
- **On every focus,** `setLoading(true)` and `api.getMe()` run (`:153-174`). While `loading`, a small `ActivityIndicator` (`:210-213`) replaces the profile card, and the taller card then pushes the menu down.
- **`ProfileHeaderCard`** (`:74-109`) already falls back to the session's cached `useAuthStore((s) => s.me)` for name and email. But it returns `null` when the name is empty (`:83-85`), which is another jump.
- **`profile`** is `useState<MyProfile | null>(null)` (`:145`), lost on every remount.

### Steps
1. **A module-level last profile:** add `let lastProfile: MyProfile | null = null;` in `settings.tsx`. Initialise the state from it (`useState<MyProfile | null>(lastProfile)`) and update it wherever `setProfile(me)` runs.
2. **Remove the `loading` state and the spinner.** Always render `ProfileHeaderCard`. The focus effect still calls `getMe()` silently and updates the profile, and a failure keeps what is shown.
3. **`ProfileHeaderCard`** never returns `null`. While there is no name yet, it renders the same card with a placeholder: a 64 px avatar circle in the muted surface colour, plus two muted bars (`h-4 w-32` and `h-3 w-44`, `rounded bg-surface-raised`) in place of the name and the email. That gives the same height, so nothing below moves. With a name, it renders as today.
4. **No tests** (UI). The file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `work/T-1899-settings-no-spinner.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Opening Settings shows the profile card at once,** from the cache or the session. No spinner; the rows below never move.
- **The profile still refreshes** in the background.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added a module-level `lastProfile` cache in `settings.tsx`; the hub's `profile` state now initialises from it, but only when the cached profile's `id` matches the session's `me.id`, and the focus refresh updates it alongside the state.
- Removed the `loading` state, the `ActivityIndicator` spinner and the `ACCENT` import. `ProfileHeaderCard` now always renders; `GET /me` still runs on focus and updates the card silently, and a failure keeps whatever is shown.
- `ProfileHeaderCard` no longer returns `null`: with no name yet it renders the same card with a 64 px muted avatar circle (`h-16 w-16 rounded-full bg-muted`) and two muted bars (`h-4 w-32` and `h-3 w-44`, `rounded bg-surface-raised`) in place of the name and email, so the height matches and the menu below does not move. With a name it renders exactly as before.
- No tests (UI change, as the spec says). File is 276 lines.

### Checks run
- `pnpm install --reporter=silent`: completed with no output/errors.
- `pnpm gate` (repo root, run twice: once after the code change, then again after writing this Report; both GATE PASS, that round's lines):
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (2.0s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (1.7s)`
  - `PASS  typecheck  (1.2s)`
  - `PASS  effect  (0.7s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the change is UI-only and `@zilar/mobile` has no nearby tests.

### Notes for the lead
- The cache lives only in module memory, as the spec asks: it survives tab remounts and is lost on a full app restart, where the session's `me` provides the name and email instead.
- The placeholder card is still pressable and opens `/me`, the same as the loaded card.
- I did not run the app on a phone; the "nothing below moves" claim is from the structure (placeholder uses the same card padding and a 64 px avatar) and needs the lead's phone smoke.

### Round
- **Finding 1 (must-fix), fixed:** in `apps/mobile/src/app/(tabs)/settings.tsx`, `confirmSignOut` now clears both the module cache and the card's state (`lastProfile = null; setProfile(null)`) once `signOut()` settles, before routing to `/login`. A second account signing in on the same phone no longer sees the previous account's name or email from the cache; the card falls back to the new session's `me`, or the placeholder, until `GET /me` answers.
- The state initialiser also adopts the cache only when `lastProfile.id === me?.id` (the session's cached profile), so a sign-out that does not go through this screen — the expired-session path calls the store's `signOut` directly (`store/effects/session-check.ts:72`), which this screen cannot hook — cannot leak it either.
- Still the only source file changed outside this task file.
- **Tests added:** none. The finding names no test, the Spec says no tests (UI), and the mobile app has no component renderer (`@testing-library/react-native` is not a dependency, and adding one is out of scope), so the behaviour is covered by the lead's phone smoke: sign in as A, open Settings, sign out, sign in as B, open Settings.
- **Gate:** rerun after the fix and this Report: `gate: 2 changed file(s) against main`, `PASS install (frozen) (1.4s)`, `PASS format (1.3s)`, `PASS lint (1.2s)`, `PASS typecheck (3.9s)`, `PASS effect (0.5s)`, `SKIP tests @zilar/mobile (no nearby test files)`, scope/migration/images/size checks pass, `GATE PASS`.
- No single test files ran: no test file exists near this change.
- No disagreements with the findings.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `a18877f84`. The NEEDS LEAD packet (20:19) predates the fix `a18877f84` (20:23).
- **No cross-account leak:** the cached profile is cleared on sign-out, and it's only used when its id matches the signed-in user (`settings.tsx:170`).
- **Emulator** (mock build, opening Settings): the screenshots at 0.4 s and 2.4 s are identical. The profile card ("You", you@zilar.test) is drawn at once, with no spinner, and the rows never move.
