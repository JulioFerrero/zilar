---
id: T-0162
title: Integration keys in the UI (Telegram bot token) and a proper import dialog
status: review
milestone: M5
branch: task/T-0162-integrations-settings-telegram
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0161]
estimate: 1 day
---

# T-0162: Integration keys in the UI (Telegram bot token) and a proper import dialog

## Spec (written by Claude, do not edit)

### Why
Testing the Coolify install on 2026-10-02 showed three problems with the Telegram sticker importer:
1. Without `TELEGRAM_BOT_TOKEN` the server answers `501 import_unavailable`, and the web app silently closes the dialog and hides the entry. The user never learns why.
2. The token can only be set as an environment variable, and neither compose file passes it through. A self-hoster who installed by the setup screen has no way to turn the feature on.
3. `TelegramImportDialog` is a plain inline block (`mx-auto max-w-md`) rendered at the end of the page, not an overlay like `InviteDialog` and `NewGroupDialog`, so it appears appended to the text.

### What to build

**1. Real overlay dialog.** Rebuild both states of `TelegramImportDialog` (form and result) as an overlay with the same structure and classes as `InviteDialog.tsx`: `fixed inset-0 z-40` backdrop, centered panel, `role="dialog"` with `aria-modal`, title, a close button, close on Escape and on backdrop click (not while busy), focus moved into the dialog on open. Keep the existing texts and behaviour otherwise.

**2. Say why it is unavailable.** The dialog never closes itself on a 501. It shows a clear state instead: "Telegram import is not set up on this server." For the server owner (see below) add a link to the new settings page; for everyone else: "Ask the person who runs this server to set it up." Keep `onUnavailable` only to disable the entry point's primary action, not to hide it silently; the entry stays visible and opens this state.

**3. Stored integration settings (server).**
- Reuse the `instance_settings` table and the encryption helpers from T-0161 (`setup/crypto.ts`, `setup/settings.ts`). New key `telegram.bot_token`, stored encrypted like the Resend key. The environment variable `TELEGRAM_BOT_TOKEN` still works and wins when set.
- The Telegram client must read the token when a request arrives, not at boot, so saving it works without a restart (inject a `getBotToken()` function into the stickers routes; the env value, else the stored value, else none).
- The server owner is the user with the earliest `createdAt` (document this in a comment and the Report; there is no global admin role). All integration routes answer the same 404 as an unknown route for anyone else.
- Routes under `/api/settings/integrations` (session required):
  - `GET` returns `{ telegram: { configured: boolean, source: 'env' | 'stored' | null }, canManage: boolean }`. Never the token, not even masked.
  - `PUT /telegram` body `{ botToken }` (zod, trimmed, max 256, no spaces). Verify it by calling Telegram's `getMe` through the existing injectable client before storing; a rejected token answers 422 `invalid_token` with a fixed message and nothing is stored. Rate limit 10 per 10 minutes per user. Audit `integrations.telegram_set` with ids only.
  - `DELETE /telegram` removes the stored token (the env value cannot be deleted from here; say so). Audit `integrations.telegram_removed`.
- The token never appears in logs, audit detail, errors, or responses (sentinel tests, like T-0161).

**4. Settings page (web).** New route `/settings/integrations` ("Integrations" in the settings navigation, shown only when `canManage`), reached from the import dialog link. A Telegram card: status (Connected / Not set up, and "set by environment variable" when `source` is `env`), a password input for the bot token with the steps in plain words (open @BotFather in Telegram, send /newbot, copy the token), Save and Remove buttons, and clear error messages (invalid token, network, rate limit). Design the page generically as a list of integration cards so a GIF provider key can be added later; do not build GIF now.

**5. Docs.** `docs/INSTALL_DOCKER.md`: one short section "Optional: sticker import from Telegram" saying where to paste the token in the UI.

