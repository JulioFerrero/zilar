---
id: T-0162
title: Integration keys in the UI (Telegram bot token) and a proper import dialog
status: planned
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

## Review (written by Claude)
