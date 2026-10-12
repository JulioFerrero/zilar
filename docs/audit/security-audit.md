# Security audit: auth, sessions, keys, uploads, push, AI, deploy (2026-10-11)

Docs only. Read from `main` at `32fa1f0d8`. Every finding is marked
**confirmed by code** (I read the lines cited) or **suspected (check: …)**.
No secret was found in git: the only tracked env-like files are the four
`.env.example` files, and a grep for key-shaped literals found nothing.
The public-route sweep (`apps/server/src/authz-sweep.test.ts:14-28`) keeps
every `/api` route behind `Session` except the six allowlisted ones; the
findings below are about what happens *after* the session check.

## 1. Summary

| Id | Sev | Component | One line |
| --- | --- | --- | --- |
| SEC-1 | P1 | Uploads / files proxy | Sender-declared mime decides inline display; an `.svg` is served inline on the app origin (`/api/files`, and `/upload/*` directly) with no CSP of its own: same-origin script execution for anyone who opens the link. |
| SEC-2 | P1 | Edge / ejabberd | `/xmpp-ws/*` strips its prefix and proxies to ejabberd's whole HTTP listener, so ejabberd's admin REST API (`/api`, `mod_http_api`) is reachable from the Internet behind one basic-auth password. |
| SEC-3 | P1 | Uploads | `/upload/<slot>/<name>` is public, never expires, CORS `*`; a leaked URL is the file, and a retracted message does not delete it (open since T-0452). |
| SEC-4 | P1 | Archive reader role | `zilar_archive` gets `SELECT` on *every* table ejabberd creates (`users` with the admin password, rosters, rooms, push sessions), not only `archive`; the comment that says otherwise is wrong. |
| SEC-5 | P2 | Deploy | Push component secret defaults to the same public placeholder on both sides, so the handshake *succeeds* with a known secret; ejabberd's 5222 (no STARTTLS) and 5347 are open to the Compose network. |
| SEC-6 | P2 | Rate limits | Coolify compose never sets `TRUSTED_PROXY_HOPS`, so every per-IP limiter (setup, join, invite preview) keys on Traefik's address: one shared bucket, lockable by anyone. |
| SEC-7 | P2 | Rate limits | No budget on `POST /api/invites`, `PATCH /api/me`, `POST /api/groups`, `GET /api/avatars/:id`; the first three hit ejabberd or mint sign-up capability. |
| SEC-8 | P2 | Avatars / backgrounds | Any signed-in user can fetch any avatar or background by id (no membership check; documented in code). |
| SEC-9 | P2 | Headers | No HSTS anywhere; CSP/nosniff only exist in the web container's Caddy, so the plain-Caddy stack serves `/api/*` and `/upload/*` with no security headers. |
| SEC-10 | P2 | Config | `LITELLM_MASTER_KEY` defaults to the literal `@empty@`, which passes the non-empty check, so the server believes a gateway is configured. |
| SEC-11 | P2 | Auth | Better Auth's own logger is disabled, hiding its security warnings (rate-limit IP fallback, invalid origin). |
| SEC-12 | P2 | Admin model | "Owner" is whoever has the oldest `user` row, not a stored flag; first-run setup is a race until the first account exists. |
| SEC-13 | P2 | AI / tools | A group member can make another member's AI spend that owner's provider key and approved web hosts (by design, but with no per-caller budget). |
| SEC-14 | P2 | Keys at rest | Settings cipher falls back to a key derived from `BETTER_AUTH_SECRET`, so one secret unlocks sessions *and* stored provider keys when `ZILAR_KEY_ENCRYPTION_KEY` is unset. |
| SEC-15 | P2 | Sessions | Accepted trade-offs to keep in mind: revoked sessions read for up to 5 min (cookie cache), and sign-in reveals whether an email has an account. |

Counts: P0 0, P1 4, P2 11.

