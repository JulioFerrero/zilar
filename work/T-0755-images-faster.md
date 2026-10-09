---
id: T-0755
title: "images faster + docs-safe: the tip check accepts a run whose sha is the last main commit that changed non-docs paths; green-main builds are linux/amd64 only (the live host is x86_64) with the GitHub Actions build cache; version-tag releases stay multi-arch"
status: merged
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

**Changed (3 files):** `.github/workflows/images.yml`, `docs/RELEASING.md` (§9, two sentences), this task file.

**What was done**
- **Tip check (`tip` job):** added `actions/checkout@v7` with `fetch-depth: 0`. The compare step runs `git log -1 --format=%H origin/main -- . ':(exclude)work/**' ':(exclude)docs/**' ':(exclude)**/*.md'`, sets `latest=true` only when that sha equals `HEAD_SHA`, and logs the decision. The `git ls-remote` call is gone.
  - Checked in the worktree: the same filter run from HEAD `f24203d8` (the spec commits above it) returns `73fae1bf T-0751: drizzle out of the server`, so docs and spec commits are skipped.
- **Platforms per build step:**
  - new smoke build step: `linux/amd64`, `load: true`, `cache-from` gha;
  - no-push PR build: `linux/amd64`, `cache-from` + `cache-to` (mode=max);
  - version-tag push: `linux/amd64,linux/arm64`, `cache-from` only;
  - green-main push: `linux/amd64`, `cache-from` + `cache-to` (mode=max).
  - Every gha cache uses `scope=${{ matrix.name }}`.
- **QEMU:** `docker/setup-qemu-action@v4` now has `if: startsWith(github.ref, 'refs/tags/v')`. I also gave it a name, which the spec did not ask for.
- **Smoke step reuses the cache:** yes. The `docker build` line is removed from the "Smoke-start the server image" run step; a new `docker/build-push-action@v7` step (`load: true`, `cache-from` gha, `scope=zilar-server`) builds the image first. Its `build-args` are not passed: `ZILAR_COMMIT` is an ARG in the runtime stage only (`apps/server/Dockerfile:48`), so the builder layers still hit the cache.
- **Comments:** one comment per change, citing the 3h18m hang (run 37911863834), the x86_64 host, and T-0754.
- **RELEASING §9:** the multi-arch sentence now says amd64 only with the gha cache, and tags still build amd64 and arm64. The tip-check sentence now says "last commit on `main` that changed code (not `work/`, `docs/` or `*.md`)".

**Checks**
- `pnpm install`: done.
- Docs read: `docs.docker.com/build/cache/backends/gha/` confirms a per-image `scope`, `cache-from` and `cache-to` used together, and `mode=max` as the example. The `docker/build-push-action` README excerpt does not describe the gha options or `load` with one platform. The `actions/checkout` README says `fetch-depth: 0` fetches all history for all branches.
- `actionlint`: not installed (`command -v actionlint` printed nothing), so not run.
- The workflow parses with the repo's `yaml@2.9.1` package (jobs `tip,build,deploy`). The tip script passes `bash -n`.
- `pnpm exec prettier --write` on the two source files: `images.yml` unchanged; `RELEASING.md` rewritten.
- `pnpm gate` (from the worktree root): `gate: 3 changed file(s) against main`, `PASS install (frozen) (1.1s)`, `PASS format (16.8s)`, `PASS lint (1.5s)`, `PASS typecheck (1.9s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. No package tests ran, because no package was touched.

**Process note:** I wrote a scratch copy of the tip script to the scratchpad to syntax-check it, then deleted it.

**Unverified (needs a real run)**
- `load: true` together with `cache-from: type=gha` on the single-platform smoke build: the docs did not cover this combination.
- The gha cache writes from a PR build and the job's `permissions` (`contents: read`, `packages: write`): not tested.
- The tip job now fetches full history on every green-main run; its 5-minute timeout is untested.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **The image-build check:** a full-history checkout, then `git log -1 origin/main` with `work/`, `docs/` and `*.md` excluded, so a docs commit on top no longer blocks the build of the code under it, and a newer code commit still makes older runs stale.
- **Platforms:** QEMU only for `v*` tags; green-main and PR builds are amd64-only (the live host reports `x86_64`); both use the gha cache scoped per image. Tags stay multi-arch, with `cache-from` only.
- **The smoke build:** it moved to `build-push-action` with `load: true` and a gha `cache-from`, placed after buildx setup and before the smoke run.
- **Merged before T-0754.** The first real run on main is the check, since `load` plus a gha cache is unverified until then.
