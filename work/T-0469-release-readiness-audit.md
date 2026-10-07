---
id: T-0469
title: "Audit: release readiness — Effect 4.0 adoption status, README/docs freshness, and what a release could miss"
status: merged
milestone: M5
branch: task/T-0469-release-readiness-audit
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0469: release readiness audit

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-07) asked three things:
- "are we using Effect 4.0 in all the project?"
- "the readmes are updated?"
- "what can we miss in a release?"

This task answers all three with facts from the repo and produces one checklist. **Docs only: no code, config or package changes.**

### Verified facts (do not re-derive)
- **Effect:**
  - the plan is `docs/ROADMAP_EFFECT.md`: Effect inside, promises at the edges. UI components, route handlers, drizzle queries, migrations and better-auth glue are **not** meant to be converted (lines 7-9 and the "Not converted" line). Candidate areas are listed in the table (lines 12-21) and the pair sequence at lines 30-36;
  - the guide is `docs/EFFECT_GUIDE.md`;
  - `effect` is a dependency of `apps/server/package.json` only, according to a grep of every `package.json` under `apps/` and `packages/`.
- **READMEs:** `README.md`, `apps/mobile/README.md`, `apps/runner/README.md`, `apps/site/README.md`, `packages/runner-tunnel/README.md`, `packages/agent-drivers/README.md`, `work/README.md` and `docs/effect-reference/README.md`. The main docs are `docs/FEATURES.md` (its last history row covers 2026-10-04 to 2026-10-05), `docs/USER_GUIDE.md`, `docs/SERVER_CONFIG.md`, `docs/INSTALL_DOCKER.md` and `docs/INSTALL.md`.
- **Features merged since 2026-10-05** are not in `docs/FEATURES.md`, for example:
  - AI memory (T-0433 to T-0451);
  - forwarding and multi-select;
  - the media gallery (T-0410, T-0431);
  - the upload lock route (T-0453, T-0454);
  - chat backgrounds (T-0457 to T-0466).
  
  The merge history is `git log --oneline` on main, and `work/BOARD.md` holds the merged rows with dates.
- **New config:** `BACKGROUND_STORAGE_DIR` (T-0460) is set in `deploy/docker-compose.yml`, but `docs/SERVER_CONFIG.md` and `docs/INSTALL_DOCKER.md` do not mention it. `docs/INSTALL_DOCKER.md:250` and `:360` describe the avatar volume and backups.
- **Release:**
  - the recipe is in `docs/RELEASING.md` (sections 1-9, auto-deploy in §9);
  - the latest tag is `v0.1.9` (`git tag`);
  - migrations live in `apps/server/drizzle/`, with the head at `0044_*`.
- **Open live work:** the upload-lock cutover (Caddy `GET /upload/*` to the server, a redirect window) is pending and needs Julio (`docs/audit/upload-auth-plan.md` §5 and §7). Mobile still loads `/upload` directly.

### What to write: `docs/audit/release-readiness.md`
Every claim cites a `file:line` or a command and its output. Sections:
1. **Effect 4.0 status.** For each area in the `ROADMAP_EFFECT.md` table: converted, partly converted or not, with evidence (an `effect` import in the files, by grep).
   - List the server modules that import `effect` today.
   - Say plainly whether "all the project" uses Effect (the answer per the plan is **no, by design**: only logic inside modules), and which listed candidate areas are still open.
   - Check that the installed `effect` version is 4.x (from `apps/server/package.json` and the lockfile).
2. **README and docs freshness.** For each README and main doc:
   - **verdict:** current, stale (what is wrong, with line numbers) or missing info;
   - **`FEATURES.md`:** list every user-visible feature merged since the last history row that is missing, with its task ids, written as ready-to-paste table rows in the file's own format and status marks (🟡 Merged unless the board says live);
   - **`SERVER_CONFIG.md` and the install docs:** list every env var in `apps/server/src/config.ts` that they do not document.
3. **What a release could miss,** as a checklist, each item with evidence:
   - migrations since the last tag (`git log v0.1.9..main --stat -- apps/server/drizzle`);
   - new env vars and volumes, and whether `deploy/docker-compose.yml` sets them;
   - new storage dirs and whether backups (`docs/INSTALL_DOCKER.md` backup section and the backup script) include them, for example the wallpapers under `/data/avatars/backgrounds`;
   - features behind flags that are off by default;
   - the pending upload-lock cutover;
   - mobile build and version numbers (`apps/mobile/app.json` or `app.config`);
   - the Caddyfile vs new routes;
   - the auto-deploy secrets (`docs/RELEASING.md` §9);
   - anything in `docs/RELEASING.md` §1 that the current main would fail.
4. **Recommended order** of fixes before the next tag, each as a one-line task with its files.