What is in good shape (confirmed by code): invite codes are 16 random
bytes consumed by one conditional `UPDATE` (`apps/server/src/auth/invites.ts:26-28,89-105`);
OTP is 6 digits, hashed, 10 min, 5 attempts, 3 sends/min
(`apps/server/src/auth/auth.ts:16-18,81-84,113-117`); cookies are httpOnly,
SameSite=Lax, Secure in production (`auth.ts:101-111`); writes bypass the
session cache so a revoked session cannot write (`apps/server/src/effect/http-core.ts:37-42`);
the edge rejects unsafe cross-origin requests and CORS is limited to
`WEB_ORIGINS` (`apps/server/src/effect/edge.ts:117-119,161-170`); the mobile
token lives in SecureStore (`apps/mobile/src/auth/secure-session-storage.ts:19-31`);
XMPP JWTs are HS256, `jid`+`iat`+`exp`, 300 s, capped at 600 s, 120 per
10 min per user (`apps/server/src/xmpp/token.ts:9,40-44`, `apps/server/src/xmpp/api.ts:22-27`);
ejabberd forces JWT for every non-admin account, no in-band registration,
rooms members-only and admin-created (`deploy/ejabberd/ejabberd.yml:78-80,139-147,214-219,288-289`);
the JWK is written with `umask 077` and the admin password never hits the
log (`deploy/ejabberd/jwt-entrypoint.sh:38-41,48-86`); every archive query
uses `$n` placeholders (`apps/server/src/search/archive-query.ts:4-24`,
`apps/server/src/push/archive-scan.ts:15-28`); the GIF proxy, sandbox and
web tools resolve DNS, reject private ranges and pin the socket to the
resolved address (`apps/server/src/gifs/routes.ts:62-67`,
`apps/server/src/sandbox/host-fetch.ts:109-114,141`,
`apps/server/src/web-tools/guarded-fetch.ts:177-182`); `/api/files` only
forwards paths under `/upload/` on the public origin
(`apps/server/src/voice-transcription/routes.ts:154-164`); push preview
checks the caller's archives and answers one uniform 404
(`apps/server/src/push/api-handlers.ts:154-178`); the socket-address header
is deleted and re-set from the real socket (`apps/server/src/effect/edge-request.ts:193-194`);
the logger redacts cookies, auth headers and the secret env names
(`apps/server/src/logger.ts:4-26`); AI memory refuses secret-looking text
(`apps/server/src/agents/memory/secrets.ts:7-16`).

## 2. Findings by sub-area

### 2.1 Uploads and files

**SEC-1 (P1, confirmed by code; live effect suspected).** `GET /api/files`
streams the ejabberd file with the upstream `content-type` and sets
`content-disposition: attachment` only when the indexed `kind === 'file'`
(`apps/server/src/files/api.ts:125-147,283-291`). The kind and mime come
from the sender's message payload (`apps/server/src/media/extract.ts:133-138`),
so a sender declares `kind: image` for an `.svg` upload and ejabberd serves
it as `image/svg+xml` (stock `content_types`; `deploy/ejabberd/ejabberd.yml:233-239`
sets none). The route adds `nosniff` but no CSP (`files/api.ts:141-142`),
unlike the avatar route (`apps/server/src/avatars/api.ts:180`). A victim who
opens the file URL top-level runs the SVG's script on the app origin with
the session cookie: it can call every `/api` route and mint an XMPP token.
The web client only uses `/api/files` for downloads (`apps/web/src/components/FileMessage.tsx:28,61-64`),
but a plain link in a message, or the public `/upload/...` URL, is enough.
In the Coolify stack the web container's CSP (`script-src 'self'`,
`apps/web/Caddyfile:23`) may block it *if* Caddy applies that header to
proxied responses; the plain-Caddy stack has no CSP on `/api/*` or
`/upload/*` at all (`deploy/caddy/Caddyfile:21-23,42-44`).
Check: upload an `.svg` with a script, open it through both paths, and
`curl -I` for the CSP header. Fix: in `files/api.ts` allow inline only for
an allowlist of raster image, video and audio types, force `attachment` for
everything else, and set `content-security-policy: default-src 'none';
sandbox` on every reply; add the same two headers for `/upload/*` in both
Caddyfiles. Test: a `.svg` row answers with `attachment` and the CSP.

**SEC-3 (P1, confirmed by code).** `/upload/*` goes straight to ejabberd in
both stacks (`deploy/caddy/Caddyfile:42-44`, `apps/web/Caddyfile:55-56`),
`mod_http_upload` has no `access` rule and sends `Access-Control-Allow-Origin: *`
(`deploy/ejabberd/ejabberd.yml:233-239`), and quota is the only deletion
(`max_days` unset, lines 241-251). Whoever holds a URL reads the file,
forever, from any origin. `docs/audit/upload-auth-plan.md` (T-0452) already
describes the lock-down; only the `/api/files` proxy (T-0454) landed.
Smallest fix: keep the proxy as the only reader and stop proxying `/upload/*`
GETs at the edge (allow `PUT`/`OPTIONS` only, since the PUT is the slot
upload); mobile and web already have the chat JID for `/api/files`. Then
drop the `*` CORS header.

### 2.2 Edge, ejabberd and deploy

