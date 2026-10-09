---
id: T-0744
title: "deploy/coolify/docker-compose.yml: set BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds on the server (as deploy/docker-compose.yml does), so chat backgrounds land on the avatar volume, not the container layer"
status: merged
milestone: M5
branch: task/T-0744-coolify-background-dir
model: auto
effort: low
depends_on: []
estimate: 0.02 day
---

# T-0744: chat backgrounds on a volume in the Coolify stack

## Spec (written by Claude, do not edit)

### Why
In the lead's local upgrade rehearsal, the tip image warned: "BACKGROUND_STORAGE_DIR (/app/data/backgrounds) is on the container layer, not a mounted volume". The plain compose sets it, but the Coolify compose does not, so uploaded chat backgrounds would be lost whenever the server container is replaced.

### Verified facts (do not re-derive)
- `deploy/docker-compose.yml:150-153` sets `BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds`, with a comment: it lives inside the `avatar-data` volume, so no new volume is needed.
- `deploy/coolify/docker-compose.yml` sets `STICKER_STORAGE_DIR: /data/stickers` (line 140) and `AVATAR_STORAGE_DIR: /data/avatars` (line 144) on `server`, mounts `avatar-data:/data/avatars` (line 208), and has no `BACKGROUND_STORAGE_DIR`.
- The default is `./data/backgrounds` (`apps/server/src/config.ts:154`).

### What to build
In `deploy/coolify/docker-compose.yml`, directly after the `AVATAR_STORAGE_DIR` line (144), add the same comment and the line `BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds` from `deploy/docker-compose.yml:150-153`. Nothing else changes.

### Read first
`AGENTS.md`, `deploy/coolify/docker-compose.yml` (lines 130-215), `deploy/docker-compose.yml` (lines 140-160).

### Allowed files
`deploy/coolify/docker-compose.yml`, `work/T-0744-coolify-background-dir.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `grep -n BACKGROUND_STORAGE_DIR deploy/coolify/docker-compose.yml` shows the new line.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did:** added the same comment and `BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds` line as `deploy/docker-compose.yml:150-153`, directly after `AVATAR_STORAGE_DIR` in the `server` service of `deploy/coolify/docker-compose.yml` (comment at lines 145-148, variable at line 149). Nothing else changed.

**Files changed:**
- `deploy/coolify/docker-compose.yml`
- `work/T-0744-coolify-background-dir.md` (this report and status)

**Commands and results:**
- `pnpm install`: done (10.8s).
- `pnpm exec prettier --file-info deploy/coolify/docker-compose.yml`: parser `yaml`, not ignored.
- `pnpm exec prettier --check deploy/coolify/docker-compose.yml`: "All matched files use Prettier code style!"
- `pnpm exec prettier --write deploy/coolify/docker-compose.yml`: unchanged.
- `grep -n BACKGROUND_STORAGE_DIR deploy/coolify/docker-compose.yml`: line 149 shows the new line.
- `pnpm gate` (run from `/Users/julio/personal-projects/zilar-T-0744`), summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (14.9s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (1.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No single Vitest tests were run: no package code changed and the gate ran no test step.

**Problems / deviations:** none. The comment says "(T-0460)", copied from the plain compose file.

**Open questions:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 1 min). It adds one line and its comment, matching `deploy/docker-compose.yml:150-153`, and the gate passed. **The live Coolify compose still needs the same line, which is Julio's OK.**
