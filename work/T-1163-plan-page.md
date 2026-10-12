---
id: T-1163
title: "GitHub Pages: a 'Fix plan' page next to the Code map, generated from docs/plan/plan.json plus each task's status in work/, in the Code map's style; sensitive items show a generic title until their task is merged"
status: merged
milestone: M5
branch: task/T-1163-plan-page
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1163: The fix plan page

## Spec (written by Claude, do not edit)

### Why
Julio likes the Code map (https://julioferrero.github.io/zilar/) and asked, on 2026-10-12, for a similar **public** page showing the new audit plans. He chose GitHub Pages over a private page.
- **How the Code map works:** `pnpm code:map` (`packages/devtools/src/code-map/cli.ts`) writes `dist/code-map/index.html` with the data inlined (`cli.ts:1-9`, `OUT_DIR = 'dist/code-map'`). It uses `template.html`, `style.css` and the scripts in that folder.
- **How it's published:** `.github/workflows/code-map.yml` builds on every push to main (`:4-7`), runs `pnpm code:map` (`:38`) and uploads `dist/code-map` (`:40-42`).
- **The data:** the lead keeps it in `docs/plan/plan.json`: the audits with counts and highlights, and the waves with items. An item has `task` (a task id, optional), `ref`, `title` and an optional `sensitive`.

### What to build
1. **A new folder `packages/devtools/src/plan-page/`,** following the `code-map/` layout: `cli.ts`, `collect.ts`, `template.html`, `style.css` and, if needed, `page.js`, each at most 400 lines. Run it with `pnpm plan:page`: add the script to `packages/devtools/package.json` and to the root `package.json`, like `code:map`.
   - **`collect.ts`:** read `docs/plan/plan.json` and, for every item with a `task`, the `status:` line of `work/<task>-*.md` (`todo`, `in-progress`, `review`, `merged`, `blocked`). An item without a task is `planned`.
   - **Sensitive items:** an item with `sensitive: true` and a status other than `merged` is rendered as **"Security hardening (details after the fix)"**, with no `ref`. Its real title and ref must **not appear anywhere** in the output HTML or the data.
   - **Output:** `dist/code-map/plan/index.html`, with everything inlined like the Code map. No external requests except fonts the Code map already uses, if any.
2. **The page:**
   - **Header:** "Fix plan", the `updated` date, the intro, and a link back to the Code map (`../`).
   - **An audits grid:** one card per audit, with the title, the model, the severity counts as small labelled pills, the highlights as a short list, and a link to the doc on GitHub (`https://github.com/JulioFerrero/zilar/blob/main/<doc>`).
   - **Waves:** each wave shows its title, goal and a progress bar (merged out of total items), then its items. Each item shows a status chip (planned, todo, in progress, review, merged, blocked) and its task id, linked to `https://github.com/JulioFerrero/zilar/blob/main/work/` plus its file.
   - **Overall progress** at the top: merged items out of all items.
   - **Style:** reuse the Code map's look (its colours, type and spacing, from `code-map/style.css`), light and dark. Icons, no emoji, and it must work at phone width.
3. **The Code map** gets a "Fix plan" link in its header (`code-map/template.html:16-17`) to `plan/`.
4. **The workflow:** add `- run: pnpm plan:page` after `pnpm code:map` in `.github/workflows/code-map.yml`.
5. **One test** (no UI tests; this guards a privacy rule), `packages/devtools/src/plan-page/collect.test.ts`: a sensitive, unmerged item's real title is absent from the rendered HTML, and a merged one shows it.

### Read first
`AGENTS.md`, `packages/devtools/src/code-map/` (all files: `cli.ts`, `template.html`, `style.css`, `page.js`), `.github/workflows/code-map.yml`, `docs/plan/plan.json` and one task file, for example `work/T-1158-block-really-blocks.md:1-11`, for the frontmatter.

### Allowed files
`packages/devtools/src/plan-page/cli.ts`, `packages/devtools/src/plan-page/collect.ts`, `packages/devtools/src/plan-page/collect.test.ts`, `packages/devtools/src/plan-page/template.html`, `packages/devtools/src/plan-page/style.css`, `packages/devtools/src/plan-page/page.js`, `packages/devtools/package.json`, `package.json`, `packages/devtools/src/code-map/template.html`, `.github/workflows/code-map.yml`, `work/T-1163-plan-page.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/plan-page/collect.test.ts --reporter=dot
pnpm plan:page
pnpm gate
```

### Acceptance
- The Checks pass, and `pnpm plan:page` writes `dist/code-map/plan/index.html`.
- Every new file stays at most 400 lines.
- **The lead's check after the merge:** https://julioferrero.github.io/zilar/plan/ shows the audits and the waves with live statuses, the Code map links to it, and no sensitive unmerged title is in the page source.

---

## Report (written by the worker when done)

### What I did
A new **Fix plan** page next to the Code map, generated from `docs/plan/plan.json` and the live `status:` of each item's `work/T-NNNN-*.md` task file. Output is `dist/code-map/plan/index.html` with everything inlined, like the Code map.

- `packages/devtools/src/plan-page/collect.ts` — parses/validates `plan.json` (hand-written guard, see deviations), resolves each item's status (`todo`/`in-progress`/`review`/`merged`/`blocked`, or `planned` when it has no task), redacts sensitive items, and computes per-wave and overall merged counts.
- `packages/devtools/src/plan-page/cli.ts` — `pnpm plan:page`: inlines style, script and data into `template.html` and writes `dist/code-map/plan/index.html`; prints a summary line.
- `packages/devtools/src/plan-page/template.html`, `style.css`, `page.js` — header ("Fix plan", updated date, intro, link back to `../`), overall progress bar, audits grid (title, model, severity pills, highlights, link to the doc on GitHub) and waves (title, goal, progress bar, items with a status chip, ref and task id linked to its `work/` file). Same tokens/type/spacing as the Code map, light and dark, inline SVG icons (no emoji), works at phone width.
- `packages/devtools/src/code-map/template.html` — a "Fix plan" link (`href="plan/"`) in the header, using the existing `.note` class.
- `.github/workflows/code-map.yml` — `- run: pnpm plan:page` after `pnpm code:map`.
- `packages/devtools/package.json` + root `package.json` — the `plan:page` script.
- `packages/devtools/src/plan-page/collect.test.ts` — the privacy test.

### Files changed
`packages/devtools/src/plan-page/{cli.ts,collect.ts,collect.test.ts,template.html,style.css,page.js}`, `packages/devtools/package.json`, `package.json`, `packages/devtools/src/code-map/template.html`, `.github/workflows/code-map.yml`, `work/T-1163-plan-page.md`. All new files are ≤400 lines (max `style.css` at 334). Nothing outside the Allowed files.

### Commands and real results
- `pnpm install` — done (1180 packages). Pre-existing peer warning in `apps/mobile` (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18); not from this task.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/plan-page/collect.test.ts` — **1 file passed, 2 tests passed**.
- `pnpm plan:page` — **`plan-page: 10 audits, 4 waves, 8/27 merged -> dist/code-map/plan/index.html`** (file written).
- Sensitivity check on the generated HTML: `Security hardening (details after the fix)` appears **3** times; the three sensitive titles ("Only contacts can send direct messages", "Private uploads", "Release signing and versioning for the Android app") and refs `SG-2`/`SEC-F6` each appear **0** times.
- Main gates: `pnpm gate` (run twice, last run after the final edit):
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen), format, lint, typecheck, effect, tests @zilar/devtools
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations and notes
- **No `zod`.** `@zilar/devtools` (and the repo) has no `zod` dependency, and the spec lists no new dependency, so I validated `plan.json` with a small hand-written guard instead, as `code-map/collect.ts` does. Say the word if you want `zod` added to the workspace catalog and used here.
- **Redaction also drops the `work/` link of a redacted item,** not just the title and ref: a task file name can describe the sensitive topic, so linking it would leak. The task id is still shown (unlinked). Merged sensitive items show everything.
- **`cli.ts` side-effect guard.** The write/print code only runs when `cli.ts` is the entry point, so `collect.test.ts` can import `renderHtml`. `code-map/cli.ts` runs unconditionally; this is a small, intentional difference.
- I ran `prettier --write` on just the changed files before the gate, to avoid a red gate on formatting.
- No UI tests (per `AGENTS.md`); the one test guards the privacy rule.

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 3 nits and 1 follow-up.**
- **The build:** `pnpm plan:page` writes `dist/code-map/plan/index.html` (18.6 KB, inlined): 10 audits, 4 waves, 8 of 27 merged.
- **Privacy, checked by the lead:** none of the sensitive unmerged titles or refs appear in the HTML. The three show "Security hardening (details after the fix)".
- **The page,** viewed by the lead on localhost: the Code map style, audits grid, wave progress bars, status chips and task links are all fine. The Code map header links to it, and the workflow runs it.
- **Follow-up:** running tasks show "todo", because main's task files keep `todo` until merge. Read the BOARD row status (`in-progress`) as a fallback.
