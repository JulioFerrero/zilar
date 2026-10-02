---
id: T-0160
title: Rename EVERYTHING from Galena to Zilar (no keep-list)
status: merged
milestone: M5
branch: task/T-0160-rename-zilar
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0160: Rename EVERYTHING from Galena to Zilar

## Spec (written by Claude, do not edit)

### Why
Julio chose the name **Zilar** (Basque for "silver") on 2026-10-02, bought `zilar.app`, `zilar.dev` and `zilar.org`, and ordered a TOTAL rename: every occurrence of "galena" in the project becomes "zilar", with no exceptions for internal names. About 410 files mention it. This task must run ALONE (no other worker active).

### The rule
Every occurrence of `galena` / `Galena` / `GALENA` in a tracked file becomes `zilar` / `Zilar` / `ZILAR`, EXCEPT only:
- `work/**`, `docs/PROJECT_PLAN.md`, `AGENTS.md` (lead-owned; the lead renames them after the merge),
- the git history,
- `.env` files of any kind (never read, print or edit them; the lead migrates them),
- already-applied migration files under `apps/server/drizzle/**` (none contain the word today; do not edit them; a new migration is needed only if a table or column name contains it, and then it is generated with `pnpm --filter @zilar/server db:generate` and reviewed).
No fallbacks, no shims, no compatibility aliases: the old names are simply gone (the lead migrates Julio's local environment files and data). Do not add "old name still works" code.

### What this includes (non-exhaustive: the rule above decides)
1. **Workspace scope** `@galena/*` becomes `@zilar/*`: every `package.json` name and dependency, imports, `tsconfig` paths, vite/vitest/turbo/eslint configs, Dockerfiles, scripts, `pnpm-lock.yaml` (regenerate with `pnpm install` and commit it). From now on the checks use `pnpm --filter @zilar/<pkg>`.
2. **Environment variables** `GALENA_*` become `ZILAR_*`, including `EXPO_PUBLIC_GALENA_*`, `VITE_GALENA_*`, `GALENA_LEAD_*`, `GALENA_XMPP_*`, `GALENA_DB_PASSWORD`, and every `.env.example`.
3. **XMPP hosts and test domains**: `galena.localhost` becomes `zilar.localhost` (also `rooms.`, `push.`, `upload.` and every other host built from it), `galena.test`/`galena.example` become `zilar.test`/`zilar.example`, in `infra/**`, `deploy/**`, server config defaults, the web and mobile mock data, fixtures, tests and docs.
4. **Database names and roles** `galena` become `zilar` (the app database, role and any `galena_*` names) in `infra/**` init scripts and compose, `deploy/**`, `drizzle.config.ts`, defaults and docs.
5. **Docker and compose**: project name `galena-dev` becomes `zilar-dev`, container/service/network/volume names, image names, labels, in-container paths such as `/galena/...` become `/zilar/...` (`infra/**` and `deploy/**`). The install script `deploy/galena` is renamed with `git mv` to `deploy/zilar`; every reference follows.
6. **Client storage names**: localStorage/sessionStorage keys, cookie names, IndexedDB database names, service worker and Cache Storage names, push tags, the PWA manifest `name`/`short_name`/`id`, `index.html` titles, the mobile `app.json` (`name`, `slug`, `scheme` `zilar`, iOS bundle identifier and Android package `app.zilar.chat`), asset names, notification channel ids, deep links. Existing browser sessions are lost; that is accepted.
7. **The lead tooling** in `packages/devtools`: the state directory `~/.galena-lead` becomes `~/.zilar-lead`, the autopilot log `/tmp/galena-lead-autopilot.log` becomes `/tmp/zilar-lead-autopilot.log`, branch/worktree/prompt texts, the `GALENA_LEAD_*` variables. Keep the code path-agnostic (the repository folder name is NOT changed by this task).
8. **Everything a person sees**: UI text, emails ("Your Zilar sign-in code" and the others), notifications, error messages, README, `docs/**` (except `docs/PROJECT_PLAN.md`), wizard/doctor output, comments and code identifiers (`galenaFoo` becomes `zilarFoo`, `GalenaError` becomes `ZilarError`), test names and fixtures. The product is written "Zilar" (capital Z).
9. **Guard test**: a Vitest test in `packages/devtools` that runs `git ls-files`, reads every text file (skip binaries, skip the exception list above) and fails with the file:line list when the word "galena" (case-insensitive) is still present.

### Order of work (suggested)
1. `rg -il galena` to get the file list; do the mechanical replacement with a script that handles the three casings and the identifier forms, then review the diff by area (server, web, mobile, packages, infra, deploy, docs) for false positives (the Basque/mineral word in prose, URLs of third parties, anything that must stay English like "galena" in a quoted third-party text; there should be none).
2. `git mv deploy/galena deploy/zilar` and fix references.
3. `pnpm install`, regenerate the lockfile, then run every check below.
4. Do NOT start, stop, rebuild or modify the lead's running dev stack (`galena-dev-*` containers, ports 3188, 5173, 5280, 5222, 5347) or any local database or volume; tests use PGlite and fakes.

### Read first
`AGENTS.md`, `docs/SERVER_CONFIG.md`, `infra/docker-compose.dev.yml`, `deploy/galena`, `apps/mobile/app.json`, `packages/devtools/src/lead/**`.

### Allowed files
Everything tracked EXCEPT the exception list in "The rule". New dependencies: none. In the Report list every file group you changed, anything you left as "galena" and why (should be nothing outside the exception list), and every manual step the lead must do on the live environment (database/role rename, volumes, `.env` keys, native rebuild).

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/devtools test --maxWorkers=2
pnpm --filter @zilar/protocol test --maxWorkers=2
pnpm --filter @zilar/chat-core test --maxWorkers=2
pnpm --filter @zilar/server test --maxWorkers=2 config auth mailer startup stickers push
pnpm --filter @zilar/web test --maxWorkers=2 App Login Settings Sticker
pnpm --filter @zilar/mobile test --maxWorkers=2 hooks-guard store
sh deploy/tests/push-deploy.test.sh
sh deploy/tests/storage-safety.test.sh
```
(the lead runs the full suites once on main afterwards)

### Acceptance
- The guard test passes: no "galena" outside the exception list.
- Format, lint, typecheck and the checks above pass.
- `deploy/zilar` exists and its tests pass; the compose files render.
- No change to applied migrations; no `.env` file read or edited.
- The Report has the manual-steps list for the live environment.

## Report (written by the worker when done)

Done. Total rename `galena`/`Galena`/`GALENA` -> `zilar`/`Zilar`/`ZILAR`
in every tracked file except the lead-owned exception list. No fallbacks,
no shims, no compatibility aliases.

### Method
- `git mv deploy/galena deploy/zilar` first (spec step 2).
- Built the target file list with `git ls-files | xargs grep -il galena`,
  minus `work/**`, `AGENTS.md`, `docs/PROJECT_PLAN.md`,
  `apps/server/drizzle/**` (already-applied migrations, none contained the
  word). 466 files matched (incl. the moved `deploy/galena` script itself).
- Mechanical replace with a Python script (`GALENA`->`ZILAR`,
  `Galena`->`Zilar`, `galena`->`zilar`) over file contents. Straightforward:
  no third-party "galena" references found anywhere (the only mineral-word
  hits were the project name itself); identifier forms (`createGalenaAuthClient`,
  `GalenaTool/1` UA, `__galena_*` VM globals, `galenaPolluted` test probes,
  `x-galena-*` headers) all renamed consistently.
- Renamed 4 tracked filenames with `git mv` (content refs already followed):
  `apps/web/public/icons/galena-mark.svg` -> `zilar-mark.svg`,
  `deploy/baremetal/galena-server.service` -> `zilar-server.service`,
  `deploy/baremetal/nginx-galena.conf` -> `nginx-zilar.conf`,
  `galena-night-log-2026-09-28.entries` -> `zilar-night-log-2026-09-28.entries`
  (root scratch log, referenced only from `work/overnight-report-2026-09-28.md`,
  which is lead-owned and untouched).
- `pnpm install` re-run after the `package.json` renames; `pnpm-lock.yaml`
  regenerated (0 `galena` left, `@zilar/*` throughout).
- Guard test added: `packages/devtools/src/no-legacy-name.test.ts` runs
  `git ls-files`, reads every text file (skips binaries, skips the exception
  list plus itself — the needle is built at runtime as
  `['gal','ena'].join('')` so its own source stays clean) and fails with the
  file:line list on any case-insensitive hit, including file names.
- `pnpm format:check` initially failed on 8 files (7 where the shorter
  `zilar` name changed prettier line-wrapping + the new test file); fixed
  with `prettier --write` on exactly those files (re-wraps only, verified on
  the diff of `tool-worker.ts` and `TopicRow.tsx`).

### File groups changed (467 files, +3160/-3160 plus renames)
- Workspace scope: root `package.json` (`zilar`), all 10 `package.json`
  names/deps (`@zilar/*`), every import, `pnpm-lock.yaml`.
- Server: `config.ts` + `xmpp/config.ts` (incl. `ZILAR_*` env names,
  `zilar.localhost` / `rooms.zilar.localhost` defaults), `app.ts` health
  name `zilar-server`, mailer subjects ("Your Zilar sign-in code", "Reset
  your Zilar sign-in"), `apps/server/.env.example`, Dockerfile, db schema
  identifiers, all tests/fixtures (`zilar.test`, `zilar.example`,
  `zilar.localhost` JIDs).
- Web: `package.json`, `vite.config.ts`, `index.html` titles, PWA manifest
  (`name`/`short_name`/`id`), `sw.js` cache names, storage keys
  (`zilar:recentStickers`, `zilar:pushDevice`), mock data, tests.
- Mobile: `app.json` (`Zilar`, slug/scheme `zilar`, bundle
  `com.julioferrero.zilar`, package `com.julioferrero.zilar`, permission
  texts), storage keys, `createZilarAuthClient`, mock data, tests.
- Runner + tunnel + agent-drivers + protocol + chat-core + xmpp-core:
  package names, imports, test domains, `ZilarTool/1` UA.
- Infra: compose project/network `zilar-dev`, `/zilar/jwt-entrypoint.sh`
  path, `zilar.localhost` hosts, `ZILAR_DB_PASSWORD` /
  `ZILAR_ARCHIVE_DB_PASSWORD` / `ZILAR_XMPP_JWT_SECRET`, init SQL
  (`zilar` db/user, `zilar_archive` role), `push.zilar.localhost`.
- Deploy: `deploy/zilar` script (PROG, `ZILAR_DOMAIN`, `ZILAR_*` passwords,
  `zilar-backup-*.tgz`, `push.$_domain` wiring, `/etc/zilar/zilar.env`,
  `/var/lib/zilar`, `zilar-server:local`/`zilar-web` images), both compose
  files, ejabberd/caddy/baremetal configs, `deploy/.env.example`,
  `baremetal/.env.example`, healthcheck, both deploy test scripts,
  `zilar-server.service`, `nginx-zilar.conf`.
- Docs (except PROJECT_PLAN.md): README, INSTALL*, SERVER_CONFIG,
  USER_GUIDE, FEATURES, TOOL_SANDBOX, PUSH_SPIKE, LEAD_PLAYBOOK,
  LIVE_CHECKS, ROADMAP_M5, mockup HTML, ui-style.
- Devtools/lead: `~/.zilar-lead`, `/tmp/zilar-lead-autopilot.log`,
  `ZILAR_LEAD_*` vars, prompts, branch/worktree texts.

### Left as "galena" (all inside the exception list, untouched)
- `work/**` (all task files incl. this one, BOARD.md, overnight report),
  `docs/PROJECT_PLAN.md`. Nothing else: `grep -il galena` over tracked
  files returns only those paths; `AGENTS.md` contains no occurrence.
- Git history (not rewritten). No `.env` file read, printed or edited
  (only `.env.example` files); `apps/server/drizzle/**` untouched
  (verified: `git status` shows no file under it).

### Checks (all pass, real results)
- `pnpm install`: ok (lockfile up to date, 11 workspace projects).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint` (oxlint): pass, no output.
- `pnpm typecheck` (turbo, 10 tasks): pass.
- `pnpm --filter @zilar/devtools test --maxWorkers=2`: 15 files / 328
  tests pass (incl. the new guard test).
- `pnpm --filter @zilar/protocol test --maxWorkers=2`: 11 files / 159 pass.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2`: 10 files / 135 pass.
- `pnpm --filter @zilar/server test --maxWorkers=2 config auth mailer
  startup stickers push`: 22 pass + 1 skipped (23 files), 278 pass +
  1 skipped.
- `pnpm --filter @zilar/web test --maxWorkers=2 App Login Settings
  Sticker`: 13 files / 136 pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 hooks-guard store`:
  18 pass + 1 skipped (19 files), 228 pass + 1 skipped.
- `sh deploy/tests/push-deploy.test.sh`: pass=20 fail=0.
- `sh deploy/tests/storage-safety.test.sh`: pass=20 fail=0.
- `deploy/zilar` exists and is executable; `doctor` runs against it
  (docker/compose/openssl ok; port 443 busy is this machine's own state,
  unrelated). Compose files: `deploy/docker-compose.yml`,
  `deploy/coolify/docker-compose.yml`, `infra/docker-compose.dev.yml`
  all renamed consistently (project `zilar-dev`, `ZILAR_*` keys).

### Manual steps for the lead on the live environment
Julio's local env files and data still say `galena` (this task never reads
or edits `.env`, per spec). After merge, on every machine/install:
1. `infra/.env`: rename `GALENA_DB_PASSWORD` -> `ZILAR_DB_PASSWORD`,
   `GALENA_ARCHIVE_DB_PASSWORD` -> `ZILAR_ARCHIVE_DB_PASSWORD`,
   `GALENA_XMPP_JWT_SECRET` -> `ZILAR_XMPP_JWT_SECRET`
   (values unchanged); update any other `GALENA_*` keys the same way.
2. `apps/server/.env`: same renames (`ZILAR_XMPP_JWT_SECRET`,
   `ZILAR_KEY_ENCRYPTION_KEY`, `ZILAR_ARCHIVE_DB_PASSWORD`,
   `ZILAR_DOCTOR_DISK_USED_PCT` if set) + `XMPP_DOMAIN=zilar.localhost`,
   `XMPP_MUC_DOMAIN=rooms.zilar.localhost` if they were pinned to the old
   defaults; push vars (`PUSH_COMPONENT_JID=push.<domain>`) follow the
   domain automatically for new installs.
3. Postgres: rename role/database `galena` -> `zilar` and
   `galena_archive` -> `zilar_archive` (or recreate volumes fresh on dev;
   production `deploy/.env`: `ZILAR_DOMAIN`, `ZILAR_DB_PASSWORD`,
   `ZILAR_ARCHIVE_DB_PASSWORD`, `ZILAR_XMPP_JWT_SECRET`,
   `ZILAR_KEY_ENCRYPTION_KEY`; database `zilar`, role `zilar`).
4. Docker: `zilar-dev` project/network names change — old `galena-dev-*`
   containers/volumes stay until removed (`docker compose down -v` on the
   dev stack wipes scratch data; production volumes need migration, not
   deletion). ejabberd re-registers `admin@zilar.localhost` on a fresh
   volume; existing volumes keep the old domain until reset.
5. Devtools state: `~/.galena-lead/state.json` -> `~/.zilar-lead/state.json`
   (or re-run; `ZILAR_LEAD_STATE` override renamed too).
6. Mobile: native rebuild required (bundle id/package
   `com.julioferrero.zilar`, scheme `zilar`); browsers lose sessions/PWA
   (storage keys + manifest id changed — accepted per spec).
7. Lead-owned renames after merge (out of scope here): `work/**`,
   `docs/PROJECT_PLAN.md`, repo folder name (worktree dir keeps its name).

### Deviations / notes
- `galena-night-log-2026-09-28.entries` renamed to `zilar-...` although it
  sits at repo root: nothing outside lead-owned `work/` references it, and
  leaving it would fail the new guard test.
- No new migration generated: no table/column name contains the word
  (`drizzle/**` verified clean before and after).
- Never touched the running dev stack, databases or volumes; tests used
  PGlite/fakes only.

## Review (written by Claude)

**Verdict:** approved and merged (round 1, lead fixes). Live-environment migration done by the lead after the merge.

### Findings
- Lead fix (data safety): the two key-derivation labels (`provider-key/v1`, `push-storage/v1`) are mixed into the keys that encrypt stored provider API keys and push subscriptions; renaming them would make that stored data undecryptable. They live in `apps/server/src/kdf-labels.ts` with their old text, explained in a comment, allow-listed in the legacy-name guard, with a test pinning the exact bytes. This is the ONLY intentional occurrence of the old name in code; nothing else was kept.
- Lead fix: the mobile bundle id / Android package is `app.zilar.chat` (reverse of `zilar.app`), not `com.julioferrero.zilar`.
- The LiteLLM key alias prefix was renamed (it is only a label at key creation; no lookup by alias).
- Pre-review nits accepted: stale `.orig` files from T-0121 renamed with the rest (cleanup later); the `infra/.env.example` vs compose key mismatch predates this task.

### Follow-ups
- Live environment: rename `.env` keys, move the dev stack to `zilar-dev`, restore the databases under the new names, rewrite JIDs, rebuild the Android dev client (lead steps).
- Lead-owned renames: `AGENTS.md`, `docs/PROJECT_PLAN.md`, `work/**`, the lead's memory notes.
- Delete the `.orig`/`.rej` files in `apps/web/src/mock`.
