# Install Zilar on bare metal (no Docker)

This path is for people comfortable with Linux. You run every piece
yourself: PostgreSQL, ejabberd, the Zilar server (Node), the built web
app as static files, and Caddy or nginx for HTTPS. Prefer
[the Docker install](INSTALL_DOCKER.md) unless you have a reason not to
run containers — the Docker path is tested end to end, this one is only
partly verified (see §9).

Requirements: a Linux host with **systemd**, Node 24 LTS (system package
or `fnm`/`nvm`), `pnpm` 10, **PostgreSQL 16+ with pgvector** (or 18),
**ejabberd 24+** (distribution package or the official binary), and
**Caddy 2** (or nginx + certbot). 1 vCPU / 2 GB RAM is enough for a
small group and a few hundred users of chat.

Conventions below: `chat.example.com` is your domain (replace it
everywhere, including `rooms.chat.example.com` for group chats), `zilar`
is a dedicated system user that owns the code and data, `/opt/zilar`
is the checkout, `/etc/zilar/zilar.env` (mode 0600) holds secrets,
`/var/lib/zilar` holds the server's data.

## 1. Users and directories

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin zilar
sudo mkdir -p /opt/zilar /etc/zilar /var/lib/zilar /srv/zilar-web
sudo chown zilar:zilar /opt/zilar /var/lib/zilar
sudo chmod 700 /etc/zilar
```

PostgreSQL's peer auth maps the `zilar` OS user to the `zilar` database
role later (§2), so run the database steps as that user where noted.

`/var/lib/zilar` holds the server's file data: stickers
(`STICKER_STORAGE_DIR`, default `/var/lib/zilar/stickers` — created at
startup when missing, must stay writable, backed up in §7).

## 2. Database: PostgreSQL + pgvector

Install PostgreSQL 16 or newer and the pgvector extension for it
(`postgresql-16-pgvector` / `postgresql-18-pgvector` on Debian/Ubuntu, or
build pgvector from source against your server version). The server
refuses to start without the `vector` extension in its database.

Create the roles and databases with the shipped script (passwords arrive
as `psql` variables, never from git — use URL-safe passwords of letters
and digits, they are embedded in connection URLs):

```bash
sudo -u postgres psql \
  -v zilar_password='<zilar-db-password>' \
  -v ejabberd_password='<ejabberd-db-password>' \
  -v archive_password='<archive-db-password-or-empty>' \
  -f deploy/baremetal/setup-postgres.sql
