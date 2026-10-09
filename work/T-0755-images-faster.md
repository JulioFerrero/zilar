---
id: T-0755
title: "images faster + docs-safe: the tip check accepts a run whose sha is the last main commit that changed non-docs paths; green-main builds are linux/amd64 only (the live host is x86_64) with the GitHub Actions build cache; version-tag releases stay multi-arch"
status: todo
milestone: M5
branch: task/T-0755-images-faster
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-0755: faster image builds that ignore docs-only commits

## Spec (written by Claude, do not edit)

### Why
Measured on 2026-10-09:
- **Duration:** green image runs take 14 min on average.
- **The hang:** the multi-arch server build hung for 3h18m (run 37911863834) in the arm64 leg, which runs under QEMU emulation.
- **The live host does not need arm64.** A `uname -m` in a live container gives `x86_64`.
- **The tip check must change.** T-0754 makes CI skip docs-only pushes, so after it lands, the tip of `main` can be a docs commit whose CI never ran. The current tip check would then skip building the code commit before it.

### Verified facts (do not re-derive)
- **`.github/workflows/images.yml`, the `tip` job** (lines 27-48): it compares `github.event.workflow_run.head_sha` with `git ls-remote … refs/heads/main` and sets `latest=false` when they differ.
- **The build steps:**
  - the no-push PR build (around line 189), the version-tag push (around 200) and the green-main push (around 217) all use `platforms: linux/amd64,linux/arm64` (lines 194, 205, 222);
  - there is no `cache-from` or `cache-to`;
  - `docker/setup-qemu-action` and `docker/setup-buildx-action` run earlier in the job.
- **The smoke step** ("Smoke-start the server image", T-0739/T-0743) already builds the server for amd64 locally.

### What to build
1. **The tip check:** fetch main (`git clone --filter=blob:none --no-checkout` or `actions/checkout` with `fetch-depth: 0`), and find the newest main commit that changed anything outside `work/`, `docs/` and `*.md`:
   `git log -1 --format=%H origin/main -- . ':(exclude)work/**' ':(exclude)docs/**' ':(exclude)**/*.md'`.
   Set `latest=true` when that sha equals `HEAD_SHA`. Keep the log lines explaining the decision. A newer code commit still makes an older run stale, as before.
2. **The green-main and PR builds:** `platforms: linux/amd64` only, plus `cache-from: type=gha,scope=${{ matrix.name }}` and `cache-to: type=gha,mode=max,scope=${{ matrix.name }}`. Run the QEMU setup step only for version tags (`if: startsWith(github.ref, 'refs/tags/v')`).
3. **The version-tag build:** stays `linux/amd64,linux/arm64`, because releases are for self-hosters who may run ARM. Add the same `cache-from` only.
4. **The smoke step:** if it can reuse the gha cache with `docker/build-push-action` and `load: true`, do so; otherwise leave it as it is. Say which in the Report.
5. **Comments:** one comment line for each change, citing the numbers above.

### Read first
`AGENTS.md`, `.github/workflows/images.yml`, `docs/RELEASING.md` §9.

### Allowed files
`.github/workflows/images.yml`, `docs/RELEASING.md`, `work/T-0755-images-faster.md`.

In `docs/RELEASING.md` §9, update only the sentences about multi-arch builds and the tip check.

### Checks
```bash
pnpm gate
```

### Acceptance
- The tip check uses the last commit that changed code.
- Green-main and PR builds are amd64-only with the gha cache; tag builds stay multi-arch.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks the first real run.

---

## Report (written by the worker when done)

## Review (written by Claude)
