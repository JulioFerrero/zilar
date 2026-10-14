---
id: T-1410
title: "P2 task E: the desk egress proxy in packages/desk (HTTP CONNECT + plain HTTP; open web by default, private and internal IPs always blocked by the shared IP guard, optional per-desk allowlist, per-host log without URLs)"
status: merged
milestone: M5
branch: task/T-1410-egress-proxy
model: auto
effort: default
depends_on: []
estimate: 0.8 day
---

# T-1410: Desk egress proxy

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: an AI's computer reaches the **open web through a proxy**, never directly, and private and internal ranges are always blocked (`docs/design/agent-system.md` §2.3, §3 and §7 decision 3). The same proxy runs on the VPS and inside a user's runner (§2.6), so it belongs in `packages/desk`.

**This is the plan's Task E** (`docs/audit/desk-runner-plan.md` §5.1-5.3 and §8 Task E). Credential injection is a later task (Task F, §5.4): leave a clear hook for it, nothing more.

### Facts (the lead checked them on main, 2026-10-14)
- **The IP guard** is `apps/server/src/sandbox/ip-guard.ts`: `classifyIp` (`:175`, returns `'public' | 'blocked'`) and `isIpLiteral` (`:195`), with tests in `ip-guard.test.ts`. The reader-side guarded fetch is `apps/server/src/web-tools/guarded-fetch.ts` (resolve, classify every address, connect to a pinned IP: `:202-215`).
- **The sidecar's jails** get `HTTP_PROXY`/`HTTPS_PROXY` from the sidecar config (`packages/desk/src/agent/docker.ts`, T-1407).
- **`packages/desk`** is a workspace package (`@zilar/desk`).

### What to build
1. **Move the IP guard into `packages/desk/src/egress/ip-guard.ts`** (with its tests). `apps/server/src/sandbox/ip-guard.ts` becomes a one-line re-export, so no server importer changes. Add `"@zilar/desk": "workspace:*"` to `apps/server/package.json` if it isn't there yet. T-1409 adds the same line, so on a conflict keep one.
2. **`packages/desk/src/egress/proxy.ts`:** a small Node HTTP proxy with **no new dependency** (the `node:http`/`node:net` built-ins).
   - `CONNECT host:443` tunnels; plain `http://` GET/HEAD are forwarded only on port 80, for redirects.
   - For each request it resolves the host, **classifies every address** (any blocked one → deny) and connects to the pinned public IP. That defeats DNS rebinding.
   - **It refuses** IP-literal hosts, ports other than 443 and 80, credentials in the URL, and private, loopback, link-local, ULA, Teredo and 6to4 addresses.
   - **An optional allowlist** per desk: exact host match. Identify the desk by a per-desk proxy credential the sidecar sets in the jail's proxy URL (`http://<deskId>:<secret>@desk-egress:3128`). The proxy maps it to the desk's policy through a small in-memory registry API that the sidecar calls on provision and stop.
   - **The credential-injection hook** is a function `beforeForward(deskId, host)` that returns no headers today.
3. **`packages/desk/src/egress/log.ts`:** one line per connection with the time, desk id, host, allowed or denied with a reason code, and bytes. **No URLs, paths, headers or bodies.** Expose `hostsFor(deskId)` (the recent distinct hosts) for "View steps" later.
4. **`packages/desk/src/egress/main.ts`:** the entry point (env: port, registry socket path).
5. **The sidecar** (`packages/desk/src/agent/`): on provision, register the desk with the proxy (allowlist from `DeskEgressPolicy`) and give the jail the per-desk proxy URL; on stop, unregister. Keep the files at most 400 lines.
6. **README:** a short "Egress proxy" section.

### Tests (security: required)
- **`packages/desk/src/egress/policy.test.ts`:**
  - a public host is allowed;
  - loopback, RFC 1918, link-local `169.254.169.254`, IPv6 ULA, Teredo, 6to4 and an IP literal are denied;
  - a host that resolves to one public and one private address is denied;
  - with an allowlist, another host is denied;
  - port 22 is denied.
- Keep the moved `ip-guard.test.ts` passing.

### Read first
`AGENTS.md`, `docs/audit/desk-runner-plan.md` §5, `apps/server/src/sandbox/ip-guard.ts`, `apps/server/src/web-tools/guarded-fetch.ts`, and `packages/desk/src/agent/`.

### Allowed files
`packages/desk/**`, `apps/server/src/sandbox/ip-guard.ts`, `apps/server/src/sandbox/ip-guard.test.ts`, `apps/server/package.json`, `pnpm-lock.yaml`, `work/T-1410-egress-proxy.md`.

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- **A manual local run in the Report:** start the proxy, `curl -x` an https public site (allowed) and `http://127.0.0.1` (denied), with the log lines.

---

## Report (written by the worker when done)

