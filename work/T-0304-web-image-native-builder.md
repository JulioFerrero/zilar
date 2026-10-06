---
id: T-0304
title: "Images: the web image's builder stage runs on the native build platform, not under QEMU"
status: todo
milestone: M5
branch: task/T-0304-web-image-native-builder
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0304: faster zilar-web image

## Spec (written by Claude, do not edit)

### Why
The first green-main images run is 37396257689. In that run:
- the `zilar-server` image built in about 4 minutes;
- `zilar-postgres` and `zilar-ejabberd` took under 1 minute each;
- `zilar-web` was still building after 28 minutes.

`.github/workflows/images.yml` builds every image for `linux/amd64,linux/arm64` (lines 121, 132 and 149), with QEMU (line 85). The web builder stage runs `pnpm install` and the Vite build under arm64 emulation, but its output (`apps/web/dist`) is static files that are the same on every platform. Only the Caddy runtime stage needs to be per-platform.

### Verified facts (do not re-derive)
- `apps/web/Dockerfile`:
  - line 11: `FROM node:24.11.1-alpine AS builder`;
  - line 25: `pnpm install --frozen-lockfile`;
  - line 35: `pnpm --filter @zilar/web build`;
  - line 37: `FROM caddy:2.10.2-alpine AS runtime`;
  - line 40: copies `/repo/apps/web/dist` from the builder.
- `apps/server/Dockerfile` installs production dependencies that may be native, so it is **not** part of this task.

### What to build
1. In `apps/web/Dockerfile`, change line 11 to `FROM --platform=$BUILDPLATFORM node:24.11.1-alpine AS builder`.
2. Add a two-line comment above it: the dist output is platform-independent static files, so the builder runs natively and only the Caddy stage is built per platform.
3. Nothing else changes; the runtime stage stays per-platform.
4. If Docker is available locally, run `docker buildx build --platform linux/amd64 -f apps/web/Dockerfile . -t zilar-web-test` and report the result. If it is not available, say so in the Report.

### Read first
`AGENTS.md`, `apps/web/Dockerfile`, `.github/workflows/images.yml`.

### Allowed files
`apps/web/Dockerfile`, `work/T-0304-web-image-native-builder.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The builder stage uses `--platform=$BUILDPLATFORM`; the runtime stage is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
