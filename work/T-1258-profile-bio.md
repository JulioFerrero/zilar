---
id: T-1258
title: "TG-12 profile, server + web: a short bio (at most 140 characters, one line) — new user_profiles table (migration 0052), PATCH /me takes an optional bio, GET /me and the by-handle profile return it, web Profile settings edits it and the add-contact profile row shows it"
status: merged
milestone: M5
branch: task/T-1258-profile-bio
model: auto
effort: default
depends_on: [T-1255]
estimate: 0.4 day
---

# T-1258: A short bio on your profile

## Spec (written by Claude, do not edit)

### Why
This is item TG-12 profile of the Telegram parity plan: Telegram shows a short bio under the name. We have none.
- **The profile today:**
  - `AuthMe` (`packages/api-contract/src/auth.ts:46-55`), with `UpdateMePayload = { name }` (`:40`);
  - the server `updateMe` (`apps/server/src/auth/api.ts:203-...`) updates the name through Better Auth's `updateUser` (`:210`).
- **Another person's profile:** `GET /users/by-handle/:handle` returns `HandleProfile` (`packages/api-contract/src/contact-requests.ts:92-98`), read by `profileForHandle` (`apps/server/src/contact-requests/reads.ts:109-...`, 156 lines).
- **Web:** the Profile settings page renders `apps/web/src/components/ProfileSettingsSection.tsx` (229 lines). The add-contact result row is `apps/web/src/components/ContactProfileRow.tsx` (347 lines).

### What to build
1. **Migration `apps/server/drizzle/0052_user_profiles.sql`** (hand-written SQL, like `0051_push_session.sql`):
   - `CREATE TABLE "user_profiles" ("user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE, "bio" text NOT NULL DEFAULT '', "updated_at" timestamp with time zone NOT NULL DEFAULT now());`
   - a separate table, so Better Auth's `user` table stays as Better Auth expects it;
   - add the row type to `apps/server/src/db/rows.ts`.
2. **The contract:**
   - an `AuthBio` schema: trimmed, at most 140 characters, no control characters and **no line breaks** (reuse the `isControlCharacter` check used by `AuthDisplayName`, `auth.ts:28-36`);
   - `UpdateMePayload` = `{ name: AuthDisplayName, bio: Schema.optional(AuthBio) }`. Make `name` optional too only if every client still sends it; check the web and mobile callers and cite them;
   - `AuthMe` gets `bio: Schema.optional(Schema.String)`, and `HandleProfile` gets `bio: Schema.optional(Schema.String)`.
3. **The server:**
   - `updateMe` upserts the bio when it's present (`INSERT ... ON CONFLICT (user_id) DO UPDATE`);
   - `GET /me` and `profileForHandle` return it (a LEFT JOIN, so a missing row means no bio). A blocked viewer still gets the same 404 as today (`reads.ts:131-136` and the block check after it);
   - put the SQL in a new `apps/server/src/auth/profile-bio.ts` so `api.ts` (337 lines) stays at most 400;
   - never log the bio.
4. **Web:**
   - in `ProfileSettingsSection.tsx`, a Bio field under the name: a single-line input with `maxLength={140}`, a counter like "12 / 140", and the hint "A few words about you. Anyone who finds you by username can see it.", saved with the existing Save;
   - `ContactProfileRow.tsx` shows the bio, when set, as one muted line under the handle;
   - keep both files at most 400 lines.
5. **Tests** (auth), in `apps/server/src/auth/` beside the existing `/me` tests (find them and cite), up to 3:
   - PATCH with a bio, then GET /me returns it;
   - a bio over 140 characters, or with a newline, answers 400;
   - the by-handle profile shows another user's bio.

### Out of scope
Mobile: the next task.

### Read first
`AGENTS.md`, `packages/api-contract/src/auth.ts`, `apps/server/src/auth/api.ts`, `packages/api-contract/src/contact-requests.ts:85-110`, `apps/server/src/contact-requests/reads.ts`, `apps/server/drizzle/0051_push_session.sql`, `apps/server/src/db/rows.ts`, `apps/web/src/components/ProfileSettingsSection.tsx` and `apps/web/src/components/ContactProfileRow.tsx`.

