---
id: T-0748
title: "docs: the Coolify backup docs describe Coolify database backups that do not work on this stack; rewrite deploy/coolify/scheduled-backup.md and fix docs/RELEASING.md (§5 bullet, §9 Backups) to the real setup — a pg_dump scheduled task + 4 S3 volume backups — and add the manual restore runbook"
status: todo
milestone: M5
branch: task/T-0748-backup-docs
model: auto
effort: low
depends_on: [T-0747]
estimate: 0.1 day
---

# T-0748: the backup docs match the live setup

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09 the lead set up off-host backups to an S3 bucket (Backblaze B2) and ran a restore drill. Two docs describe things that do not work on the Coolify stack. Plan: `docs/audit/s3-storage-plan.md`, task A4.

### Verified facts (do not re-derive; these are what the lead set up and checked live on 2026-10-09)
- **Coolify database backups do not apply here.** Coolify lists the service's `postgres` component as an *application*, not a database, probably because it runs the custom `zilar-postgres` image (`deploy/postgres/Dockerfile`, `FROM pgvector/pgvector:0.8.6-pg18-trixie`). So there is no Backups tab and no Coolify database restore. Coolify's restore page covers only the database components it recognises, and its volume backup page says it "does not provide a dashboard restore action".
- **The dumps** come from a Coolify scheduled task on the service, container `postgres`, daily at `30 3 * * *`, with this command:
  `sh -c 'umask 077;d=/var/lib/postgresql/dumps;mkdir -p $d&&pg_dumpall -U postgres -g>$d/g.tmp&&mv $d/g.tmp $d/globals.sql&&for b in zilar ejabberd;do pg_dump -U postgres -Fc -f $d/$b.tmp $b&&mv $d/$b.tmp $d/$b.dump||exit 1;done;chmod 600 $d/*;ls -l $d'`
  The dumps land on the `postgres-data` volume (mounted at `/var/lib/postgresql`, `deploy/coolify/docker-compose.yml`), outside PGDATA. Coolify limits a scheduled-task command to 255 characters.
- **Volume backups** are Coolify storage backups to an S3 destination, each keeping 3 copies locally and 30 copies or 30 days on S3, as live copies with no container stop:
  - `postgres-data` at 03:40 (it carries the dumps; the raw PGDATA copy inside is not consistent, so never restore from it);
  - `sticker-data` at 03:45;
  - `avatar-data` at 04:00 (it includes `backgrounds/`);
  - `ejabberd-uploads` at 04:15.
- **The drill,** 2026-10-09: the 10:26 `zilar.dump` was `pg_restore -O` into a temporary database `rd` on the same server, with no errors. The live and restored copies matched: 60 tables each, and the same counts for `account`, `groups` and `stickers`. `rd` was dropped afterwards.
- **Docs that are wrong now:**
  - `docs/RELEASING.md:41` (§5) says the scheduled backup runs `./zilar backup` and covers the volumes;
  - `docs/RELEASING.md:134-136` (§9 "Backups") points to "the nightly Coolify schedule in `deploy/coolify/scheduled-backup.md`" and to `./zilar backup` on the host;
  - `deploy/coolify/scheduled-backup.md` (99 lines) tells you to add a Backups schedule on the `postgres` component and says the file stores are not covered.
- **The rule for `docs/RELEASING.md`** (line 3): never put real addresses or secrets in it. The same goes for the new text: no bucket names, uuids, hosts or keys. Use placeholders such as `<s3-storage>`.

### What to build
1. **Rewrite `deploy/coolify/scheduled-backup.md`** as plain Markdown, replacing the odd `#`-per-line format, with these sections:
   - **What runs nightly:** the task and the four volume backups, as above;
   - **Why not Coolify database backups:** the application classification;
   - **How to set it up on a new install:** the S3 destination in Coolify, the scheduled task with the exact command, and `backup_set` for each volume, including the "it replaces the whole schedule" note;
   - **How to check:** files appear in the bucket. Coolify has no read-back.
   - **How to restore** (manual runbook):
     - (a) stop `server` and `ejabberd`;
     - (b) download the newest `postgres-data` archive from S3 and unpack it;
     - (c) `psql -f globals.sql`, then `pg_restore -O -c --if-exists -d zilar zilar.dump`, and the same for `ejabberd`;
     - (d) unpack `sticker-data`, `avatar-data` and `ejabberd-uploads` into their volumes;
     - (e) start everything, then check `/health`, the row counts and that every `storage_key` has a file.

     Mark the archive layout as "check on first real restore", because the lead did not open a Coolify volume archive.
   - **The drill:** the one-off check used on 2026-10-09 (restore into a temporary database, compare counts, drop it). Run it monthly and before risky migrations.
2. **`docs/RELEASING.md`:** fix the §5 bullet (line 41) and §9 "Backups" (lines 134-136) to match. For an immediate backup before a risky migration, run the dump task once (Coolify "run now", or a one-off scheduled task), then the `postgres-data` volume backup. Drop the `./zilar backup` advice for Coolify, which stays valid only for the plain stack.

### Read first
`AGENTS.md`, `deploy/coolify/scheduled-backup.md`, `docs/RELEASING.md` (§5, §9), `docs/audit/s3-storage-plan.md` (§2).

### Allowed files
`deploy/coolify/scheduled-backup.md`, `docs/RELEASING.md`, `work/T-0748-backup-docs.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Both docs describe only the setup above, and neither one contains a real host, bucket, uuid or key.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