### Read first
`AGENTS.md`, `docs/ROADMAP_EFFECT.md`, `docs/EFFECT_GUIDE.md` (skim), `docs/FEATURES.md`, `docs/RELEASING.md`, `docs/SERVER_CONFIG.md`, `docs/INSTALL_DOCKER.md`, `apps/server/src/config.ts`, `deploy/docker-compose.yml`, `deploy/caddy/Caddyfile`, `work/BOARD.md` (the merged rows from 2026-10-05 on).

### Allowed files
`docs/audit/release-readiness.md`, `work/T-0469-release-readiness-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/release-readiness.md` answers the three questions with evidence, gives ready-to-paste `FEATURES.md` rows and the undocumented env vars, and lists a release checklist with a recommended fix order.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/release-readiness.md` (355 lines) answering the three
questions with `file:line` and command evidence. No code, config or package
change. I read `AGENTS.md`, `docs/ROADMAP_EFFECT.md`, `docs/EFFECT_GUIDE.md`,
`docs/FEATURES.md`, `docs/RELEASING.md`, `docs/SERVER_CONFIG.md`,
`docs/INSTALL_DOCKER.md`, `docs/INSTALL.md`, `docs/USER_GUIDE.md`,
`apps/server/src/config.ts`, `deploy/docker-compose.yml`,
`deploy/caddy/Caddyfile`, `deploy/zilar`, `work/BOARD.md` and every README
named in the spec.

### Files changed

- `docs/audit/release-readiness.md` (new)
- `work/T-0469-release-readiness-audit.md` (status + this Report)

### Findings (short)

- **Effect 4.0:** installed (`apps/server/package.json:23` `^4.0.0`,
  lockfile `effect@4.0.0`). Adopted in exactly one module,
  `apps/server/src/voice-transcription/pipeline.ts`, plus its test. "All the
  project" is **no, by design** (`ROADMAP_EFFECT.md:8,26`); all other candidate
  areas are open. T-0172 was a host fix, not the planned Effect push rewrite.
- **Docs:** stale READMEs `apps/mobile/README.md` and
  `packages/runner-tunnel/README.md`; stale main docs `FEATURES.md`,
  `USER_GUIDE.md`, `SERVER_CONFIG.md`, `INSTALL_DOCKER.md`; `SERVER_CONFIG.md`
  misses `AVATAR_STORAGE_DIR` and `BACKGROUND_STORAGE_DIR`; `INSTALL_DOCKER.md`
  misses `BACKGROUND_STORAGE_DIR` and still says Voice is "Planned".
  Ready-to-paste `FEATURES.md` rows are in §2a.
- **Release checklist:** 6 migrations since the real latest tag `v0.1.13`
  (7 since the spec's `v0.1.9`); background wallpapers are already covered by
  `avatars.tgz` (`deploy/zilar:968-969`); the upload-lock cutover is pending
  and mobile still loads `/upload` directly; auto-deploy secrets and the
  tag-vs-auto-deploy wording in `RELEASING.md` need attention; local `main` is
  2 commits ahead of `origin/main` at audit time.

### Deviations from the spec

- The spec's "Verified facts" say the latest tag is `v0.1.9`; `git tag |
  sort -V` shows **`v0.1.13`** (2026-10-03), and `FEATURES.md:156` itself
  records the v0.1.13 release. I reported both the requested
  `v0.1.9..main` migration list (7 files) and the correct `v0.1.13..main`
  list (6 files) instead of silently using the wrong tag. This is itself a
  release-readiness finding, not an edit to the spec.
- The spec's `FEATURES.md` examples are the post-2026-10-05 features; I also
  listed the user-visible 2026-10-05 features that are missing from the file
  (blocking, chat folders, mobile mention picker, bottom bar, settings hub) as
  a separate group, because they are absent too.

### Commands run (real results)

```
$ pnpm install
Done in 18.9s (peer warning: @types/react-dom wants @types/react ^19.3.0, found 19.2.18)

$ pnpm gate
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (17.3s)
PASS  lint  (0.9s)
PASS  typecheck  (1.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single test files: none — no test file was touched (docs-only task), so there
was nothing to run with `pnpm --filter <package> test`.

### Blocked / needs a decision

Nothing blocked. Two items are flagged for Julio in §3–§4 of the audit: the
mobile version/buildNumber bump and the upload-lock cutover.

## Review (written by Claude)

Approved (lead, 2026-10-07). docs/audit/release-readiness.md finds:
- Effect 4.0.0 is installed, but only the voice-transcription pipeline uses it (by design for routes and UI; the other candidate areas are still open);
- FEATURES.md, the USER_GUIDE, README, the mobile README and the runner-tunnel README are stale, with ready rows;
- AVATAR and BACKGROUND_STORAGE_DIR are undocumented;
- the release checklist covers 6 migrations since v0.1.13 (it corrected the lead's v0.1.9), no backup before an auto-deploy migration, and the RELEASING sections 1 and 9 clash.
It also gives a fix order.
