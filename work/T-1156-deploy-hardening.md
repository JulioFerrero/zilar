---
id: T-1156
title: "Security wave 2 (SEC-2, SEC-4, SEC-5/6/10): Caddy proxies only /xmpp-ws/ws to ejabberd (admin /api no longer public), security headers on /upload, search role reads only the archive, Coolify compose sets TRUSTED_PROXY_HOPS and drops unsafe placeholder defaults"
status: merged
milestone: M5
branch: task/T-1156-deploy-hardening
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1156: Deploy hardening

## Spec (written by Claude, do not edit)

### Why
`docs/audit/security-audit.md` SEC-2, SEC-4, SEC-5, SEC-6 and SEC-10, and fixes **F2**, **F3** and **F4** (section 3). Julio OK'd wave 2 on 2026-10-11.
- **SEC-2**, verified by the lead: `apps/web/Caddyfile:50-52` strips `/xmpp-ws` and proxies **any** path to `ejabberd:5280`. That listener serves `/api` (`mod_http_api`, `deploy/ejabberd/ejabberd.yml:91-97`), so ejabberd's admin REST API is reachable from the internet behind one admin password. `deploy/caddy/Caddyfile` has the same route; find it and cite it.
- **SEC-4:** `deploy/postgres/init/20-search-reader.sql:51` grants the search role SELECT on **every future** ejabberd table, not just `archive`.
- **SEC-6, SEC-10 and SEC-5:** see the audit for the exact lines in `deploy/coolify/docker-compose.app.yml`, `apps/server/src/config.ts` (507 lines: add **at most 2 lines**) and `apps/server/src/push/config.ts`.

