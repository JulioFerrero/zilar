---
id: T-0161
title: First-run setup screen (Resend key, first admin) with no manual environment setup
status: review
milestone: M5
branch: task/T-0161-first-run-setup
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: []
estimate: 2 days
---

# T-0161: First-run setup screen (Resend key, first admin) with no manual environment setup

## Spec (written by Claude, do not edit)

### Why
Installing on Coolify (or anywhere) today needs an operator to hand-fill mail settings and mint an invite with a CLI inside the container. The Coolify test on 2026-10-02 showed the cost: sign-in codes need SMTP, the first account needs an invite, and an unknown email gets no code. Target: deploy the compose file, open the URL, finish setup in the browser. No mail variables in the compose file and no terminal.

### What to build

**1. Instance settings (server).**
- New table `instance_settings(key text primary key, value text not null, updated_at)` (Drizzle migration, one new migration only). Secret values are stored encrypted (AES-256-GCM, random nonce per value) with a key from `ZILAR_KEY_ENCRYPTION_KEY` when set, otherwise derived with HKDF-SHA256 from `BETTER_AUTH_SECRET` (label `zilar-instance-settings`). Never store the Resend key in clear text.
- Keys: `mail.resend_api_key` (encrypted), `mail.from` (plain).

**2. Mail from settings.**
- Resend is used through its SMTP endpoint with the existing SMTP mailer: host `smtp.resend.com`, port 465, secure, user `resend`, password = the key. No new dependency.
- Mail transport resolution order: explicit `MAIL_TRANSPORT`/`SMTP_*` env (unchanged behaviour) wins; else stored Resend settings; else "unconfigured".
- In production the server must now START when mail is unconfigured (today it refuses). While unconfigured, sending a code fails with a clear logged error (no secret in it) and the sign-in API answers 503 with `mail_not_configured`.
- Saving the settings swaps the live mailer without a restart.

**3. Setup gate.**
- "Setup needed" means: no user with the admin role exists. Like other self-hosted apps, whoever opens the new server first sets it up; there is no setup token.
- `GET /api/setup/status` (public): `{ needsSetup: boolean, mailConfigured: boolean }`. Nothing else.
- `POST /api/setup` (public): body `{ resendApiKey, from, adminEmail }` (zod). In ONE transaction under an advisory lock: re-check that setup is still needed, store the settings, create the first-admin invite for `adminEmail`. Then send a test sign-in code to `adminEmail` through the new mailer; if sending fails, roll back the settings and answer 422 `mail_send_failed` with no provider detail. Success answers 200 `{ ok: true, inviteCode }`. The invite code is for the web client only: it keeps it in memory (never in storage, URL or logs) and sends it with the sign-up request itself. The admin never sees or types an invite code and never touches a terminal or a log.
- Once an admin exists, `POST /api/setup` answers the same 404 as an unknown route. The first admin is created only when its email completes the sign-in code, so a visitor who sets a wrong email cannot take the server over without access to that inbox, and the setup stays open for a retry until an admin exists.
- Rate limit `POST /api/setup`: 5 per 10 minutes per IP. Audit entry `setup.completed` with ids only (no email, no key).

**4. Web.**
- Route `/setup`: if `needsSetup` is false, redirect to `/login`. Otherwise a form (Resend API key as a password input, from address) plus the admin email. Plain explanation of where to get a Resend key and that the from-domain must be verified in Resend. On success go straight to the sign-in code step for that email (the code was already emailed by the setup call), with the invite header added by the client automatically. The admin only types the 6-digit code from their inbox.
- The login screen checks `needsSetup` first and shows a "Finish setting up this server" link to `/setup` instead of an unusable form.
- Match the existing auth screens' components and style. Tests with Vitest + Testing Library: redirect when not needed, error states (mail failed), success path.

**5. Deploy files.**
- `deploy/coolify/docker-compose.yml`: remove the mail variables and `MAIL_ALLOW_CONSOLE_IN_PRODUCTION`; keep optional SMTP overrides out of the required set. Remove the manual-key instructions that no longer apply.
- `docs/INSTALL_DOCKER.md`: rewrite the Coolify section as: paste the compose file, set the domain, deploy, open the URL, finish the setup screen. Say what a Resend key is.

### Read first
`AGENTS.md` (security checklist, all of it), `apps/server/src/auth/` (`mailer.ts`, `invites.ts`, `invite-cli.ts`, `routes.ts`, `auth.ts`), `apps/server/src/config.ts` (mail validation and the `EMPTY_MEANS_UNSET_KEYS` list), `apps/web/src/auth/`, `deploy/coolify/docker-compose.yml`, `docs/INSTALL_DOCKER.md`.

