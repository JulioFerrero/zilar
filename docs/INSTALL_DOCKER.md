# Install Galena with Docker

Five minutes from a fresh clone to your own Galena behind HTTPS: Postgres,
ejabberd (chat), the Galena server, the web app and Caddy (automatic HTTPS)
as Docker containers. No LiteLLM ships in this stack — AI features stay off
unless you point Galena at your own gateway (see below).

What was actually tested: the full stack on `localhost` with Caddy's local
CA (see "What was tested" at the bottom). A real domain and the Coolify path
follow the documented conventions but were **not** verified live.

## The five-minute path

Prerequisites: Docker with the Compose plugin, `openssl`, `curl`.

```bash
git clone <galena-repo-url> galena
cd galena
cp deploy/.env.example deploy/.env
```

Fill in every `CHANGE_ME` in `deploy/.env`:

| Variable | How to fill it |
|---|---|
| `GALENA_DOMAIN` | Your domain, e.g. `chat.example.com`. Use `localhost` only to try it out. |
| `ACME_EMAIL` | Your email for the Let's Encrypt account. |
| `POSTGRES_PASSWORD`, `GALENA_DB_PASSWORD`, `EJABBERD_DB_PASSWORD`, `GALENA_ARCHIVE_DB_PASSWORD` | `openssl rand -hex 24` each (URL-safe). |
| `EJABBERD_ADMIN_PASSWORD` | `openssl rand -hex 24`. |
| `GALENA_XMPP_JWT_SECRET` | `openssl rand -base64 48`. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. |
| `GALENA_KEY_ENCRYPTION_KEY` | `openssl rand -base64 48`. Needed for Settings → Connections and AIs. |
| `IMAGE_OWNER` | The GitHub org/user that publishes the images (lowercase). |
| `IMAGE_TAG` | The release tag to run, e.g. `v0.1.0` (a tag `v*` is what publishes images). |

`IMAGE_OWNER`/`IMAGE_TAG` pick the published server and web images (postgres
and ejabberd always build locally from `deploy/` in the plain stack, so they
need no registry pull).

DNS first (real domain only): point an `A` record for `GALENA_DOMAIN` at the
host. Caddy cannot issue a certificate until the domain resolves to it.

Then start:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait
```

Open `https://<GALENA_DOMAIN>` and create the first account: sign up with an
email address and the invite CLI on the server container mints the invite
code the form asks for:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  exec server ./node_modules/.bin/tsx src/auth/invite-cli.ts
```

Sign-ups after the first need an invite created the same way (the inviter's
code links the two accounts as contacts).

## The Coolify path

No checkout of this repository is needed: Coolify runs everything from the
images named below, and the compose file is a lone paste.

1. In Coolify, create a Service of type **Docker Compose Empty**.
2. Paste `deploy/coolify/docker-compose.yml` as the Source Compose and save.
   The file references only images and environment variables — no bind
   mounts, no relative paths.
3. Under Configuration → Environment Variables fill every required value:
    `IMAGE_OWNER` / `IMAGE_TAG` pick the release whose images you want (all
    four `galena-*` images are published per `v*` tag by
    `.github/workflows/images.yml`); passwords are `SERVICE_PASSWORD_*`
    (generated); `XMPP_DOMAIN` / `XMPP_MUC_DOMAIN` are your domains;
    `WEB_ORIGIN` is the web app's public URL (copy it after Coolify
    generates the web domain).
4. In the Domains configuration give the `web` component your main domain,
   the `server` component an API domain, and the `ejabberd` component two
   entries (WebSocket and uploads). The compose file declares the
   `SERVICE_URL_*` variables that wire this up; adjust the hostnames after
   Coolify generates them.
5. Deploy and verify: the web app loads, sign-up works, chat connects
   (the browser devtools Network tab shows the `/xmpp-ws/ws` WebSocket as
   `101 Switching Protocols`).
6. Create the first account as above, via the server container's terminal in
   Coolify (`tsx src/auth/invite-cli.ts`).

Not verified on a live Coolify: the exact domain/ports UI mapping
(`SERVICE_URL_*` generation per component) and the multi-domain routing to
one ejabberd listener. The file follows Coolify's documented conventions
(https://coolify.io/docs/services/configuration/docker-compose); expect to
adjust domain names after Coolify parses it.

## Email (required)

Galena signs people in with a one-time code **sent by email**: there is no
password login. A production server refuses to start without a mail
transport, so fill the `MAIL_*` / `SMTP_*` variables in `deploy/.env`
before the first `up`.

Until T-0128 (SMTP mailer) is merged, the only working transport is the
development console mailer, which prints OTP codes to the server log
(`docker compose ... logs server`). That means **a real production install
cannot send sign-in emails yet** — use any SMTP provider as soon as T-0128
lands:

| Variable | What to put |
|---|---|
| `MAIL_TRANSPORT` | `smtp` once T-0128 is merged; `console` only for a local trial. |
| `SMTP_HOST` | Your provider's host, e.g. `smtp.resend.com`, `smtp.sendgrid.net`, `email-smtp.eu-west-1.amazonaws.com`. |
| `SMTP_PORT` / `SMTP_SECURE` | `587` + `false` (STARTTLS) for most providers; `465` + `true` for implicit TLS. |
| `SMTP_USER` / `SMTP_PASSWORD` | The provider's username (often `apikey`) and password or API key. |
| `MAIL_FROM` | Sender on sign-in emails, e.g. `Galena <no-reply@chat.example.com>`. |
| `MAIL_REPLY_TO` | Optional; empty means no Reply-To header. |
| `MAIL_ALLOW_CONSOLE_IN_PRODUCTION` | Scratch-only escape hatch (`true` lets the console mailer boot in production). Never on a real install. |

## Updating

Images are published per release tag. To update:

```bash
# set IMAGE_TAG to the new release in deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait
```

Migrations run at server startup, so the new server container migrates the
database itself. Back up the `postgres-data` volume first if the install
matters to you (database backups are T-0127's job; there is no script yet).

## What ports must be open

Only **80/tcp and 443/tcp** to Caddy. Postgres, ejabberd, the server and the
web app publish no host ports. The runner hub (port 3189, off by default) is
never published: runners reach it over Tailscale/WireGuard or an SSH tunnel
to the host. Outbound 443 must work for ACME (Let's Encrypt) http-01/tls-alpn
validation.

## Runners

The runner hub (port 3189, off by default) has **no public path** in this
stack: no host port is published and Caddy has no route for it. A runner on
another machine cannot reach the hub directly. Current options: run the
runner on the same host (it can reach the internal network), or give the
runner a private path to the host (Tailscale/WireGuard, SSH tunnel to
localhost:3189). The hub speaks a raw TCP tunnel protocol on its own port
(`packages/runner-tunnel/src/server.ts`: plain `WebSocketServer` on path
`/tunnel`, bound to 127.0.0.1), not HTTP on a path Caddy could route
without a dedicated port forward — so exposing it is a T-0127/monitoring
decision, not a one-line Caddy addition. `RUNNER_HUB_ENABLED` stays `false`
unless you have that private path in place.

## Troubleshooting

**Certificate not issued.** Check DNS (`dig +short <domain>` must return the
host IP), that ports 80/443 are reachable from the internet, and Caddy's
logs: `docker compose ... logs caddy`. Behind a home NAT, forward both
ports. ACME has rate limits — do not restart in a loop.

**WebSocket fails (chat never connects).** The app connects to
`wss://<domain>/xmpp-ws/ws`. In devtools → Network, look for that request:
a `101` is success; a `404` means Caddy routed it to the web app instead of
ejabberd; a `502/503` means ejabberd is down (`docker compose ... ps`,
`... logs ejabberd`). `ejabberdctl status` inside the container must answer.