### What to build
1. **Caddy** (`apps/web/Caddyfile`, `deploy/caddy/Caddyfile`):
   - proxy **only** `/xmpp-ws/ws` (the WebSocket) to ejabberd, keeping the same upstream and the strip;
   - every other `/xmpp-ws/*` path answers 404;
   - add `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and HSTS to `/upload/*` responses, as the audit's F1 says.
   - Check that the web client's XMPP URL is exactly `/xmpp-ws/ws` (find where the web and mobile build the WebSocket URL, and cite it in the Report). If it's another path, keep that path instead and say so.
   - **Don't change `ejabberd.yml` in this task:** two other tasks (T-1151, T-1155) edit it now.
2. **The search role** (`deploy/postgres/init/20-search-reader.sql`):
   - remove the default-privileges grant on future tables;
   - keep the direct `SELECT` on `archive`, making it run at init as the audit's F3 says;
   - fix the file's wrong comment;
   - write the production repair as a short `REVOKE` / `GRANT` block in the Report, under a heading "Run on production (Julio)". The lead will hand it to Julio for the Coolify terminal. Do not run anything on production.
3. **Compose and config** (audit F4):
   - `deploy/coolify/docker-compose.app.yml`: add `TRUSTED_PROXY_HOPS` with the right value for Coolify's chain. The production request path is Traefik, then the web Caddy, then the server. Read how the server parses `X-Forwarded-For` with `TRUSTED_PROXY_HOPS` (`apps/server/src/config.ts:175`, `apps/server/src/invite-links/api.ts:128`) and write the derivation in the Report;
   - an empty `LITELLM_MASTER_KEY` default;
   - no placeholder default for the push component secret;
   - `config.ts`: `LITELLM_MASTER_KEY` goes in `EMPTY_MEANS_UNSET_KEYS`, at most 2 lines;
   - `push/config.ts`: refuse the `CHANGE_ME_PUSH_COMPONENT_SECRET` placeholder (push off, with a clear log line).
   - Apply the same compose changes to `deploy/coolify/docker-compose.yml` and `deploy/docker-compose.yml` where the same keys exist.
4. **Tests** (permissions and keys), at most 2:
   - `apps/server/src/push/config.test.ts` (find or create it): the placeholder secret gives push off;
   - if the server has a test for the `X-Forwarded-For` hop parsing, add the Coolify case; otherwise skip it.

### Read first
`AGENTS.md`, `docs/audit/security-audit.md` (SEC-2, SEC-4, SEC-5, SEC-6, SEC-10, F2 to F4), `apps/web/Caddyfile`, `deploy/caddy/Caddyfile`, `deploy/postgres/init/20-search-reader.sql`, `deploy/coolify/docker-compose.app.yml`, `apps/server/src/config.ts:160-200` and `apps/server/src/push/config.ts`.

### Allowed files
`apps/web/Caddyfile`, `deploy/caddy/Caddyfile`, `deploy/postgres/init/20-search-reader.sql`, `deploy/coolify/docker-compose.app.yml`, `deploy/coolify/docker-compose.yml`, `deploy/docker-compose.yml`, `apps/server/src/config.ts`, `apps/server/src/push/config.ts`, `apps/server/src/push/config.test.ts`, `work/T-1156-deploy-hardening.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/config.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check on production after the deploy:**
  - `curl -s -o /dev/null -w "%{http_code}" https://chat.zilar.app/xmpp-ws/api/status` returns 404;
  - web chat still connects;
  - Julio runs the REVOKE block.

---

## Report (written by the worker when done)

### What I did
1. **Caddy (SEC-2, F1):** `apps/web/Caddyfile` and `deploy/caddy/Caddyfile` now proxy
   **only** the exact path `/xmpp-ws/ws` to `ejabberd:5280` (same upstream, same
   `strip_prefix`); every other `/xmpp-ws/*` path answers `404`, so ejabberd's
   admin REST API (`/api`, `mod_http_api` on the same `:5280` listener,
   `deploy/ejabberd/ejabberd.yml:94-97`) is no longer reachable from the
   internet. The same overly-broad route the lead cited exists at
   `deploy/caddy/Caddyfile:34-37` (now fixed). Both `/upload/*` handles gained
   `X-Content-Type-Options: nosniff`,
   `Content-Security-Policy: default-src 'none'; sandbox` and HSTS
   (`max-age=31536000; includeSubDomains`).
2. **Search role (SEC-4, F3):** `deploy/postgres/init/20-search-reader.sql` no
   longer grants default privileges on future tables; the conditional direct
   `GRANT SELECT ON public.archive` stays, and the comment that presented the
   blanket grant as intended now states the reader sees only `archive`.
3. **Compose + config (SEC-5/6/10, F4):**
   - `deploy/coolify/docker-compose.app.yml`: added `TRUSTED_PROXY_HOPS: 2`
     (derivation below); `LITELLM_MASTER_KEY` default is now empty (unset);
     both push-secret lines dropped the `:-CHANGE_ME_PUSH_COMPONENT_SECRET`
     default (unset stays empty).
   - Same LITELLM + push-secret changes applied to
     `deploy/coolify/docker-compose.yml` and `deploy/docker-compose.yml`
     where those keys exist (`TRUSTED_PROXY_HOPS` exists in neither, so it
     went only into the app file; the plain stack has a different proxy
     depth anyway — see open questions).
   - `apps/server/src/config.ts` (1 line): `LITELLM_MASTER_KEY` added to
     `EMPTY_MEANS_UNSET_KEYS`, so an empty compose value decodes to
     `undefined` and the AI gateway stays off.
   - `apps/server/src/push/config.ts`: `pushConfigError` treats
     `CHANGE_ME_PUSH_COMPONENT_SECRET` as missing, so with the placeholder
     push stays off — `main.ts` logs its usual `push stays off` line naming
     `PUSH_COMPONENT_SECRET` (value never echoed) and the routes answer 503.
4. **Tests:** created `apps/server/src/push/config.test.ts` (2 tests):
   placeholder secret yields an error naming `PUSH_COMPONENT_SECRET`; a real
   secret yields no error. The X-Forwarded-For Coolify case was **skipped**:
   the hop-parsing test lives in `apps/server/src/invite-links/invite-links.test.ts`
   (outside my Allowed files), and its existing vectors already assert the
   N=2 semantics the Coolify chain needs
   (`trustedClientIp('203.0.113.7, 10.0.0.1', 2)` returns the client,
   lines 624-636).

### XMPP WebSocket URL (spec check)
Neither app hardcodes the path: both use the `service` URL from
`POST /api/xmpp/token` (`apps/server/src/xmpp/api.ts:89`, from
`XMPP_WS_PUBLIC_URL`; web calls it at `apps/web/src/lib/api/chats.ts:94`,
mobile types it at `apps/mobile/src/lib/chat-api.ts:49` /
`chat-api-schemas.ts:141`). All three compose files set it to
`wss://<domain>/xmpp-ws/ws` (`docker-compose.app.yml:150`,
`coolify/docker-compose.yml:134`, `docker-compose.yml:136`; default
`ws://127.0.0.1:5280/ws` in `apps/server/src/xmpp/config.ts:49-52`; mock
backend `wss://mock.zilar.test/xmpp-ws/ws`). So `/xmpp-ws/ws` is the exact
path to keep — no other client path exists.

### TRUSTED_PROXY_HOPS derivation (spec: Coolify chain is Traefik, then the web Caddy, then the server)
`trustedClientIp` returns the Nth address from the **right**
(`apps/server/src/http/client-ip.ts:12-24`); `clientIpFrom` uses it for N > 0
and the socket address otherwise (`client-ip.ts:34-42`, read by the join and
setup limiters). Traefik appends the client (`X-Forwarded-For: client`), the
web Caddy appends Traefik (`client, traefik-ip`). N=2 selects the client; N=1
would select Traefik's address (the same shared-bucket bug one hop over) and
N=0 the web-Caddy socket. So the right value is **2**, not the audit's
sketched 1 (which assumed the server sits directly behind Traefik).
`docs/SERVER_CONFIG.md:218` agrees: "set it to the number of proxies in front
of the server". A forged left-most entry is never selected
(`invite-links.test.ts:632`).

### Run on production (Julio)
The production volume already ran the old init script, so the default
privilege is stored. In the Coolify terminal, against the **ejabberd**
database as the `postgres` superuser:
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd IN SCHEMA public REVOKE SELECT ON TABLES FROM zilar_archive;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM zilar_archive;
GRANT SELECT ON public.archive TO zilar_archive;
```
This removes future-table and already-granted access, then restores exactly
the one grant search needs. Re-running it is harmless.

### Commands (real results)
- `pnpm install`: done, 11.3s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/config.test.ts`: 2 passed.
- Same runner on `src/push/fcm-token.test.ts src/push/api-subscribe.test.ts` (neighbors that load push config): 13 passed.
- `pnpm gate`: `GATE PASS` — PASS install / format / lint / typecheck /
  effect / tests @zilar/server; SKIP tests @zilar/web (no nearby test
  files); "scope: every changed file is inside the Allowed files".

### Deviations, problems, open questions
- **F3 remainder (needs a lead decision):** the audit's full F3 also creates
  `archive` at init from ejabberd's `pg.sql` via `deploy/postgres/Dockerfile`
  so the direct GRANT always runs — that file is outside my Allowed files, so
  I did not do it. Effect: on a **fresh** volume `archive` still does not
  exist at init and the reader needs the documented manual GRANT after first
  ejabberd boot (same step `SERVER_CONFIG.md` already prescribes for existing
  volumes). Production (existing volume) is fully covered by the block above.
- **Same flaws left in files outside my scope (not touched):**
  `infra/postgres/init/20-search-reader.sql` and
  `deploy/baremetal/setup-postgres.sql` still carry the default-privileges
  grant; `deploy/baremetal/Caddyfile:49-50` and
  `deploy/baremetal/nginx-zilar.conf:85-86` still proxy all of `/xmpp-ws/`;
  `deploy/ejabberd/ejabberd.yml:24` still defaults the push macro to the
  placeholder (owned by T-1151/T-1155; harmless now that the server refuses
  it); `docs/SERVER_CONFIG.md:80-81` still documents the old
  `ALTER DEFAULT PRIVILEGES` manual step.
- `ZILAR_KEY_ENCRYPTION_KEY: ${...:-@empty@}` in `deploy/docker-compose.yml:138`
  left alone (SEC-14, not in this task).
- The plain stack got no `TRUSTED_PROXY_HOPS` (key absent there; its path is
  client → Caddy → server, i.e. 1). Suggest the lead confirm `1` belongs in a
  follow-up.
- Security checklist: no secrets read/logged/committed; the placeholder is
  refused by name only, never echoed; unknown `/xmpp-ws/*` paths now 404 like
  any unknown route; no new routes, no permission or cap changes.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits and 4 follow-ups.**
- **Caddy, both edges:** only `/xmpp-ws/ws` reaches ejabberd; the rest of `/xmpp-ws/*` answers 404. `/upload/*` gets nosniff, the sandbox CSP and HSTS.
- **The client path:** every client uses `wss://<domain>/xmpp-ws/ws`, checked by the worker in the compose `XMPP_WS_URL`.
- **`TRUSTED_PROXY_HOPS: 2`:** Traefik adds the client, the web Caddy adds Traefik, and `trustedClientIp` picks the Nth from the right. The lead checked this derivation.
- **Placeholders:** none for the push secret (Coolify sets `SERVICE_PASSWORD_PUSHCOMPONENT`), and the server refuses the placeholder. `LITELLM_MASTER_KEY` is empty-means-unset.
- **The search role:** default privileges dropped in the init file. Production needs the REVOKE block in the Report; the lead hands it to Julio.
- **Follow-ups:**
  - baremetal Caddy and nginx still proxy all of `/xmpp-ws/`;
  - the infra and baremetal search-reader grants;
  - the fresh-volume archive grant;
  - `TRUSTED_PROXY_HOPS` for the plain stack.
- **Still to do:** the live checks, `/xmpp-ws/api/status` giving 404 and chat still connecting, after the deploy.
