---
id: T-1983
title: "Client IP hardening: the server and Better Auth see the visitor's real IP (live sessions all record a private proxy IP today, so every per-IP limit is one shared bucket) — web Caddy trusts private-range proxies, Better Auth reads the server's own client IP, plain compose passes TRUSTED_PROXY_HOPS"
status: merged
milestone: M5
branch: task/T-1983-client-ip-chain
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-1983: Real client IP for limits and sessions

## Spec (written by Claude, do not edit)

### Why
These fixes come from the lead's private security review of 2026-10-18 (T-1968). The lead confirmed the problem live: all 7 sessions created in the last 7 days store a **private** IP address. So:
- **The server sees the proxy.** It sees a proxy's address, not the visitor's.
- **One shared bucket.** Every per-IP limit (sign-in codes, joins, setup, invite preview) is one bucket for the whole instance, so one person can use it up for everyone.

This must work for anyone self-hosting, on both Coolify and the plain compose stack.

### Facts (read by the lead on 2026-10-18)
- **The Coolify chain** is Traefik, then the web container's Caddy (`apps/web/Caddyfile`, `handle /api/*` → `reverse_proxy server:3000` at `:46-51`), then the server.
  - The web Caddy's global block (`:10-14`) has `admin off` and `grace_period 2s`, and no `servers { trusted_proxies ... }`. Caddy then replaces an untrusted incoming `X-Forwarded-For` with its direct peer (Traefik), so the server sees one private address.
- **Coolify compose.** `deploy/coolify/docker-compose.app.yml:158-163` sets `TRUSTED_PROXY_HOPS: 2` and explains that both proxies append.
- **Picking the address.** `apps/server/src/http/client-ip.ts`: `clientIpFrom(input, hops)` picks the Nth address from the right of `X-Forwarded-For`, or falls back to the socket address when there are fewer than `hops` entries (`:20-23`, `:34-41`).
  - It is used by `invite-links/api.ts:123` and `setup/api.ts:104`, among others.
- **Better Auth ignores it.** It has its own IP rule, which is used for its rate limits and the `session.ip_address` column, and it never reads `TRUSTED_PROXY_HOPS`.
  - `apps/server/src/auth/auth.ts:126-136` (`advanced`) sets no `ipAddress` option.
  - `apps/server/src/effect/edge.ts:172-178` hands every `/api/auth/*` request to `auth.handler(webRequest)` unchanged.
- **The plain compose stack.**
  - `deploy/docker-compose.yml`: the `server` service (`:119`) lists its `environment:` explicitly and never passes `TRUSTED_PROXY_HOPS`.
  - `deploy/.env.example:81` documents it as `# TRUSTED_PROXY_HOPS=0`.
  - In that stack the edge Caddy (`deploy/caddy/Caddyfile`) sends `/api` straight to the server and writes the client IP as the single value, so `1` is right there.

### Steps
1. **The web Caddy appends.** In `apps/web/Caddyfile`'s global block, add `servers { trusted_proxies static private_ranges }` with a one-line comment.
   - Caddy then keeps the incoming `X-Forwarded-For` from Traefik (private) and appends its own peer, so `TRUSTED_PROXY_HOPS: 2` lands on the visitor.
   - A spoofed header from the internet stays on the left and is never picked.
2. **Better Auth uses the same IP.** In `edge.ts`, before handing an `/api/auth/*` request to `auth.handler`:
   - set a header `x-zilar-client-ip` to `clientIpFrom({ forwardedFor, socketAddress }, config.TRUSTED_PROXY_HOPS)`, **overwriting** any incoming value;
   - in `auth.ts`, set `advanced.ipAddress.ipAddressHeaders: ['x-zilar-client-ip']`.
   - Check the option name against the installed Better Auth version, and use its real field.
3. **Plain compose.** Add `TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-1}` to the server environment in `deploy/docker-compose.yml`, and fix the `.env.example` comment to say the default is 1 behind the bundled Caddy.
   - Check `deploy/baremetal` the same way, and say what you found in the Report.
4. **Tests** (rate limits and auth are crucial):
   - a client-supplied `x-zilar-client-ip` is overwritten;
   - with `X-Forwarded-For: "1.2.3.4, 10.0.0.2"` and hops 2, Better Auth gets `1.2.3.4`.
   - Use the nearest existing edge or auth test file.
5. **Keep files small.** Every file stays at or under 400 lines.

### Allowed files
- `apps/web/Caddyfile`
- `apps/server/src/effect/edge.ts`
- `apps/server/src/auth/auth.ts`
- `apps/server/src/http/client-ip.ts`
- `apps/server/src/auth/auth.test.ts`
- `apps/server/src/effect/edge.test.ts`
- `deploy/docker-compose.yml`
- `deploy/.env.example`
- `work/T-1983-client-ip-chain.md`

(`deploy/baremetal/` has no compose file. Only read it, and report whether its proxy setup needs the same change.)

### Checks
```bash
docker run --rm -v "$PWD/apps/web/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
pnpm --filter @zilar/server exec vitest run src/auth src/effect --reporter=dot
pnpm gate
```
If Docker isn't running for you, say so; the lead validates the Caddyfile.

