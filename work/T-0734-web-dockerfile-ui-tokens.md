---
id: T-0734
title: "fix the production web image build: apps/web/Dockerfile copies packages/ui-tokens (manifest + sources), which @zilar/web imports since T-0240; every 'Production images' run on main has failed on it since at least 2026-10-08"
status: todo
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

## Review (written by Claude)
