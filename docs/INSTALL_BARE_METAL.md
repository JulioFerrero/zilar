# Install Galena on bare metal (no Docker)

This path is for people comfortable with Linux. You run every piece
yourself: PostgreSQL, ejabberd, the Galena server (Node), the built web
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
everywhere, including `rooms.chat.example.com` for group chats), `galena`
is a dedicated system user that owns the code and data, `/opt/galena`
is the checkout, `/etc/galena/galena.env` (mode 0600) holds secrets,
`/var/lib/galena` holds the server's data.

## 1. Users and directories

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin galena
sudo mkdir -p /opt/galena /etc/galena /var/lib/galena /srv/galena-web
sudo chown galena:galena /opt/galena /var/lib/galena
sudo chmod 700 /etc/galena
```

PostgreSQL's peer auth maps the `galena` OS user to the `galena` database
role later (§2), so run the database steps as that user where noted.

`/var/lib/galena` holds the server's file data: stickers
(`STICKER_STORAGE_DIR`, default `/var/lib/galena/stickers` — created at
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
  -v galena_password='<galena-db-password>' \
  -v ejabberd_password='<ejabberd-db-password>' \
  -v archive_password='<archive-db-password-or-empty>' \
  -f deploy/baremetal/setup-postgres.sql
```

This creates the `galena` and `ejabberd` roles/databases, enables
`vector` in `galena`, and — unless the archive password is empty —
creates the read-only `galena_archive` role for message search (leave it
empty to disable search; the server answers 501 and the web hides it).

Point the server at it in `/etc/galena/galena.env` (copy
`deploy/baremetal/.env.example` there, mode 0600, owned by `galena`):

