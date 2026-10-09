---
id: T-0752
title: "self-updating Effect map: move the map generator into packages/devtools (effect / plain / legacy per file, by package, files and lines, in-progress tasks from work/*.md), `pnpm effect:map` writes a static dist/effect-map/index.html, and a new effect-map.yml workflow publishes it to GitHub Pages on every push to main plus a coverage table in the run summary"
status: todo
milestone: M5
branch: task/T-0752-effect-map-pages
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0752: the Effect map updates itself

## Spec (written by Claude, do not edit)

### Why
Julio asked on 2026-10-09 for an Effect map that stays current without the lead republishing it. Today the map is a claude.ai artifact fed by a generator outside the repo, and the lead pushes new data by hand. The repo `JulioFerrero/zilar` is **public**, so GitHub Pages is free. The new page is static, built in CI from the commit being pushed.

### Verified facts (do not re-derive)
- **The current generator lives outside the repo.** Read it, but do not edit it:
  - `/Users/julio/.claude/jobs/fcd95e40/tmp/effect-map/gen.mjs` (77 lines): `git ls-files`, filtered to non-test `.ts`/`.tsx` under `apps/`, `packages/` and `scripts/`, excluding the patterns at lines 13-16. For each file it records the line count, the legacy libraries it imports (`LIBS` at lines 18-23: drizzle, hono, zod, zustand) and `effect` (any import of `effect`, `effect/*` or `@effect/*`).
  - It reads in-progress tasks from `~/.zilar-lead/state.json` plus the worktrees (lines 26-48). **That does not exist in CI.**
  - `/Users/julio/.claude/jobs/fcd95e40/tmp/effect-map/template.html` (343 lines) is the page. It takes its data inline (`/*DATA*/null`) and also subscribes to a claude.ai database (`db.doc('map/current').onSnapshot`, around line 334); that part must go.
  - `/Users/julio/.claude/jobs/fcd95e40/tmp/effect-map/build.mjs` inlines the data into the template.
- **The task files are in the repo:** `work/T-XXXX-*.md`, with `status:` in the front matter and an `### Allowed files` section listing backtick paths.
- **`packages/devtools`** runs TypeScript with `tsx` (`packages/devtools/package.json` scripts, lines 6-13). `dist/` is gitignored (`.gitignore:6`).
- **CI setup to copy:** `.github/workflows/ci.yml:23-32` (checkout, `pnpm/action-setup@v6`, `actions/setup-node@v7` with `node-version-file: .nvmrc` and `cache: pnpm`, then `pnpm install --frozen-lockfile`).

### What to build
1. **`packages/devtools/src/effect-map/generate.ts`**, a TypeScript port of `gen.mjs` that works in any checkout: the root comes from `git rev-parse --show-toplevel`, with no home-directory paths.
   - Per file, record `kind`: `legacy` if it imports a legacy library, else `effect` if it imports Effect, else `plain`.
   - Record "in progress" from `work/T-*.md` files whose `status` is `todo`, `in-progress` or `review`: their Allowed files and their task ids.
   - Summarise per package (`apps/server`, `apps/web` and so on) and in total: files and lines for each kind, and the Effect percentage by files and by lines.
   - Unit-test the classifier and the summary in `packages/devtools/src/effect-map/generate.test.ts` on a few in-memory sources.
2. **`packages/devtools/src/effect-map/template.html`**, adapted from the old template: static only, with the data inlined and no `claude.use` or database code.
   - Show the per-package table, the totals, a colour per kind (effect, plain, legacy) and the in-progress marks.
   - Keep the old page's look and filters where they still apply. It must work at phone width, in light and dark mode.
3. **`packages/devtools/src/effect-map/cli.ts`:** writes `dist/effect-map/index.html` and `dist/effect-map/data.json`, and prints a one-line summary. When `GITHUB_STEP_SUMMARY` is set, it also appends a markdown table (per package: files, Effect files, Effect % by lines, legacy files). Add the script `"effect:map"` to `packages/devtools/package.json` and a root alias `"effect:map": "pnpm --filter @zilar/devtools effect:map"` to `package.json`.
4. **New `.github/workflows/effect-map.yml`:**
   - triggers on `push` to `main` and on `workflow_dispatch`;
   - `permissions: { contents: read, pages: write, id-token: write }`;
   - `concurrency: { group: pages, cancel-in-progress: true }`;
   - `timeout-minutes: 10`;
   - steps: the setup copied from `ci.yml`, then `pnpm effect:map`, then `actions/upload-pages-artifact` with `path: dist/effect-map`, then `actions/deploy-pages` in an `environment: github-pages` job.

   Pin the action versions you use, and read their READMEs (fetch the GitHub pages) for the current major versions.

   **Do not enable Pages yourself.** That is a repository setting Julio approves; the lead does it.

### Read first
`AGENTS.md`, the three files under `/Users/julio/.claude/jobs/fcd95e40/tmp/effect-map/` (read only), `.github/workflows/ci.yml`, `packages/devtools/package.json`, `package.json`.

### Allowed files
`packages/devtools/src/effect-map/generate.ts`, `packages/devtools/src/effect-map/generate.test.ts`, `packages/devtools/src/effect-map/cli.ts`, `packages/devtools/src/effect-map/template.html`, `packages/devtools/package.json`, `package.json`, `.github/workflows/effect-map.yml`, `work/T-0752-effect-map-pages.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/effect-map
pnpm effect:map
pnpm gate
```
Paste the `pnpm effect:map` summary line into the Report, and open `dist/effect-map/index.html` locally to check that it renders. Report what you checked.

### Acceptance
- `pnpm effect:map` writes a working static page and a JSON file from any checkout.
- The workflow file is complete.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
