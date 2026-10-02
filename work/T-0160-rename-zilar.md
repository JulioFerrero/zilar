---
id: T-0160
title: Rename the project from Galena to Zilar (user-visible names, config, deploy; stored identifiers stay)
status: planned
milestone: M5
branch: task/T-0160-rename-zilar
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0160: Rename the project from Galena to Zilar

## Spec (written by Claude, do not edit)

### Why
Julio chose the name **Zilar** (Basque for "silver") on 2026-10-02 and bought `zilar.app`, `zilar.dev` and `zilar.org`. About 410 files still say "Galena". This task renames everything a person sees or configures. It must run ALONE (no other worker active), because it touches almost every package, and it must not break anything that is stored in data.

### Decisions by the lead (fixed, do not revisit)
1. **Renamed (user-visible and configuration):**
   - Every string a person sees: web and mobile UI text, page titles, the PWA manifest and service worker names, notification titles, the sign-in mail subjects and bodies ("Your Zilar sign-in code" and the others), error messages that name the product, the mobile app display name and splash text, `README.md`, `docs/**`, install wizard and doctor texts, the Caddyfile comments and the default admin mail subject lines.
   - Environment variables: `GALENA_*` become `ZILAR_*` (`ZILAR_DOMAIN`, `ZILAR_XMPP_JWT_SECRET`, `ZILAR_DB_PASSWORD`, `ZILAR_ARCHIVE_DB_PASSWORD`, `ZILAR_KEY_ENCRYPTION_KEY`, `ZILAR_API_URL`, `ZILAR_XMPP_INTEGRATION`, `ZILAR_MOCK`, `ZILAR_MOCK_SCENARIO`, `ZILAR_DOCTOR_DISK_USED_PCT`, `ZILAR_PUSH_COMPONENT_HOST`, `ZILAR_LEAD_ALLOW_ALL`, plus `EXPO_PUBLIC_GALENA_*` and `VITE_GALENA_*`). **The old `GALENA_*` names keep working as a fallback** read in one place per package (the config module, the wizard, the dev scripts): the new name wins; when only the old one is set, log ONE startup warning naming the variable (names only, never values) telling the owner to rename it. Julio's existing `.env` files keep working.
   - The deploy script `deploy/galena` becomes `deploy/zilar`; leave a tiny `deploy/galena` shim that prints "renamed to ./deploy/zilar" and execs it. Backup archives keep the manifest tag `galena-backup-v1` accepted on restore (add `zilar-backup-v1` for new archives).
   - Mobile: display name "Zilar"; deep link scheme `zilar://` (keep `galena://` registered as well so old links still open); `slug` and the Android/iOS bundle ids change to `app.zilar.chat` (new app identity: the old dev build stays installed next to it). This needs a native rebuild: say so in the Report.
   - Docker image names, compose service labels and container names in `deploy/**` use `zilar`.
2. **NOT renamed (identifiers stored in data or workspace plumbing):**
   - The dev XMPP domain `galena.localhost`, the `galena-dev` compose project name and its volumes, database names and users (`galena`, `ejabberd`), and any default that appears in JIDs already stored in Julio's dev database. Changing them would orphan every existing chat. The domain stays configurable as before; docs may use `zilar.example` or `chat.example.com` for examples.
   - The workspace package scope `@galena/*` (packages, imports, `--filter` strings in every spec and in `AGENTS.md`). It is invisible to users, nothing is published to npm, and renaming it would invalidate the Checks of all historical specs. A later task may do it when we publish.
   - The `galena_` prefix of existing database tables/columns/indexes and migration files (never edit applied migrations).
   - Git history, `work/**` task files, `docs/PROJECT_PLAN.md` and `AGENTS.md` (lead-owned; the lead updates them after the merge).
3. **Visible name rules:** the product is written "Zilar" (capital Z, no other styling). Where a sentence says "Galena server" it becomes "Zilar server". "Self-hosted Zilar" in the README intro.

### What to build
1. A word list first: run `rg -i galena` over the repo (excluding `node_modules`, `.git`, `work/`, `docs/PROJECT_PLAN.md`, `AGENTS.md`, `apps/server/drizzle/**`) and classify every hit as RENAME or KEEP per the decisions above. Put the KEEP list with reasons in the Report.
2. Apply the renames. Config fallback helper: one small tested function per package (`readEnvWithFallback(newName, oldName)`), no copy-paste.
3. Tests: update every test that asserts the old name; add tests for the fallback (new wins, old works and warns once, neither set), for the sign-in mail subjects, for the mobile deep link config (both schemes), for the deploy shim and for the restore accepting both manifest tags. Add a guard test that fails when a user-visible string in `apps/web/src` or `apps/mobile/src` contains "Galena" (allow-list the KEEP identifiers).
4. Verify in a browser (dev server on a spare port, never 5173/3000/8081) that the title, header and sign-in page say Zilar; the Report says what you saw.
5. Out of scope: package scope, XMPP domain, DB names, migrations, logos or new artwork (a text wordmark is fine), buying or configuring the domains.

### Read first
`AGENTS.md`, `docs/SERVER_CONFIG.md`, `deploy/galena`, `apps/mobile/app.json`, `apps/server/src/config.ts`, `apps/server/src/auth/mailer.ts`, `apps/web/index.html` and the PWA manifest.

### Allowed files
Everything in the repo EXCEPT: `work/**` (except this task's file), `docs/PROJECT_PLAN.md`, `AGENTS.md`, `apps/server/drizzle/**`, lockfile changes beyond what the renames require, and `.env` files of any kind (never read or edit them). New dependencies: none.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2 config auth mailer startup
pnpm --filter @galena/web test --maxWorkers=2 App Login Settings
pnpm --filter @galena/mobile test --maxWorkers=2 hooks-guard config
sh deploy/tests/push-deploy.test.sh
sh deploy/tests/storage-safety.test.sh
```
(plus the tests you add or touch)

### Acceptance
- No user-visible "Galena" remains in web, mobile, mails, docs and deploy output (guard test).
- Old `GALENA_*` variables still work with a single warning; new `ZILAR_*` win.
- Existing chats and the dev database are unaffected (no JID, domain, table or migration change).
- The deploy shim and both backup manifest tags work.
- The Report lists the KEEP list and everything that needs a native rebuild or a manual step by Julio.

## Report (written by the worker when done)

## Review (written by Claude)
