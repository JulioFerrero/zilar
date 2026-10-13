---
id: T-1332
title: "Your own no-picture ball is the same colour on every screen of web and mobile (today the mobile Edit profile and every web own-ball are pink while mobile Settings and Profile are green): seed it with personSeed everywhere"
status: merged
milestone: M5
branch: task/T-1332-own-ball-seed
model: auto
effort: default
depends_on: [T-1330]
estimate: 0.3 day
---

# T-1332: One own ball everywhere

## Spec (written by Claude, do not edit)

### Why
The lead's UI audit, 2026-10-13: the signed-in user's no-picture ball has two colours. On the Android mock build:
- the Settings card and the own Profile screen are **green**: they're seeded by `ownSeedFor` (`apps/mobile/src/lib/own-seed.ts`, `personSeed(userId, domain)`, T-1329);
- **Edit profile** is **pink**: `apps/mobile/src/app/settings/profile.tsx:52-54` seeds with `useChatStore(state => state.me?.jid)`, which is undefined there, so it paints the raw seed.

On web the own ball is **pink** everywhere: the menu's profile row (`apps/web/src/components/chatList/ChatListMenu.tsx`), the `/settings` hub card (`apps/web/src/routes/SettingsHubPage.tsx` or `components/settings/hub/`, T-1330) and the Profile picture section (`apps/web/src/components/ProfileSettingsSection.tsx` → `ProfilePictureSection`, `AvatarUploader.tsx:33`). Other people's balls on web use `personSeed` (`PeopleSearchResult.tsx`, `GroupPanel.tsx` …). The rule is in `docs/audit/avatar-seeds.md`.

### What to build
1. **Mobile Edit profile** seeds the ball with the same `ownSeedFor` as the Settings card and `/me`.
2. **Web:** every own ball uses the same rule. Add a small web helper if needed, mirroring `own-seed.ts` and citing where the own user id and domain come from on web:
   - the menu profile row;
   - the settings hub card;
   - the Profile picture section;
   - any other own-avatar spot you find (say which).
3. **Check:** for the mock user, web and mobile paint the same ball (the same `personSeed` input). Explain in the Report why they match.
4. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/avatar-seeds.md`, `apps/mobile/src/lib/own-seed.ts`, `apps/mobile/src/app/settings/profile.tsx`, `apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/routes/SettingsHubPage.tsx`.

### Allowed files
`apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/avatar-control.tsx`, `apps/web/src/lib/own-seed.ts`, `apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/ProfilePictureSection.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/routes/SettingsHubPage.tsx`, `apps/web/src/components/settings/hub/**/*.tsx`, `work/T-1332-own-ball-seed.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check:** the web mock and the Android mock build show the same own ball on the menu, the hub, Profile and Edit profile.

---

## Report (written by the worker when done)

### What I did

Root cause: the own ball was seeded from the raw own bare JID on web and on the
mobile Edit profile screen, while mobile Settings and `/me` seed it with
`personSeed(userId, domain)` (`own-seed.ts`, T-1329). The two strings differ
whenever the JID localpart is not the lowercased user id — the mock user is
exactly that case (`id: 'u-you'` but `jid: 'you@zilar.test'`), so mobile drew
`personSeed('u-you', 'zilar.test')` = `u-you@zilar.test` (green) and the raw-JID
screens drew `you@zilar.test` (a different ball).

Fixes:
1. **Mobile Edit profile** (`apps/mobile/src/app/settings/profile.tsx`): now uses
   `ownSeedFor(ownJid)` and passes `ownerSeed={seedFor?.(profile.id)}`, the same
   function the Settings card (`(tabs)/settings.tsx`) and `/me` use.
2. **New web helper** (`apps/web/src/lib/own-seed.ts`), mirroring mobile's
   `own-seed.ts`: `ownSeedFor(jid)` reads the domain from the own bare JID
   (`bareJid` + the part after `@`) and returns `(userId) => personSeed(userId, domain)`,
   or `undefined` when no JID is known. Web's own JID comes from the store
   (`useChatSelector((s) => s.me?.jid)`, seeded at boot from `GET /me`'s `jid`,
   `apps/web/src/store/effects/lifecycle.ts:147`) and the own user id from the auth
   session (`useAuth().user.id`, `AuthProvider.tsx`; mock id `u-you`, `mock/ids.ts`).
3. **Web own balls** now all use that helper:
   - menu profile row — `apps/web/src/components/chatList/ChatListMenu.tsx`
   - `/settings` hub card — `apps/web/src/routes/SettingsHubPage.tsx`
   - Profile picture section (`ProfilePictureSection` inside
     `apps/web/src/components/ProfileSettingsSection.tsx`), which feeds
     `AvatarUploader.ownerSeed` (`apps/web/src/components/AvatarUploader.tsx`).
   I searched for other own-avatar spots: `Avatar id={ownJid ?? user.id}` /
   `ownerSeed={ownJid}` exist only in those three files; `Composer`/`MessageList`
   read `me.jid` only for "is this a mention of me", not for a ball. No other
   own-ball site found.
4. Updated the stale `AvatarUploader` comment (it claimed uploader call sites
   carry no JID; the own/AI/group callers now pass a seed).

### Why web and mobile now match (the mock user)

Both apps run the same `@zilar/mock-backend` seed: `currentUser = { id: 'u-you',
jid: 'you@zilar.test' }` (`packages/mock-backend/src/data/people.ts:13-18`). Each
own ball is now `personSeed('u-you', 'zilar.test')` = `u-you@zilar.test`:

- mobile: `ownSeedFor(me.jid)(profile.id)` = `personSeed('u-you', 'zilar.test')`;
- web: `ownSeedFor(me.jid)(user.id)` with `user.id = 'u-you'` (mock session,
  `apps/web/src/auth/AuthProvider.tsx:255`, `apps/web/src/mock/ids.ts`) =
  `personSeed('u-you', 'zilar.test')`.

Same function, same inputs, so the same `avatarSvg` bytes. When no JID is known
yet, both fall back to the raw user id (the existing behaviour), still in step.

### Files changed (all inside Allowed files)

- `apps/mobile/src/app/settings/profile.tsx`
- `apps/web/src/lib/own-seed.ts` (new)
- `apps/web/src/components/AvatarUploader.tsx` (comment only)
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/chatList/ChatListMenu.tsx`
- `apps/web/src/routes/SettingsHubPage.tsx`
- `work/T-1332-own-ball-seed.md`

### Commands and results

- `pnpm install` — done, clean (one peer-dependency warning, pre-existing).
- `pnpm exec prettier --write <changed files>` — formatted the two long JSX lines
  so the gate's `prettier --check` passes.
- `pnpm gate` (from repo root):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (3.8s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

No tests were run individually: the change is UI-only and the gate found no
nearby test files (the task says no tests for this UI work).

### Problems / deviations

- None functional. `apps/web/src/components/ProfilePictureSection.tsx` named in
  the Allowed files does not exist; `ProfilePictureSection` is a local component
  inside `ProfileSettingsSection.tsx`, so no new file was created.
- `AvatarUploader.tsx` needed only a comment fix, not a behaviour change.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (2 nits); the packet is current for `42018f33`.**
- **Lead's checks:**
  - web mock (headless): the own ball is green in the menu profile row, the `/settings` hub card and the Profile picture section (it was pink);
  - Android mock build: Edit profile is green, matching Settings and `/me`.
