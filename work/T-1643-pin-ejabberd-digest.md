---
id: T-1643
title: "Pin the ejabberd base image by digest (audit OPS-7 remainder): ghcr.io/processone/ejabberd:26.07@sha256:5aeb0faa… in the production Dockerfile and the dev compose"
status: merged
milestone: M5
branch: task/T-1643-pin-ejabberd-digest
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1643: Pin ejabberd by digest

## Spec (written by Claude, do not edit)

### Why
Audit finding OPS-7 (`docs/audit/findings-sweep-server.md:70`): "the base image is still pinned by tag, not digest". A re-pushed `26.07` tag would silently change the chat server on the next build.

### Facts (the lead read them on 2026-10-16)
- **Where the tag is used:** `deploy/ejabberd/Dockerfile:19` (`FROM ghcr.io/processone/ejabberd:26.07`) and `infra/docker-compose.dev.yml:44` (`image: ghcr.io/processone/ejabberd:26.07`). These are the only two uses outside docs.
- **The digest:** the lead read the multi-arch index digest of that tag from ghcr.io's public registry on 2026-10-16: `sha256:5aeb0faa39cfe38792c5eea9cc6344ba9ab6c59c708a24e897d6b471882c8497` (content type `application/vnd.oci.image.index.v1+json`, so it covers amd64 and arm64).

### Steps
1. **`deploy/ejabberd/Dockerfile:19`** becomes `FROM ghcr.io/processone/ejabberd:26.07@sha256:5aeb0faa39cfe38792c5eea9cc6344ba9ab6c59c708a24e897d6b471882c8497`. Add one comment line above it: the digest pins the 26.07 index (OPS-7), and to upgrade, change the tag and the digest together.
2. **`infra/docker-compose.dev.yml:44`:** the same `image:` value with the same digest.
3. **Don't pull or call any registry.** The digest above is given.

### Allowed files
- `deploy/ejabberd/Dockerfile`
- `infra/docker-compose.dev.yml`
- `work/T-1643-pin-ejabberd-digest.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Both references carry the tag and the digest.**
- **The gate passes.**
- **CI's image build passes after the merge** (the lead checks).

---

## Report (written by the worker when done)

### What I did
- `deploy/ejabberd/Dockerfile`: added one comment line above the base image and changed the `FROM` to `ghcr.io/processone/ejabberd:26.07@sha256:5aeb0faa39cfe38792c5eea9cc6344ba9ab6c59c708a24e897d6b471882c8497`.
- `infra/docker-compose.dev.yml`: changed the ejabberd `image:` value to the same tag@digest.
- Confirmed with a repo-wide grep (`processone/ejabberd`) that these are the only two non-doc uses of the tag; every other match is under `docs/` or `work/` and was left alone.
- Did not pull or query any registry (digest was given by the lead).

### Checks run
- `pnpm install`: Done in 14.3s (1 deprecated subdependency warning, pre-existing).
- `pnpm gate` (from repo root): GATE PASS. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (1.2s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No single test files were run: the change touches only Docker/compose config, no test-relevant code.

### Notes for the lead
- The digest is the multi-arch index digest supplied in the spec; I did not verify it against the registry (the spec said not to).
- The pre-existing comment in `infra/docker-compose.dev.yml:43` ("pinned to the 26.07 release") already read correctly for the digest-pinned value, so I left it unchanged; the spec only asked to change the `image:` value there.
- The Dockerfile comment is a single line as the spec requested.

## Review (written by Claude)

**Approved and merged.** This closes audit finding OPS-7.

- **Pre-review:** clean.
- **The change:** both references carry `26.07@sha256:5aeb0faa…`, the multi-arch index digest the lead read from ghcr.io.
- **After the merge:** the lead checks that Coolify's ejabberd build on the VPS passes.
