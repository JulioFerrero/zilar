---
id: T-0151
title: Production storage safety (sticker volume, backups, disk check, upload quota)
status: planned
milestone: M5
branch: task/T-0151-deploy-storage-safety
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0151: Production storage safety

## Spec (written by Claude, do not edit)

### Why
Plan: about 200 people within a month sending files, images and stickers. Files live in two places: ejabberd's HTTP upload docroot (`/opt/ejabberd/upload`, volume `ejabberd-uploads`) and the server's `STICKER_STORAGE_DIR` (default `./data/stickers`). Gaps found on 2026-10-01:
- `deploy/docker-compose.yml` (and the Coolify compose) mount NO volume for `STICKER_STORAGE_DIR`: sticker files are lost when the server container is replaced.
- The database dump does not include either file store. `./deploy/galena backup` / `restore` must be checked and, if they miss a volume, extended.
- Nothing warns when the disk fills, and nothing limits how much one person can upload.

### What to build
1. Compose files (`deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`): a named volume `sticker-data` mounted at a fixed absolute `STICKER_STORAGE_DIR` (for example `/data/stickers`) for the server, with that env set. The directory must be writable by the server user.
2. `./deploy/galena backup` and `restore`: include BOTH the uploads volume and the sticker volume (verify first what they do today; keep the existing archive layout and the 0600 mode). Restore must put them back and the tests prove a round trip with fake files.
3. `./deploy/galena doctor`: report free space of the Docker data/volume filesystem; warn at 80% used, fail at 95%, in plain words. Also check that the sticker directory is a mounted volume (not the container layer) when running under compose.
4. ejabberd upload quota: configure ejabberd's `mod_http_upload_quota` (`max_days` for old files only if the owner sets it, and per-user `access_soft_quota`/`access_hard_quota` with a sensible default such as 2 GiB soft / 4 GiB hard) in `deploy/ejabberd/ejabberd.yml`, documented, with the knobs overridable through macros like the other deploy settings. Keep `max_size` at 50 MiB. If the quota module cannot be configured with the stock image, say so in the Report instead of guessing.
5. Docs (`docs/SERVER_CONFIG.md`, install guide, `docs/FEATURES.md` row): where each kind of file lives (attachments: ejabberd upload volume; stickers: sticker volume; GIFs: not stored, proxied; voice: not built), how backups cover them, the quota defaults, and a short "when to consider S3" note (more than one server instance, large growth; ejabberd's upload module writes only to local disk).
6. Out of scope: any S3 or storage-abstraction code, server/web/mobile code, schema changes.

### Read first
`AGENTS.md`, `work/T-0127-install-wizard-backup-baremetal.md`, `work/T-0145-deploy-push.md` (Review), `deploy/**`, `docs/SERVER_CONFIG.md` (sticker storage rows), `apps/server/src/startup.ts` (sticker dir checks, read only).

### Allowed files
`deploy/**`, `docs/**`, the deploy tests, `work/T-0151-deploy-storage-safety.md`. Not allowed: `apps/**`, packages, schema, dependencies, `infra/**` (dev stack).

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
sh deploy/tests/push-deploy.test.sh
```
Plus the deploy tests you add for backup/restore and doctor.

### Acceptance
- Compose renders with the new volume on both files; the sticker dir is under a mounted volume.
- Backup then restore round-trips fake upload and sticker files; archive and files are mode 0600.
- Doctor warns at 80% and fails at 95% (tested with an injected usage number, no real disk fill).
- Quota config is documented with defaults and parses (ejabberd.yml is valid YAML and uses only documented options).
- No secrets printed anywhere.

## Report (written by the worker when done)

## Review (written by Claude)
