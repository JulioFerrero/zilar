---
id: T-0156
title: Server and deploy nits bundle
status: review
milestone: M5
branch: task/T-0156-server-deploy-nits
model: meta/muse-spark-1.3-contributor
effort: medium
estimate: 0.5 day
---

# T-0156: Server and deploy nits bundle

## Spec (written by Claude, do not edit)

### Why
Small defects and rough edges deferred from the T-0106..T-0151 reviews. None is urgent alone; together they are worth one pass before real users arrive.

### What to build
Server (`apps/server`):
1. Telegram importer (T-0123): cap the size of the JSON read from Telegram responses (`getStickerSet`), like the file download cap.
2. `patchPack` (stickers): refuse a reorder list with duplicate sticker ids with a clear 400 (today only completeness is checked).
3. T-0141: `SERVER_PACKAGE_ROOT` is derived from a file path that breaks if the file moves or the build output changes shape; derive it robustly (walk up to the `package.json` named `@zilar/server`) and test it from `src/` and from a built layout fixture.
4. T-0106: the tool-output counts log line is defined but not wired; wire it (ids and counts only) or delete it.
5. Push: re-registering a device (same endpoint, new subscription) leaves the old enable-pair behind; remove the stale pair in the same transaction (scoped by user id AND endpoint), with a test.
6. Startup warnings: warn (once, ids/paths only) when `UPLOADS`-related or sticker directories are on the container layer in production (no mount), and when `GIF_PROVIDER` is set without `GIF_API_KEY`.
Deploy (`deploy/`, `docs/`):
7. `./deploy/zilar init --no-push` must not write `PUSH_COMPONENT_JID`.
8. `deploy/ejabberd/push-entrypoint.sh`: the sed pattern matches any key on the marker line; match only the push host key and verify that exactly one line changed.
9. The wizard's domain validation accepts one `:port` (`example.test:1234`), which yields an invalid push JID; reject a port in the install domain with a clear message (or strip it for the JID only if the Caddy setup supports it; say which in the Report).
Every item gets a test (Vitest for server, the existing deploy shell tests for deploy). Report each item as done or not done.

### Read first
`AGENTS.md`, the Reviews of `work/T-0123-*.md`, `T-0141-*.md`, `T-0106-*.md`, `T-0119-*.md`, `T-0145-*.md`, `T-0151-*.md`.