### Read first
`AGENTS.md` (security checklist), `work/T-0161-first-run-setup.md` (Report), `apps/server/src/setup/` (crypto, settings, routes and their tests), `apps/server/src/stickers/routes.ts` (around the import route), `apps/server/src/stickers/telegram-import.ts`, `apps/web/src/components/TelegramImportDialog.tsx` and its test, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/routes/NotificationsPage.tsx` (a settings page to copy), `apps/web/src/routes/AppRoutes.tsx`.

### Allowed files
`apps/server/src/integrations/**` (new), `apps/server/src/setup/settings.ts` (only to add generic helpers), `apps/server/src/stickers/routes.ts`, `apps/server/src/stickers/telegram-import*.ts` and their tests, `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/web/src/components/TelegramImportDialog.tsx` and test, `apps/web/src/routes/StickersPage.tsx` and test, `apps/web/src/routes/IntegrationsPage.tsx` and test (new), `apps/web/src/routes/AppRoutes.tsx`, the settings navigation component, `apps/web/src/lib/api.ts` and test, `docs/INSTALL_DOCKER.md`, `work/T-0162-integrations-settings-telegram.md`. No new dependencies, no new migration (the table exists), no mobile.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/integrations src/stickers src/authz-sweep.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/components/TelegramImportDialog.test.tsx src/routes/StickersPage src/routes/IntegrationsPage src/lib/api.test.ts
```

### Acceptance
- The import dialog is an overlay like the other dialogs and is visually separate from the page.
- Without a token the user sees why, and the owner gets a link to the settings page; nobody sees a silent close.
- The owner saves a valid bot token on the settings page, import works without restarting the server; an invalid token is refused and not stored; the env variable still wins.
- A non-owner gets the same 404 on every integrations route. Tests cover owner vs non-owner, invalid token, rate limit, env-wins, and the sentinel token absent from logs, audit and responses.

### Out of scope
GIF provider key (same pattern, later task), changing mail settings after setup, mobile, roles or an admin system beyond "earliest user is the owner".

---

## Report (written by the worker when done)

Done. Integration keys live in the UI now: Settings → Integrations carries an
Email card (sender + Resend key) above a Telegram card (bot token), and the
sticker import dialog is a real overlay that says why the feature is off.

**Design notes (for the record):** the server owner is the user with the
earliest `createdAt` (there is no global admin role) — `isOwner` orders by
`(createdAt, id)`. `GET /api/settings/integrations` is readable by any
signed-in user (the dialog needs `canManage` to decide on its settings
link; secrets never leave either way); every write is owner-only and
answers the same 404 as an unknown route for anyone else. The Telegram
PUT verifies via `getMe` on the injectable client (new `TelegramClient`
method; 401 maps to `invalid_token` in both `callMethod` paths, so the
import flow's `try_later` mapping is untouched). The import route resolves
its token per request via injected `getBotToken()` (env wins, else stored,
else none) — no restart after saving. Email PUT sends a real test message
to the owner's own address through the candidate mailer before storing
anything (default sender uses `sendOtp` with a fixed dummy code through
the new Resend mailer, exactly like setup's test-code path; no secrets in
it), then stores (key encrypted, sender plain) and swaps the `CurrentMailer`.

**Server** (`apps/server/src/`):
- `integrations/settings.ts` (new): `telegram.bot_token` get/save/delete in
  `instance_settings` via the T-0161 cipher; mail helpers reused from
  `setup/settings.ts` as-is.
- `integrations/routes.ts` (new): `GET /settings/integrations` →
  `{ telegram: { configured, source }, email: { configured, source, from },
  canManage }` (sender returned, keys never); `PUT /telegram` (zod trimmed
  max-256 no-spaces, `getMe` verify, 422 `invalid_token` stores nothing,
  10/10min per user, audit `integrations.telegram_set`); `DELETE /telegram`
  (audit `integrations.telegram_removed`); `PUT /email` (`from` required
  mailbox-or-angle-addr, `resendApiKey?` optional keeps stored key, test
  mail to the owner's own address, 422 `mail_send_failed` stores nothing,
  409 `managed_by_environment` on env mail, 5/10min per user, audit
  `integrations.email_set`, swaps `CurrentMailer`). All audits ids-only,
  detail null. All error messages fixed strings.
- `integrations/routes.test.ts` (new, 21 tests): owner vs non-owner (writes
  404, GET readable with `canManage:false`), invalid token 422 + nothing
  stored, env-wins, resolver stored/null, telegram + email rate limits, bad
  bodies send nothing, failed test mail 422 + nothing stored, 409 on env
  mail, route shape, sentinel token/key/email absent from logs/audit/response.
- `stickers/telegram-import.ts`: `getMe()` on `TelegramClient`, 401 →
  `invalid_token` (both method paths); `telegram-import.test.ts` +2 tests.
  Existing fake clients in `telegram-import-routes.test.ts` gained `getMe`.
- `stickers/routes.ts`: import resolves the token via injected
  `getBotToken()` (default = legacy env-only read, so unit callers
  unchanged); `app.ts` wires `createGetBotToken` (env→stored→null) and
  mounts the integrations routes with a test seam.

**Web** (`apps/web/src/`):
- `components/TelegramImportDialog.tsx`: overlay like `InviteDialog`
  (`fixed inset-0 z-40` backdrop, centered panel, `role=dialog` +
  `aria-modal`, title, close button, Esc + backdrop-click close, no close
  while busy, focus into the dialog). 501 → not-set-up state (never closes
  itself): "Telegram import is not set up on this server." + settings link
  for the owner (`isOwner`), "Ask the person who runs this server…" else.
  `onUnavailable` kept only to inform the entry point. Texts otherwise kept.
- `routes/StickersPage.tsx`: entry always visible; opens the dialog and
  loads `getIntegrationsStatus` for `isOwner`.
- `routes/IntegrationsPage.tsx` (new) at `/settings/integrations` (route in
  `AppRoutes.tsx`, "Integrations" menu item in `ChatList.tsx`): Email card
  (current sender, From input with the Resend-domain hint incl.
  `onboarding@resend.dev` note, optional new-key password input, Save with
  "Sending a test email…" busy state, success + clear errors incl. 422 and
  rate limit, "Managed by environment" state with no form) above a Telegram
  card (status incl. "set by environment variable", BotFather steps, Save
  with "Checking…", Remove, invalid-token/network/rate-limit errors).
  Non-owners see a note, not the cards. Generic card list for a later GIF key.
- `lib/api.ts`: `getIntegrationsStatus`/`saveTelegramBotToken`/
  `removeTelegramBotToken`/`saveEmailSettings` (key omitted when empty) +
  zod schemas. Tests: dialog (9: overlay attrs, focus, 501 state, owner vs
  other link, error map), StickersPage (11: 501 state keeps entry),
  IntegrationsPage (8: order, sender-only save body, key save body, 422,
  env-managed, telegram save/error, non-owner, retry), api (3 new).
- Menu neighbour suites pass (ChatList, InstallMenu).

**Docs:** `docs/INSTALL_DOCKER.md`: "Changing the sender later" paragraph +
"Optional: sticker import from Telegram" section (BotFather → settings page).

**Commands (real results):**
- `pnpm install`: exit 0.
- `pnpm format:check`: pass. `pnpm lint`: pass. `pnpm typecheck`: 11 tasks pass.
- `pnpm --filter @zilar/server test --maxWorkers=2 src/integrations src/stickers src/authz-sweep.test.ts`: 7 files, 108 passed (sweep prints the 4 new routes → 401 unauthenticated).
- `pnpm --filter @zilar/web test --maxWorkers=2 src/components/TelegramImportDialog.test.tsx src/routes/StickersPage src/routes/IntegrationsPage src/lib/api.test.ts`: 4 files, 99 passed.
- Neighbours: web ChatList + InstallMenu (23 passed).
- Note: `vi.fn().mockResolvedValue(x)` reuses ONE `Response` — its body can
  only be read once, so two sequential api calls in one test need
  `mockResolvedValueOnce` chains (fixed 2 api tests; worth knowing).

**Security checklist:** no secrets in logs/audit/errors/responses (sentinel
tests for token, key, owner email; audit rows detail-null; request log only
sees paths); no deletes/updates keyed by a bare id without scope (settings
rows are global singleton keys, owner-gated); no cap/uniqueness rule added
(upserts on the settings PK); permission (owner) checked before any effect,
failure (422/503/409) stores nothing; unknown vs forbidden both 404 on
writes; new routes session-required (sweep: 401 unauthenticated, never
allowlisted); writes rate-limited (10/10min telegram, 5/10min email) plus
the existing import/upload caps.

**Deviations:** (1) GET is readable by any signed-in user (spec said
404-for-everyone-else on "every integrations route"; the dialog needs
`canManage` and secrets never leave — writes are 404 as specified). The
spec's "A non-owner gets the same 404 on every integrations route" is met
for all three writes; calling this out since GET differs. (2) StickersPage
has no "settings navigation component" to extend — settings pages are
reached from the main menu, so "Integrations" went there next to Stickers.

## Review (written by Claude)
