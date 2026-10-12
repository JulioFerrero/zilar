---
id: T-1259
title: "TG-12 profile mobile: Settings → Profile gets a Bio field (one line, at most 140, counter, same hint as web) saved with PATCH /me, and the @handle profile card shows another person's bio"
status: merged
milestone: M5
branch: task/T-1259-mobile-profile-bio
model: auto
effort: default
depends_on: [T-1258]
estimate: 0.2 day
---

# T-1259: Bio on mobile

## Spec (written by Claude, do not edit)

### Why
T-1258 (merged) added the bio. Read its Report for the details:
- **Server and contract:** `AuthBio`, at most 140 characters, trimmed, with no control characters or newlines. `UpdateMePayload` is `{ name, bio? }`; `name` stays required. `AuthMe.bio` and `HandleProfile.bio` are optional strings (`packages/api-contract/src/auth.ts`, `packages/api-contract/src/contact-requests.ts`).
- **Web:** `apps/web/src/components/ProfileSettingsSection.tsx` (the Bio field, its counter and hint) and `apps/web/src/components/ContactProfileRow.tsx` (the bio line under the handle).
- **Mobile has none of it:**
  - `Me` (`apps/mobile/src/lib/auth-api.ts:8-13`) and `toMe` (`:26-28`) drop the bio;
  - `updateMe` (`:42-51`) sends only `name`;
  - Settings → Profile is `apps/mobile/src/app/settings/profile.tsx` (111 lines), with `NameField` (`apps/mobile/src/components/settings/name-field.tsx`, 61 lines) and `use-profile-settings.ts` (309 lines);
  - another person's profile is `apps/mobile/src/components/contacts/profile-card.tsx` (328 lines), used by `apps/mobile/src/app/u/[handle].tsx`.

### What to build
1. **`auth-api.ts`:**
   - `Me` gets `bio: string` (absent means `''`);
   - add `updateBio(apiUrl, token, name, bio, fetchImpl?)`, which sends `{ name, bio }` because the server needs `name`;
   - keep `updateMe` unchanged so `session-store.ts` and its test stay as they are.
2. **A new `apps/mobile/src/components/settings/bio-field.tsx`,** like `NameField`:
   - a single-line input, `maxLength={140}`, newlines stripped on change;
   - the counter "n / 140" and the hint "A few words about you. Anyone who finds you by username can see it.";
   - a Save button that calls `updateBio` with the current name, showing "Saved." or "Could not save your bio.".
   - Render it in `settings/profile.tsx` under the name field, and read the starting value from `GET /me` the way the screen already loads the profile (cite where).
3. **`profile-card.tsx`:** when `bio` is set, show it as one muted line under the handle.
4. **Mock:** the mock's `/me` routes already serve `bio` (T-1258, `packages/mock-backend/src/domains/me/`). Check and cite.
5. **No new tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `work/T-1258-profile-bio.md`, `apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/name-field.tsx`, `apps/mobile/src/components/settings/use-profile-settings.ts` and `apps/mobile/src/components/contacts/profile-card.tsx`.