### Allowed files
`apps/server/src/stickers/**`, `apps/server/src/push/**`, `apps/server/src/startup*.ts`, `apps/server/src/tools/**` and the files item 3 and 4 need, `deploy/**`, `docs/**`, their tests, `work/T-0156-server-deploy-nits.md`. Not allowed: schema/migrations (stop and mark blocked if item 5 needs one), web, mobile, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 stickers push startup tools
sh deploy/tests/push-deploy.test.sh
sh deploy/tests/storage-safety.test.sh
```

### Acceptance
- Each of the nine items is done with a test, or listed as not done with the reason.
- No new migration; no secrets in logs or errors.

## Report (written by the worker when done)

### What I did (item by item)

1. **Telegram JSON cap — done.** `apps/server/src/stickers/telegram-import.ts`: new `TELEGRAM_JSON_MAX_BYTES` (256 KiB); both method-envelope readers (`callMethod`, `callMethodOnce`) now go through `readTelegramEnvelope`, which streams the body through a capped reader (aborts past the cap, fails as `try_later`) instead of unbounded `response.json()`. A buffered-body branch caps `response.text()` too. Test: 1 MiB envelope → `try_later`, small envelope still parses, token never in the error.
2. **`patchPack` duplicate reorder — done.** `apps/server/src/stickers/service.ts`: duplicate ids in `order` fail distinctly with 400 `duplicate_order` ("order must not list a sticker twice") before the completeness check; the write stays inside the same pack-lock transaction, so a failed reorder changes nothing. Test: valid reorder 200, duplicate reorder 400 `duplicate_order`, panel order unchanged after.
3. **`SERVER_PACKAGE_ROOT` robust — done.** `apps/server/src/stickers/service.ts`: new exported `serverPackageRoot(from)` walks up from the caller's file to the `package.json` named `@zilar/server` (unreadable/non-JSON/wrong-name keeps walking; filesystem root returns unchanged so callers never resolve against `/`); `SERVER_PACKAGE_ROOT = serverPackageRoot()`. No behaviour change in the current layout. Tests: same root from `src/stickers/service.ts`, `dist/stickers/service.js` and `dist/service.js` fixtures; a fixture with a wrong-name package.json does not match.
4. **Tool-turn counts line wired — done (wired, not deleted).** `apps/server/src/agents/gateway.ts`: new optional `AgentGatewayDeps.turnLogger` (falls back to `logger`), passed as `turnLogger` into both `runDmTurn` and `runGroupToolTurn`, so production logs one `AI tool turn finished` line per turn (`{aiId, rounds, toolCalls, elapsedMs}` — ids and counts only, never content). Test: a gateway DM turn with a tool round produces exactly one line with the real fields and no message text in any log. The `gateway.test.ts` harness gained an optional `turnLogger` (defaults to forward into the captured logger).
5. **Push stale enable-pair — done.** `apps/server/src/push/store.ts`: `saveDevice` reads the stale rows (same user, same endpoint) INSIDE the transaction under the per-user advisory lock, deletes scoped by user id AND endpoint in the same transaction, and reports replaced nodes to a new `SaveDeviceAdmin.disablePushPair(userId, node)` seam (best effort after commit; throws swallowed). `apps/server/src/push/routes.ts` implements the seam by re-running the room-subscription sync (there is no admin command that drops a push pair by node directly, so unsubscribing the user from their rooms is the backstop that stops publishes to the old pair; the browser normally sends `<disable/>` itself). No migration. Tests: stale node reported to the seam; cleanup failure still registers; another user's identical endpoint untouched.
6. **Startup warnings — done.** `apps/server/src/startup.ts`: `warnOnContainerLayerStorage` (production-only, once per dir, ids/paths only; injected `dirDevice`/`rootDevice` so tests never touch the fs) and `warnOnGifConfig` (provider set without key → one line, names only). Wired in `apps/server/src/index.ts` for `STICKER_STORAGE_DIR` + `AVATAR_STORAGE_DIR` (production only) and `GIF_PROVIDER`/`GIF_API_KEY`. Note: there is no `UPLOADS`-related server env var — ejabberd owns the upload docroot (`/opt/ejabberd/upload`, volume `ejabberd-uploads`), which the server cannot stat; the equivalent check already exists as `./zilar doctor`'s sticker-mount check (T-0151). So the sticker + avatar dirs are covered here. Tests: warns once per dir on same-device, quiet off-production / on mounted volumes / on stat failure; GIF warns only on provider-without-key (message carries no values).
7. **`--no-push` writes no JID — done.** `deploy/zilar`: `PUSH_COMPONENT_JID=push.<domain>` is now written only when push is on; the compose files derive `push.<domain>` from `ZILAR_DOMAIN` themselves, so an absent line is the correct off state. `doctor` no longer flags a missing JID when push is off (still flags it when push is on). Docs updated (`INSTALL_DOCKER.md`, `SERVER_CONFIG.md`). Test: `--no-push` env carries no `PUSH_*` secret or JID lines and no empty values; both compose files still render with `PUSH_ENABLED=false`.
8. **Entrypoint sed tightened — done.** `deploy/ejabberd/push-entrypoint.sh`: refuses unless exactly one `# ZILAR_PUSH_COMPONENT_HOST`-anchored line exists (a second marker-looking line, even a different key, fails loudly and touches nothing); after the sed, verifies exactly one host line for the domain exists (not just "at least one"). Tests: exactly-one-line verification, two-marker refusal that touches neither line.
9. **Wizard rejects `:port` domains — done (rejected, not stripped).** `deploy/zilar`: any `:` in `--domain` is now a hard error naming the bare-host form and the `--http-port`/`--https-port` flags. Rejected rather than stripped: Caddy serves only the bare domain (`{$ZILAR_DOMAIN}` site block), so stripping would leave every other derived value (PUBLIC_URL, WEB_ORIGINS, XMPP domain, push JID) disagreeing with what Caddy serves. Docs (`INSTALL_DOCKER.md` ZILAR_DOMAIN row) say so. Tests: `example.test:1234`-style domain rejected in plain words; bare host and `localhost` still pass.

