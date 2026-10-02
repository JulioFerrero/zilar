---
id: T-0026
title: Mobile — real sign-in (invite, email code, name) and a session, so the phone is no longer mock-only
status: merged
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
  `x-zilar-invite` header and `PATCH /api/me`
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
3. **Send `x-zilar-invite` on BOTH calls** (send-code and sign-in) when an invite
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
`127.0.0.1:3188`. A gated test (`ZILAR_AUTH_INTEGRATION=1`) that goes through
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
- **Auth client (`src/lib/auth.ts`):** `createZilarAuthClient` wraps Better Auth's React client with the `emailOTP` plugin and a **bearer** auth option (native fetch has no cookie jar). `sendSignInCode` / `verifySignInCode` attach the `x-zilar-invite` header on **both** calls when an invite is present; `verifySignInCode` captures the session token from the `set-auth-token` response header. `API_URL` comes from `EXPO_PUBLIC_ZILAR_API_URL` (default `http://127.0.0.1:3188`).
- **API helpers (`src/lib/auth-api.ts`):** hand-validated `fetchMe`, `updateMe` (`PATCH /api/me`) and `checkInvite`, with an `AuthApiError` carrying status/code. No new dependency (mobile has no zod, so this follows the spike's type-guard style).
- **Session storage (`src/auth/session-storage.ts`, `src/auth/secure-session-storage.ts`):** the bearer token is persisted with **`expo-secure-store`** (OS keychain/keystore), never AsyncStorage; an in-memory implementation is used by tests.
- **Session store + hook (`src/auth/session-store.ts`, `src/auth/session.ts`):** a zustand store with `bootstrap` (restores a session and loads `/api/me`), `signIn`, `setName`, `signOut`, plus the `useSession()` hook returning `{ me, loading, status, signOut }`. The app bootstraps once in `_layout.tsx`.
- **Guard (`src/auth/guard.ts`, `src/auth/RequireAuth.tsx`):** pure `guardDecision` → loading / allow / `login` with the target preserved / `name`; `RequireAuth` and `RequireUser` components. `safeTarget` only accepts relative in-app paths.
- **OTP (`src/auth/otp.ts`, `src/auth/OtpInput.tsx`):** six boxes with auto-advance, backspace and whole-code paste; pure helpers keep the logic testable.
- **Screens/routes:** `AuthFlow` (email → code, retry timer, "Wrong code" / "Too many attempts, try again later", "Use a different email"), `NameForm`, and routes `app/login.tsx`, `app/invite/[code].tsx`, `app/welcome/name.tsx`; `app/index.tsx` and `app/chat/[id].tsx` are wrapped in `RequireAuth`. The chat store is still the mock store.
- **Tests (Vitest, no real network):** invite header on both calls, no header on login, whole-code paste + auto-advance, wrong code keeps the guest state and signs nobody in, name step calls `PATCH /api/me` before updating, guard redirects to login with the target, sign-out clears storage, and the token/OTP are never written to the console (console spies). Plus a gated real-server integration test.

### Files changed
- New: `apps/mobile/src/lib/auth.ts`, `apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/lib/auth.test.ts`, `apps/mobile/src/lib/auth-api.test.ts`
- New: `apps/mobile/src/auth/session-storage.ts`, `secure-session-storage.ts`, `session-store.ts`, `session-store.test.ts`, `session.ts`, `guard.ts`, `guard.test.ts`, `errors.ts`, `errors.test.ts`, `otp.ts`, `otp.test.ts`, `AuthFlow.tsx`, `OtpInput.tsx`, `NameForm.tsx`, `RequireAuth.tsx`, `integration.test.ts`
- New routes: `apps/mobile/src/app/login.tsx`, `apps/mobile/src/app/invite/[code].tsx`, `apps/mobile/src/app/welcome/name.tsx`
- Modified: `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/package.json`, `pnpm-lock.yaml`
- New screenshots: `apps/mobile/screenshots/auth-code.png`, `apps/mobile/screenshots/auth-signed-in.png`
- `work/T-0026-mobile-auth.md` (status + this Report). No other file, package or doc was touched.

### Commands run and real results
- `pnpm install`: PASS — "Already up to date".
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (280 files, 127 rules).
- `pnpm typecheck`: PASS — turbo "8 successful, 8 total".
- `pnpm test --force`: PASS — turbo "8 successful, 8 total". `@zilar/server` **186 passed, 3 skipped** (20 files); `@zilar/mobile` **77 passed, 1 skipped** (12 files + the gated integration file skipped by default); other packages unchanged.
- `pnpm build`: PASS — 2/2 tasks; Expo exported iOS + Android bundles.
- **Integration run** (`ZILAR_AUTH_INTEGRATION=1` against the running server on `127.0.0.1:3188`, codes/tokens redacted):

```
[auth integration] send-code with invite → 200 → code read from the server log → CODE=*** →
sign-in with invite → 200, token TOKEN=*** → GET /api/me → 200 → PATCH /api/me → 200 →
sign-out → 200 → second sign-in without invite → 200 → GET /api/me after second sign-in → 200
```

  The test creates a fresh invite with the server CLI, then speaks raw `node:http` (no browser Fetch-Metadata headers, like React Native), reads the OTP from the server's own log, verifies it, `PATCH`es the name, signs out and signs in again as an existing user.

- **Visual check:** built and installed with `npx expo run:ios --no-bundler` (Build Succeeded), started Metro, signed in on the simulator with a real code read from the server log, and confirmed the session survives a cold restart (the app reopened straight into the chat list). Screenshots committed; Metro stopped (`lsof -ti tcp:8081` → empty) and the simulator I booted was shut down.

### Problems, deviations from the spec, open questions
- **`app.json` was reverted (allowed-files rule).** `npx expo install expo-secure-store` appended `expo-secure-store` to the `plugins` array in `app.json`. `app.json` is not in Allowed files, so I reverted it. SecureStore works without the config plugin for this use; the plugin only configures the iOS Face ID usage string, which we don't use. If the lead wants the plugin committed, that needs an allowed-files exception.
- **Native-only origin behavior (worth knowing).** Better Auth's Fetch-Metadata CSRF check rejects POSTs that carry `Sec-Fetch-*`/cookie but no trusted `Origin`. React Native sends neither, so the bearer flow works on device (proved by the simulator sign-in). Node's `fetch` adds `sec-fetch-mode: cors`, which would 403; the integration test therefore uses `node:http`. If the app is ever exercised through a browser-like transport, it must send a trusted `Origin`.
- **Small UX additions:** `autoFocus` on the email field and the first OTP box, plus `returnKeyType="go"` / `onSubmitEditing` on the email field. These are usability improvements that also made on-device typing possible; they don't change the flow or the look.
- **Two unused test rows.** Each integration run creates one extra invite (the CLI always inserts a row) and one test account, all in the dev database; harmless, but the lead may want to prune `t0026-*@example.test`.
- **Screenshots came from a second simulator.** The lead's booted "iPhone 17 Pro" had a pending "Open in Zilar?" dialog from another session, so I left it alone and booted a fresh "iPhone 17" instead (then shut it down). All codes, tokens and invite codes are redacted from the screenshots; the code-screen shot is empty.
- **Typed routes:** running Metro generated `.expo/types`, which makes `router.replace` stricter. `safeTarget` validates the target and a documented `as Href` cast keeps `pnpm typecheck` green both with and without the generated types.

### What the next task (mobile on real data) gets for free
- `useSession()` / `useAuthStore` (`bootstrap`, `signIn`, `setName`, `signOut`) ready for the chat screens, with the token already persisted in SecureStore.
- `lib/auth.ts` (bearer Better Auth client + invite header) and `lib/auth-api.ts` (`fetchMe`, `updateMe`, `checkInvite`).
- Routes and guards (`/login`, `/invite/[code]`, `/welcome/name`, `RequireAuth`/`RequireUser`) and a reusable `OtpInput`/`AuthFlow`.
- The chat store is still the mock store, exactly as scoped.

### Blocked / needs a decision
- Nothing blocked.


---

## Review (written by Claude)

**Verdict:** **approved**. Merging.

### What the lead verified
- **Uncached** run of every check: `format:check`, `typecheck`, `test` (64 s),
  `build` (24 s), `lint` (exit 0) — **all PASS**. mobile **77 passed / 1
  skipped** across 12 files plus the gated integration file, server 186, web 78,
  xmpp-core 115 + 3 skipped. The mobile counts match the Report exactly.
- **Secrets, which is the thing that actually matters here.** I grepped the whole
  diff for 6-digit literals: the only hits are test fixtures (`123456`,
  `654321`, `12345`) and a colour `#707579`. No real OTP or invite code is
  committed. The gated integration test redacts as it logs —
  `code read from the server log → CODE=***` and `token TOKEN=***` — and the
  Report shows the same redacted output. The screenshots show a synthetic
  `…@example.test` address and no code at all.
- **The session token goes to the OS keychain**, not plain storage:
  `secure-session-storage.ts` uses `expo-secure-store` and says why in a comment
  (`AsyncStorage` is unencrypted and readable by other apps' backups). This is
  what the Spec asked for and it is the right call.
- **The live flow is real, not mocked.** Against the running server on
  `127.0.0.1:3188`: `send-code with invite → 200`, `sign-in with invite → 200`,
  `GET /api/me → 200`, `PATCH /api/me → 200`, `sign-out → 200`, then
  **`second sign-in without invite → 200`** and `GET /api/me after second sign-in
  → 200`. That last pair is the one that proves the session survives a restart
  and that an existing user does not need an invite.
- **Both screenshots opened.** `auth-code.png` is the messenger-style code screen
  the style guide asks for: centred card, large title, six digit boxes with the
  first focused, a live `Resend in 28s` countdown and "Use a different email".
  `auth-signed-in.png` shows the guard letting a signed-in user through to the
  chat list, still on mock data as scoped.
- **Scope.** Only `apps/mobile/src/{auth,lib,app}/**`, the two dependencies the
  Spec allowed (`better-auth@^1.7.6`, `expo-secure-store`), the lockfile and the
  task file, plus the two screenshots the Spec asked for. `metro.config.js` is
  **untouched**, as required after T-0004. The chat store is still the mock
  store, as required.
- The `guard` keeps the target route and only accepts relative in-app paths, so
  it cannot be used as an open redirect. That was not asked for and it is right.

### Findings
- None. Nothing outstanding.

### Note for the next task
The next task can now assume a real session and a real profile name, and must
still use the mock store only until it swaps in `xmpp-core`. Two things from
tonight's other work travel with it: the T-0004 Metro stubs are already in place
(do not touch `metro.config.js` again), and the client **must** reconnect on
`AppState` `active` when the status is not `online`, because the simulator did not
suspend the socket during the T-0004 probe and a real device will.