### Allowed files
`apps/server/drizzle/0052_user_profiles.sql`, `apps/server/src/db/rows.ts`, `packages/api-contract/src/auth.ts`, `packages/api-contract/src/contact-requests.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/profile-bio.ts`, `apps/server/src/auth/*.test.ts`, `apps/server/src/contact-requests/reads.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/lib/api.ts`, `packages/mock-backend/src/domains/me/**`, `work/T-1258-profile-bio.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth src/contact-requests --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's check on the web mock:** Profile settings saves a bio. **Live after deploy (read-only):** `GET /api/me` answers 200, with `bio` absent or a string.

---

## Report (written by the worker when done)

### What I did
- **Migration** `apps/server/drizzle/0052_user_profiles.sql`: the `user_profiles` table exactly as specified; the file-name loader picks it up (no `_journal.json` entry is needed — migrations are read as `*.sql` by number, see `apps/server/src/effect/sql.ts:166-200`).
- **Contract**: `AuthBio` (trimmed, at most 140, no control characters — reuses `isControlCharacter`); `UpdateMePayload` gains `bio: Schema.optional(AuthBio)`; `AuthMe` and `HandleProfile` gain `bio: Schema.optional(Schema.String)`. `name` stays **required**: every caller still sends it — web `updateMe` (`apps/web/src/lib/api/chats.ts:66-67`) and mobile `updateMe` (`apps/mobile/src/lib/auth-api.ts:42-51`).
- **Server**: new `apps/server/src/auth/profile-bio.ts` with `upsertProfileBio` (`INSERT ... ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio`) and `bioForUser` (a LEFT JOIN from `"user"`, so a missing row means no bio). `updateMe` upserts the bio when present; `meView` returns it on `GET /me`; `profileForHandle` (`apps/server/src/contact-requests/reads.ts`) LEFT JOINs `user_profiles` and returns `bio` only when set. A blocked viewer still gets the same 404. The bio never reaches a log.
- **Mock backend**: `PATCH /me` stores a trimmed bio (`packages/mock-backend/src/domains/me/**`) and `GET /me` serves it.
- **Web**: `apps/web/src/lib/api.ts` adds `updateMeProfile(name, bio)`; `ProfileSettingsSection.tsx` reads the bio once with `getMe()` and renders a single-line Bio input (`maxLength={140}`, a `N / 140` counter, the hint) saved with the existing Save; `ContactProfileRow.tsx` shows the bio as one muted line under the handle.
- **Tests**: `apps/server/src/auth/profile-bio.test.ts` with 3 tests (PATCH then GET /me; over-140 and embedded-newline 400; another user's bio on the by-handle profile).

### Files changed
`apps/server/drizzle/0052_user_profiles.sql` (new), `apps/server/src/auth/profile-bio.ts` (new), `apps/server/src/auth/profile-bio.test.ts` (new), `apps/server/src/auth/api.ts`, `apps/server/src/db/rows.ts`, `apps/server/src/contact-requests/reads.ts`, `packages/api-contract/src/auth.ts`, `packages/api-contract/src/contact-requests.ts`, `packages/mock-backend/src/domains/me/routes.ts`, `packages/mock-backend/src/domains/me/state.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/ContactProfileRow.tsx`, `work/T-1258-profile-bio.md`. All ≤400 lines; all inside Allowed files.

### Deviations / notes
- `ProfileSettingsSection.tsx` has no name field; its existing Save claimed the `@username`. I kept the single Save and extended it to also persist the bio, so the bio sits under the `@username` field and a bio-only save works (including for a user with no handle yet). I renamed the button from "Save username" to "Save" because it now saves the profile. No separate Save button was added (the spec asked for "the existing Save").
- The section reads the bio through its own `getMe()` call: `AuthProvider`'s `AuthUser` carries no `bio`, and `apps/web/src/auth/AuthProvider.tsx` is not in Allowed files.
- Mock-backend scope: only `domains/me/**` is Allowed, so instead of adding `bio` to the shared `MockMe`/`MockData` (`src/data/people.ts`, `src/state.ts`, outside scope) the me slice owns the bio via `MeState` and serves it through the same `me` getter; the route reads the setter through an intersection cast.
- Tests went into a new file rather than `auth.test.ts`: that file is already 851 lines and the acceptance caps every touched file at 400. The existing `/me` tests are the `describe('PATCH /api/me')` block in `apps/server/src/auth/auth.test.ts` (I left it untouched).

### Commands and real results
- `pnpm install`: done (16 workspace projects, 1180 packages).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts`: 39 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contact-requests/contact-requests.test.ts`: 8 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/profile-bio.test.ts`: 3 passed.
- `pnpm gate` (repo root) — ends with **GATE PASS**:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.0s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (11.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Not run by me: the web-mock click-through (no browser here) and the live deploy check.

### Open questions
- None.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 nits).**
- **Migration 0052:** `user_profiles` (`user_id` PK, FK `user(id)` ON DELETE CASCADE, `bio` default '', `updated_at`). Better Auth's `user` table is untouched.
- **The bio schema:** `AuthBio` trims, allows at most 140 characters and rejects control characters, newlines included (the test sends `line one\nline two` and gets 400).
- **Where the bio goes:**
  - `PATCH /me` takes it as optional, and `name` stays required;
  - `GET /me` and `by-handle` return it;
  - the SQL lives in `profile-bio.ts`.
- **Lead's checks after rebasing onto main:**
  - auth `profile-bio` + `auth` + contact-requests tests: 47 passed;
  - tsc on server, web and mobile: 0 errors (mobile needed a `pnpm install` for T-1256's new `expo-media-library` first; nothing to do with this branch).
- **Lead's check on the local web mock:** Profile shows Bio with the hint and the 0 / 140 counter; typing "Builds chat apps." gives 17 / 140, and Save shows "Saved.".
- **Next:** live after deploy, read-only: `GET /api/me` is 200.
