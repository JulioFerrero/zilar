---
id: T-0156
title: Server and deploy nits bundle
status: planned
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

## Review (written by Claude)