```

This creates the `zilar` and `ejabberd` roles/databases, enables
`vector` in `zilar`, and — unless the archive password is empty —
creates the read-only `zilar_archive` role for message search (leave it
empty to disable search; the server answers 501 and the web hides it).

Point the server at it in `/etc/zilar/zilar.env` (copy
`deploy/baremetal/.env.example` there, mode 0600, owned by `zilar`):

```
DATABASE_URL=postgres://zilar:<zilar-db-password>@localhost:5432/zilar
XMPP_ARCHIVE_DATABASE_URL=postgres://zilar_archive:<archive-db-password>@localhost:5432/ejabberd
```

## 3. ejabberd

Install ejabberd 24+ from your distribution (`apt install ejabberd`) or
the official binary from processone. Then:

1. Copy `deploy/baremetal/ejabberd.yml` to `/etc/ejabberd/ejabberd.yml`
   (back up the packaged one first). Replace every `chat.example.com`
   (and the `rooms.` subdomain), the `SQL_PASSWORD`, and the
   `UPLOAD_URL` if your public upload path differs. Then the push
   section: replace the `push.chat.example.com` host under the
   `ejabberd_service` listener with `push.<your domain>` (it must equal
   `PUSH_COMPONENT_JID` in `/etc/zilar/zilar.env` — ejabberd does not
   expand macros in map keys, so this host is always literal, never a
   macro), and set its password to the same value as
   `PUSH_COMPONENT_SECRET`.
2. Write the JWT key file `/etc/ejabberd/jwt.jwk` (mode 0600, owned by
   the ejabberd user): derive it from the same `ZILAR_XMPP_JWT_SECRET`
   the server uses, with the same recipe as the Docker entrypoint
   (`deploy/ejabberd/jwt-entrypoint.sh` — base64url of the raw secret):
   ```bash
   k=$(printf '%s' "$ZILAR_XMPP_JWT_SECRET" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
   printf '{"kty":"oct","k":"%s","alg":"HS256","use":"sig"}' "$k" | sudo tee /etc/ejabberd/jwt.jwk >/dev/null
   sudo chmod 600 /etc/ejabberd/jwt.jwk && sudo chown ejabberd:ejabberd /etc/ejabberd/jwt.jwk
   ```
   The same secret mistyped on either side means every chat login fails —
   double-check it.
3. Provide `/etc/ejabberd/server.pem` (the `certfiles` entry): the
   distribution package usually generates a self-signed one, or drop in
   your own certificate + key combined file. ejabberd refuses to start
   without a readable cert file even though public traffic terminates at
   the proxy.
4. Register the admin account the server uses for its admin API (the
   `ADMIN` macro, `admin@chat.example.com`):
   ```bash
   sudo ejabberdctl register admin chat.example.com '<ejabberd-admin-password>'
   ```
   and put the same password in `EJABBERD_ADMIN_PASSWORD` in
   `/etc/zilar/zilar.env`.
5. `sudo systemctl enable --now ejabberd`, then
   `sudo ejabberdctl status` must answer, and
   `curl -s http://127.0.0.1:5280/api/status -u admin@chat.example.com:<password>`
   must return ejabberd status JSON (proves the SQL backend and the
   admin credentials from this section).

Key differences from the Docker config (`deploy/ejabberd/ejabberd.yml`):
SQL host is `localhost` (not the `postgres` container), both listeners
bind `127.0.0.1` (peers are on this machine, not a Compose network — the
loopback ACL applies again), values are written out literally (no
`EJABBERD_MACRO_*` entrypoint), `jwt_key` points at `/etc/ejabberd/jwt.jwk`
(step 2 above), `certfiles` points at a real file, and the upload docroot
is `/var/lib/ejabberd/upload` (create it now, owned by the ejabberd user —
`mod_http_upload` cannot create it):

```bash
sudo mkdir -p /var/lib/ejabberd/upload
sudo chown ejabberd:ejabberd /var/lib/ejabberd/upload
```

## 4. Server: Node, pnpm, systemd

As the `zilar` user, clone the repo to `/opt/zilar`, check out the
release tag you want, and install:

```bash
sudo -u zilar -i
cd /opt/zilar
corepack enable && corepack prepare pnpm@10.32.1 --activate
pnpm install --frozen-lockfile
```

Copy `deploy/baremetal/.env.example` to `/etc/zilar/zilar.env`
(as root), fill in every `CHANGE_ME` (passwords from §2, the admin
password and JWT secret from §3, `BETTER_AUTH_SECRET` from
`openssl rand -base64 32`, SMTP settings — sign-in codes are sent by
email, the server refuses production without `MAIL_TRANSPORT=smtp`),
then lock it down. For push notifications, fill the `PUSH_*` lines too
(`PUSH_ENABLED=true`, a VAPID key pair generated with the
`_gen_vapid_keys` recipe in `deploy/zilar` — a real P-256 pair, not
random bytes — pointed at from `deploy/baremetal/.env.example`,
`PUSH_VAPID_SUBJECT=mailto:<you>`,
`PUSH_COMPONENT_JID=push.<your domain>`, `PUSH_COMPONENT_SECRET` equal
to the listener password from step 1 of §3, `PUSH_STORAGE_KEY` from
`openssl rand -base64 48`) — and keep `XMPP_ARCHIVE_DATABASE_URL` set:
push requires the archive reader, without it the component stays off.
Back up `/etc/zilar/zilar.env` with the databases (§7): losing
`PUSH_STORAGE_KEY` orphans every device (browsers must re-enable push).

```bash
sudo chown zilar:zilar /etc/zilar/zilar.env && sudo chmod 600 /etc/zilar/zilar.env
```

Install the unit and start it:

```bash
sudo cp deploy/baremetal/zilar-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zilar-server
```

`systemctl status zilar-server` should show active; the unit restarts
on failure, runs as the `zilar` user with `NoNewPrivileges`,
`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, and can write only
to the checkout's server tree and `/var/lib/zilar`. Migrations run at
startup, so the first start creates the schema. Check the journal for
the startup line and no configuration errors:

```bash
sudo journalctl -u zilar-server --since '5 min ago' | tail -20
curl -s http://127.0.0.1:3000/health
```

The health endpoint must answer `{"ok":true,...}`. "Invalid server
configuration" names the variable (never its value) — compare
`/etc/zilar/zilar.env` against `deploy/baremetal/.env.example`.

## 5. Web app: build once, serve as static files

On the build machine (this host is fine), build the Vite app and copy
the output to the proxy's document root:

```bash
cd /opt/zilar
pnpm --filter @zilar/web build
sudo cp -r apps/web/dist/. /srv/zilar-web/
sudo chown -R root:root /srv/zilar-web
```

`/srv/zilar-web/index.html` must exist. The proxy configs below set the
same caching (hashed `/assets` for a year, never the entry point) and
security headers (CSP, nosniff, `frame-ancestors 'none'`) as the Docker
image (`apps/web/Caddyfile`). Rebuild + recopy on every update (§7).

## 6. Reverse proxy: Caddy or nginx

Pick one. Both terminate HTTPS, serve `/srv/zilar-web`, and route
`/api/*` + `/health` to the server (127.0.0.1:3000) and `/xmpp-ws/*` +
`/upload/*` to ejabberd (127.0.0.1:5280), with the same path rules as
the Docker Caddyfile (strip `/xmpp-ws`, never strip `/upload`).

**Caddy** (automatic HTTPS — recommended): install Caddy 2, copy
`deploy/baremetal/Caddyfile` to `/etc/caddy/Caddyfile`, replace
`chat.example.com` and the ACME email, `systemctl reload caddy`. Point
an `A` record for your domain at the host first — Caddy cannot issue a
certificate until the domain resolves to it.

**nginx** (you manage certificates): install nginx + certbot, get a
certificate (`certbot certonly --nginx -d chat.example.com` needs port
80 reachable), copy `deploy/baremetal/nginx-zilar.conf` to
`/etc/nginx/sites-enabled/zilar` (replace the domain and the
`ssl_certificate` paths), `nginx -t && systemctl reload nginx`.

Open only **80/tcp and 443/tcp** to the proxy. Postgres, ejabberd and
the server listen on loopback only.

## 7. First account, updating, backups

**First account.** Sign-up needs an invite: there is no
admin-creation endpoint. Mint the code the sign-up form asks for with
the invite CLI, loading the server config from `/etc/zilar/zilar.env`
(`set -a` exports every line the file defines; values with spaces such
as `MAIL_FROM` are double-quoted in `.env.example`, which both the shell
and systemd's `EnvironmentFile=` handle — verified with `sh` and `bash`):

```bash
cd /opt/zilar/apps/server
sudo -u zilar sh -c 'set -a; . /etc/zilar/zilar.env; ./node_modules/.bin/tsx src/auth/invite-cli.ts'
```

(If you hand-edit the file, keep quotes around any value containing
spaces: an unquoted `MAIL_FROM=Zilar <…>` breaks the load and every
variable after that line stays unset.)

Open `https://chat.example.com`, sign up with your email, paste the
code. The sign-in code arrives by email (SMTP from §4). Sign-ups after
the first need an invite created the same way.

**Updating.** As `zilar`: `git fetch && git checkout <new-tag>`,
`pnpm install --frozen-lockfile`, rebuild the web app and recopy
`/srv/zilar-web` (§5), then `sudo systemctl restart zilar-server`.
Migrations run at startup. Back up first if the install matters (§8):
`pg_dump -Fc` both databases at minimum.

**Backups.** There is no wizard for this path (the `./zilar backup`
helper only drives the Docker stack). At minimum, dump both databases
nightly, tar the two file stores below, and copy the archives plus
`/etc/zilar/zilar.env` (live secrets — mode 0600, store encrypted)
off the machine. The env file backup matters twice for push: it holds
`PUSH_STORAGE_KEY`, and losing that key orphans every device (browsers
must re-enable push):

```bash
pg_dump -Fc -U zilar -h localhost zilar > "zilar-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump -Fc -U ejabberd -h localhost ejabberd > "ejabberd-$(date -u +%Y%m%dT%H%M%SZ).dump"
tar -czf "ejabberd-upload-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C /var/lib/ejabberd upload
tar -czf "zilar-stickers-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C /var/lib/zilar stickers
chmod 600 zilar-*.dump ejabberd-*.dump ejabberd-upload-*.tgz zilar-stickers-*.tgz
```

Where each kind of file lives: attachments (XEP-0363) in the ejabberd
upload dir (`/var/lib/ejabberd/upload` — the `docroot` in
`deploy/baremetal/ejabberd.yml`); stickers in `/var/lib/zilar`
(`STICKER_STORAGE_DIR` — set it in `/etc/zilar/zilar.env` to
`/var/lib/zilar/stickers`, create it owned by `zilar:zilar`; never a
relative path — see `docs/SERVER_CONFIG.md` "Stickers"); GIFs are not
stored (proxied; a sent GIF becomes a normal attachment); voice is not
built. The database dumps hold neither file store — skip the two tar
lines and a restore brings back rows pointing at missing files.

Upload quotas work the same as Docker: `deploy/baremetal/ejabberd.yml`
enables `mod_http_upload_quota` with 2048 MiB soft / 4096 MiB hard per
user (oldest files trimmed first past the hard quota, no age-out);
retune the two shaper numbers there. Watch disk space (`df -h /`):
at 80% used plan to free space or grow the disk; at 95% uploads and
stickers start failing.

A systemd timer running the dump + tar lines plus an off-machine copy
(rsync/scp to another host) is enough for a small install. Restore =
recreate roles/databases (§2), `pg_restore --clean`, restore both file
dirs, put the env file back, restart ejabberd and `zilar-server`.
Practice the restore once before you need it.

## Backups: schedule, retention, off-machine copy

One backup exists only when someone remembers to run it. The shipped
timer pair (`deploy/baremetal/zilar-backup.timer` +
`zilar-backup.service`, driving `zilar-backup.sh`) runs the full pass
daily at 03:30 with a random delay of up to 30 minutes, and catches up
at boot when the host was off (`Persistent=true`). Install it:

```bash
sudo mkdir -p /var/lib/zilar-backups
sudo chown zilar:zilar /var/lib/zilar-backups
sudo cp deploy/baremetal/zilar-backup.sh /opt/zilar/deploy/baremetal/
sudo cp deploy/baremetal/zilar-backup.service deploy/baremetal/zilar-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zilar-backup.timer
systemctl list-timers zilar-backup.timer   # NEXT column shows the coming run
sudo journalctl -u zilar-backup --since '2 days ago' | tail -20
```

(`BACKUP_KEEP_N`, default 7, is set in the unit — edit the
`Environment=` line to keep more or fewer.) `zilar-backup.sh` dumps both
databases (`pg_dump -Fc`), `pg_dumpall -g` roles/globals, tars uploads +
stickers + avatars, and bundles the archive with a copy of
`/etc/zilar/zilar.env` — mode 0600 throughout, because the archive holds
live secrets. Retention mirrors the Docker wizard: the new archive must
list back through `tar -tzf` before the oldest beyond N are deleted; a
failed dump keeps every old archive; only `zilar-backup-*.tgz` files are
ever deleted, never through symlinks.

A backup on the same disk is not a backup: encrypt each archive BEFORE
copying it off the machine (the env file inside owns the install), then
`scp`/`rclone` it to another host. With age:

```bash
age --encrypt --recipient age1<your-public-key> --output newest.tgz.age /var/lib/zilar-backups/zilar-backup-<stamp>.tgz
scp newest.tgz.age backup-host:/srv/zilar-backups/
```

Freshness has no `doctor` on this path (the `./zilar doctor` freshness
check only drives the Docker stack): watch it with the timer itself —
`systemctl list-timers` shows the last run, and the service logs
`Keeping the newest N (removed M older)` per pass. If the newest archive
is older than 2 days, the timer is not firing (host off without
`Persistent`, unit failed — read the journal) — fix it the way you would
any missed backup: run `/opt/zilar/deploy/baremetal/zilar-backup.sh`
by hand now, then repair the timer.

### Restore drill (practice before you need it)

A backup you never restored is a hope, not a backup. Once per quarter,
prove the archives work — on a THROWAWAY host or throwaway
roles/databases, never over the live data (restore overwrites):

```bash
# 1. Note the live sticker and upload counts (source of truth).
#    Sticker count: sign in, open the sticker picker. Upload count:
#    sudo -u ejabberd find /var/lib/ejabberd/upload -type f | wc -l
# 2. Take a fresh backup: sudo systemctl start zilar-backup.service
#    and copy the newest archive aside (still mode 0600).
# 3. On the throwaway target: recreate roles/databases (§2),
#    pg_restore --clean both dumps, restore both file dirs, put the env
#    file back, restart ejabberd and zilar-server.
# 4. Confirm: sign in, the sticker count matches step 1, uploads open
#    (spot-check two files end to end), /health answers ok:true.
# 5. Wipe the throwaway target and delete the aside copy.
```

If any step fails, fix the backup before you need it for real.

## 8. What was and was not tested

Honestly: **none of this guide was run on a real machine.** It was
written from the Docker stack's proven configs (same modules, same
routes, same env names) and validated only as far as this macOS
workstation allows:

- `deploy/baremetal/Caddyfile` passes `caddy validate` (via
  `docker run caddy caddy validate`) — validated with the literal
  `chat.example.com` domain from the file plus `{$ZILAR_DOMAIN}` /
  `{$ACME_EMAIL}` placeholders swapped in for the check; the exact
  commands and results are in the T-0127 report.
- `deploy/baremetal/ejabberd.yml` was diffed against the proven
  `deploy/ejabberd/ejabberd.yml`; every difference is listed in §3's
  closing paragraph and is deliberate (localhost SQL, loopback bind +
  ACL, literal values, `jwt_key` at `/etc/ejabberd/jwt.jwk`, certfiles,
  `/var/lib/ejabberd/upload` docroot).
- `deploy/baremetal/setup-postgres.sql` mirrors the proven
  `deploy/postgres/init/*.sql` logically but was never executed — not
  even the `\if :{?...}` / `\gset` guards it shares with
  `20-search-reader.sql` (which IS proven in Docker).
- `deploy/baremetal/zilar-backup.{service,timer,sh}` (T-0158) were never
  checked with `systemd-analyze verify` (no systemd on macOS) and never
  ran against a real Postgres/ejabberd: treat the timer install steps in
  §7 as untested-on-a-real-machine until the first bare-metal backup is
  observed end to end (archive written, verified, pruned, copied off
  encrypted).
- `deploy/baremetal/zilar-server.service` was never checked with
  `systemd-analyze verify` (no systemd on macOS) and never booted a
  machine; the hardening directives are standard systemd options, but a
  too-strict `ProtectSystem`/`ReadWritePaths` combination fails the
  service at first start on some distributions — if it does, the unit
  logs tell you which path was denied.
- The nginx config was never tested with real traffic (`nginx -t` was
  unavailable here); treat the Caddy path as the primary one.
- The invite CLI command in §7 (`set -a; . /etc/zilar/zilar.env; …`)
  follows the standard Bourne idiom for loading an env file, but was never
  run against a real `/etc/zilar/zilar.env`; the first person to follow
  this guide should confirm the exact invocation and report back.

If you follow this guide, please report what worked and what did not —
every correction makes the next install easier.