**SEC-2 (P1, confirmed by code).** Both edges do `uri strip_prefix /xmpp-ws`
then `reverse_proxy ejabberd:5280` (`apps/web/Caddyfile:50-52`,
`deploy/caddy/Caddyfile:34-37`). ejabberd's listener serves `/ws`, `/upload`
and `/api: mod_http_api` on that same port (`deploy/ejabberd/ejabberd.yml:91-97`),
so `https://<domain>/xmpp-ws/api/<command>` reaches the admin REST API from
the Internet. It is gated by basic auth as `admin@<domain>` with
`what: '*'` minus start/stop (`ejabberd.yml:162-174`), the password is the
Coolify-generated `SERVICE_PASSWORD_EJABBERDADMIN`, and ejabberd applies no
lockout to HTTP-API auth. The comment at `ejabberd.yml:163-165` believes
only the server can reach it. Fix: in both Caddyfiles, replace
`handle /xmpp-ws/*` with `handle /xmpp-ws/ws` (exact) plus `uri replace`,
or add `handle /xmpp-ws/api/* { respond 404 }` before it; and in
`ejabberd.yml` move `/api` to a second listener bound to the server-only
network or add `ip:` restrictions under `api_permissions`. Add a deploy test
in `deploy/tests` that `GET /xmpp-ws/api/status` answers 404.

**SEC-5 (P2, confirmed by code).** `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` and
`PUSH_COMPONENT_SECRET` both default to `CHANGE_ME_PUSH_COMPONENT_SECRET`
(`deploy/coolify/docker-compose.app.yml:96,202`, same in
`deploy/coolify/docker-compose.yml:84,186` and `deploy/docker-compose.yml:90,193`).
The comment says the handshake fails with the placeholder; it succeeds
because the sides match. The component listener (5347) and c2s (5222,
`starttls_required: false`) bind `0.0.0.0` (`ejabberd.yml:83-89,105-116`);
nothing publishes them, but any container on the same Docker network can
reach them, and Coolify's shared `coolify` network is one toggle away.
`deploy/zilar:668` (doctor) flags the placeholder only for the plain stack.
Fix: drop the `:-CHANGE_ME…` defaults on the two server/ejabberd lines
(Coolify generates `SERVICE_PASSWORD_PUSHCOMPONENT`), and make
`apps/server/src/push/config.ts` refuse to start the component when the
secret equals the placeholder (today it does not check,
`apps/server/src/push/component.ts:16-17,43`).

**SEC-9 (P2, confirmed by code).** No `Strict-Transport-Security` in
`deploy/caddy/Caddyfile`, `apps/web/Caddyfile` or the docs (grep empty).
Security headers live only in the web container (`apps/web/Caddyfile:19-26`);
the plain stack routes `/api/*`, `/health` and `/upload/*` around it
(`deploy/caddy/Caddyfile:21-29,42-44`). Fix: a `header` block with HSTS
(`max-age=31536000; includeSubDomains`), nosniff and `frame-ancestors 'none'`
in `deploy/caddy/Caddyfile`, and HSTS in `apps/web/Caddyfile` (Traefik
terminates TLS, the header still travels).

