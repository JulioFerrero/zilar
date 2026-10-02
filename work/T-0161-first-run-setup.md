---
id: T-0161
title: First-run setup screen (Resend key, first admin) with no manual environment setup
status: blocked
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

**Status: blocked — a second writer is editing this same worktree concurrently. I did no further source edits after discovering it.**

What I did before discovering the conflict:
- `pnpm install` (exit 0, ~7.5 s).
- Read AGENTS.md, the task spec, and all "Read first" material plus Better Auth internals (OTP endpoints, `createVerificationOTP` server API, error codes, rate limits, session cookie flows) and web test patterns.
- Added `instance_settings` to `apps/server/src/db/schema.ts` and generated the single migration `apps/server/drizzle/0034_instance-settings.sql` (+ journal + snapshot) via `drizzle-kit generate --name instance-settings`.
- Started `apps/server/src/setup/`: wrote `crypto.ts` (AES-256-GCM + HKDF `zilar-instance-settings`, my own design) and a first draft of `settings.ts`; made a comment-only edit to `config.ts`'s mail default (production unset boots unconfigured).

What I found at ~21:04 CEST: uncommitted changes in this worktree that are NOT mine appeared while I was working:
- `apps/server/src/auth/mailer.ts` — a duplicate `MailNotConfiguredError` class (mine at line 32, theirs at line 221), plus their `SwitchableMailer`, `RESEND_SMTP`, `createResendMailer`, and a `MAIL_TRANSPORT === 'setup'` branch in `createMailer`. File mtime 21:04, after my last edit of it.
- `apps/server/src/app.ts` — their `setupMailer` dep + `createSetupRoutes` mount. `apps/server/src/index.ts` — their startup wiring via `setup/secret-box.ts` + `loadMailSettings`.
- `apps/server/src/setup/` — directory created 21:01–21:05 containing BOTH my files (`crypto.ts` 21:03, `settings.ts` 21:04 — my writes) and files I never created (`secret-box.ts`, `secret-box.test.ts`, `routes.ts`, `routes.test.ts`, still being edited at 21:05 while I was reading).
- Their design differs from mine in load-bearing ways: separate `secret-box.ts` (nonce|ciphertext|tag, zero salt, `settingsKey(config)` helper) vs my `crypto.ts` (v1 versioned envelope with random salt); their settings module has `needsSetup`/`saveMailSettings` signatures my files don't match; their routes import `{ needsSetup, saveMailSettings }` from `./settings` which my `settings.ts` does not export — the tree is currently in a non-compiling mixed state through no action of mine.

Why blocked, not merged: two writers on one branch/worktree means every further edit of mine risks silently overwriting or breaking their in-flight work (and vice versa — my `crypto.ts` and `settings.ts` already collide by filename with their design). Per AGENTS.md safety rules I stopped editing source files the moment I confirmed foreign writes.

Open questions / decisions needed from the lead:
1. Who owns T-0161 — me or the other writer? If both, how is the work split (filenames/modules) and where do we coordinate so we stop writing the same files?
2. Design call: which encryption envelope is canonical — my salted v1 `crypto.ts:SettingsCipher` or their `secret-box.ts` (`seal`/`open`/`settingsKey`)? Same for mailer shape (`NotConfiguredMailer` vs `SwitchableMailer`, `MAIL_TRANSPORT` unset vs `'setup'` value) and "setup needed" definition.
3. The migration `0034_instance-settings.sql` (+ journal + snapshot) is mine, generated before the conflict; keep it or regenerate after the design call.

Checked but did NOT run (tree left in a mixed, likely non-compiling state): `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, server/web tests. No commit made: committing a half-foreign tree would misattribute their work to me.

## Review (written by Claude)
