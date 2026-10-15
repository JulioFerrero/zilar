---
id: T-1590
title: "One-line install step 6 (docs/deploy/one-line-install-plan.md): the landing app (apps/site) answers get.zilar.app with the installer script at any path, mirroring apps/web/Caddyfile:86-102; its image copies deploy/install.sh"
status: merged
milestone: M5
branch: task/T-1590-landing-serves-installer
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1590: The landing app serves get.zilar.app

## Spec (written by Claude, do not edit)

### Why
This is `docs/deploy/one-line-install-plan.md` step 6.
- **Julio's decisions (2026-10-15):** `get.zilar.app` is served by the landing app; he added the DNS record (`get` CNAME `zilar.app`, now resolving to 152.53.146.96).
- **After this merges,** the lead adds the domain and a watch path to the landing app in Coolify (Julio approved).

### Facts (the lead read them on main, 2026-10-15)
- **`apps/site/Caddyfile`:** one `:80` site. `@apex host zilar.app` redirects to `https://www.zilar.app{uri}`; then `root * /srv/zilar-site`, `encode`, security headers, asset caching and `file_server`.
- **`apps/site/Dockerfile`:**
  - the builder stage (context = repo root) copies the root manifests and `apps/site`, then builds;
  - the runtime is `caddy:2.10.2-alpine`, with the Caddyfile at `/etc/caddy/Caddyfile` and `dist` at `/srv/zilar-site`;
  - a `wget` health check on `/`.
- **The web app already does this** (`apps/web/Caddyfile:86-102`):
  - `handle /install.sh` sets `Content-Type "text/x-shellscript; charset=utf-8"` and `Cache-Control "no-cache"`;
  - `@installer host get.zilar.app` with `handle @installer { rewrite * /install.sh … file_server }`;
  - the image copies it with `COPY deploy/install.sh /srv/zilar-web/install.sh` (`apps/web/Dockerfile:52-53`).

### Steps
1. **`apps/site/Dockerfile`:** copy `deploy/install.sh` into the runtime stage at `/srv/zilar-site/install.sh` (from the build context, the way web does).
2. **`apps/site/Caddyfile`:**
   - before the apex redirect, add `@installer host get.zilar.app` with a `handle` that rewrites every path to `/install.sh`, sets the same two headers as web, and serves the file;
   - `get.zilar.app` must not be redirected to www;
   - leave the rest unchanged;
   - **keep the security headers** on the script response too.
3. **`/install.sh` on the landing's own hosts** also serves the script, with the same headers.
4. **Check locally:** build the image (`docker build -f apps/site/Dockerfile -t zilar-site:check .`), run it on a free port, then:
   - `curl -sS -H 'Host: get.zilar.app' http://127.0.0.1:<port>/` and `…/anything` both return the script (its first line is `#!/bin/sh`) with the shell content type;
   - `curl -sSI -H 'Host: zilar.app' http://127.0.0.1:<port>/` still answers 308 to www;
   - `curl -sSI -H 'Host: www.zilar.app' http://127.0.0.1:<port>/` answers 200 HTML.
   - Stop and remove the container afterwards.

### Tests
None (step 4 is the check).

