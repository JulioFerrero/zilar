---
id: T-1941
title: "Drop the CI Coolify deploy job (revert T-1940): no Coolify key in GitHub"
status: merged
milestone: M5
branch: task/T-1941-drop-ci-coolify-deploy
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1941: Remove the CI deploy job

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "its the first time i see a project in coolify ask to add a coolify key in github", and Zilar must work the same for anyone self-hosting it. He chose to revert T-1940's CI job and keep T-1939's layout fixes.

### Facts (read by the lead on 2026-10-18, main `546057231`)
- **`.github/workflows/images.yml`** (385 lines): T-1940 appended the job `deploy` at the end of `jobs`. It starts with the comment `# T-1940: zilar-server and zilar-web are Docker-image Apps with no watch` (`:346`), the job key is at `:350`, and it runs to the end of the file. The job before it ends at `:344` (the `installer` job's `gh release upload … --clobber` / `fi`).
- **`deploy/coolify/LAYOUT.md`** (350 lines): the section `## Deploys from CI` (`:162`) runs up to just before `## Variables`. It holds the 4-secret table (`COOLIFY_URL`, `COOLIFY_DEPLOY_TOKEN`, `COOLIFY_SERVER_APP_UUID`, `COOLIFY_WEB_APP_UUID`).

### Steps
1. In `images.yml`, delete the whole `deploy` job, together with its `# T-1940` comment block, so the file ends with the `installer` job exactly as before T-1940.
2. In `LAYOUT.md`, delete the whole `## Deploys from CI` section. In the server and web app bullets, replace any "CI calls Coolify's `POST /deploy`" sentence with: "How a deploy is triggered is not decided yet (no Coolify key in GitHub)."
3. Leave everything T-1939 changed untouched.

### Allowed files
- `.github/workflows/images.yml`
- `deploy/coolify/LAYOUT.md`
- `work/T-1941-drop-ci-coolify-deploy.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `images.yml` has no `deploy` job and no `COOLIFY_*` secret.
- LAYOUT.md has no "Deploys from CI" section and no Coolify-key instructions.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Reverted T-1940's CI deploy job and its documentation; T-1939's layout work is untouched.

1. `.github/workflows/images.yml`: deleted the whole `deploy` job (its `# T-1940:`
   comment block, the four `COOLIFY_*` secrets and the `curl` deploy helper). The
   file now ends with the `installer` job's `gh release upload … --clobber` / `fi`,
   exactly as before T-1940 (385 → 344 lines).
2. `deploy/coolify/LAYOUT.md`: deleted the `## Deploys from CI` section, including
   the four-secret table and the "secrets not set; skipping" note (350 → 327 lines).
   In the `zilar-server` and `zilar-web` bullets the `**Deploys:**` line now reads
   "How a deploy is triggered is not decided yet (no Coolify key in GitHub)", keeping
   the existing sentence that the App has no watch paths.
3. Nothing else was changed. A grep for `COOLIFY`, `Deploys from CI` and `deploy job`
   in both files returns no match.

### Checks run

- `pnpm install` — Done in 11.8s.
- `pnpm gate` — real summary:

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- No single test file was run: the change touches only a workflow YAML and a Markdown
  doc, so no package has a nearest test.

### Notes for the lead

- "3 changed file(s)" are the two allowed repo files plus this task file (allowed).
- The `Deploys:` bullets keep the "no watch paths" fact, so the layout still says why a
  new `:latest` tag does not reach the host on its own; only the trigger is left open.
- No Coolify key, token or URL remains anywhere in the two files.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `df9b5173f`, CLEAN.
- **The diff only removes:** −41 lines in `images.yml` (the `deploy` job) and the "Deploys from CI" section in LAYOUT.md.
- **Checked:** `grep COOLIFY_` finds 0 hits in both files.
- **Julio's decision (10-18):** no Coolify key in GitHub, and no split for now. Fast stop for every install comes instead.