**SEC-10 (P2, suspected; check: Coolify's handling of `@empty@`).**
`LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:-@empty@}`
(`deploy/coolify/docker-compose.app.yml:171`) meets
`Schema.optional(nonEmptyStringSchema)` (`apps/server/src/config.ts:131`), so
`config.LITELLM_MASTER_KEY !== undefined` everywhere it is tested
(`apps/server/src/main.ts:550-581`, `apps/server/src/app.ts:560`): the
`AisConfigured` gate opens and the key literal is sent as a bearer to
`http://127.0.0.1:9`. Not a leak, but a wrong "configured" state. Fix: add
`LITELLM_MASTER_KEY` to `EMPTY_MEANS_UNSET_KEYS` (`config.ts:401-409`) and
change the compose default to an empty string.

### 2.3 Database roles

**SEC-4 (P1, confirmed by code).** `20-search-reader.sql:51` runs
`ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd IN SCHEMA public GRANT SELECT ON
TABLES TO zilar_archive`: every table ejabberd creates on first boot
(`update_sql_schema: true`, `ejabberd.yml:62`) is readable by the search
role, including `users` (ejabberd stores SQL passwords in plain form unless
`auth_password_format: scram` is set, and `ejabberd.yml` does not set it; the
admin account uses SQL auth, lines 78-80,139-141), `rosterusers`, `muc_room`,
`push_session`, `private_storage`. The header comment (lines 4-6) promises
the opposite. The server builds every archive query in code with
placeholders, so this needs a second bug to exploit, but the whole point of
the role is to bound that blast radius. Fix: create the `archive` table at
init from ejabberd's `pg.sql` (`deploy/postgres/Dockerfile`) so the direct
`GRANT SELECT ON public.archive` (line 49) always runs, and delete line 51;
add `auth_password_format: scram` to `ejabberd.yml`. Test: a
`deploy/tests` check that `zilar_archive` cannot `SELECT` from `users`.

### 2.4 Rate limits and abuse

**SEC-6 (P2, confirmed by code).** `TRUSTED_PROXY_HOPS` defaults to 0
(`apps/server/src/config.ts:175-183`) and is absent from
`deploy/coolify/docker-compose.app.yml:128-214`, so `clientIpFrom` returns
the socket address, which behind Traefik is Traefik
(`apps/server/src/setup/api.ts:101-110`; the join and invite-preview
limiters share the helper). Five setup attempts from anyone lock first-run
setup for ten minutes for everyone; the same for joins. Fix: set
`TRUSTED_PROXY_HOPS: 1` in the Coolify compose and document it in
`docs/SERVER_CONFIG.md`. Better Auth's own limiter is separate: it reads a
single-entry `x-forwarded-for` and otherwise falls back to one shared
bucket (`@better-auth/core` `utils/ip.mjs:190-193,196-217`), which Traefik
satisfies; it is fine on Coolify, but see SEC-11.

**SEC-7 (P2, confirmed by code).** No limiter on `createInvite`
(`apps/server/src/auth/api.ts:121-131`; the contract group declares only
`Session`, `packages/api-contract/src/auth.ts:92-93`), so one account mints
unlimited one-use sign-up codes; none on `patchMe`, which refreshes the
nickname in every contact's roster through ejabberd (`auth/api.ts:107-120,165-171`);
none on group create (`apps/server/src/groups/api.ts:67-91` builds only the
role and join limiters; the contract limits only `changeRole` and `join`,
`packages/api-contract/src/groups.ts:174,201`), which creates a MUC room;
none on `GET /api/avatars/:id` (`avatars/api.ts:165-187`). Fix: three
`makeRateLimit` middlewares in the contract (invites 10/day, me 10/10 min,
groups create 20/h) and an in-handler limiter for avatar reads.

### 2.5 Authorization

**SEC-8 (P2, confirmed by code).** `GET /api/avatars/:id` serves any avatar
to any signed-in user; the code says so (`apps/server/src/avatars/api.ts:159-164`).
Backgrounds follow the same shape (`apps/server/src/backgrounds/api.ts:125-133`).
Ids are UUIDs, so this is capability-by-URL, acceptable for user pictures
and weak for private-group pictures. Fix later: for `kind = group`, check
membership before serving (`avatars/service.ts` already has the owner
lookup).

**SEC-12 (P2, confirmed by code).** `isOwner` is `ORDER BY created_at ASC,
id ASC LIMIT 1` over `user` (`apps/server/src/integrations/routes.ts:71-77`);
the same rule gates mail, Telegram, email integration and transcription
settings. Deleting or re-creating the first user silently moves ownership.
First-run `POST /api/setup` is public until a user exists
(`apps/server/src/setup/api.ts:134-140`): the first HTTP client wins. Fix:
an `instance_settings` row `owner_user_id` written by setup, read by
`isOwner`; document "run setup right after deploy".

**SEC-13 (P2, confirmed by code, impact by design).** Room turns offer the
AI's tools to any member who mentions it (`apps/server/src/agents/group-turn.ts:57-61,169`);
tool visibility is gated by topic visibility, not by who pays
(`apps/server/src/tools/access.ts:97-114`). The owner's LiteLLM virtual key
and approved hosts are spent on another member's prompt. Fix when it
matters: a per-AI daily budget in `apps/server/src/ais/usage.ts` and a
"members may use tools" switch per group.

### 2.6 Auth, sessions and keys

**SEC-11 (P2, confirmed by code).** `logger: { disabled: true }`
(`apps/server/src/auth/auth.ts:75`) silences Better Auth, including the
"rate limiting fell back to a single shared bucket" warning
(`better-auth/dist/api/rate-limiter/index.mjs:240-243`) and "Invalid origin"
errors. Fix: pass a pino-backed logger object with `warn`/`error` only.

**SEC-14 (P2, confirmed by code).** `settingsCipherFor` uses
`ZILAR_KEY_ENCRYPTION_KEY ?? BETTER_AUTH_SECRET` (`apps/server/src/setup/settings.ts:34`,
`apps/server/src/setup/crypto.ts:3-5`). The Coolify compose sets both
(`docker-compose.app.yml:140,152`), so this only bites installs that drop
the key; then the auth secret alone decrypts the Resend key and transcription
key. Fix: refuse to start in production without `ZILAR_KEY_ENCRYPTION_KEY`
(the connections module already does), or log one loud warning.

**SEC-15 (P2, confirmed by code, accepted).** Session cookie cache 5 min
for reads (`auth.ts:88-99`); unknown email without invite answers 403
`invite_required`, revealing account existence (`auth.ts:157-170`, accepted
by Julio in T-1104). No change needed; listed so nobody re-audits them.

### 2.7 Checked and clean

Push: VAPID and FCM come from env, push stays off without
`PUSH_STORAGE_KEY` (`apps/server/src/push/config.ts:67,255-256`), stored
subscriptions are AES-GCM under an HKDF label (`push/crypto.ts:7,29`), the
preview route returns text only to a recipient of that message. Setup and
provider keys: AES-256-GCM envelopes with distinct labels
(`apps/server/src/kdf-labels.ts:6-7`, `connections/crypto.ts:33`); views never
return the encrypted key (`connections/api.ts:78`). Logging: request lines
carry a masked path and ids only (`edge.ts:129-140`); OTP reaches the log
only with the console transport, blocked in production unless
`MAIL_ALLOW_CONSOLE_IN_PRODUCTION` (`config.ts:192-220`). Pins, tools,
files, media, search and push preview all resolve the caller's archives
from server tables (`apps/server/src/search/service.ts:77-130`,
`apps/server/src/pins/access.ts:53-103`). Directory lists groups, not
people, and carries no email (`packages/api-contract/src/directory.ts:25-35`).
The sandbox runs tool code in QuickJS inside a worker, not `node:vm`
(`apps/server/src/sandbox/tool-worker-vm.ts:1-8`, `run-tool.ts:161-169`).
Nothing in the server trusts a client-side check for authorization.

## 3. Fix plan (impact first, then size)

1. **F1 (SEC-1 + SEC-9, small).** `apps/server/src/files/api.ts`: inline
   allowlist (`image/png|jpeg|gif|webp`, `video/mp4`, `audio/*`), `attachment`
   otherwise, `content-security-policy: default-src 'none'; sandbox` on
   every reply. Both Caddyfiles: HSTS, nosniff and that CSP on `/upload/*`.
   One test in `files/routes.test.ts`: an `image/svg+xml` row answers
   `attachment` and the CSP header.
2. **F2 (SEC-2, small).** `apps/web/Caddyfile` and `deploy/caddy/Caddyfile`:
   route only `/xmpp-ws/ws` to ejabberd (404 for the rest); `ejabberd.yml`:
   `/api` on a separate listener or `ip`-restricted. Deploy test: `GET
   /xmpp-ws/api/status` is 404.
3. **F3 (SEC-4, small).** `deploy/postgres/init/20-search-reader.sql`: drop
   the default-privileges line, create `archive` from ejabberd's `pg.sql` at
   init so the direct grant runs; `auth_password_format: scram` in
   `ejabberd.yml`. Test: `zilar_archive` cannot read `users`.
4. **F4 (SEC-6 + SEC-10 + SEC-5, small).** `deploy/coolify/docker-compose.app.yml`:
   `TRUSTED_PROXY_HOPS: 1`, empty `LITELLM_MASTER_KEY` default, no placeholder
   default for the push secret; `config.ts`: `LITELLM_MASTER_KEY` in
   `EMPTY_MEANS_UNSET_KEYS`; `push/config.ts`: refuse the placeholder.
5. **F5 (SEC-7, small).** Rate-limit tags for invites, `PATCH /me` and group
   create in `packages/api-contract/src/middleware.ts` plus the three layers;
   in-handler limiter for avatar reads. One test per limiter (429 on the
   N+1th call).
6. **F6 (SEC-3, medium).** Stop proxying `GET /upload/*` at both edges
   (keep `PUT`/`OPTIONS`), remove the `*` CORS header, and make mobile load
   attachments through `/api/files` where it still uses the raw URL. Follow
   `docs/audit/upload-auth-plan.md`.
7. **F7 (SEC-11 + SEC-14, small).** Pino-backed logger for Better Auth;
   production refuses to boot without `ZILAR_KEY_ENCRYPTION_KEY`.
8. **F8 (SEC-12 + SEC-8 + SEC-13, medium, later).** Stored owner id written
   by setup; membership check for group avatars; per-AI budget and a group
   switch for member tool use.