### Allowed files
- `apps/site/Caddyfile`
- `apps/site/Dockerfile`
- `work/T-1590-landing-serves-installer.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report pastes** the three curl results from step 4: the status lines, the content type and the script's first line.

---

## Report (written by the worker when done)

### What I did

- `apps/site/Dockerfile`: added `COPY deploy/install.sh /srv/zilar-site/install.sh` to the runtime stage (same comment as the web image).
- `apps/site/Caddyfile`: at the top of the `:80` block, before the apex redirect, added
  `@installer host get.zilar.app` with `handle @installer { rewrite * /install.sh; header
  Content-Type "text/x-shellscript; charset=utf-8"; header Cache-Control "no-cache";
  file_server }`. Added `handle /install.sh` on the landing's own hosts with the same two
  headers. The site-level security-header block is unchanged and still applies to the script
  response. The apex redirect and everything else are unchanged.
- Built the image, ran it on 127.0.0.1:18080, ran the step-4 curls, then stopped it
  (`--rm`, so the container is gone).

Files changed: `apps/site/Caddyfile`, `apps/site/Dockerfile`, this task file.

### Checks run

- `pnpm install`: `Done in 10.6s using pnpm v10.32.1` (one pre-existing peer-dependency warning in `apps/mobile`).
- `docker build -f apps/site/Dockerfile -t zilar-site:check .`: build succeeded (runtime `COPY deploy/install.sh /srv/zilar-site/install.sh` DONE).
- `docker run --rm -d --name zilar-site-check -p 127.0.0.1:18080:80 zilar-site:check`: started, health `starting`, then stopped with `docker stop zilar-site-check`.

Step-4 curls (real output):

```
$ curl -sS -o /dev/null -w 'status=%{http_code} content_type=%{content_type}\n' -H 'Host: get.zilar.app' http://127.0.0.1:18080/
status=200 content_type=text/x-shellscript; charset=utf-8
$ curl -sS -H 'Host: get.zilar.app' http://127.0.0.1:18080/ | head -n 1
#!/bin/sh
$ curl -sS -o /dev/null -w 'status=%{http_code} content_type=%{content_type}\n' -H 'Host: get.zilar.app' http://127.0.0.1:18080/anything
status=200 content_type=text/x-shellscript; charset=utf-8
$ curl -sS -H 'Host: get.zilar.app' http://127.0.0.1:18080/anything | head -n 1
#!/bin/sh
$ curl -sSI -H 'Host: zilar.app' http://127.0.0.1:18080/ | head -n 2
HTTP/1.1 301 Moved Permanently
Location: https://www.zilar.app/
$ curl -sSI -H 'Host: www.zilar.app' http://127.0.0.1:18080/ | head -n 4
HTTP/1.1 200 OK
Accept-Ranges: bytes
Content-Length: 18010
Content-Type: text/html; charset=utf-8
$ curl -sS -o /dev/null -w 'landing /install.sh status=%{http_code} content_type=%{content_type}\n' -H 'Host: www.zilar.app' http://127.0.0.1:18080/install.sh
landing /install.sh status=200 content_type=text/x-shellscript; charset=utf-8
```

Security headers are kept on the script response (from `curl -sSI -H 'Host: get.zilar.app' …`):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, plus `Cache-Control: no-cache`.

- `pnpm gate` (from repo root) summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.9s)
PASS  lint  (1.6s)
PASS  typecheck  (2.8s)
SKIP effect (no source files changed)
SKIP tests @zilar/site (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no single package test (the task's Tests section says none; the image check above is the test).

### Notes for the lead

- **The apex redirect answers 301, not 308.** Step 4 says `Host: zilar.app` "still answers
  308 to www"; the real response is `HTTP/1.1 301 Moved Permanently`. That redirect is the
  pre-existing `redir @apex https://www.zilar.app{uri} permanent` line (Caddy maps `permanent`
  to 301), which step 2 says to leave unchanged, so I did not touch it. If you actually want a
  308, tell me and I'll change `permanent` to `308` (one word). Everything else in step 4
  matches.
- No new dependencies, no tests added, no other files touched.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 1 nit (the spec said 308; the existing apex redirect is a 301).
- **The diff:**
  - an `@installer host get.zilar.app` handle placed before the apex redirect, rewriting every path to `/install.sh` with the shell content type and `no-cache`;
  - `/install.sh` on the landing's own hosts;
  - the image copies `deploy/install.sh`.
- **The worker's local container run:**
  - `get.zilar.app` at `/` and `/anything` answers 200 `text/x-shellscript`, and the body starts with `#!/bin/sh`;
  - `zilar.app` answers 301 to www;
  - `www.zilar.app` answers 200.
- **Julio's decision (2026-10-15):** the Coolify path becomes a standard one-click template. The one-liner stays for plain Docker hosts, so this is still needed.
- **Next (approved by Julio):** in Coolify, add the `get.zilar.app` domain to the landing app and `deploy/install.sh` to its watch paths, then `curl https://get.zilar.app`.
