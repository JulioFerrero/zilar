---
id: T-2196
title: "Phone: profile and avatar calls fail with the shared ApiError; ProfileApiError and its own body parsing go; same messages"
status: merged
milestone: M5
branch: task/T-2196-phone-profile-error
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2196: One error class for phone profile calls

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src/lib/profile-api.ts:9-11` says `ProfileApiError` "is the shared `ApiError`", but it is a second class. Its own body parsing repeats what `apiErrorFromBody` in `@zilar/api-contract` already does. Every other phone API, and the web, fails with `ApiError`; the group visibility sheet already reads `error.detail.nextChangeAt` from it (`apps/mobile/src/components/chat/visibility-sheet.tsx:25-31`).

### Facts (the lead read these on 2026-10-19)
1. `packages/api-contract/src/errors.ts:18-30` `ApiError(status, code, message, detail)`; `:34-42` `apiErrorFromBody(status, raw)` keeps every extra envelope field (such as `nextChangeAt`) on `detail`.
2. `apps/mobile/src/lib/profile-api.ts`:
   - `:31-46` `class ProfileApiError`;
   - `:52-57` `NextChangeAtSchema`, `:72-84` `parseApiErrorBody`, `:86-94` `parseNextChangeAt`;
   - `:100-109` `toProfileError`, and `:112-115` `profileCall`, which wraps `call` only to convert errors;
   - `:119-150` `avatarRequest`, which builds the error by hand.
3. Other users of `ProfileApiError` / `parseApiErrorBody`:
   - `apps/mobile/src/app/me.tsx:27`, `:73`;
   - `apps/mobile/src/components/settings/avatar-native.ts:3`, `:234`, `:252`, `:259`, `:265-284` (`toAvatarUploadError`);
   - `apps/mobile/src/components/settings/profile-logic.ts:9`, `:39`, `:67-71`, `:79`;
   - `apps/mobile/src/components/settings/use-profile-api.ts:6`, `:44`;
   - `apps/mobile/src/components/settings/use-profile-settings.ts:10`, `:167`, `:173`, `:191`.

### Steps
1. Delete `ProfileApiError`, `NextChangeAtSchema`, `parseApiErrorBody`, `parseNextChangeAt`, `toProfileError` and `profileCall` from `profile-api.ts`:
   - the shared chats and handles APIs take `call` directly;
   - `avatarRequest` throws `apiErrorFromBody(response.status, body)` on a non-2xx answer.
2. Every `new ProfileApiError(status, code, message)` becomes `new ApiError(status, code, message)`, and every `instanceof ProfileApiError` becomes `instanceof ApiError`.
3. `profile-logic.ts` `friendlyClaimError`: read `nextChangeAt` from `error.detail.nextChangeAt`, and keep it only when it is a string that parses as a date. That is today's rule, which moves here from `parseNextChangeAt`.
4. `avatar-native.ts` `toAvatarUploadError`: start from `apiErrorFromBody(status, jsonBody(body))`. Keep the same results:
   - when the body has a real `code`, use that error, with `UPLOAD_FAILED_MESSAGE` when it has no message;
   - otherwise the 400 / 413 / 429 / default mapping stays exactly as now.
5. Update the comment at `profile-api.ts:9-11` so it stays true, or delete it.
6. Keep every user-facing text and code the same. Add no tests.

### Allowed files
- `apps/mobile/src/lib/profile-api.ts`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/components/settings/avatar-native.ts`
- `apps/mobile/src/components/settings/profile-logic.ts`
- `apps/mobile/src/components/settings/use-profile-api.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `work/T-2196-phone-profile-error.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git grep -n "ProfileApiError\|parseApiErrorBody" -- apps` finds nothing.
- Phone emulator, mock mode, checked by the lead: Me loads, Edit profile opens, and the username field shows its availability text.
- Product lines are at least 35 lower.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/lib/profile-api.ts`: deleted `ProfileApiError`, `NextChangeAtSchema`, `parseApiErrorBody`, `parseNextChangeAt`, `toProfileError` and `profileCall`. The chats and handles APIs now take `call` directly, and `avatarRequest` throws `apiErrorFromBody(response.status, body)` on a non-2xx answer. The stale comment above `MyProfile` is gone. All thrown errors are the shared `ApiError`.
- `apps/mobile/src/app/me.tsx`, `apps/mobile/src/components/settings/use-profile-api.ts`, `apps/mobile/src/components/settings/use-profile-settings.ts`: every `new ProfileApiError(...)` is now `new ApiError(...)`.
- `apps/mobile/src/components/settings/profile-logic.ts`: `friendlyClaimError` and `isHandleRateLimited` check `instanceof ApiError`. `friendlyClaimError` reads `error.detail.nextChangeAt` and keeps it only when it is a string that parses as a date (the old `parseNextChangeAt` rule, now a small `nextChangeAtOf` helper).
- `apps/mobile/src/components/settings/avatar-native.ts`: `uploadEffect` fails with `ApiError`; `toAvatarUploadError` starts from `apiErrorFromBody(status, jsonBody(body))` and keeps the old results (real code wins, `UPLOAD_FAILED_MESSAGE` when it has no message, otherwise the 400/413/429/default mapping).
- No user-facing text or error code changed. No tests added.

### Files changed

- `apps/mobile/src/lib/profile-api.ts`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/components/settings/avatar-native.ts`
- `apps/mobile/src/components/settings/profile-logic.ts`
- `apps/mobile/src/components/settings/use-profile-api.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `work/T-2196-phone-profile-error.md`

### Commands and real results

- `pnpm install`: done in 18.9s (1155 packages, one deprecated subdependency warning).
- `git grep -n "ProfileApiError\|parseApiErrorBody" -- apps`: no matches.
- `pnpm gate` (first run): GATE FAIL — `format` failed on `profile-logic.ts` only.
- `pnpm exec prettier --write apps/mobile/src/components/settings/profile-logic.ts`: reformatted the one file.
- `pnpm gate` (second run): **GATE PASS**. Summary lines:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (3.4s)`
  - `PASS  effect  (0.7s)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `PASS  tests @zilar/mobile  (2.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
- Single tests: none run — no existing test file covers these modules, and the spec says to add none. The gate's own mobile test run passed.
- Product lines: `git diff --shortstat -- apps` = `6 files changed, 49 insertions(+), 114 deletions(-)`, 65 lines lower.

### Deviations and notes

- `toAvatarUploadError` uses `errorFieldsOf(raw)` alongside `apiErrorFromBody` for the message fallback. `apiErrorFromBody` substitutes `Request failed (<status>)` when the envelope has a code but no message, while the old code used `UPLOAD_FAILED_MESSAGE`; reading the message from the raw body keeps the old result exactly.

### Blocked / needs a decision

None.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −65.

**What changed:**
- `ProfileApiError` and its own body parsing (`parseApiErrorBody`, `parseNextChangeAt`, `toProfileError`, `profileCall`) are gone. Phone profile and avatar calls fail with the shared `ApiError`, like every other phone call and the web.
- `avatarRequest` uses `apiErrorFromBody`.
- The username error reads `nextChangeAt` from `error.detail`, still only when it is a date.
- An avatar error with no message in its body still shows the upload-failed text.

**Phone emulator smoke passed:**
- Me and Edit profile;
- typing a username shows "@zed_new_99 is available".
