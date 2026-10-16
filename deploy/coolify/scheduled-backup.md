# Nightly backup on Coolify

This page covers the backup of the Zilar stack on Coolify. Since the move on
2026-10-11 the stack runs as a Coolify **Application** (`zilar-chat`), built
from `deploy/coolify/docker-compose.app.yml` on a checkout Coolify makes itself
(see `docs/deploy/coolify-app-plan.md`). There is no checkout on the host, so
`./zilar backup` does not apply here. Use the setup below.

Placeholders used on this page:

- `<app>`: the Application name (`zilar-chat` on the live install).
- `<app-uuid>`: the Application's uuid in Coolify.
- `<s3-storage>`: the S3 storage name you give in Coolify.
- `<bucket>`, `<s3-host>`: the bucket and endpoint of your S3 provider.
- `<domain>`: the public host of the install.
- `<scratch>`: an empty folder on the host, outside the Coolify volumes.
- `<postgres-container>`: the name of the Postgres container. Coolify names the
  Application's containers `<service>-<app-uuid>-…`, so this one starts with
  `postgres-`. Find it by its Compose service label:

  ```sh
  docker ps --filter label=com.docker.compose.service=postgres --format '{{.Names}}'
  ```

Never put real bucket names, keys or hosts in this file or in the repo.

## What runs nightly

Every night the backup runs five jobs on the Application. Job 1 only writes the
dump files, on the `postgres-data` volume on the server. Jobs 2 to 5 copy the
volumes to S3 (`<s3-storage>`). Job 2 is what carries the dumps off the host.

1. **Database dumps.** The scheduled task `pg-dump-nightly` on the Application,
   in the `postgres` container, at 03:30 daily (`30 3 * * *`). It writes
   `globals.sql`, `zilar.dump` and `ejabberd.dump` (each `pg_dump -Fc`, written
   to a temp name and renamed, mode 600) to `/var/lib/postgresql/dumps` on the
   `postgres-data` volume. Nothing is copied off the server by this job.
2. **Volume backup of `postgres-data`** to S3 at 03:40. It carries the dumps.
   The raw database folder inside it is not a consistent copy, so never restore
   the database from it. Restore the dumps.
3. **Volume backup of `sticker-data`** to S3 at 03:45.
4. **Volume backup of `avatar-data`** to S3 at 04:00. It includes `backgrounds/`.
5. **Volume backup of `ejabberd-uploads`** to S3 at 04:15.

Each volume backup keeps 3 copies locally and 30 copies or 30 days on S3. The
volume backups run live, with no container stop.

These jobs were re-created on the Application on 2026-10-12; the old Service and
its schedules went away with the 10-11 move, and nothing had recreated them
before then.

## What `ejabberd-database` holds, and why it should be backed up

`ejabberd-database` is mounted at `/opt/ejabberd/database` and is **not covered**
by the nightly backups above. With `default_db: sql` (`deploy/ejabberd/ejabberd.yml`), rooms,
MAM history, rosters and push sessions all live in Postgres, so the volume holds
the **Mnesia leftovers** written before the switch plus the node's **Erlang
cookie**. Losing it is low impact — a restored node writes a fresh cookie — but
a backup is cheap and makes a restore start from the same node state.

**Step for Julio:** add a backup schedule for `ejabberd-database` to
`<s3-storage>`, weekly is enough. The Application is his to change; nothing is
scheduled for this volume today.

## Why not Coolify database backups

Coolify lists the `postgres` component of this Application as an application,
not as a database. The stack runs the custom image `zilar-postgres`
(`deploy/postgres/Dockerfile`, based on `pgvector/pgvector`). So the Application
has no Backups tab for the database, and Coolify's database restore page does
not apply. Coolify's volume backup page also says it has no dashboard restore
action. That is why the dumps are made by a scheduled task, and why the restore
is a manual runbook below.

## How to set it up on a new install

1. **Add the S3 storage.** In Coolify, open S3 Storage and add `<s3-storage>`
   with the bucket, region, access key and secret key of your provider. Choose
   "Validate Connection & Continue". Enter the keys only in Coolify's form.

2. **Add the dump task.** Open the Application, then Scheduled Tasks. Add a
   task:
   - Container: `postgres` (the Compose service, in the Coolify form)
   - Name: `pg-dump-nightly` (the live name; any name works)
   - Frequency: `30 3 * * *`
   - Command (one line, exact):

   ```sh
   sh -c 'umask 077;d=/var/lib/postgresql/dumps;mkdir -p $d&&pg_dumpall -U postgres -g>$d/g.tmp&&mv $d/g.tmp $d/globals.sql&&for b in zilar ejabberd;do pg_dump -U postgres -Fc -f $d/$b.tmp $b&&mv $d/$b.tmp $d/$b.dump||exit 1;done;chmod 600 $d/*;ls -l $d'
   ```

   Coolify limits a scheduled task command to 255 characters. This one fits.

3. **Set the volume backups.** Open the Application's Storages (its persistent
   volumes) and, for each volume below, set one backup schedule with the Coolify
   storage backup settings (`backup_set` in the Coolify API):

   | Volume              | Time   | Local copies | S3 retention         | Status             |
   | ------------------- | ------ | ------------ | -------------------- | ------------------ |
   | `postgres-data`     | 03:40  | 3            | 30 copies or 30 days | live               |
   | `sticker-data`      | 03:45  | 3            | 30 copies or 30 days | live               |
   | `avatar-data`       | 04:00  | 3            | 30 copies or 30 days | live               |
   | `ejabberd-uploads`  | 04:15  | 3            | 30 copies or 30 days | live               |
   | `ejabberd-database` | weekly | 3            | 30 days              | **step for Julio** |

   For each volume, set `s3_storage_uuid` to `<s3-storage>`, `save_s3` to true,
   and `stop_during_backup` to false.

   **Note:** `backup_set` replaces the whole backup schedule of that volume. Send
   every field every time, not only the ones you change. Coolify has no read-back
   for this setting, so keep your own copy of the values you sent.

