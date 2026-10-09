---
id: T-0752
title: "self-updating Effect map: move the map generator into packages/devtools (effect / plain / legacy per file, by package, files and lines, in-progress tasks from work/*.md), `pnpm effect:map` writes a static dist/effect-map/index.html, and a new effect-map.yml workflow publishes it to GitHub Pages on every push to main plus a coverage table in the run summary"
status: merged
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

**Done.** All eight Allowed files are touched; nothing else changed. Model: Haiku 5.5 (single worker, no subagents).

### Files
- `packages/devtools/src/effect-map/generate.ts`: port of `gen.mjs`. Root from `git rev-parse --show-toplevel`; kinds `legacy` > `effect` > `plain`; per-package and total sums; open tasks from `work/T-*.md` (`todo`, `in-progress`, `review`) matched with `allowedTokens`/`tokenMatcher` from `packages/devtools/src/gate/scope.ts`.
- `packages/devtools/src/effect-map/generate.test.ts`: 18 tests (classifier, file filter, package and total sums, task parsing, title cut).
- `packages/devtools/src/effect-map/cli.ts`: writes `dist/effect-map/index.html` and `data.json` at the repo root, prints the summary line, appends a markdown table to `GITHUB_STEP_SUMMARY` when set.
- `packages/devtools/src/effect-map/template.html`: static page, data inlined, system fonts, no external requests, no claude.ai or `claude.use` code. Light and dark via `prefers-color-scheme`. Keeps the treemap, zoom, breadcrumbs and tooltip; adds a per-package table, the total, and an open-tasks list.
- `packages/devtools/package.json`: `effect:map` script. Root `package.json`: `effect:map` alias.
- `.github/workflows/effect-map.yml`: build job (checkout, pnpm, node from `.nvmrc`, `pnpm install --frozen-lockfile`, `pnpm effect:map`, upload `dist/effect-map`) and a deploy job in `environment: github-pages`. Triggers, permissions, concurrency and timeout as in the spec. Actions: `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7` (copied from `ci.yml`); `actions/upload-pages-artifact@v5` and `actions/deploy-pages@v5`. The latest release of each is v5 (GitHub API, checked 2026-10-09); their README examples still show v3/v4. The YAML parses; I did not run it on GitHub.
- Pages is not enabled and nothing was pushed.

### Commands and results
- `pnpm install`: done.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/effect-map`: 18 passed, 1 file.
- `pnpm effect:map`: `effect-map: 849 files (Effect 197, plain 652, legacy 0), Effect 35.7% of lines, 23.2% of files, 5 open tasks -> dist/effect-map/index.html`
- `git grep` for `zod`, `hono`, `drizzle-orm`, `zustand` imports in `apps`, `packages`, `scripts`: 0 files, which agrees with the `legacy 0` above.
- Open tasks by front matter (`todo`, `in-progress`, `review`): 5 (T-0009, T-0027, T-0618, T-0752, T-0753). The generator lists the same 5.
- `pnpm gate` (from the worktree root, after prettier on the changed files):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (4.5s)
  PASS  format  (30.7s)
  PASS  lint  (1.7s)
  PASS  typecheck  (3.2s)
  PASS  tests @zilar/devtools  (1.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### What I checked in the rendered page
Headless Chromium (Playwright from the worktree's `node_modules`), `file://` on `dist/effect-map/index.html`, with a throwaway script outside the worktree:
- Phone 390px, light and dark, and desktop 1280px dark: `document.documentElement.scrollWidth` equals `clientWidth` in all three (no horizontal scroll). No console errors, no network requests other than `file://`.
- The treemap paints (canvas pixels differ from the background). The headline reads 35.7%, the note and the 5 open tasks are right, and the package table has 15 rows (header, total, 13 packages).
- Mouse hover shows the tooltip (path, lines, kind, open task id). Clicking a folder zooms in and the breadcrumb shows the path; the first breadcrumb returns to the root.
- Looked at the phone light, phone dark and desktop dark screenshots: layout, legend and table are readable. I did not check desktop light separately (it uses the same tokens).

Two bugs found in that check and fixed: a top-level `let top` clashed with `window.top` (the page threw and rendered nothing); Prettier changed the `/*DATA*/null` marker to `/*DATA*/ null`, so the CLI now matches the marker with optional whitespace.

### Decisions and notes
- "Effect %" is the share of lines (and of files) whose kind is `effect`. A file that still imports a legacy library counts as `legacy` even if it also imports Effect. The old page's headline counted "not legacy" as done; I followed the spec's three kinds instead. Say if the headline should be "not legacy".
- As in `gen.mjs`, only static `import`/`export ... from` lines are read; dynamic `import()` and bare side-effect imports are not.
- The open-task outlines are wide: T-0009 covers 636 files and T-0027 covers 788, because their Allowed files are broad directory globs. The map looks busy because of that, not because the tool is wrong. Narrowing those Allowed lists would make the map clearer.
- The page keeps the old treemap look. There were no filters in the old page to keep.

### Blocked / needs a decision
Nothing blocked. Open question: whether the headline should be "Effect %" (as built) or "not legacy %" (the old page's definition). Fix round 1 keeps "Effect %" as the lead asked.

### Fix round 1 (lead review)
Cause 1, stale status: open tasks now come from `work/BOARD.md`. A row is open only when its status cell is exactly `todo`, `in-progress`, `review` or `blocked`; the task file gives the title (front matter) and the Allowed paths. `parseBoard`, `openTask` in `generate.ts`; tests in `generate.test.ts`.
Cause 2, "Not allowed": `allowedPaths` reads the Allowed section up to the next `###`, `---`, `## ` or `**Not allowed` line. Test uses the T-0009 shape (`apps/web/**`, `apps/mobile/**`, `packages/**`, `infra/**`, `docs/**` are left out).
Also fixed while testing: `blocked` was missing from the open statuses.

Results after the fix:
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/effect-map`: 22 passed, 1 file.
- `pnpm effect:map`: `effect-map: 851 files (Effect 197, plain 654, legacy 0), Effect 35.7% of lines, 23.1% of files, 2 open tasks -> dist/effect-map/index.html`
- Files carrying a task: 2 of 851 (the two counted files of T-0752; T-0753 covers none). The board has 2 open rows today (T-0752 and T-0753, both `in-progress`).
- `pnpm gate`: `gate: 8 changed file(s) against main`, PASS install, format, lint, typecheck, tests @zilar/devtools, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the code and looked at the rendered page in the browser.
- **The map:** a treemap per package, a per-package table, the kinds effect, plain and legacy, and no claude.ai code.
- **Fix round 1:** open tasks now come from the board rows (`todo`, `in-progress`, `review`, `blocked`), because front-matter statuses on main are stale. The Allowed parse also ignores the "**Not allowed**" line. 834 marked files became 2.
- **The workflow:** `effect-map.yml` runs on every push to main and uses `upload-pages-artifact@v5` and `deploy-pages@v5`; both majors exist.
- **Before it can go online:** GitHub Pages must be enabled, with the source set to "GitHub Actions" (a repo setting; it needs Julio's OK).
- **The measure:** Effect is 35.7% of lines, with 0 legacy files.
