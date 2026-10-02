---
id: T-0160
title: Rename EVERYTHING from Galena to Zilar (no keep-list)
status: planned
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

## Review (written by Claude)
