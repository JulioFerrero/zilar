---
id: T-1438
title: "Serve the one-line installer from the web image: /install.sh on every host, and the bare host get.zilar.app answers with the script"
status: merged
milestone: M5
branch: task/T-1438-get-zilar-app
model: auto
effort: default
depends_on: [T-1428]
estimate: 0.2 day
---

# T-1438: get.zilar.app

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-15) wants `curl -fsSL https://get.zilar.app | sh`. T-1428 merged `deploy/install.sh`. DNS (a Porkbun A record) and the extra Coolify domain come later and are not part of this task; the lead adds them. This task makes the web image serve the script.

### Facts (the lead read them on main)
- **`apps/web/Caddyfile`:**
  - one `:80` site (`:14`), `root * /srv/zilar-web` (`:15`);
  - handles for `/api/*` (`:44`), `/health` (`:51`), `/xmpp-ws/*` (`:58`, `:69`) and `/upload/*` (`:73`);
  - the SPA fallback `handle { … file_server }` (`:87-90`).
  - TLS ends at Coolify's proxy in front of it, so the `Host` header is the public name.
- **`apps/web/Dockerfile`:** the runtime stage copies the Caddyfile (`:50`) and the built app into `/srv/zilar-web` (`:51`). The build context is the repo root.
- **`deploy/install.sh`** is 400 lines, POSIX `sh`.

### What to build
1. In `apps/web/Dockerfile`'s runtime stage: `COPY deploy/install.sh /srv/zilar-web/install.sh`.
2. In `apps/web/Caddyfile`, before the SPA fallback:
   - `handle /install.sh` serves the file with `Content-Type: text/x-shellscript; charset=utf-8` and `Cache-Control: no-cache`;
   - a host matcher `@installer host get.zilar.app` rewrites every path to `/install.sh`, with the same headers, so `https://get.zilar.app` and `https://get.zilar.app/anything` return the script.
   - Nothing else changes.
3. If there's a Caddyfile check in CI or `deploy/tests/` (for example `caddy validate` or `caddy adapt`), run it and keep it green. Name it in the Report.

### Tests
None beyond the existing checks.

### Allowed files
`apps/web/Dockerfile`, `apps/web/Caddyfile`, `work/T-1438-get-zilar-app.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead checks after deploy that `curl -s https://chat.zilar.app/install.sh | head -1` prints `#!/bin/sh`.

---

## Report (written by the worker when done)

### What I did
- `apps/web/Dockerfile`, runtime stage: added
  `COPY deploy/install.sh /srv/zilar-web/install.sh` right after the built
  app is copied into `/srv/zilar-web`, so the script is served from the web
  root.
- `apps/web/Caddyfile`, immediately before the SPA fallback:
  - `handle /install.sh` serves the file with
    `Content-Type: text/x-shellscript; charset=utf-8` and
    `Cache-Control: no-cache`;
  - `@installer host get.zilar.app` + `handle @installer` rewrites every
    path to `/install.sh` with the same headers, so both
    `https://get.zilar.app` and `https://get.zilar.app/anything` return the
    script.
  - Nothing else changed.
- `work/T-1438-get-zilar-app.md`: this Report and the status flip.

### Files changed
`apps/web/Dockerfile`, `apps/web/Caddyfile`, `work/T-1438-get-zilar-app.md`
(all inside the Allowed files).

### Commands run and results
- `pnpm install` — done in 18.8s (only a pre-existing `@types/react-dom`
  peer warning in `apps/mobile`, unrelated to this task).
- `pnpm gate` — ended with `GATE PASS`. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.3s)
  PASS  lint  (2.6s)
  PASS  typecheck  (7.4s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Single tests
None. The change is deploy config (Dockerfile + Caddyfile); there are no test
files near it, and the spec says "None beyond the existing checks". The gate
reported `SKIP tests @zilar/web (no nearby test files)`.

### Caddyfile check
There is **no** Caddyfile check in CI or `deploy/tests/`: I searched
`.github/workflows/` and `deploy/tests/` (`deploy/tests/` holds only
`*.test.sh` shell tests, none Caddy-related) and found no `caddy validate`,
`caddy adapt` or `caddy fmt` anywhere. There is no `caddy` binary on this
machine either, so I could not run one locally. I checked the new syntax
against the Caddy v2 directives/matchers reference instead: `handle` blocks
are mutually exclusive and a no-matcher `handle` is the fallback (sorted
last), named-matcher blocks keep their file order, and a `header` set before
`file_server` is respected (the documented pattern for fixing a served
file's `Content-Type`).

### Notes / verification against the code
- `.dockerignore` at the repo root does not exclude `deploy/`, so
  `deploy/install.sh` is in the build context; `deploy/install.sh` is mode
  `0755` (world-readable), so the `caddy` user can serve it.
- The web image build context is the repo root (per the Dockerfile header),
  so `COPY deploy/install.sh ...` resolves.

### Deviations
None.

### Blocked / needs a decision
Nothing blocked. DNS (Porkbun A record) and the extra Coolify domain for
`get.zilar.app` are out of scope per the spec; the lead adds them.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1: reserved paths such as `/api` still win on get.zilar.app, which is acceptable.
- The lead validated the Caddyfile with the production image `caddy:2.10.2-alpine` (`caddy validate`: Valid configuration).
- After deploy: `curl -s https://chat.zilar.app/install.sh | head -1` should print `#!/bin/sh`.
- get.zilar.app itself waits for Julio's Porkbun A record, then the lead adds the Coolify domain.
