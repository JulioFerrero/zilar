# Zilar nightly backup (Coolify install).

#

# Coolify runs this stack as a "Docker Compose Empty" Service (see

# docs/INSTALL_DOCKER.md "The Coolify path"): there is no checkout on the

# host, so the host-cron recipe (deploy/backup-cron.example) does not

# apply. Use Coolify's own scheduler instead:

#

# 1. Open the Service, go to Configuration > Scheduled Tasks, Add.

# 2. Container name: the Compose service that carries the backup tooling.

# On this stack that is `server` (it mounts the sticker/avatar

# volumes; uploads live on ejabberd — see step 4).

# 3. Command: the in-container equivalent of one backup pass. There is

# no `./deploy/zilar` inside the containers, so run the pieces the

# helper runs (same members, same layout):

#

# pg_dump -Fc -U postgres -d zilar > /tmp/zilar.dump \

# && pg_dump -Fc -U postgres -d ejabberd > /tmp/ejabberd.dump

#

# taken from the `postgres` container (it already carries

# POSTGRES_PASSWORD in its own environment), plus

# `tar -C /data -czf - stickers` / `avatars` from `server` and

# `tar -C /opt/ejabberd -czf - upload` from `ejabberd`.

# 4. File stores need their own lines: one scheduled task runs in ONE

# container, so add one task per store (postgres dumps, server

# stickers/avatars tar, ejabberd uploads tar), each writing to a

# Coolify persistent-storage path shared by the tasks, then a final

# task that tars the members into

# `zilar-backup-<UTC stamp>.tgz` (mode 0600 — it holds the env

# secrets if you include them) and prunes to the newest 7.

# 5. Frequency: `30 3 * * *` (daily 03:30, server timezone). Timeout:

# raise from the 300 s default for the first run (dumps of a 200-

# person install take minutes, not seconds), then lower it to just

# above what Recent executions shows.

# 6. Press Execute Now on each task while the Service runs, then open

# Recent executions and confirm the archive lists back

# (`tar -tzf` names every member). A green exit alone does not prove

# the archive is complete — verify the members once.

#

# Retention rule (same as `./deploy/zilar backup --keep 7` on the plain

# stack): keep the newest 7 `zilar-backup-*.tgz`, delete the oldest only

# after the new archive verified readable, never anything else.

#

# Off-machine copy: `./deploy/zilar backup --offsite-hint` on any

# checkout prints the encrypt-then-copy recipe (age/gpg + scp, or

# rclone) — the archive holds live secrets, never upload it unencrypted.

#

# Not verified on a live Coolify (same standing caveat as the Coolify

# path in docs/INSTALL_DOCKER.md): the exact Scheduled Tasks UI mapping

# per Coolify version and the shared-storage wiring between tasks.