## How to check

1. The first run is at 03:30. The next morning, check that new objects appear in
   `<bucket>` on `<s3-host>`. Use the provider's console or any S3 client.
   Example with the AWS CLI:

   ```sh
   aws s3 ls s3://<bucket>/ --endpoint-url https://<s3-host>
   ```

2. You should see the four volume backups (`postgres-data`, `sticker-data`,
   `avatar-data`, `ejabberd-uploads`); the dumps travel inside the
   `postgres-data` archive. If a volume is missing, check its schedule under the
   Application's Storages.

3. The Application → Scheduled Tasks page lists `pg-dump-nightly` and its
   executions; each execution has a log ending in the `ls -l` of the three dump
   files. An error there (or no new execution) means the dump did not run.
   Coolify has no read-back for `backup_set`, so the bucket check in step 1 is
   the only check that the volume backups arrived.

## How to restore

Use this runbook only after a loss. The layout of the volume archives is not
checked yet. **Check the archive layout on the first real restore**, and update
this page with what you find. `docs/ops/restore-drill.md` is the full drill
(both dumps, every volume, the secrets, a 60-minute RTO) to practice first.

1. **Stop the app containers.** Stop `server` and `ejabberd` so nothing writes
   during the restore. Either stop them in Coolify, or run `docker stop` on the
   `server-<app-uuid>-…` and `ejabberd-<app-uuid>-…` containers. Keep the
   Postgres container running.

2. **Download the newest archive.** Download the newest `postgres-data` archive
   from `<s3-storage>`. Unpack it into `<scratch>`, not into a Coolify volume.
   The dumps should be in a `dumps` folder of the archive. Check that
   `globals.sql`, `zilar.dump` and `ejabberd.dump` are there. The layout is not
   checked yet.

3. **Load the dumps.** Run these on the Coolify server, over SSH. Find the
   container name first (see the placeholders above).

   ```sh
   docker cp <scratch>/dumps/globals.sql <postgres-container>:/tmp/globals.sql
   docker exec <postgres-container> psql -U postgres -f /tmp/globals.sql
   docker cp <scratch>/dumps/zilar.dump <postgres-container>:/tmp/zilar.dump
   docker exec <postgres-container> pg_restore -U postgres -O -c --if-exists -d zilar /tmp/zilar.dump
   docker cp <scratch>/dumps/ejabberd.dump <postgres-container>:/tmp/ejabberd.dump
   docker exec <postgres-container> pg_restore -U postgres -O -c --if-exists -d ejabberd /tmp/ejabberd.dump
   docker exec <postgres-container> rm /tmp/globals.sql /tmp/zilar.dump /tmp/ejabberd.dump
   ```

   `globals.sql` recreates the roles. On a live install, `role already exists`
   messages are expected. Read the output for any other error.

4. **Restore the file volumes.** Unpack the newest archive of each of
   `sticker-data`, `avatar-data` and `ejabberd-uploads` into its volume (and
   `ejabberd-database`, once it is scheduled). Coolify has no restore button for
   volumes. Keep the containers stopped while you copy. Check the archive layout
   on the first real restore.

5. **Start everything.** Start `server` and `ejabberd` again. Then check:
   - `https://<domain>/health` answers OK.
   - The row counts of the main tables match what you expect from before the
     loss (for example `account`, `groups` and `stickers`).
   - Every row with a `storage_key` (stickers, avatars and chat backgrounds) has
     a file in its volume. Missing files mean the restore is not complete.

## Quick restore check on the live server

This is the cheap check: it proves that the dump already on the server restores
and holds the same data as the live database. It needs no SSH, does not write to
the live database, and does not test the S3 copy. For the full test — both
dumps, every volume archive and the secrets — use `docs/ops/restore-drill.md`.

The check uses two one-off Coolify scheduled tasks on the Application, container
`postgres`. Create each task, run it once (use run now, or set frequency
`* * * * *` and delete the task right after its first run), read its output in
the execution log, then delete the task.

1. **Task A: restore into a temporary database.** Command, exact:

   ```sh
   sh -c 'export PGUSER=postgres;dropdb --if-exists rd;createdb rd&&pg_restore -O -d rd /var/lib/postgresql/dumps/zilar.dump 2>&1|tail -5;echo tables=$(psql -d rd -tAc "\dt"|wc -l)'
   ```

   The output must have no `pg_restore` error lines. It prints only `tables=N`.

2. **Task B: compare with the live database, then drop the temporary one.**
   Command, exact:

   ```sh
   sh -c 'export PGUSER=postgres;Q="select (select count(*) from account),(select count(*) from groups),(select count(*) from stickers)";for d in zilar rd;do echo $d $(psql -d $d -tAc "\dt"|wc -l) $(psql -d $d -tAc "$Q");done;dropdb rd'
   ```

   The output has one line per database, in the form
   `<db> <tables> <account>|<groups>|<stickers>`. The `zilar` line and the `rd`
   line must match. On 2026-10-09 both lines were `60 0|1|30`.

3. Write the result in the drill log: the date, the dump time, and the two
   output lines. Do not write keys or hosts.