### Allowed files
`apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/components/settings/bio-field.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/use-profile-settings.ts`, `apps/mobile/src/components/contacts/profile-card.tsx`, `work/T-1259-mobile-profile-bio.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/auth-api.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check on the emulator (mock build):** Settings → Profile shows Bio with the counter, and Save shows "Saved.".

---

## Report (written by the worker when done)

### What I did
- **`auth-api.ts`:** `Me` gained `bio?: string | undefined`; `toMe` passes the bio through and leaves it **absent** when the server omits it (so payloads from an older server still read as `''` at the call site). Added `updateBio(apiUrl, token, name, bio, fetchImpl?)`, which PATCHes `/api/me` with `{ name, bio }` (both trimmed; the server still requires `name`) and returns the updated `Me`. `updateMe` is untouched.
- **`components/settings/bio-field.tsx` (new, 71 lines):** like `NameField`, a single-line input (`maxLength={140}`, newlines stripped in `onChangeText`), the counter `n / 140`, the hint "A few words about you. Anyone who finds you by username can see it.", the error, "Saved.", and a "Save bio" key.
- **`app/settings/profile.tsx`:** renders `<BioField>` under the name field.
- **`use-profile-settings.ts`:** the starting bio is read from `GET /me` in the same load that already paints the screen (`api.getMe()` + the session token, `use-profile-settings.ts:97-151`). Because `MyProfile` (`profile-api.ts`, not in Allowed files) drops the bio, it is read through `auth-api`'s `fetchMe` — the same `/me` the screen loads. `saveBio` calls `updateBio` with the saved name and the auth bearer from the load; failure shows "Could not save your bio.".
- **`components/contacts/profile-card.tsx`:** when `bio` is set, one muted line under the `@handle` (`numberOfLines={1}`).
- **Mock:** the mock `/me` already serves a bio (T-1258): `packages/mock-backend/src/domains/me/routes.ts:31` returns `data.me`, `:38-39` stores it on PATCH, and `state.ts` owns it. In mock mode the bio calls use the mock bearer and `mockFetch` (the `devices.tsx` recipe), so the emulator mock build works.
- No new tests (UI, per the spec).

### Files changed
`apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/components/settings/bio-field.tsx` (new), `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/use-profile-settings.ts`, `apps/mobile/src/components/contacts/profile-card.tsx`, `work/T-1259-mobile-profile-bio.md`. All inside Allowed files; all ≤400 lines (auth-api 141, bio-field 71, profile 129, use-profile-settings 399, profile-card 334).

### Deviations / notes
1. **`Me.bio` is optional, not `bio: string`.** A required field would break files I may not edit: `src/lib/auth-api.test.ts:6,14` asserts `expect(me).toEqual(ME)` on a fixture with no bio, and `src/auth/session-store.test.ts:7` / `session.test.ts:45` build `Me` literals. `toMe` therefore leaves `bio` absent when the server omits it; the screen reads `viewer.bio ?? ''`. This is why the Checks' `auth-api.test.ts` still passes unmodified.
2. **The starting bio comes through `auth-api`'s `fetchMe`**, an extra `GET /me`, because `MyProfile`/`MyProfileSchema` (in `profile-api.ts`, not in Allowed files) has no `bio` and strips it. I could not add it there without leaving scope.
3. **`profile-card.tsx` imports `HandleProfile` from `@zilar/api-contract`** (the contract type, which has `bio`) instead of the local interface in `contacts-api.ts` (not in Allowed files, and it has no `bio`). The local shape is structurally assignable, so the two call sites (`u/[handle].tsx:258`, `people-search-result.tsx:79`) are unchanged.
4. The bio Save button reads "Save bio" (mirroring "Save name"); a bio save sends the **saved** name (`profile.name`), not the pending name input, so it cannot rename by accident.

### Commands and real results
- `pnpm install`: done in 10s (pnpm v10.32.1).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts`: **1 file passed, 6 tests passed** (the AGENTS quiet form of the task's Checks command).
- `pnpm gate` (repo root) — ends with **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Not run by me: the lead's emulator mock smoke (no phone here).

### Open questions
- If the lead prefers `Me.bio` required (`bio: string`) and editing `auth-api.test.ts` / the session tests, that needs those files in the Allowed list.

### Blocked / needs a decision
- None.

### Round (fix round)
PREREVIEW.md lists 0 must-fix, 1 should-fix (S1), 1 nit (N1), 4 follow-ups (F1–F4).

**S1 fixed.** The bio Save is now disabled while a name save is in flight, so the bio PATCH (which carries the saved name) cannot land with a stale name and silently revert a just-saved rename.
- `components/settings/bio-field.tsx`: added `saveDisabled: boolean` (mirrors `HandleField.saveDisabled`) and included it in the button's `disabled`.
- `app/settings/profile.tsx`: passes `saveDisabled={nameBusy}`.
- `use-profile-settings.ts` is unchanged: `saveBio` still sends the saved name (correct once the name save has landed).

**Not changed, why:**
- **N1 (nit):** it is in `lib/auth-api.ts`, a file this round did not otherwise change, so per the instructions I left it alone. Its caller ignores the return, so there is no live bug.
- **F1–F4 (follow-ups):** out of scope; each needs a file outside Allowed files (`auth-api.test.ts`/session tests, `lib/profile-api.ts`, `lib/contacts-api.ts`, `packages/mock-backend/...`). Behaviour is correct as documented.

**Tests:** none added. The spec says "No new tests (UI)", the finding names no test, and a new hook test file would be outside the Allowed files (the gate's scope check would flag it). The UI Save path has no existing test harness.

**Commands and real results:**
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts`: **1 file passed, 6 tests passed**.
- `pnpm gate` (repo root) — ends with **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Round 2 (fix round)
PREREVIEW.md (HEAD `cca9ace`) lists 0 must-fix, 1 should-fix (S2), 1 nit (N1), 4 follow-ups (F1–F4).

**S2 fixed (behaviour).** A name save can no longer start while a bio save is in flight, so the bio PATCH — which carries the saved name — cannot land last and silently revert a just-saved rename. The exact implementation the finding proposes (a new `saveDisabled` prop on `NameField`) needs `components/settings/name-field.tsx`, which is **not** in this task's Allowed files, so I reached the same guard from an Allowed file:
- `app/settings/profile.tsx`: `nameSaveBlocked = nameUnchanged || bioBusy` is fed to `NameField`'s existing `unchanged` prop — the prop it already uses to keep Save disabled. Only the name Save button is disabled; the label stays "Save name" and the input stays editable, exactly what a dedicated `saveDisabled` prop would do. The bio side keeps its round-1 `saveDisabled={nameBusy}`, so the two saves are now mutually exclusive in both directions.

**Not changed, why:**
- **N1 (nit):** it is in `lib/auth-api.ts`, a file this round did not otherwise change, so per the instructions I left it alone (its caller ignores the return; no live bug).
- **F1–F4 (follow-ups):** out of scope; each needs a file outside the Allowed files (`auth-api.test.ts`/session tests, `lib/profile-api.ts`, `lib/contacts-api.ts`, `packages/mock-backend/...`).

**Tests:** none added. The spec says "No new tests (UI)", the finding names no test, and UI code gets no tests (AGENTS); a new hook test file would be outside the Allowed files and the gate's scope check would flag it.

**Commands and real results:**
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts`: **1 file passed, 6 tests passed**.
- `pnpm gate` (repo root) — ends with **GATE PASS**:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements
- **S2, implementation only (behaviour is fixed).** The finding says to give `NameField` a `saveDisabled` prop and calls "both files are Allowed", but `apps/mobile/src/components/settings/name-field.tsx` is not in the Allowed files list, and the task forbids changing files outside it. I did not skip the finding: the behaviour it asks for is fixed in `apps/mobile/src/app/settings/profile.tsx` (Allowed) by folding `bioBusy` into the value `NameField` already uses to disable Save. If the lead prefers the literal `saveDisabled` prop, add `apps/mobile/src/components/settings/name-field.tsx` to the Allowed files and I will move the guard there.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 2 auto rounds (2 nits, 4 follow-ups).**
- **The change:**
  - `Me.bio`, plus `updateBio` sending `{ name, bio }`;
  - a new `bio-field.tsx`, with its state in `use-profile-settings.ts` (399 lines; at the limit, so the next profile change must move code out first);
  - the bio line on `profile-card.tsx`.
- **Lead's emulator check (mock build, SMOKE PASS):**
  - Settings → Profile shows Bio between Display name and @username, with the hint and "0 / 140";
  - typing "Hi there" gives "8 / 140", and Save bio shows "Saved.".
- **Not checked:** the bio on another person's @handle card; the mock seeds no bios. Check it on the next APK.