```
DATABASE_URL=postgres://galena:<galena-db-password>@localhost:5432/galena
XMPP_ARCHIVE_DATABASE_URL=postgres://galena_archive:<archive-db-password>@localhost:5432/ejabberd
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
   `PUSH_COMPONENT_JID` in `/etc/galena/galena.env` — ejabberd does not
   expand macros in map keys, so this host is always literal, never a
   macro), and set its password to the same value as
   `PUSH_COMPONENT_SECRET`.
2. Write the JWT key file `/etc/ejabberd/jwt.jwk` (mode 0600, owned by
   the ejabberd user): derive it from the same `GALENA_XMPP_JWT_SECRET`
   the server uses, with the same recipe as the Docker entrypoint
   (`deploy/ejabberd/jwt-entrypoint.sh` — base64url of the raw secret):
   ```bash
   k=$(printf '%s' "$GALENA_XMPP_JWT_SECRET" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
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
   `/etc/galena/galena.env`.
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

As the `galena` user, clone the repo to `/opt/galena`, check out the
release tag you want, and install:

```bash
sudo -u galena -i
cd /opt/galena
corepack enable && corepack prepare pnpm@10.32.1 --activate
pnpm install --frozen-lockfile
```

Copy `deploy/baremetal/.env.example` to `/etc/galena/galena.env`
(as root), fill in every `CHANGE_ME` (passwords from §2, the admin
password and JWT secret from §3, `BETTER_AUTH_SECRET` from
`openssl rand -base64 32`, SMTP settings — sign-in codes are sent by
email, the server refuses production without `MAIL_TRANSPORT=smtp`),
then lock it down. For push notifications, fill the `PUSH_*` lines too
(`PUSH_ENABLED=true`, a VAPID key pair generated with the
`_gen_vapid_keys` recipe in `deploy/galena` — a real P-256 pair, not
random bytes — pointed at from `deploy/baremetal/.env.example`,
`PUSH_VAPID_SUBJECT=mailto:<you>`,
`PUSH_COMPONENT_JID=push.<your domain>`, `PUSH_COMPONENT_SECRET` equal
to the listener password from step 1 of §3, `PUSH_STORAGE_KEY` from
`openssl rand -base64 48`) — and keep `XMPP_ARCHIVE_DATABASE_URL` set:
push requires the archive reader, without it the component stays off.
Back up `/etc/galena/galena.env` with the databases (§7): losing
`PUSH_STORAGE_KEY` orphans every device (browsers must re-enable push).

```bash
sudo chown galena:galena /etc/galena/galena.env && sudo chmod 600 /etc/galena/galena.env
```

Install the unit and start it:

```bash
sudo cp deploy/baremetal/galena-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now galena-server
```

`systemctl status galena-server` should show active; the unit restarts
on failure, runs as the `galena` user with `NoNewPrivileges`,
`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, and can write only
to the checkout's server tree and `/var/lib/galena`. Migrations run at
startup, so the first start creates the schema. Check the journal for
the startup line and no configuration errors:

```bash
sudo journalctl -u galena-server --since '5 min ago' | tail -20
curl -s http://127.0.0.1:3000/health
```

The health endpoint must answer `{"ok":true,...}`. "Invalid server
configuration" names the variable (never its value) — compare
`/etc/galena/galena.env` against `deploy/baremetal/.env.example`.

## 5. Web app: build once, serve as static files

On the build machine (this host is fine), build the Vite app and copy
the output to the proxy's document root:

```bash
cd /opt/galena
pnpm --filter @galena/web build
sudo cp -r apps/web/dist/. /srv/galena-web/
sudo chown -R root:root /srv/galena-web
```

`/srv/galena-web/index.html` must exist. The proxy configs below set the
same caching (hashed `/assets` for a year, never the entry point) and
security headers (CSP, nosniff, `frame-ancestors 'none'`) as the Docker
image (`apps/web/Caddyfile`). Rebuild + recopy on every update (§7).

## 6. Reverse proxy: Caddy or nginx

Pick one. Both terminate HTTPS, serve `/srv/galena-web`, and route
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
80 reachable), copy `deploy/baremetal/nginx-galena.conf` to
`/etc/nginx/sites-enabled/galena` (replace the domain and the
`ssl_certificate` paths), `nginx -t && systemctl reload nginx`.

Open only **80/tcp and 443/tcp** to the proxy. Postgres, ejabberd and
the server listen on loopback only.

## 7. First account, updating, backups

**First account.** Sign-up needs an invite: there is no
admin-creation endpoint. Mint the code the sign-up form asks for with
the invite CLI, loading the server config from `/etc/galena/galena.env`
(`set -a` exports every line the file defines; values with spaces such
as `MAIL_FROM` are double-quoted in `.env.example`, which both the shell
and systemd's `EnvironmentFile=` handle — verified with `sh` and `bash`):

```bash
cd /opt/galena/apps/server
sudo -u galena sh -c 'set -a; . /etc/galena/galena.env; ./node_modules/.bin/tsx src/auth/invite-cli.ts'
```

(If you hand-edit the file, keep quotes around any value containing
spaces: an unquoted `MAIL_FROM=Galena <…>` breaks the load and every
variable after that line stays unset.)

Open `https://chat.example.com`, sign up with your email, paste the
code. The sign-in code arrives by email (SMTP from §4). Sign-ups after
the first need an invite created the same way.

**Updating.** As `galena`: `git fetch && git checkout <new-tag>`,
`pnpm install --frozen-lockfile`, rebuild the web app and recopy
`/srv/galena-web` (§5), then `sudo systemctl restart galena-server`.
Migrations run at startup. Back up first if the install matters (§8):
`pg_dump -Fc` both databases at minimum.

**Backups.** There is no wizard for this path (the `./galena backup`
helper only drives the Docker stack). At minimum, dump both databases
nightly, tar the two file stores below, and copy the archives plus
`/etc/galena/galena.env` (live secrets — mode 0600, store encrypted)
off the machine. The env file backup matters twice for push: it holds
`PUSH_STORAGE_KEY`, and losing that key orphans every device (browsers
must re-enable push):

```bash
pg_dump -Fc -U galena -h localhost galena > "galena-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump -Fc -U ejabberd -h localhost ejabberd > "ejabberd-$(date -u +%Y%m%dT%H%M%SZ).dump"
tar -czf "ejabberd-upload-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C /var/lib/ejabberd upload
tar -czf "galena-stickers-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C /var/lib/galena stickers
chmod 600 galena-*.dump ejabberd-*.dump ejabberd-upload-*.tgz galena-stickers-*.tgz
```

Where each kind of file lives: attachments (XEP-0363) in the ejabberd
upload dir (`/var/lib/ejabberd/upload` — the `docroot` in
`deploy/baremetal/ejabberd.yml`); stickers in `/var/lib/galena`
(`STICKER_STORAGE_DIR` — set it in `/etc/galena/galena.env` to
`/var/lib/galena/stickers`, create it owned by `galena:galena`; never a
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
dirs, put the env file back, restart ejabberd and `galena-server`.
Practice the restore once before you need it.

## 8. What was and was not tested

Honestly: **none of this guide was run on a real machine.** It was
written from the Docker stack's proven configs (same modules, same
routes, same env names) and validated only as far as this macOS
workstation allows:

- `deploy/baremetal/Caddyfile` passes `caddy validate` (via
  `docker run caddy caddy validate`) — validated with the literal
  `chat.example.com` domain from the file plus `{$GALENA_DOMAIN}` /
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
- `deploy/baremetal/galena-server.service` was never checked with
  `systemd-analyze verify` (no systemd on macOS) and never booted a
  machine; the hardening directives are standard systemd options, but a
  too-strict `ProtectSystem`/`ReadWritePaths` combination fails the
  service at first start on some distributions — if it does, the unit
  logs tell you which path was denied.
- The nginx config was never tested with real traffic (`nginx -t` was
  unavailable here); treat the Caddy path as the primary one.
- The invite CLI command in §7 (`set -a; . /etc/galena/galena.env; …`)
  follows the standard Bourne idiom for loading an env file, but was never
  run against a real `/etc/galena/galena.env`; the first person to follow
  this guide should confirm the exact invocation and report back.

If you follow this guide, please report what worked and what did not —
every correction makes the next install easier.
