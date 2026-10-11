---
id: T-1101
title: "Release blocker: the web Docker image fails ('failed to resolve import @zilar/ball-avatar'); the Dockerfile must copy packages/ball-avatar"
status: merged
milestone: M5
branch: task/T-1101-web-dockerfile-ball-avatar
model: auto
effort: default
depends_on: [T-1100]
estimate: 0.05 day
---

# T-1101: The web Dockerfile copies `packages/ball-avatar`

## Spec (written by Claude, do not edit)

### Why
- **The failure:** GitHub Actions "Production images" has failed for the `zilar-web` image on every main build since T-1091, for example run 38101963332 on `ee8322cd`. The error:
  `Error: [vite]: Rolldown failed to resolve import "@zilar/ball-avatar" from "/repo/packages/chat-core/src/avatar.ts".`
- **The cause:**
  - T-1091 added the workspace package `packages/ball-avatar`;
  - `apps/web/Dockerfile` copies each workspace package by name: the `package.json` files at `:22-28`, then the sources at `:36-42`;
  - `packages/ball-avatar` is in neither list.
- **The server image is not affected:** `apps/server/Dockerfile` does not copy chat-core.

### What to build
1. **Add the package to `apps/web/Dockerfile`:**
   - `COPY packages/ball-avatar/package.json packages/ball-avatar/` next to the other `package.json` lines (after `:27`, chat-core);
   - `COPY packages/ball-avatar packages/ball-avatar` next to the other sources (after `:41`).
   - Nothing else changes.
2. **Proof in the Report:** run `docker build -f apps/web/Dockerfile -t zilar-web-check .` from the repo root (Docker is installed locally) and paste the last 15 lines of its output, which must end with a success. Then remove the image with `docker rmi zilar-web-check`.
   - If Docker is not running, say so in the Report and do not start it. Paste the `grep -n "COPY" apps/web/Dockerfile` output instead.
3. **No other files change.**

### Read first
`AGENTS.md`, `apps/web/Dockerfile`, and `packages/ball-avatar/package.json`.

### Allowed files
`apps/web/Dockerfile`, `work/T-1101-web-dockerfile-ball-avatar.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the `docker build` result.

---

## Report (written by the worker when done)

### What I did

Added the missing `@zilar/ball-avatar` workspace package to `apps/web/Dockerfile`, exactly as the spec asked and nothing else:

- line 28: `COPY packages/ball-avatar/package.json packages/ball-avatar/` (after the chat-core manifest, line 27);
- line 43: `COPY packages/ball-avatar packages/ball-avatar` (after the chat-core sources, line 42).

The Dockerfile comment block at lines 32-35 still lists the copied source packages without ball-avatar. The spec said "Nothing else changes", so I left that comment untouched.

### Files changed

- `apps/web/Dockerfile` (2 lines added).
- `work/T-1101-web-dockerfile-ball-avatar.md` (status + this Report).

### Commands and results

- `pnpm install`: `Done in 10.9s using pnpm v10.32.1`.
- Docker build proof: **could not run — Docker is not running.**
  - `docker info --format '{{.ServerVersion}}'` → `Cannot connect to the Docker daemon at unix:///Users/julio/.docker/run/docker.sock. Is the docker daemon running?`
  - Per the spec ("If Docker is not running, say so in the Report and do not start it"), I did not start it. No `docker build` and no `docker rmi` were run.
  - `grep -n "COPY" apps/web/Dockerfile`:
    ```
    21:COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
    22:COPY apps/web/package.json apps/web/
    23:COPY packages/api-contract/package.json packages/api-contract/
    24:COPY packages/protocol/package.json packages/protocol/
    25:COPY packages/client-core/package.json packages/client-core/
    26:COPY packages/xmpp-core/package.json packages/xmpp-core/
    27:COPY packages/chat-core/package.json packages/chat-core/
    28:COPY packages/ball-avatar/package.json packages/ball-avatar/
    29:COPY packages/ui-tokens/package.json packages/ui-tokens/
    37:COPY apps/web apps/web
    38:COPY packages/api-contract packages/api-contract
    39:COPY packages/protocol packages/protocol
    40:COPY packages/client-core packages/client-core
    41:COPY packages/xmpp-core packages/xmpp-core
    42:COPY packages/chat-core packages/chat-core
    43:COPY packages/ball-avatar packages/ball-avatar
    44:COPY packages/ui-tokens packages/ui-tokens
    50:COPY apps/web/Caddyfile /etc/caddy/Caddyfile
    51:COPY --from=builder /repo/apps/web/dist /srv/zilar-web
    ```
- Single tests: none — the change touches only the Dockerfile, and the spec lists no test files to run.
- `pnpm gate` summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

- The `docker build` acceptance proof is missing because Docker is not running on this machine. The fallback (`grep -n "COPY"`) is pasted above.

### Open questions

- None.

### Security checklist

No secrets, no routes, no permission or DB changes: this task only adds two `COPY` lines to a build file.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean.**
- **The change:** `apps/web/Dockerfile` copies `packages/ball-avatar/package.json` and `packages/ball-avatar`, next to the other workspace packages. The diff has these two lines only.
- **The proof:** the local Docker daemon is not running, and the lead did not start it while Julio uses the PC. The authoritative check is the GitHub "Production images" run on this merge, and the lead watches its `zilar-web` job. No deploy secrets are set, so this merge cannot deploy.
- **Check:** the gate passed.
