---
id: T-1917
title: "URGENT deploy fix: every Dockerfile that runs pnpm install copies patches/ first — the T-1908 pnpm patch broke 'Production images' (ENOENT /repo/patches/expo-share-intent@8.0.1.patch), so nothing deploys"
status: merged
milestone: M5
branch: task/T-1917-docker-copy-patches
model: auto
effort: default
depends_on: [T-1908]
estimate: 15 min
---

# T-1917: The Docker builds copy the pnpm patches

## Spec (written by Claude, do not edit)

### Why
T-1908 added `patchedDependencies` (`pnpm-workspace.yaml`) pointing at `patches/expo-share-intent@8.0.1.patch`. The image builds copy only the manifests before `pnpm install --frozen-lockfile`, so pnpm can't open the patch. The **Production images** run for `0f8e4a267` failed in zilar-web, zilar-server and zilar-desk-agent with:
```
ENOENT: no such file or directory, open '/repo/patches/expo-share-intent@8.0.1.patch'
```
Live is still the previous commit, and **no deploy can happen until this is fixed.**

### Facts (read by the lead on 2026-10-17)
These Dockerfiles copy the manifests and then run `pnpm install`:
- `apps/server/Dockerfile:23` (`COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./`), install at `:31`;
- `apps/web/Dockerfile:21` (same, plus `tsconfig.base.json`), install at `:31`;
- `apps/site/Dockerfile:16`, install at `:19` (`--filter @zilar/site...`);
- `deploy/desk/Dockerfile.agent:28`, install at `:31`.

`patches` isn't listed in `.dockerignore`, so it reaches the build context.

### Steps
1. In each of the four Dockerfiles, add `COPY patches ./patches` right after the root manifest `COPY` line, before `RUN pnpm install`.
2. If `pnpm gate` or another check builds an image or lints Dockerfiles, run it. Otherwise only `pnpm gate`. Docker isn't required on the worker machine. If `docker` is available, build one image (`docker build -f apps/server/Dockerfile .`) up to the install step, and say in your Report whether you could.

### Allowed files
- `apps/server/Dockerfile`
- `apps/web/Dockerfile`
- `apps/site/Dockerfile`
- `deploy/desk/Dockerfile.agent`
- `work/T-1917-docker-copy-patches.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **All four Dockerfiles** copy `patches/` before `pnpm install`.
- **The lead's push** gets a green "Production images" run.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Added `COPY patches ./patches` right after the root manifest `COPY` line and before
`RUN pnpm install` in all four Dockerfiles that install with pnpm, so pnpm can read the
`patchedDependencies` entry in `pnpm-workspace.yaml` and open the patch:

- `apps/server/Dockerfile` (before the install at line 33);
- `apps/web/Dockerfile` (before the install at line 33);
- `apps/site/Dockerfile` (before the install at line 21);
- `deploy/desk/Dockerfile.agent` (before the install at line 33).

Each copy site also has a one-line comment saying why the directory is needed during
install. I checked that these four are the only Dockerfiles in the repo that run
`pnpm install`. `patches/` is not in `.dockerignore`, so it reaches the build context.

Files changed:
- `apps/server/Dockerfile`
- `apps/web/Dockerfile`
- `apps/site/Dockerfile`
- `deploy/desk/Dockerfile.agent`
- `work/T-1917-docker-copy-patches.md`

### Checks run

- `pnpm install --frozen-lockfile`: Done in 17.8s using pnpm v10.32.1.
- `pnpm gate`: 5 changed files against main; PASS install / format / lint / typecheck;
  SKIP tests (no nearby test files) and SKIP effect (no source files changed);
  scope check passed; `GATE PASS`. No files outside the Allowed files.
- `docker build --target builder -f apps/server/Dockerfile .`: not run — the lead
  rejected the command ("skip the local docker build; the CI Production images run
  verifies it after the push"). Docker is installed on this machine.

### Notes for the lead

I could not verify the image build locally because the lead asked me to skip it, so the
first real proof that the ENOENT is gone is the next "Production images" run. If that
run still fails, check that the patch file itself is in the build context (it is
committed at `patches/expo-share-intent@8.0.1.patch`).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `fcd8ab461`.
- **The fix:** `COPY patches ./patches` comes before `pnpm install` in the server, web, site and desk-agent Dockerfiles, and `patches` isn't in `.dockerignore`.
- **Unverified locally:** the lead skipped the local Docker build. The proof is the next "Production images" run on the push.
