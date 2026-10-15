---
id: T-1594
title: "Demo of the Coolify catalog submission (Julio asked to see it as a draft PR in our repo, not merged): deploy/coolify/catalog/ mirrors the two upstream repos — coolify/templates/compose/zilar.yaml (pinned v0.2.0 images, Coolify's template rules), coolify/svgs/zilar.svg, coolify-docs/content/docs/services/zilar.mdx plus its logo, and PR.md with both pull request texts"
status: review
milestone: M5
branch: task/T-1594-coolify-catalog-demo-pr
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1594: Coolify catalog submission, as a demo

## Spec (written by Claude, do not edit)

### Why
- **Julio wants to see** what we would submit to Coolify's one-click catalog.
- **What upstream needs** (Coolify's guide, `coollabsio/coolify-docs` `content/docs/contribute/service.mdx`, read by the lead on 2026-10-15):
  - a template PR against `coollabsio/coolify` branch `next` adding `templates/compose/<service>.yaml` and `svgs/<service>.svg`;
  - plus a **required** docs PR in `coollabsio/coolify-docs` adding `content/docs/services/<slug>.mdx` and the logo under `public/images/services/`.
- **Eligibility:** the project needs 1,000 GitHub stars, and Zilar has 0 today. So this is a demo, opened by the lead as a **draft PR in our own repo**. It is never merged into main.

### Facts (the lead read them on 2026-10-15)
- **Coolify's template rules** (that guide):
  - **header comments:** `# documentation:`, `# slogan:`, `# category:` (one word), `# tags:` (comma-separated), `# logo: svgs/<name>.svg`, `# port:`;
  - **image tags:** pin a specific version, never `latest` or another floating tag;
  - **omit what Coolify adds:** `container_name`; `restart` (Coolify defaults to `unless-stopped`; set it only for different behaviour); top-level declarations for plain named volumes;
  - **networks:** the default network is added by Coolify; declare custom networks only when needed;
  - **required variables:** mark them `${VAR:?}`;
  - **docs page frontmatter:** `title`, `description`, `category`, optional `icon` and `og.description`;
  - **docs page body:** `# Name`, the logo image, "What is …?", and "Links" with `?utm_source=coolify.io`.
  - **Commit and PR title style:** `feat(service): add <name>` (`coollabsio/coolify` `CONTRIBUTING.md`).
- **Our tested template** is `deploy/coolify/docker-compose.yml` (T-1592): images `ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-*:${IMAGE_TAG:-latest}`, the 9 `SERVICE_PASSWORD_*`, `SERVICE_URL_WEB_80`, the desk services behind `profiles: ['desks']`, and the logo `deploy/coolify/zilar.svg`.
  - **The lead's rehearsal on Coolify 4.4.6 passed:** all secrets generated; healthy in under 2 minutes; `/health` 200, `/api/me` 401, WebSocket 101, `/xmpp-ws/api` 404 over Let's Encrypt; desk services not created while off. Details: `work/T-1592-coolify-template.md` › Review.
- **Release images** are tagged like `v0.1.13`, e.g. `ghcr.io/julioferrero/zilar-server:v0.1.13`. The next release is `v0.2.0`, which Julio has approved and the lead tags soon.

### Steps
Create these files. **Change nothing outside `deploy/coolify/catalog/`.**
1. **`deploy/coolify/catalog/coolify/templates/compose/zilar.yaml`:** start from `deploy/coolify/docker-compose.yml`, then apply Coolify's rules:
   - literal `ghcr.io/julioferrero/zilar-<name>:v0.2.0` images (no `IMAGE_OWNER`/`IMAGE_TAG`);
   - no `restart: unless-stopped` (keep the desk services' `restart: on-failure`, which differs on purpose);
   - drop top-level declarations of plain named volumes;
   - keep `desk-net`/`desk-out` (needed);
   - comments trimmed to what a Coolify user needs (the header, plus a few lines on AI computers being off and how to turn them on).
   - Keep every service, variable and health check otherwise identical.
2. **`deploy/coolify/catalog/coolify/svgs/zilar.svg`:** a copy of `deploy/coolify/zilar.svg`.
3. **`deploy/coolify/catalog/coolify-docs/content/docs/services/zilar.mdx`:** the frontmatter (`title: "Zilar"`, a short description, `category: "Communication"` or the closest existing category, `og.description`), then:
   - "What is Zilar?" (2–4 sentences);
   - **"AI computers":** off by default; turn them on with `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host` on the host, then the four variables;
   - "Links": the repo and `https://zilar.app`, with `?utm_source=coolify.io`.
4. **`deploy/coolify/catalog/coolify-docs/public/images/services/zilar.svg`:** the same logo.
5. **`deploy/coolify/catalog/PR.md`:** both PR texts as we would submit them:
   - **the template PR** (title `feat(service): add zilar`, base `next`): what Zilar is; the files; how it was tested (the rehearsal facts above); notes for reviewers (the desk services need host prep and run privileged with the Docker socket only when the user turns them on; the guard exits 0 otherwise); the link to the docs PR;
   - **the docs PR** (title `docs(services): add zilar`);
   - **eligibility:** one line saying it waits for 1,000 stars.
6. **`deploy/coolify/catalog/README.md`** (5 lines): what this folder is, and that it is not used by any install.

### Tests
None.

### Allowed files
- `deploy/coolify/catalog/coolify/templates/compose/zilar.yaml` (new)
- `deploy/coolify/catalog/coolify/svgs/zilar.svg` (new)
- `deploy/coolify/catalog/coolify-docs/content/docs/services/zilar.mdx` (new)
- `deploy/coolify/catalog/coolify-docs/public/images/services/zilar.svg` (new)
- `deploy/coolify/catalog/PR.md` (new)
- `deploy/coolify/catalog/README.md` (new)
- `work/T-1594-coolify-catalog-demo-pr.md`

### Checks
```bash
docker compose -f deploy/coolify/catalog/coolify/templates/compose/zilar.yaml config --quiet
pnpm gate
```
Run the check with dummy `SERVICE_*` values; at that point the `v0.2.0` images may not exist yet, but `config` doesn't pull.

### Acceptance
- **The Report gives:**
  - the diff between `zilar.yaml` and `deploy/coolify/docker-compose.yml` (expected: images, restart lines, volume declarations, comments);
  - the `config` result.

---

## Report (written by the worker when done)

### What I did

Created `deploy/coolify/catalog/`, mirroring the two upstream PRs. Nothing
outside the six new catalog files was changed.

- `deploy/coolify/catalog/coolify/templates/compose/zilar.yaml` — the Coolify
  template, derived from `deploy/coolify/docker-compose.yml`:
  literal `ghcr.io/julioferrero/zilar-<name>:v0.2.0` images; no
  `restart: unless-stopped` (kept the desk services' `restart: on-failure`);
  dropped the top-level plain named-volume declarations; kept `desk-net` /
  `desk-out`; trimmed the comments to the Coolify header plus a short block on
  AI computers. Every service, variable and health check is otherwise identical.
- `deploy/coolify/catalog/coolify/svgs/zilar.svg` — copy of
  `deploy/coolify/zilar.svg`.
- `deploy/coolify/catalog/coolify-docs/content/docs/services/zilar.mdx` — the
  docs page: frontmatter (`title`, `description`, `category: "Communication"`,
  `icon`, `og.description`), "What is Zilar?", an "AI computers" section (host
  command + the four variables), and "Links" with `?utm_source=coolify.io`.
  Logo paths match existing pages (`/docs/images/services/zilar.svg`).
- `deploy/coolify/catalog/coolify-docs/public/images/services/zilar.svg` — same
  logo.
- `deploy/coolify/catalog/PR.md` — both PR texts (`feat(service): add zilar`
  against `next`, and `docs(services): add zilar`), incl. the rehearsal test
  facts, reviewer notes and the 1,000-star eligibility line.
- `deploy/coolify/catalog/README.md` — 4 lines: what the folder is and that no
  install reads it.

### Checks run

- **Structural diff** between `deploy/coolify/catalog/coolify/templates/compose/zilar.yaml`
  and `deploy/coolify/docker-compose.yml` (comments stripped). As expected, the
  only differences are:
  - **images** (5): `${IMAGE_OWNER:-…}/${IMAGE_TAG:-latest}` →
    `ghcr.io/julioferrero/zilar-<name>:v0.2.0` (postgres, ejabberd, server, web,
    desk-agent ×2);
  - **restart lines**: `restart: unless-stopped` removed from `postgres`,
    `ejabberd`, `server`, `web`; the desk services keep `restart: on-failure`;
  - **volume declarations**: the top-level `volumes:` block (7 plain named
    volumes) is gone;
  - **comments**: 161 comment lines in the source, 42 in the template.
  No service, variable or health check differs.

- **`docker compose -f deploy/coolify/catalog/coolify/templates/compose/zilar.yaml config --quiet`**
  (dummy `SERVICE_*` values): **FAILS**, expected for a Coolify template:

  ```text
  service "server" refers to undefined volume sticker-data: invalid compose project
  ```

  This is not a defect in the file. Coolify's guide
  (`content/docs/contribute/service.mdx`, "Configuration Coolify adds") says a
  template **may omit** top-level declarations for ordinary named volumes
  because *Coolify adds them when it parses the Service*, and that "these
  additions apply to Coolify's normal service parsing, **not to running the
  template directly with Docker Compose**". Plain `docker compose` requires
  those declarations, so it cannot parse any template that follows that rule —
  the same is true of upstream's own `templates/compose/plausible.yaml`. Proof
  that the file is otherwise well-formed: copying the template and appending the
  7 declarations Coolify would add makes
  `docker compose config --quiet` print nothing and exit 0, and
  `config --services` lists `postgres ejabberd server web` (desks correctly off
  by profile).

- **`pnpm gate`** from the repo root:

  ```text
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- No unit tests: the change is compose/docs/SVG only (spec says "Tests: None"),
  so no `pnpm --filter … test` run.

### Notes for the lead

- **Deviation / needs your call — the compose check.** The spec's step 1 tells
  me to drop the top-level plain named-volume declarations, and its expected
  diff names "volume declarations"; I did both. But the spec's Checks line then
  asks `docker compose … config --quiet` to pass on that same file, and it
  cannot: `docker compose` refuses an undeclared named volume, while Coolify's
  parser — per its own guide, quoted above — is the thing that adds the
  declarations. The file is therefore correct/upstream-faithful, and the check
  is unsatisfiable as written. I kept the omission (it is what we would submit,
  and it matches the real `plausible.yaml`). If you would rather the local check
  pass, the fix is to restore the 7 empty volume declarations at the bottom of
  `zilar.yaml`; the guide says that is also allowed. Say which and I will
  adjust.
- Docs logo references use `/docs/images/services/zilar.svg`, matching existing
  pages (e.g. `plausible.mdx`), even though the file sits under
  `public/images/services/`. The task spec pins the filename to `zilar.svg`
  (not `zilar-logo.svg`), so I used that.
- `category: "Communication"` as the spec allowed; I could not list the docs
  site's existing categories from here, so if the generator expects a different
  spelling it is a one-word edit.
- `desk-net` keeps its fixed `name: desk-net` and `internal: true` (needed), and
  `desk-out` is kept as the spec's step 1 requires.
