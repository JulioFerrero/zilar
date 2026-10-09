---
id: T-0734
title: "fix the production web image build: apps/web/Dockerfile copies packages/ui-tokens (manifest + sources), which @zilar/web imports since T-0240; every 'Production images' run on main has failed on it since at least 2026-10-08"
status: merged
milestone: M5
branch: task/T-0734-web-dockerfile-ui-tokens
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0734: the web image needs packages/ui-tokens

## Spec (written by Claude, do not edit)

### Why
The GitHub workflow "Production images" builds the web image on every green main. That build fails, which also skips the deploy job (run 37882409884, 2026-10-09 04:07 UTC):

```
Error: [vite]: Rolldown failed to resolve import "@zilar/ui-tokens" from "/repo/apps/web/src/lib/chatBackground.ts".
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @zilar/web@0.1.0 build: `vite build`
```

`@zilar/web` depends on the workspace package `packages/ui-tokens` (T-0240), but the Dockerfile never copies it into the build.

### Verified facts (do not re-derive)
- **`apps/web/Dockerfile`:**
  - lines 22-25 copy the manifests: `apps/web/package.json`, `packages/protocol/package.json`, `packages/xmpp-core/package.json` and `packages/chat-core/package.json`;
  - lines 32-35 copy the sources: `apps/web`, `packages/protocol`, `packages/xmpp-core` and `packages/chat-core`;
  - `packages/ui-tokens` is in neither list.
- **`packages/ui-tokens/package.json`** has no `@zilar/*` dependencies of its own, so no further package is needed.
- **`apps/server/Dockerfile`** does not need `ui-tokens`: the server does not import it.

### What to build
1. **`apps/web/Dockerfile`:** add `COPY packages/ui-tokens/package.json packages/ui-tokens/` next to the other manifest copies, and `COPY packages/ui-tokens packages/ui-tokens` next to the other source copies. Change nothing else.
2. **Prove it locally,** if Docker is available: `docker build -f apps/web/Dockerfile -t zilar-web-check .` from the repo root must get past `pnpm --filter @zilar/web build`. Put the last lines of the build output in the Report. If Docker is not available, say so in the Report, and instead show that `pnpm --filter @zilar/web build` passes on the host.

### Read first
`AGENTS.md`, `apps/web/Dockerfile`, `packages/ui-tokens/package.json`.

### Allowed files
`apps/web/Dockerfile`, `work/T-0734-web-dockerfile-ui-tokens.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Both `COPY` lines are present.
- The Report has the build evidence.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/web/Dockerfile`: added `COPY packages/ui-tokens/package.json packages/ui-tokens/` after the chat-core manifest copy (line 26) and `COPY packages/ui-tokens packages/ui-tokens` after the chat-core source copy (line 37). Nothing else changed.
- Ran `pnpm install` in the worktree first (succeeded).

**Build evidence (Docker is available)**
- `docker build -f apps/web/Dockerfile -t zilar-web-check .` from the worktree root: exit 0.
- The `ui-tokens` COPY steps ran (builder steps 9/16 and 15/16). The vite step passed: `vite v8.3.1 building client environment for production...` then `✓ built in 928ms`. Last lines of the build output:
  ```
  #25 exporting manifest list sha256:7aa40447... done
  #25 naming to docker.io/library/zilar-web-check:latest done
  #25 unpacking to docker.io/library/zilar-web-check:latest 0.0s done
  #25 DONE 0.1s
  View build details: docker-desktop://dashboard/build/desktop-linux/desktop-linux/boitmd4u638pld0of0j2o1oq2
  ```
- Removed the check image: `docker image rm zilar-web-check` gave `Untagged: zilar-web-check:latest` and `Deleted: sha256:7aa40447...`. Nothing was pushed or run.

**Checks**
- `pnpm gate` (from the worktree root, `pwd` checked):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (17.8s)
  PASS  lint  (1.5s)
  PASS  typecheck  (4.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Changed files (`git status`): `apps/web/Dockerfile` and this task file only.

**Problems and deviations**
- None against the spec.
- Not changed, because the spec says "change nothing else": the comment at `apps/web/Dockerfile` lines 30-32 still lists only `@zilar/chat-core`, `@zilar/protocol` and `@zilar/xmpp-core` as the workspace imports. It is now stale for `@zilar/ui-tokens`. The lead may want to add that name in a follow-up.

**Open questions**
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 1.4 min). The lead reviewed the diff directly.
- **Change:** two `COPY` lines for `packages/ui-tokens`, nothing else.
- **Evidence:** the local `docker build -f apps/web/Dockerfile` exits 0 (vite: built in 928ms), and the check image was removed.
- **Deploy:** the repo has no Actions secrets, so auto-deploy stays off and this merge only publishes images.
- **Left for later:** the Dockerfile comment listing the workspace packages is stale.
