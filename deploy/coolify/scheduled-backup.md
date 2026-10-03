# Zilar nightly backup (Coolify install).

#

# Coolify runs this stack as a "Docker Compose Empty" Service (see

# docs/INSTALL_DOCKER.md "The Coolify path"): there is no checkout on the

# host, so the host-cron recipe (deploy/backup-cron.example) does not

# apply — and there is no `./deploy/zilar` inside any container either.

# What Coolify CAN do, verified against the official docs

# (https://coolify.io/docs/databases/backups):

#

# 1. Database dumps — but NOT through Scheduled Tasks on this stack.

# Coolify's scheduled database backups ("Backups" on a database

# resource, "Back up a database inside a service" for a Service like

# this one) run `pg_dump` custom format themselves: open the Service,

# open the `postgres` component, add a schedule under Backups, scope it

# to the `zilar` and `ejabberd` databases (comma-separated list),

# frequency `30 3 * * *` (daily 03:30, server timezone), retention to

# the newest 7. Coolify reads the credentials from the container's own

# environment (`POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB` —

# all present on this stack's `postgres` service), so no password step

# is needed. Verify once with Backup Now, then check the Executions

# page (status Success, both database names, size greater than zero).

# Optionally enable the S3 section so the dumps land off-machine.

# 2. File stores are NOT covered by Coolify's database backups. The

# `ejabberd-uploads`, `sticker-data` and `avatar-data` volumes hold

# attachments, stickers and avatars that no dump contains — a restore

# of the databases alone brings back rows pointing at missing files.

# There is no runnable per-task recipe for them here: Scheduled Tasks

# run one command in one container with no shared assembly area and no

# documented volume path, so the member-assembly + prune steps from the

# plain stack cannot be transcribed 1:1. Until someone proves a full

# volume-copy recipe on a live Coolify, treat Coolify file stores as

# backed up only if you add your own volume backup (e.g. a Duplicati

# sidecar over the mounted volumes, or periodic `docker cp` from the

# host) — and say so in your runbook.

#

# Retention rule (same as `./deploy/zilar backup --keep 7` on the plain

# stack): keep the newest 7 database dumps, delete the oldest only after

# the new dump verified (Coolify's Retention settings: number of backups

# to keep = 7). A backup you never restored is a hope: restore a copy

# into a disposable database (per the Coolify restore guide) and check

# the sticker and upload counts before treating it as recoverable.

#

# Off-machine copy: `./deploy/zilar backup --offsite-hint` on any

# checkout prints the encrypt-then-copy recipe (age/gpg + scp, or

# rclone) — any archive holding the env holds live secrets, never upload

# one unencrypted.

#

# Not verified on a live Coolify (same standing caveat as the Coolify

# path in docs/INSTALL_DOCKER.md): the exact Backups UI per Coolify

# version, and no volume recipe is claimed here at all.