### Acceptance
- The tests pass, and the gate passes.
- After the deploy, the lead checks live that a new session's stored IP is public, not private, by its range only, without printing it.

---

## Report (written by the worker when done)

### What I did

- `apps/web/Caddyfile`: added `servers { trusted_proxies static private_ranges }` to the global block, so the web Caddy keeps Traefik's private-range `X-Forwarded-For` and appends its own peer instead of replacing it. With `TRUSTED_PROXY_HOPS: 2` the server then picks the visitor.
- `apps/server/src/http/client-ip.ts`: added `CLIENT_IP_HEADER = 'x-zilar-client-ip'` (shared by the edge and auth), with a comment on why it exists.
- `apps/server/src/effect/edge.ts`: `/api/auth/*` now goes through `withClientIp`, which resolves `clientIpFrom({ forwardedFor, socketAddress }, config.TRUSTED_PROXY_HOPS)` and **sets** (overwrites) `x-zilar-client-ip` before `auth.handler` runs.
- `apps/server/src/auth/auth.ts`: `advanced.ipAddress.ipAddressHeaders: ['x-zilar-client-ip']` (checked against Better Auth 1.7.6's `init-options.d.mts`; the real option is `advanced.ipAddress.ipAddressHeaders`).
- `deploy/docker-compose.yml`: server gets `TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-1}` (the bundled Caddy writes one value).
- `deploy/.env.example`: comment now says the default is 1 behind the bundled Caddy.
- Tests: new `apps/server/src/effect/edge.test.ts` (spoofed `x-zilar-client-ip` is overwritten; `X-Forwarded-For: 1.2.3.4, 10.0.0.2` with 2 hops reaches the auth handler as `1.2.3.4`), and one end-to-end test in `auth.test.ts` that signs in through the edge and asserts the stored `session.ip_address` is `1.2.3.4`.

One deviation from the letter of the spec, in `edge.ts`: when the transport has no peer socket at all (`'unknown'`, which only the web-handler path used by tests produces; `NodeHttpServer` always supplies `remoteAddress`), the edge treats `X-Forwarded-For` as a one-hop stand-in at `TRUSTED_PROXY_HOPS=0`. Without this, every `app.request` test got the header `'unknown'`, Better Auth rejected it and fell back to `127.0.0.1`, and its module-global in-memory rate-limit store then shared one bucket across all tests (38 auth/session tests failed with "No OTP was sent"). A real socket never takes this branch, so production behaviour is unchanged.

### Checks run

- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/edge.test.ts` — 3 passed (before the fallback change; the dir run below re-ran the two remaining tests green).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts -t T-1983` — 1 passed, 37 skipped.
- `pnpm --filter @zilar/server exec vitest run src/auth src/effect --maxWorkers=2 --reporter=dot` — 12 files, 91 tests passed.
- `docker run --rm -v "$PWD/apps/web/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2-alpine caddy validate ...` — **not run: Docker is not running** on this machine (`dial unix /Users/julio/.docker/run/docker.sock: no such file or directory`). The lead validates the Caddyfile.
- `pnpm gate`:
  ```
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.9s)
  PASS  lint  (1.8s)
  PASS  typecheck  (7.2s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (29.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Baremetal:** `deploy/baremetal/` has no compose file and no `TRUSTED_PROXY_HOPS` anywhere (systemd unit, `.env.example`, Caddyfile, nginx config). Its server runs on loopback behind that Caddy/nginx, so it has the same bug: every per-IP limit and every stored session IP is `127.0.0.1`. It needs `TRUSTED_PROXY_HOPS=1` in `zilar-server.service`/`.env.example` and the same docs line. Its Caddy/nginx do not need `trusted_proxies` (they are the only proxy, so the client value is correct). Not changed: `deploy/baremetal/` is outside the Allowed files.
- **Stale comment, out of scope:** `apps/server/src/config/server-schema.ts:80-84` still says "Only the join limiter reads it" for `TRUSTED_PROXY_HOPS`. The edge now reads it too. Not changed (not an Allowed file).
- **File size:** `deploy/docker-compose.yml` is 447 lines (443 before this task). The 400-line guidance is exceeded by the whole file already; the gate's size check only covers source files and passed.
- **End-to-end proof:** the new auth test shows the stored session IP is the public value from the chain (`1.2.3.4`), not the proxy address.


## Review (written by Claude)

Approved.
- **The chain:** the edge writes the resolved client IP into its own header, overwriting any incoming value. Better Auth reads only that header. The web Caddy now trusts private-range proxies, so Traefik's `X-Forwarded-For` survives and two hops land on the visitor. The plain compose passes `TRUSTED_PROXY_HOPS` (default 1).
- **Caddyfile:** validated by the lead with the live web container's caddy v2.10.2 (`caddy adapt --validate`, stdin only; the live site stayed healthy).
- **Follow-ups** (outside the Allowed files, to go in a later task):
  - baremetal `TRUSTED_PROXY_HOPS=1`;
  - the stale comment in `config/server-schema.ts:80-84`.
- **After deploy:** the lead checks that a new session's stored IP is public (by range only).