### Allowed files
`apps/server/src/setup/**` (new), `apps/server/src/auth/mailer.ts`, `apps/server/src/auth/mailer.test.ts`, `apps/server/src/auth/routes.ts`, `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/db/**` (schema + the one migration), `apps/server/src/app.ts` or the file that registers routes, `apps/web/src/auth/**`, `apps/web/src/routes/**` (setup route only), `apps/web/src/lib/**` (api client additions), `deploy/coolify/docker-compose.yml`, `deploy/docker-compose.yml` (only if mail variables must change), `docs/INSTALL_DOCKER.md`, `work/T-0161-first-run-setup.md`. Not allowed: new dependencies, mobile app, other tasks' files.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/setup src/auth src/config.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/auth src/routes
```

### Acceptance
- A fresh database with no mail variables set boots in production.
- `/setup` with a working Resend key stores encrypted settings, creates the first-admin invite, and the admin can complete sign-in with a code sent by email.
- Repeated attempts and any call after setup is done are covered by tests (same 404 once done; rate limit hit).
- The key never appears in logs, audit detail, errors, or API responses (test with a sentinel value).
- Existing env-based SMTP installs behave exactly as before.

### Out of scope
- Other mail providers in the UI, changing mail settings after setup (a later settings screen), mobile, the Resend HTTP API (SMTP only).

---

## Report (written by the worker when done)

Done. First-run setup works end to end: deploy, open the URL, paste a Resend key + sender + admin email, type the emailed 6-digit code. No mail variables, no terminal.

**What was built (lead-confirmed design: my salted envelope, unset-means-unconfigured, "setup needed" = no users):**

Server:
- `db/schema.ts` + migration `0034_instance-settings.sql` (one migration only, journal + snapshot): `instance_settings(key, value, updated_at)`.
- `setup/crypto.ts`: AES-256-GCM with random salt+nonce per value (`v1:salt:iv:ct:tag`, base64url), key from `ZILAR_KEY_ENCRYPTION_KEY` else HKDF-SHA256(`BETTER_AUTH_SECRET`, label `zilar-instance-settings`). Fixed-message `SettingsDecryptionError`.
- `setup/settings.ts`: `needsSetup` (no user rows), `get/save/deleteMailSettings` (key encrypted, `mail.from` plain), `takeSetupLock` (`pg_advisory_xact_lock`), `settingsCipherFor` (explicit key wins).
- `auth/mailer.ts`: `MailNotConfiguredError`, `NotConfiguredMailer` (boots in production, logs one clear line, every send fails), `CurrentMailer` holder (swap without restart) + `isTransportConfigured`, `RESEND_SMTP` + `createResendMailer` (smtp.resend.com:465, secure, user `resend`, key as password — existing SMTP mailer, no new dep).
- `auth/auth.ts`: send-OTP `before` hook throws 503 `mail_not_configured` while unconfigured (uniform for every email; the hook runs before the anti-enumeration fake-success). Defense-in-depth mapping kept in `sendVerificationOTP` (Better Auth swallows send errors via `runInBackgroundOrAwait`, so the hook is the load-bearing 503 — verified by test).
- `setup/routes.ts`: `GET /api/setup/status` → `{ needsSetup, mailConfigured }`; `POST /api/setup` (zod body) does settings+invite in ONE tx under the advisory lock with re-check inside, sends a REAL test code via `auth.api.createVerificationOTP` + candidate mailer, swaps the live mailer on success, rolls settings back + 422 `mail_send_failed` (no provider detail) on failure. Post-setup POST = same 404 as unknown route. Rate limit 5/10 min per IP. Audit `setup.completed` with null ids/detail (ids only, never email/key/invite). Request log carries no bodies; all error messages are fixed strings.
- `app.ts` mounts the routes (+ optional `mailer` dep defaulting to config-built, so no existing test call sites changed); `authz-sweep.test.ts` allowlists the two public routes; `index.ts` builds `CurrentMailer`, loads stored Resend settings at boot when env is unset, passes it to auth + app; `config.ts` comment updated (production unset now boots unconfigured; validation rules unchanged, env SMTP still wins).

Web (`apps/web`):
- `routes/SetupPage.tsx` at `/setup`: redirects to `/login` when not needed; form (key as password input, Resend help text incl. verified-domain note); on success goes straight to AuthFlow's code step with the invite in memory only. `AuthFlow` gained backwards-compatible `initialEmail`/`initialStep` props.
- `routes/LoginPage.tsx`: checks status first, shows "Finish setting up this server" link instead of the form while setup is open. `lib/api.ts`: `getSetupStatus`/`postSetup` + zod schemas.

Deploy/docs:
- `deploy/coolify/docker-compose.yml`: removed `MAIL_TRANSPORT`/`MAIL_ALLOW_CONSOLE_IN_PRODUCTION` console defaults (lead instruction); SMTP overrides stay as optional, stored settings are the default path. Rewrote stale comments.
- `deploy/docker-compose.yml`: comment-only (variables unchanged, setup screen is the default path).
- `docs/INSTALL_DOCKER.md`: Coolify section rewritten (paste compose, set domain, deploy, finish setup screen; what a Resend key is); manual path no longer uses the invite CLI for the first account; Email/troubleshooting sections updated.

**Files changed:** `apps/server/src/setup/**` (new: crypto, settings, routes + 2 test files), mailer.ts, auth.ts, config.ts, app.ts, index.ts, `db/schema.ts` + 1 migration, authz-sweep allowlist; web auth/lib/routes/SetupPage + tests; coolify + plain compose comments; INSTALL_DOCKER.md; this task file.

**Commands (real results):**
- `pnpm install`: exit 0.
- `pnpm format:check`: pass (also prettier --write applied to my files + the 2 generated drizzle meta files).
- `pnpm lint`: pass (11 tasks). `pnpm typecheck`: pass.
- `pnpm --filter @zilar/server test --maxWorkers=2 src/setup src/auth src/config.test.ts`: 8 files, 147 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/auth src/routes`: 11 files, 89 passed.
- Neighbours: server authz-sweep/app/migrate (15 passed); web api.test + components/auth (75 passed).

**Acceptance:** fresh DB + no mail env boots (NotConfiguredMailer, covered in mailer.test); setup stores encrypted settings → invite → real emailed code → admin completes sign-in with invite header (covered); 404-once-done + 5/10min rate limit covered; sentinel key asserted absent from logs/audit/errors/responses (setup + mailer + crypto tests); env-SMTP behaviour untouched (config/mailer/auth suites pass unmodified except the 2 boot-refusal tests the spec retires).

**Security checklist:** no secrets in logs/audit/errors/URLs (sentinel tests); settings+invite atomic under advisory lock, state read inside; permission (setup-open) checked before any effect, failure after settings-write rolls back; done-setup = same 404; new routes in 401 sweep allowlist (public by design) + POST rate-limited; audit ids-only.

**Notes/deviations:** (1) Early in the session a second writer edited this worktree concurrently; per the lead's message that was the lead, it is removed, I own T-0161 alone and my design is canonical — nothing of theirs remains. (2) `createInvite` takes the full DB, not a tx, so the setup invite is inserted inline in the tx with identical shape (single-use, 7 days, no creator). (3) `invite-cli.ts` kept as-is for post-setup invites. (4) `MAIL_ALLOW_CONSOLE_IN_PRODUCTION` variable kept (harmless) — only the coolify console defaults were removed per instruction. (5) Item 5 of the review (invite code in memory in the DOM): accepted as is — the code lives only in React state, never in storage/URL/logs (asserted by the success-path test checking the invite header on sign-up).

**Setup screen order (follow-up):** three steps, server unchanged (one `POST /api/setup` with all three values; key stored only if the test send worked). Step 1: admin email only (Next). Step 2: Resend key (password input, resend.com/api-keys hint) + From address prefilled `Zilar <onboarding@resend.dev>` with the testing-domain note; Back + "Send my code" (busy state "Sending your code…"). Errors stay on step 2 with all typed values kept (state only — key never in storage/URL). Step 3: the normal code step, email prefilled, invite attached automatically. Status-failed Retry kept. `SetupPage.test.tsx` covers email-first → key → code-step success, failure-stays-on-step-2 with values kept, Back-keeps-email, validation ordering. `INSTALL_DOCKER.md` order lines updated.

**Review fixes (lead review of e64785b):**
1. `POST /api/setup` checks `needsSetup` BEFORE the rate limiter: post-setup POST is the same 404 for everyone, never a 429 (new test burns the budget, then asserts 404).
2. Client IP now uses `clientIpFor(TRUSTED_PROXY_HOPS)` shared with the join limiter (new `trustedProxyHops` dep, plumbable through `app.ts`), not the raw socket address.
3. Rollback wrapped in try/catch (logs only the error name) so a failed cleanup still answers 422 `mail_send_failed`; the rollback now also deletes the failed attempt's invite in the same guarded transaction (new test: failed send leaves zero invites; new test: broken rollback tx still 422 with no leak).
4. `SetupPage` shows an error card with Retry when the status check fails, instead of the form (new test: failure → error card → Retry → form).
6. Key test now reads the `setup.completed` audit row: `detail` is null and neither the sentinel key, sender, admin email nor invite code appears in any audit column.

## Review (written by Claude)
