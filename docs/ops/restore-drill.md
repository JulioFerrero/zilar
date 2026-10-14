# Restore drill: the Coolify backups, end to end on a scratch host

A backup you never restored is a hope. This drill proves the nightly Coolify
backups restore **end to end**: `zilar.dump` and `ejabberd.dump`, every volume
archive, and the secrets. It runs on a **throwaway host**, never the live
install. Run it once a quarter, and before a migration that could destroy data.

**Target RTO: 60 minutes**, from "start" to "all checks pass". Record the real
elapsed time each run; if it runs over the target, find the slow step and
shorten it before the next quarter.

Commands only. **Run none of this on the live host.** The archives are the ones
`deploy/coolify/scheduled-backup.md` describes.

## 0. What you need

- a throwaway Linux host with Docker and the Compose plugin, 10 GB free, and a
  checkout of this repository whose `deploy/` matches what was backed up;
- access to the B2 bucket (`<bucket>` on `<s3-host>`, Coolify storage
  `<s3-storage>`), with an S3 client (`aws s3`, or `rclone`);
- the Application's environment from Julio's password manager (the OPS-9 export
  of the `SERVICE_*` values). That copy is the source of the secrets below;
  never read them off the live host.
- the current live row counts (`account`, `groups`, `stickers`) written down
  before you start, so the restored database has something to match.

Write `date -u` when you start, and again when the last check passes. Run steps
1 to 7 in **one shell**: the exported variables carry over from step to step.

## 1. Secrets, from the password manager (never from the live host)

Copy the archived values into `deploy/.env` on the scratch checkout, key by key.
**Names only, never values, in this file or in any log.** Leave `CHANGE_ME` for
anything the drill does not need. Never display the file.

```sh
cd <scratch-checkout>
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
# edit deploy/.env and paste the values for the names in the table below
```

| Name in `deploy/.env`                                            | What restoring it proves                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `ZILAR_KEY_ENCRYPTION_KEY`                                       | the stored provider and Resend keys still decrypt          |
| `PUSH_STORAGE_KEY`                                               | the stored push subscriptions still decrypt                |
| `ZILAR_XMPP_JWT_SECRET`                                          | XMPP tokens still verify (the server and ejabberd agree)   |
| `POSTGRES_PASSWORD`                                              | the Postgres superuser matches the restored roles          |
| `ZILAR_DB_PASSWORD`                                              | the server can open the `zilar` database                   |
| `EJABBERD_DB_PASSWORD`                                           | ejabberd can open the `ejabberd` database                  |
| `ZILAR_ARCHIVE_DB_PASSWORD`                                      | the message-search reader can read `archive`               |
| `BETTER_AUTH_SECRET`                                             | existing sessions stay valid                               |
| `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY`               | browsers accept the push subscription                      |
| `PUSH_COMPONENT_SECRET`                                          | the server's push component handshake with ejabberd works |

Set the scratch-only values in the same file, so nothing touches a real domain
and the sign-in codes go to the server log:

```sh
# in deploy/.env
ZILAR_DOMAIN=localhost
HTTP_PORT=18080
HTTPS_PORT=18443
MAIL_TRANSPORT=console
MAIL_ALLOW_CONSOLE_IN_PRODUCTION=true
```

`MAIL_TRANSPORT=console` is a throwaway-host setting only: it prints one-time
codes to the server log, so never use it on a real install.

## 2. Download the newest archives from B2

List the bucket and note the date in each key; download the newest of each of
the four objects (the four volume backups — `ejabberd-database` is not
scheduled yet, see step 4). The key names carry the backup time.

```sh
export SCRATCH=<scratch>
mkdir -p "$SCRATCH"
aws s3 ls "s3://<bucket>/" --endpoint-url "https://<s3-host>"

aws s3 cp "s3://<bucket>/<postgres-data-key>"    "$SCRATCH/postgres-data.tgz"    --endpoint-url "https://<s3-host>"
aws s3 cp "s3://<bucket>/<sticker-data-key>"     "$SCRATCH/sticker-data.tgz"     --endpoint-url "https://<s3-host>"
aws s3 cp "s3://<bucket>/<avatar-data-key>"      "$SCRATCH/avatar-data.tgz"      --endpoint-url "https://<s3-host>"
aws s3 cp "s3://<bucket>/<ejabberd-uploads-key>" "$SCRATCH/ejabberd-uploads.tgz" --endpoint-url "https://<s3-host>"
# rclone, as an alternative to aws s3:
# rclone copy <remote>:<bucket> "$SCRATCH" --include '<postgres-data key>'
```

The archive layout has never been checked (the same is said in
`scheduled-backup.md`). **On the first real run, look inside each archive and
write what you find here**, then update `scheduled-backup.md` too.

## 3. Start a scratch stack and restore the dumps

Use the plain stack with its own project name and ports, so it can never touch
another install (the T-0127 isolation rule).

```sh
cd <scratch-checkout>
export COMPOSE="docker compose -p zilar-drill -f deploy/docker-compose.yml --env-file deploy/.env"
$COMPOSE up -d
$COMPOSE stop server ejabberd web
$COMPOSE ps
```

Unpack the `postgres-data` archive and check the dump files it carries:

```sh
mkdir -p "$SCRATCH/pg"
tar -xzf "$SCRATCH/postgres-data.tgz" -C "$SCRATCH/pg"
ls -l "$SCRATCH/pg/dumps"
# three files: globals.sql, zilar.dump, ejabberd.dump
```

Load them into the scratch Postgres. Find the container first:

```sh
export PG=$(docker ps \
  --filter label=com.docker.compose.project=zilar-drill \
  --filter label=com.docker.compose.service=postgres \
  --format '{{.Names}}')
docker cp "$SCRATCH/pg/dumps/globals.sql" "$PG":/tmp/globals.sql
docker exec "$PG" psql -U postgres -f /tmp/globals.sql
docker cp "$SCRATCH/pg/dumps/zilar.dump" "$PG":/tmp/zilar.dump
docker exec "$PG" pg_restore -U postgres -O -c --if-exists -d zilar /tmp/zilar.dump
docker cp "$SCRATCH/pg/dumps/ejabberd.dump" "$PG":/tmp/ejabberd.dump
docker exec "$PG" pg_restore -U postgres -O -c --if-exists -d ejabberd /tmp/ejabberd.dump
docker exec "$PG" rm /tmp/globals.sql /tmp/zilar.dump /tmp/ejabberd.dump
```

`globals.sql` recreates the roles; on a stack that already created them,
`role already exists` messages are expected. Read the output for any other
error.

## 4. Restore the file volumes

Unpack each archive into its volume, the way the live restore runbook does.
The volumes are named `<project>_<volume>` (here `zilar-drill_...`). Unpack as
root with `tar -xp` so the archive's ownership is kept; if the server later logs
a permission error, fix the ownership inside the volume and update this page.

```sh
# stickers -> /data/stickers on the server
docker run --rm \
  -v zilar-drill_sticker-data:/to \
  -v "$SCRATCH/sticker-data.tgz:/from.tgz:ro" \
  alpine:3 sh -c 'cd /to && tar -xzp -f /from.tgz'

# avatars and background wallpapers -> /data/avatars
docker run --rm \
  -v zilar-drill_avatar-data:/to \
  -v "$SCRATCH/avatar-data.tgz:/from.tgz:ro" \
  alpine:3 sh -c 'cd /to && tar -xzp -f /from.tgz'

# ejabberd uploads -> /opt/ejabberd/upload
docker run --rm \
  -v zilar-drill_ejabberd-uploads:/to \
  -v "$SCRATCH/ejabberd-uploads.tgz:/from.tgz:ro" \
  alpine:3 sh -c 'cd /to && tar -xzp -f /from.tgz'
```

If the drill is also covering `ejabberd-database` (once it is added to the
schedule, see `scheduled-backup.md`), restore it the same way into
`zilar-drill_ejabberd-database`.

## 5. Start the stack and verify

```sh
$COMPOSE up -d --wait
curl -k https://localhost:18443/health
# expected: {"ok":true,...}
```

Counts, compared with the live numbers you wrote down in step 0:

```sh
docker exec "$PG" psql -U postgres -d zilar -tAc \
  "select (select count(*) from account),(select count(*) from groups),(select count(*) from stickers)"
docker exec "$PG" psql -U postgres -d ejabberd -tAc \
  "select (select count(*) from users),(select count(*) from archive)"
```

Files present for the rows that expect them:

```sh
docker exec "$PG" psql -U postgres -d zilar -tAc \
  "select count(*) from stickers"   # compare with the file count below
docker run --rm -v zilar-drill_sticker-data:/d alpine:3 sh -c 'find /d -type f | wc -l'
docker run --rm -v zilar-drill_avatar-data:/d  alpine:3 sh -c 'find /d -type f | wc -l'
docker run --rm -v zilar-drill_ejabberd-uploads:/d alpine:3 sh -c 'find /d -type f | wc -l'
```

In the app, at `https://localhost:18443` (accept Caddy's local CA):

1. **Log in.** Enter a real account email; read the one-time code from the
   server log and type it. This proves the account rows and `BETTER_AUTH_SECRET`.
   ```sh
   $COMPOSE logs server
   ```
2. **Open an old chat** and scroll up. An old message from the `archive` table
   is the `ejabberd.dump` proof.
3. **Open a profile.** The avatar picture is the `avatar-data` proof.
4. **Open the sticker picker** and send one: the `sticker-data` proof.
5. **Open an old attachment** in a chat: the `ejabberd-uploads` proof.
6. **Open Settings → Integrations.** The stored provider and Resend entries load
   without an error: the `ZILAR_KEY_ENCRYPTION_KEY` proof. Enable notifications
   on the scratch domain: the server accepts the device, the `PUSH_STORAGE_KEY`
   proof.

## 6. Record the run

One row per drill. The target RTO is 60 minutes.

| Run (UTC) | Archive dates (dumps / volumes) | Tester | Start | Verified | Elapsed | Within 60 min? | Result | Notes |
| --------- | ------------------------------- | ------ | ----- | -------- | ------- | -------------- | ------ | ----- |
|           |                                 |        |       |          |         |                |        |       |
|           |                                 |        |       |          |         |                |        |       |

One row per check, per run.

| Run (UTC) | Check | Expected | Seen | Pass? | Notes |
| --------- | ----- | -------- | ---- | ----- | ----- |
|           | /health | ok:true | | | |
|           | `account` / `groups` / `stickers` counts | match the live numbers | | | |
|           | `users` / `archive` counts | non-zero, match the live numbers | | | |
|           | Sticker / avatar / upload file counts | match their row counts | | | |
|           | Login | one-time code accepted | | | |
|           | Old message | visible in an old chat | | | |
|           | Avatar | picture loads | | | |
|           | Sticker | picker shows and sends one | | | |
|           | Attachment | old upload opens | | | |
|           | `ZILAR_KEY_ENCRYPTION_KEY` | stored integration keys load | | | |
|           | `PUSH_STORAGE_KEY` | a device enables notifications | | | |

## 7. Tear down

```sh
cd <scratch-checkout>
docker compose -p zilar-drill -f deploy/docker-compose.yml --env-file deploy/.env down -v
rm -r "$SCRATCH"
rm deploy/.env
```

The scratch `.env` and the downloaded archives hold live secrets: delete both.