**Status:** done — all checks pass.

### What I built

- Moved the IP guard to `packages/desk/src/egress/ip-guard.ts` (and its test `packages/desk/src/egress/ip-guard.test.ts`). `apps/server/src/sandbox/ip-guard.ts` is now a one-line re-export (`export * from '@zilar/desk/egress/ip-guard';`); I added a `./egress/ip-guard` subpath to the desk package `exports` and `"@zilar/desk": "workspace:*"` to `apps/server/package.json`, so no server importer changed. Deleted the old server copy of the test.
- `packages/desk/src/egress/policy.ts`: `checkTarget(...)` resolves the host with an injectable resolver, classifies **every** address and returns the pinned public address or a fixed deny reason. It refuses IP-literal hosts, ports other than 443/80, hosts outside a set allowlist (an empty list denies all; `null` is the open web), and any blocked address (so a host that resolves to one public and one private address is denied).
- `packages/desk/src/egress/proxy.ts`: a plain `node:http`/`node:net` proxy, no new dependency. `CONNECT` tunnels and plain `http://` `GET`/`HEAD` (port 80) are pinned to the classified address. It requires `Proxy-Authorization: Basic <deskId>:<secret>` (else `407`) and strips `Proxy-Authorization`, `Proxy-Connection` and `Connection` from forwarded requests. `beforeForward(deskId, host)` is the empty credential-injection hook for Task F.
- `packages/desk/src/egress/log.ts`: one JSON line per connection (timestamp, desk id, host, allowed/denied with a fixed reason code, bytes sent back) plus `hostsFor(deskId)` (recent distinct hosts). No URLs, paths, headers or bodies.
- `packages/desk/src/egress/registry.ts`: the in-memory desk registry (constant-time secret compare) and its newline-JSON unix socket server, plus the sidecar's client.
- `packages/desk/src/egress/main.ts`: the entry point. Env: `DESK_EGRESS_PORT` (default 3128), `DESK_EGRESS_HOST` (default 0.0.0.0), `DESK_EGRESS_REGISTRY` (default `/run/zilar/egress.sock`).
- Sidecar: new `packages/desk/src/agent/egress.ts` mints the per-desk secret and builds `http://<deskId>:<secret>@<host>:<port>`; `agent/config.ts` turns `DESK_EGRESS_PROXY` (+ `DESK_EGRESS_REGISTRY`) into `AgentConfig.egress`; `agent/lifecycle.ts` registers on provision, unregisters on stop / stop_all / failed provision, and passes the per-desk URL to `docker.create`; `agent/docker.ts` now takes the proxy URL per jail; `agent/main.ts` wires the registrar. The base proxy URL moved from `DockerSettings` to `EgressSettings`.
- `packages/desk/README.md`: an "Egress proxy" section and the two env rows.

### Files changed

`packages/desk/src/egress/{ip-guard.ts,ip-guard.test.ts,policy.ts,policy.test.ts,proxy.ts,log.ts,registry.ts,main.ts}`,
`packages/desk/src/agent/{egress.ts,egress.test.ts,config.ts,docker.ts,lifecycle.ts,main.ts,test-harness.ts,server.test.ts}`,
`packages/desk/{package.json,README.md}`, `apps/server/src/sandbox/ip-guard.ts` (re-export),
`apps/server/src/sandbox/ip-guard.test.ts` (deleted, moved), `apps/server/package.json`, `pnpm-lock.yaml`,
`work/T-1410-egress-proxy.md`.

