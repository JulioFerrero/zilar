---
id: T-0180
title: Sign-in: tell people why no code arrived (new here? you need an invite link), web and mobile, without leaking who has an account
status: planned
milestone: M5
branch: task/T-0180-signin-no-code-hint
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0180: A helpful hint instead of a silent "no code"

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: a person typed her email on the iPhone, the app asked for the 6-digit code, but no email was ever sent ("i don't like this silent fail"). Cause: the server is invite-only. For an email with no account and no valid invite code it answers `{ success: true }` and sends nothing (`apps/server/src/auth/auth.ts`, the `before` hook on `SEND_OTP_PATH`). That is on purpose: the answer must be identical for known and unknown emails so nobody can probe who has an account. **Do not change the server.** The app can say something useful on its own, because the app knows whether it was opened with an invite.

### Verified facts
- Mobile: `apps/mobile/src/auth/AuthFlow.tsx` is shared by the invite screen (passes `inviteCode`) and the login screen (no `inviteCode`). It has two steps, `email` and `code`; the code step says "Enter the 6-digit code we sent to {email}" (around line 150) with a "Resend code" button.
- Web: `apps/web/src/components/auth/AuthFlow.tsx` is the same flow (also used by `SetupPage.tsx`, which must NOT change).
- On the login screen (no `inviteCode`), a person who has an account gets a code; a person who has none gets nothing. The screen cannot tell which, and must not try to.

### What to build
1. When there is no `inviteCode`, the **email step** shows one small muted line under the field: "New here? Open the invite link you were sent first, then sign in." (No line on the invite screen, where `inviteCode` is set, or on the setup page.)
2. When there is no `inviteCode`, the **code step** shows a second muted line under the instructions: "No email after a minute? Check spam, and if you are new here you need an invite link from whoever runs this server." Also keep "Resend code".
3. Same copy and placement on web and mobile; use the existing muted text style of each screen. No emoji. Do not mention accounts, "not found" or "not registered".
4. Tests (Vitest) on each side: the lines appear without `inviteCode`, do not appear with an `inviteCode`, and the setup page is unchanged. Also assert the copy does not contain the words "account", "registered" or "exists".

### Read first
`AGENTS.md`, both `AuthFlow.tsx` files and their tests, `apps/server/src/auth/auth.ts` (read only, to understand why).

### Allowed files
`apps/mobile/src/auth/AuthFlow.tsx` and its test, `apps/web/src/components/auth/AuthFlow.tsx` and its test.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 AuthFlow
pnpm --filter @zilar/web test --maxWorkers=2 AuthFlow
```

### Acceptance
- Login screens (web and mobile) show both hints; invite and setup screens do not.
- The server and the setup page are untouched; the copy leaks nothing about accounts.

### Out of scope
Any server change, a "request an invite" feature, other auth screens.

---

## Report (written by the worker when done)

## Review (written by Claude)
