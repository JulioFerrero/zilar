---
id: T-1412
title: "HOTFIX: the server Docker image copies packages/desk (production build broken since T-1410), and the gate's server-image check catches a missing workspace package next time"
status: merged
milestone: M5
branch: task/T-1412-server-image-desk
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1412: The server image includes packages/desk

## Spec (written by Claude, do not edit)

### Why
**Production auto-deploy is blocked.** The Coolify build of `main` at `f0cf8f571` (T-1410) failed at `apps/server/Dockerfile:77` (`RUN pnpm --filter @zilar/server build`, exit code 1). Production still runs the previous commit, so nothing is down, but no merge deploys until this lands.

### Facts (the lead checked them on main, 2026-10-14)
- `apps/server/package.json:26` now has `"@zilar/desk": "workspace:*"`, and `apps/server/src/sandbox/ip-guard.ts` re-exports `@zilar/desk/egress/ip-guard` (T-1410).
- `apps/server/Dockerfile` copies only these workspace packages:
  - the manifests at `:25-28`: `api-contract`, `protocol`, `xmpp-core` and `runner-tunnel`;
  - the sources at `:36-39`;
  - a comment at `:32-34` that says "keep this list in sync".
  
  **`packages/desk` is missing from both.**
- `packages/desk/package.json` depends only on `effect` (catalog), plus `esbuild` as a dev dependency.
- The same Dockerfile is used by `deploy/coolify/docker-compose.app.yml:123` and `.github/workflows/images.yml:77`.

### What to build
1. **`apps/server/Dockerfile`:**
   - add `COPY packages/desk/package.json packages/desk/` with the manifests and `COPY packages/desk packages/desk` with the sources;
   - update the comment list at `:32-34` to include `@zilar/desk`.
2. **Prove the image builds locally:** `docker build -f apps/server/Dockerfile -t zilar-server:t1412 .` from the repo root. Put the last lines of its output in the Report, then remove the image.
3. **Catch this next time.** Add a small check to the gate: compare the `@zilar/*` workspace dependencies in `apps/server/package.json` (and in `apps/web/package.json` against `apps/web/Dockerfile`) with the `COPY packages/<name>` lines of that app's Dockerfile, and fail with a clear message when one is missing.
   - Put it where the gate's other static checks live (read `packages/devtools/src/gate/` first and follow the pattern; a new file, at most 400 lines).
   - It's a plain text check, with no Docker.
   - Add one test for it (devtools pipeline).

### Read first
`AGENTS.md`, `apps/server/Dockerfile`, `apps/web/Dockerfile`, and `packages/devtools/src/gate/`.

### Allowed files
`apps/server/Dockerfile`, `apps/web/Dockerfile`, `packages/devtools/src/gate/**`, `work/T-1412-server-image-desk.md`.

### Checks
```bash
docker build -f apps/server/Dockerfile -t zilar-server:t1412 .
pnpm gate
```

### Acceptance
- The local server image builds, and the gate passes.
- The new check fails on a copy of the Dockerfile without the desk lines (show this in the Report) and passes on the fixed one.

---

## Report (written by the worker when done)

### What I did
1. **`apps/server/Dockerfile`** — added `COPY packages/desk/package.json packages/desk/` to the manifest copies and `COPY packages/desk packages/desk` to the source copies, and added `@zilar/desk` to the "keep this list in sync" comment. The two lines mark the two stages a package needs, which is what the new gate check reads.
2. **`packages/devtools/src/gate/images.ts`** (new, ~130 lines) — a plain-text, no-Docker gate check. It reads the `@zilar/*` `workspace:` dependencies of an app manifest and the `COPY packages/<name> <name>` source lines of that app's Dockerfile, and reports a clear failure for every dependency the Dockerfile does not copy. `IMAGE_TARGETS` pairs `apps/server/package.json` with `apps/server/Dockerfile` and `apps/web/package.json` with `apps/web/Dockerfile`.
3. **`packages/devtools/src/gate/cli.ts`** — runs the image check next to the migration check on every gate run and prints `images: …` or `FAIL images: …` with one line per missing package.
4. **`packages/devtools/src/gate/gate.test.ts`** — added a `describe('image package check')`: the synthetic pre-fix/fixed case, the manifest-only-COPY and mock-backend cases, and a test that reads the real `apps/server` and `apps/web` manifests and Dockerfiles from disk and expects no failures.

### Files changed
- `apps/server/Dockerfile`
- `packages/devtools/src/gate/images.ts` (new)
- `packages/devtools/src/gate/cli.ts`
- `packages/devtools/src/gate/gate.test.ts`
- `work/T-1412-server-image-desk.md` (this file)

No file outside the Allowed files was touched (`git status --short` shows exactly the five above).

### Commands and results
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts` → `Test Files 1 passed (1)`, `Tests 40 passed (40)`.
- `docker build -f apps/server/Dockerfile -t zilar-server:t1412 .` → completed successfully. The relevant lines:
  - `#6 [builder 18/19] RUN pnpm --filter @zilar/server build`
  - `#26 [builder 19/19] RUN pnpm --filter @zilar/server deploy --prod --legacy /opt/zilar-server`
  - `#32 naming to docker.io/library/zilar-server:t1412 done`
  Image removed afterwards: `docker rmi zilar-server:t1412` → `Untagged: zilar-server:t1412`, `Deleted: sha256:2ff9d89f…`.
- Acceptance proof (the check fails on the pre-fix Dockerfile): ran the check against `git show HEAD:apps/server/Dockerfile` (the original, without the desk lines):
  `["apps/server/Dockerfile: missing \`COPY packages/desk packages/desk\` for @zilar/desk"]`
  The same check on the fixed Dockerfile returns `[]` (asserted in the test above).
- `pnpm gate` (repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/devtools  (0.6s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```
  (The first `pnpm gate` run failed `format` on the three new/edited TS files; `pnpm exec prettier --write` on those three fixed it and the re-run above is green.)

### Deviations from the spec
- **`@zilar/mock-backend` is deliberately excluded from the check.** `apps/web/package.json` lists `@zilar/mock-backend` as a `dependencies` entry, but the web app reaches it only through the `VITE_MOCK` branch that Vite folds out of a production build (`apps/web/src/mock/load.ts`), so `apps/web/Dockerfile` intentionally does not copy it — and never has, while `main`'s web image builds and deploys. A literal comparison would therefore fail on the already-correct web Dockerfile. I encoded the one exception in `NOT_IN_IMAGE` in `images.ts` with the reason in a comment. Every other `@zilar/*` workspace dependency is checked. If the lead would rather have the web Dockerfile copy the package instead, say so and I will change it.

### Open questions
- None blocking. The check is one-directional (a dependency missing from the Dockerfile), as the spec asked; extra packages in a Dockerfile (e.g. `packages/ball-avatar`, which the web app only needs transitively through `@zilar/chat-core`) are not flagged. A transitive-only gap like T-1101's ball-avatar would still slip past this check — it is not visible in `package.json`.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 2. The Dockerfile adds the packages/desk manifest and sources. The local docker build succeeded. The new gate images check flags the pre-fix Dockerfile ('missing COPY packages/desk'). After merge: watch the Coolify deploy and /health.