### Commands and results

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/egress/policy.test.ts src/egress/ip-guard.test.ts` — 2 files, 50 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/lifecycle.test.ts src/agent/server.test.ts src/agent/admission.test.ts src/egress/policy.test.ts src/egress/ip-guard.test.ts` — 5 files, 73 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/egress.test.ts` — 1 file, 3 tests passed.
- `pnpm gate` (from the repo root), final run:

```
gate: 22 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (0.7s)
PASS  effect  (0.6s)
PASS  tests @zilar/desk  (0.9s)
PASS  tests @zilar/server  (29.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Manual local run (acceptance)

I started the proxy in-process in a single foreground `tsx` script (not a daemon), registered one desk (`allowedHosts: null`) and drove it with `curl -x`:

```
ALLOWED https://example.com -> 200
DENIED  http://127.0.0.1 -> 403
DENIED  http://169.254.169.254 -> 403
--- LOG ---
{"timestamp":"2026-10-14T18:14:08.683Z","deskId":"desk-demo","host":"example.com","allowed":true,"reason":"ok","bytes":4900}
{"timestamp":"2026-10-14T18:14:08.701Z","deskId":"desk-demo","host":"127.0.0.1","allowed":false,"reason":"ip-literal","bytes":0}
{"timestamp":"2026-10-14T18:14:08.751Z","deskId":"desk-demo","host":"169.254.169.254","allowed":false,"reason":"ip-literal","bytes":0}
```

### Deviations and notes

- The gate picks the "nearest tests" for a changed source from `git ls-files`; with the deletion of `apps/server/src/sandbox/ip-guard.test.ts` not yet staged, the still-tracked file was selected and Vitest failed on the missing path. I staged the changes before the gate run. The committed tree (what the lead's merge sees) is unaffected.
- Registry secrets are per process: a proxy or sidecar restart while a jail stays up leaves that jail with a stale credential until it is re-created. That matches the spec's "small in-memory registry"; a persisted master secret is a later task.
- `beforeForward` is defined and called only on the plain-HTTP path; a `CONNECT` tunnel is end-to-end TLS, so Task F will need another mechanism there. Only the hook is left, as the spec asks.
- No new dependencies were added; the proxy uses only `node:http`/`node:net`, and `registry.ts` uses the package's existing `effect` `Schema` for its boundary validation.

### Open questions

None blocking.

### Round — fix round (findings from PREREVIEW.md)

- **Finding 1 (should-fix) — `CONNECT` is now 443-only.** `handleConnect` passes `allowedPorts: [443]` to `checkTarget`. The target is also parsed with `https://` instead of `http://`, because `http://host:80` normalizes `:80` away as the scheme default (an empty `url.port`), which is how the old code silently retargeted a `:80` CONNECT to 443. New `packages/desk/src/egress/proxy.test.ts`: `CONNECT example.com:80` → `403` with log reason `port`; `CONNECT example.com:443` passes the port check (reason `resolve-failed` against a rejecting test resolver, never the network); no credential → `407`.
- **Finding 2 (should-fix) — registry client checks `ok`, cap raised.** `call()` now parses the reply line and rejects on `ok:false`, on a malformed reply, or on a close with no reply, so a refused `register` no longer resolves. `deskIdSchema` max length 128 → 160 (the real maximum is 134: `desk-<64>-<64>`). New `packages/desk/src/egress/registry.test.ts`: a 134-char desk id registers over the real unix socket, and a refused (200-char) request rejects.
- **Nits 3, 4, 5:** left alone. Nit 3 (no `502` on a failed CONNECT upstream) and nit 4 (re-provision does not refresh the allowlist) are untouched code; nit 5's missing coverage is partly answered by the new `proxy.test.ts` (CONNECT + auth), but pinning behavior is still untested. No finding struck me as wrong, so there are no disagreements.

### Round — commands and results

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/egress/proxy.test.ts src/egress/registry.test.ts src/egress/policy.test.ts` — 3 files, 22 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/egress.test.ts` — 1 file, 3 tests passed.
- `pnpm gate` (from the repo root):

```
gate: 24 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (1.8s)
PASS  effect  (0.6s)
PASS  tests @zilar/desk  (1.5s)
PASS  tests @zilar/server  (28.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Disagreements

None.

### Round — fix round (PREREVIEW round 2 findings)

- **Finding 1 (should-fix) — plain-HTTP forward is now 80-only.** `handleRequest` passes `allowedPorts: [80]` to `checkTarget`, so `GET http://<host>:443/x` is denied with reason `port` instead of being forwarded as plaintext HTTP to 443; TLS on 443 goes only through the CONNECT tunnel. New tests in `packages/desk/src/egress/proxy.test.ts`: a plain `GET http://example.com:443/x` is refused (`403`, log reason `port`), and `GET http://example.com/x` passes the port check (log reason `resolve-failed` against the rejecting test resolver, never the network). Driving the plain-HTTP forward path also answers the plain-HTTP half of nit 4.
- **Nits 2, 3, 4:** left alone — none is in a line this fix changes. Nit 2 (no `502` on a failed CONNECT upstream, `proxy.ts:247`) and nit 3 (re-provision does not refresh the allowlist, `lifecycle.ts:82`) are untouched code; nit 4's upstream-pinning coverage is still missing. No finding struck me as wrong, so there are no disagreements.

### Round — commands and results (PREREVIEW round 2)

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/egress/proxy.test.ts src/egress/policy.test.ts` — 2 files, 22 tests passed.
- `pnpm gate` (from the repo root):

```
gate: 24 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.5s)
PASS  typecheck  (1.5s)
PASS  effect  (0.5s)
PASS  tests @zilar/desk  (1.1s)
PASS  tests @zilar/server  (27.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 2 auto rounds, nit 3. Lead checks: the IP guard moved to @zilar/desk and the server keeps a one-line re-export (importers unchanged); 11 desk test files pass locally (96 tests); the worker's local run shows https://example.com allowed (200) and http://127.0.0.1 denied (403, reason ip-literal), with host-only log lines. Nothing deployed: the egress container comes with T-1411 behind DESKS_ENABLED.