### Files changed
- `apps/server/src/stickers/telegram-import.ts` (+capped envelope reader), `telegram-import.test.ts` (+cap test)
- `apps/server/src/stickers/service.ts` (+`duplicate_order`, +`serverPackageRoot`), `routes.test.ts` (+duplicate test, +package-root tests)
- `apps/server/src/agents/gateway.ts` (+`turnLogger` dep, wired into both turns), `gateway.test.ts` (+counts-line test, harness seam)
- `apps/server/src/push/store.ts` (+stale-node report + `SaveDeviceAdmin` seam), `store.test.ts` (+stale-pair test), `routes.ts` (+seam implementation)
- `apps/server/src/startup.ts` (+`warnOnContainerLayerStorage`, +`warnOnGifConfig`), `startup.test.ts` (+6 tests), `index.ts` (wiring)
- `deploy/zilar` (items 7 + 9, doctor tweak), `deploy/ejabberd/push-entrypoint.sh` (item 8), `deploy/tests/push-deploy.test.sh` (+7 checks: no-push JID, coolify fixture fix, one-line verification, two-marker refusal, port rejection ×2)
- `docs/INSTALL_DOCKER.md`, `docs/SERVER_CONFIG.md` (items 6–9 wording), this task file (Report + status)

### Commands run and real results
- `pnpm install`: ok (7.4s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint` (oxlint): pass, no findings
- `pnpm typecheck` (turbo, all packages): pass (fixed 3 `GatewayLogger` turnLogger type errors on the way)
- `pnpm --filter @zilar/server test --maxWorkers=2 stickers push startup tools`: 25 files passed, 1 skipped (live gate); 356 passed, 1 skipped
- `pnpm --filter @zilar/server test --maxWorkers=2 src/agents/gateway.test.ts src/agents/rounds.test.ts src/agents/reply.test.ts`: 3 files, 180 passed (includes the new counts-line test)
- `sh deploy/tests/push-deploy.test.sh`: 24 pass, 0 fail
- `sh deploy/tests/storage-safety.test.sh`: 24 pass, 0 fail (no regressions)
- Targeted while working: telegram-import 15 pass; stickers routes 25 pass; push store+routes 17 pass; startup 11 pass; gateway 119 pass

### Problems, deviations from the spec, open questions
- Item 3 touched `apps/server/src/stickers/service.ts`, which is allowed ("the files item 3 and 4 need"); item 4 touched `apps/server/src/agents/gateway.ts` + `gateway.test.ts` (item 4's files) and item 6 touched `apps/server/src/index.ts` (the only place startup warnings can be wired — one import + two calls, no behaviour change otherwise). No other out-of-Allowed-files changes.
- Item 5 ("in the same transaction"): the row delete IS in the same transaction (scoped by user id AND endpoint, read inside under the per-user lock). The ejabberd half cannot be transactional (no admin command targets a push pair by node — verified against `admin-client.ts`; the only push commands are room subscribe/unsubscribe); it runs best-effort after commit via the seam and never fails the registration. The Report says which.
- Item 6 (`UPLOADS`-related dirs): there is no such server env var — ejabberd owns the upload docroot and the server cannot stat it — so sticker + avatar dirs are covered (avatar added alongside sticker: same volume-loss failure mode, one extra line). The compose-level mount check already exists in `./zilar doctor` (T-0151).
- Deploy test fixes folded in (all verified): the Coolify fixture used the wrong var names (`SERVICE_PASSWORD_PUSH_COMPONENT` → `SERVICE_PASSWORD_PUSHCOMPONENT`, missing `SERVICE_FQDN_WEB`) — pre-existing failure on main, fixed; the `:port`/bare-host checks initially ran with the global flags in the wrong position (dispatch treats `--env-file=X` after the command as a command arg) — fixed to command-first order.
- Security checklist: no secrets in logs/errors (JSON-cap errors are fixed strings; counts line carries ids+counts only; stale-pair log carries user id + count only; GIF warning names variables, never values; wizard/port errors echo the domain the operator typed, never a secret); deletes scoped (user id AND endpoint; cross-user test); caps atomic (stale read inside the lock; device cap untouched); permission before effect (push route unchanged order; no new routes — 401 sweep unaffected); no new migration; no dependencies added; no `any`, no `@ts-ignore`.
- Open: none blocking.

### Blocked / needs a decision
- None.

## Review (written by Claude)
