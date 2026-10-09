---
id: T-0747
title: "AUDIT (docs only): S3 object storage for Zilar — (1) off-host backups through Coolify's S3 destination, (2) app files (stickers, avatars, backgrounds, chat uploads via ejabberd) on S3; write docs/audit/s3-storage-plan.md with file:line facts, options, risks and an ordered task list"
status: todo
milestone: M5
branch: task/T-0747-s3-storage-audit
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0747: S3 storage plan (audit)

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09 Julio chose "Backups + plan app storage". Every byte of the live install sits in five Docker volumes on one host, and the backups are on that same host too. **This task changes no code and no config.** It writes the plan the lead will cut tasks from.

### Verified facts (do not re-derive)
- **The five live volumes** on the Coolify service `zilar`, from the Coolify storages listing on 2026-10-09:
  - `postgres-data` at `/var/lib/postgresql`;
  - `ejabberd-database` at `/opt/ejabberd/database`;
  - `ejabberd-uploads` at `/opt/ejabberd/upload` (chat files, XEP-0363);
  - `sticker-data` at `/data/stickers`;
  - `avatar-data` at `/data/avatars`, which also holds `BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds`.
- **The same volumes in the repo:** `deploy/coolify/docker-compose.yml:234-241`.
- **Server-side file storage** reads `STICKER_STORAGE_DIR`, `AVATAR_STORAGE_DIR` and `BACKGROUND_STORAGE_DIR` in `apps/server/src/config.ts`, `apps/server/src/stickers/service.ts`, `apps/server/src/avatars/service.ts`, `apps/server/src/app.ts` and `apps/server/src/index.ts` (around lines 100-117).
- **Chat uploads** go through ejabberd `mod_http_upload` (`deploy/ejabberd/` config, upload docroot and quotas around lines 25-77). See also `docs/audit/upload-auth-plan.md`.
- **Backups:**
  - `deploy/zilar` has `./zilar backup [dir] [--keep N] [--offsite-hint]` (line 12);
  - `deploy/coolify/scheduled-backup.md` covers the nightly Coolify database dumps;
  - `docs/RELEASING.md` §9 "Backups": a database inside a service has no "backup now" API endpoint.
- **Coolify volume backups** (Coolify 4.3.23 on this install) can be scheduled per storage, with an S3 target (`backup_set` with `s3_storage_uuid`, `save_s3`, and retention per S3).

### What to write: `docs/audit/s3-storage-plan.md`
1. **Inventory.** List every place the server or ejabberd writes a file, with `file:line`: the writer, the reader or serving route, how the URL is built, and how it is cleaned up. Note which data lives only on disk and which also has database rows.
2. **Part A, off-host backups (no code).** Give the exact Coolify steps:
   - add the S3 destination;
   - schedule the Postgres dumps (both databases, as `scheduled-backup.md` describes) and the volume backups for the four file volumes, with S3 retention;
   - the restore drill, and how to verify it.

   List what Julio must provide (a bucket, an access key and a secret, the endpoint and the region; names only, never values). Compare the providers in a short table: Hetzner Object Storage, Cloudflare R2, Backblaze B2, and self-hosted MinIO or Garage on the same host. Say plainly that a store on the same host gives no off-host protection.
3. **Part B, app files on S3.**
   - **Server files:** a storage service, as an Effect service with a disk backend and an S3 backend (for example `@aws-sdk/client-s3`, or an Effect platform option if one exists in the pinned Effect 4.0.2; check `node_modules`). Consider presigned URLs against proxying through the server, auth checks, cache headers, migrating the existing files, and tests with a local S3 fake.
   - **Chat uploads:** can ejabberd's upload store to S3? Check the ejabberd version in `deploy/ejabberd/Dockerfile`, and whether `mod_s3_upload` or anything similar exists there. Quote what you find, with sources; never guess.
   - If ejabberd cannot do it, list the alternatives, such as the Zilar server issuing XEP-0363 slots itself and storing to S3 (see `docs/audit/upload-auth-plan.md`).
4. **Risks and an ordered task list.** Give small tasks, each with its files, tests, size and dependencies, and mark which need Julio (secrets, live config, data migration).

### Read first
`AGENTS.md`, `deploy/coolify/docker-compose.yml`, `deploy/coolify/scheduled-backup.md`, `deploy/zilar` (the backup command), `docs/RELEASING.md` (§5, §9), `docs/audit/upload-auth-plan.md`, `apps/server/src/stickers/service.ts`, `apps/server/src/avatars/service.ts`, `deploy/ejabberd/` (the Dockerfile and the config).

### Allowed files
`docs/audit/s3-storage-plan.md`, `work/T-0747-s3-storage-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every claim about the code cites `file:line`, and every claim about ejabberd or Coolify names its source.
- The plan has parts A and B and an ordered task list.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
