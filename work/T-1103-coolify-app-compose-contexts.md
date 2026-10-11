---
id: T-1103
title: "Deploy fix: docker-compose.app.yml build contexts are relative to the repo root (Coolify passes --project-directory <repo root>)"
status: merged
milestone: M5
branch: task/T-1103-coolify-app-compose-contexts
model: auto
effort: default
depends_on: [T-1102]
estimate: 0.05 day
---

# T-1103: Repo-root build contexts

## Spec (written by Claude, do not edit)

### Why
The first Coolify deploy of the new Application `zilar-chat` (deployment `hsianyeqwjkni8cjycny9vte`, commit `487e4bfc`) failed in 19 s with `resolve : lstat /apps: no such file or directory`.

Coolify runs:
`docker compose --project-directory /artifacts/<id> -f /artifacts/<id>/deploy/coolify/docker-compose.app.yml build`.

With `--project-directory` set to the **repo root**, relative `build.context` paths resolve from the repo root, not from the compose file's folder. So the `../..` and `..` that T-1102 wrote (`deploy/coolify/docker-compose.app.yml:42-44, 66-68, 115-119, 230-232`) point outside the checkout. The log also says "Dockerfile not found for service … at ../../apps/server/Dockerfile".

### What to build
1. **In `deploy/coolify/docker-compose.app.yml` only:**
   - **postgres:** `context: deploy`, `dockerfile: postgres/Dockerfile`;
   - **ejabberd:** `context: deploy`, `dockerfile: ejabberd/Dockerfile`;
   - **server:** `context: .`, `dockerfile: apps/server/Dockerfile`, with the `args` unchanged;
   - **web:** `context: .`, `dockerfile: apps/web/Dockerfile`.
2. **Add one header line:** paths are relative to the repo root, because Coolify passes `--project-directory <repo root>`; to check locally, run `docker compose --project-directory . -f deploy/coolify/docker-compose.app.yml config`.
3. **Proof in the Report:** from the repo root, run `docker compose --project-directory . -f deploy/coolify/docker-compose.app.yml config | grep -A2 "context:"`. It must show absolute paths ending in `/deploy` (twice) and the repo root (twice).
4. **No other files change.**

### Read first
`AGENTS.md` and `deploy/coolify/docker-compose.app.yml`.

### Allowed files
`deploy/coolify/docker-compose.app.yml`, `work/T-1103-coolify-app-compose-contexts.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 3.

---

## Report (written by the worker when done)

### What I did
Changed every `build.context` in `deploy/coolify/docker-compose.app.yml` so it resolves against the repo root, matching Coolify's `docker compose --project-directory <repo root>` call:
- `postgres`: `context: deploy`, `dockerfile: postgres/Dockerfile`;
- `ejabberd`: `context: deploy`, `dockerfile: ejabberd/Dockerfile`;
- `server`: `context: .`, `dockerfile: apps/server/Dockerfile` (its `args` are unchanged);
- `web`: `context: .`, `dockerfile: apps/web/Dockerfile`.

I also corrected the header comment: the two now-stale sentences that described contexts relative to `deploy/coolify/` (`../..` / `..`) were replaced with the repo-root rule plus the local check command, and the two parenthetical context references in the "Each service is built from the Dockerfile …" paragraph were updated to `.` and `deploy`.

### Files changed
- `deploy/coolify/docker-compose.app.yml`
- `work/T-1103-coolify-app-compose-contexts.md` (status + this Report)

No other files changed (gate confirms scope).

### Commands run (real results)
- `pnpm install`: done in 9.7s, all 16 workspace projects linked.
- `docker compose --project-directory . -f deploy/coolify/docker-compose.app.yml config | grep -A2 "context:"` (the step 3 proof):

```
      context: /Users/julio/personal-projects/zilar-T-1103/deploy
      dockerfile: ejabberd/Dockerfile
      context: /Users/julio/personal-projects/zilar-T-1103/deploy
      dockerfile: postgres/Dockerfile
      context: /Users/julio/personal-projects/zilar-T-1103
      dockerfile: apps/server/Dockerfile
      context: /Users/julio/personal-projects/zilar-T-1103
      dockerfile: apps/web/Dockerfile
```

Absolute paths end in `/deploy` twice (ejabberd, postgres) and are the repo root `/Users/julio/personal-projects/zilar-T-1103` twice (server, web) — as required.

- `pnpm gate` (from the repo root):

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (0.8s)
PASS  typecheck  (1.2s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test files were run: the change is a YAML deploy config, not package source, so the gate's test step is skipped ("no source files changed").

### Problems / deviations
- Spec step 2 said "add one header line". I replaced the incorrect existing header sentence rather than only adding a line, because the old text stated the wrong rule (`../..` / `..` relative to `deploy/coolify/`) and would have contradicted the fix. I also updated the matching parenthetical context references later in the same header block. The required repo-root statement and the local `config` check command are both present.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** the build contexts in `docker-compose.app.yml` are relative to the repo root: `deploy` for postgres and ejabberd, `.` for the server and web. A header line explains that Coolify passes `--project-directory <repo root>`.
- **The lead re-ran the proof:** `docker compose --project-directory . … config` resolves the contexts to `<repo>/deploy` twice and `<repo>` twice.
- **Check:** the gate passed. Coolify's deploy of this commit is the real test.
