---
id: T-0026
title: Mobile — real sign-in (invite, email code, name) and a session, so the phone is no longer mock-only
status: todo
milestone: M1
branch: task/T-0026-mobile-auth
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0015, T-0017, T-0024]
estimate: 1 day
---

# T-0026: Mobile sign-in for real

## Spec (written by Claude, do not edit)

### Goal
The mobile app is still on mock data, and the first thing standing in the way is
that it has **no sign-in at all**. T-0024 gave the web a real invite → email code
→ name → chat flow and Julio used it live; this task gives the phone the same
front door, so the next task only has to swap mock data for real data.

**This task is the front door only.** Do not wire the chat list, messages or
xmpp-core into the app; that is the next task. When you finish, the phone can
sign in, stay signed in, and show a real profile name — and the store still
uses mock chats.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md` — the sign-in screens have a look already
- `apps/web/src/lib/auth.ts`, `apps/web/src/auth/AuthProvider.tsx` and
  `apps/web/src/routes/{InvitePage,LoginPage,NamePage,AppRoutes}.tsx` —
  **mirror these flows and the same headers exactly.** The server does not care
  which client calls it.
- `apps/server/src/auth/**` — what the server actually accepts, including the
  `x-galena-invite` header and `PATCH /api/me`
- The Review of `work/T-0015-auth-invites.md` — the OTP gating, hashing and
  rate-limit rules you must not break
- `apps/mobile/src/app/**` (Expo Router routes), `apps/mobile/src/components/ui/**`
- Better Auth **1.7** docs: the React Native client
  (`better-auth/react` with a custom `fetchOptions`, or the native client),
  `emailOtp`, session persistence, and the `getSession` shape

### Allowed files
- `apps/mobile/src/auth/**` (new)
- `apps/mobile/src/app/**` (routes only)
- `apps/mobile/src/lib/auth*.ts`
- `apps/mobile/package.json` and `pnpm-lock.yaml` **only** for the auth
  dependencies listed below
- `work/T-0026-mobile-auth.md`

**Not allowed:** `packages/**`, `apps/server/**`, `apps/web/**`, `apps/mobile/src/store/**`
(the store stays on mock data in this task), `apps/mobile/metro.config.js`
(it was just fixed for xmpp-core — do not touch it), `docs/**`.

> Other workers have also edited `pnpm-lock.yaml`. Do not resolve a lockfile
> conflict; the lead does that at merge time.

### Allowed dependencies
- `better-auth` (same major as the web: `^1.7`), plus only what its React Native
  client needs (`react-native-svg` or `expo-secure-store` if the session has to
  be stored natively — `expo-secure-store` is **preferred** for the session
  token; do not put a session token in `AsyncStorage` without saying why).
- Install with `npx expo install <pkg>` so the versions match the SDK.
- Nothing else. If you need another package, describe it in the Report and stop.

### What to build
1. **The sign-in flow, same as the web:**
   - `/invite/:code` → email field → code screen
   - `/login` → email → code, for an existing user
   - after a first sign-in, `/welcome/name` → `PATCH /api/me`
   - a guard: no session → `/login`, preserving the target route
2. **The code screen:** six separate digit boxes that auto-advance and accept
   pasting the whole code, a "Resend code" link after 30 s, and the errors
   "Wrong code" and "Too many attempts, try again later". Match `ui-style.md`
   (centred card, large title) — the web version is the reference, not a redesign.
3. **Send `x-galena-invite` on BOTH calls** (send-code and sign-in) when an invite
   code is present. This is how the server attributes the sign-up; miss it and
   the user lands with no contacts.
4. **Persist the session** so the app opens straight into the chats after a
   restart, and **sign out** clears it. Secure storage, not plain AsyncStorage.
5. **A real `Me` in the store** — no. *(Explicitly out of scope: the chat store
   stays on mock data. Only the session and the profile name are real.)*
   Instead: expose a small `useSession()` hook returning `{ me, loading, signOut }`
   that the chat screens can use later.
6. **Tests** (Vitest, no real network):
   - the invite flow sends the header on both calls
   - the digit boxes auto-advance and accept a full-code paste
   - a wrong code shows the error and does not sign in
   - the name step calls `PATCH /api/me` and only then continues
   - the guard redirects to `/login` with the target preserved
   - sign-out clears the stored session
   - **the session token is never written to a log or to the console** (assert
     this with a spy)

### Integration check (you run it against the running stack)
The dev stack is **already running and serving Julio**: the server is on
`127.0.0.1:3188`. A gated test (`GALENA_AUTH_INTEGRATION=1`) that goes through
the **real** server: request a code for a test email, read the code from the
server's own log output, verify it, `PATCH /api/me`, then sign out and sign in
again. Paste the output.

**Never** run `pnpm infra:up`, `infra:down` or `infra:reset`, and never stop a
process you did not start. A copy of `infra/.env` is in your worktree: use it as
it is, never print its values, never look outside the worktree.

**Never paste a real 6-digit code, an invite code or a session token into the
Report, a commit or a screenshot.** Redact them (`CODE=123***`).

Run the app with `npx expo run:ios --no-bundler` plus Metro in the background,
and **stop Metro at the end**. Put screenshots in `apps/mobile/screenshots/`
(committed). If the simulator is busy, say so in the Report and stop rather than
taking it over.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass.
- [ ] A committed screenshot of the code screen and of the app signed in.
- [ ] The integration run is pasted in the Report, with codes redacted.
- [ ] No code, token or invite code in the Report, the commits or the screenshots.
- [ ] Only allowed files touched; the store is still on mock data.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Real chats, messages, xmpp-core, groups — the next task.
- Push notifications (T-0005).
- OAuth social sign-in.
- Any change to the Metro stubs from T-0004.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test`:
- integration run (codes redacted):

### Problems, deviations from the spec, open questions
-

### What the next task (mobile on real data) gets for free
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