**ejabberd unhealthy.** It waits for Postgres (`depends_on: service_healthy`).
Check `docker compose ... logs postgres ejabberd`. A wrong
`EJABBERD_DB_PASSWORD` shows as SQL auth failures; changing any `*_PASSWORD`
after the first start needs a volume reset (`down -v` wipes everything) to
stay consistent with the databases already created.

**Server exits with "Invalid server configuration".** A required variable is
missing or too short (the message names it, never its value). Compare
`deploy/.env` against `deploy/.env.example` line by line.

**Server refuses production without email.** `NODE_ENV=production` needs a
real mail transport (`MAIL_TRANSPORT=smtp`, landing in T-0128). Until then,
a production install cannot send sign-in emails — see "Email (required)"
above. For a local trial only, run the server with `NODE_ENV=development`
so the console mailer prints OTP codes to the server log.

**Uploads fail.** The app PUTs files to `https://<domain>/upload/<slot>/<file>`
(XEP-0363 slot URLs from ejabberd). Caddy proxies `/upload/*` to ejabberd
with the path intact — the strip that used to be here broke every slot URL
and is gone; a bare `404` with ejabberd's HTML body means the slot expired
or never existed, while a Caddy-level failure would be a `502/503`. Check
`docker compose ... logs ejabberd` for `mod_http_upload` errors. Proved in
the install test: slot request → `put`/`get` URLs under
`https://localhost/upload/...`, `PUT` → `201 Upload successful.`, `GET` →
the bytes back.

**Sign-up asks for an invite.** By design: create one with the invite CLI
above.

## What was tested

T-0126 install test, `GALENA_DOMAIN=localhost`, Caddy on host 18080/18443,
scratch project `galena-installtest`, throwaway secrets: all 5 services
`healthy` via `up -d --wait`; `curl -k https://localhost:18443/health` →
server JSON `ok:true`; `/` → 200 Galena HTML with CSP headers; `/api/me` →
401; `/xmpp-ws/ws` → `101 Switching Protocols` with an XMPP `<open>` frame
answered; full upload round-trip through Caddy (slot request over the
XMPP WebSocket → `put`/`get` URLs under `https://localhost/upload/...` →
`PUT` → `201 Upload successful.` → `GET` → the bytes back); full OTP sign-up + invite flow through Caddy ending in a JWT with
`service=wss://localhost/xmpp-ws/ws`. There is no `/ejabberd-api/*` route:
the server talks to ejabberd directly on the internal network. A real
domain (ACME issuance) and the Coolify path were NOT verified live. The
proof used a scratch-only mailer patch (see the T-0126 Report); real
production email needs T-0128.
