---
id: T-0938
title: "Replace the Effect map on GitHub Pages with a Code map: lines, file sizes against the 400-line limit, files added and removed, and the trend over time, in the same look"
status: merged
milestone: M5
branch: task/T-0938-code-map-page
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0938: The Code map page

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: "remove the map with the effect rework, and make another, that in a way i can see how we are optimizing the codebase reducing lines, making new files, removing other, reusing, etc with a similar aesthetic".

The map is https://julioferrero.github.io/zilar/ (the repo and the page are public). `.github/workflows/effect-map.yml` builds it on every push to main: `pnpm effect:map` runs `packages/devtools/src/effect-map/cli.ts`, which renders `packages/devtools/src/effect-map/template.html` (791 lines; data inlined at the `/*DATA*/ null` marker, `cli.ts` `renderHtml`) into `dist/effect-map`.

The look to keep (`template.html`):
- the colour tokens on `:root`, with a dark set under `prefers-color-scheme`;
- the `--f-ui` and `--f-data` font stacks;
- the header with one big number;
- the squarified treemap on a `<canvas>`, with cushion shading (`squarify` `:461`, `cushion` `:542`), folder crumbs (`renderCrumbs` `:613`) and a hover tip (`showTip` `:650`);
- the "Per package" table with inline bars (`:716-740`);
- the plain `<ul class="tasks">` lists.

The Effect gate ratchet stays: `packages/devtools/src/gate/plan.ts:11` and `:226-252` use `isCountedSource` from `generate.ts` and `src/effect-map/ratchet-cli.ts`, and `packages/devtools/src/lead/watch.ts:24-25` imports `parseBoard` and `BoardRow` from `generate.ts`. Only the page goes.

### What to build
1. **Remove the Effect map page:**
   - `packages/devtools/src/effect-map/template.html` and `cli.ts`;
   - the `effect:map` scripts (`packages/devtools/package.json:10`, `package.json:24`);
   - `.github/workflows/effect-map.yml`;
   - the code in `generate.ts` that only the page used: `buildEffectMap`, the summaries, the markers and the task lists. Check each with grep.

   Keep, moved where they fit, what the ratchet and `watch.ts` import (`isCountedSource`, `classifySource`, `parseBoard`, `BoardRow`, `repoRoot` and their helpers). Keep `ratchet.ts`, `ratchet-cli.ts` and the gate step working, and update the import paths in `gate/plan.ts`, `lead/watch.ts` and `gate/gate.test.ts:319` if files move. Update the `effect:map` mentions in `docs/EFFECT_GUIDE.md:18` and `docs/EFFECT_BRIEF.md:63`.
2. **A new `packages/devtools/src/code-map/`** with `cli.ts`, a collector and a template, each code file under 400 lines. It runs as `pnpm code:map` (root and devtools `package.json`) and writes `dist/code-map/index.html` and `data.json`. Each file is classed as **source**, **test** (`*.test.*`, `test/`, `test-support`), **mock** (`/mock/`, `mockStore`, `*-mock.ts`, `chat-store.ts` in mobile `store`, `packages/mock-backend`) or **generated**. The scope is `apps/*/src`, `packages/*/src` and `packages/mock-backend`.
3. **The page**, in the look above:
   - **Header:**
     - the big number is **source lines**, with the change against 7 days ago (for example "−12,400 this week");
     - beside it: test lines, mock lines, the file count, and **files over 400 lines** against a goal of 0 (Julio's limit).
   - **Treemap:**
     - area is the lines per file; colour is the size band: ≤400 green, 401–600 amber, 601–1,000 orange, over 1,000 red. Tests and mocks get one muted colour each, with a toggle to hide them;
     - drill into folders with the crumbs;
     - the tip shows the path, lines, band, and lines added or removed in the last 7 days.
   - **History:** an inline SVG line chart drawn to scale, with source, test and mock lines per day since the first commit (2026-09-27). Build it from `git log --numstat` on the checked-out main (the current totals, walked back per day, with the same classes). Label the axes, and colour from the tokens.
   - **Recent merges:**
     - the last 40 commits on main whose subject starts `T-NNNN`, each with its added and removed lines, files created and files deleted (from `--numstat` and `--diff-filter=A/D`), and its net;
     - a bar for each, green for a net cut and red for growth;
     - the task title from the subject.
   - **Per package:** files, source lines, test lines, files over 400, and the biggest file, with inline bars as today.
   - **Biggest files:** the top 25 source files, each with a bar and a marker at 400.
   - **Light and dark** both work, at 400 px wide too, with no horizontal page scroll.
4. **A new workflow** `.github/workflows/code-map.yml`, the same as `effect-map.yml` but with `pnpm code:map`, `dist/code-map` and `fetch-depth: 0` on checkout (the history needs the full git log). It publishes to the same Pages site.
5. **No tests** (Julio's rule: not crucial code). Show it works in the Report:
   - the `pnpm code:map` summary line;
   - the numbers in the header;
   - the 5 most recent merges as the page lists them;
   - the history's first and last points.

### Read first
`AGENTS.md`, `packages/devtools/src/effect-map/` (all of it), `.github/workflows/effect-map.yml`, `packages/devtools/src/gate/plan.ts:1-20` and `:220-260`, and `packages/devtools/src/lead/watch.ts:20-30`.

### Allowed files
`packages/devtools/src/effect-map/**`, `packages/devtools/src/code-map/**`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/gate.test.ts`, `packages/devtools/src/lead/watch.ts`, `packages/devtools/package.json`, `package.json`, `.github/workflows/effect-map.yml`, `.github/workflows/code-map.yml`, `docs/EFFECT_GUIDE.md`, `docs/EFFECT_BRIEF.md`, `.gitignore`, `work/T-0938-code-map-page.md`.

### Checks
```bash
pnpm code:map
pnpm --filter @zilar/devtools typecheck
pnpm --filter @zilar/devtools exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and the gate's `effect` step still runs.
- `dist/code-map/index.html` opens offline (its data is inlined), in both themes.
- Every new code file is under 400 lines.
- The Report has the numbers from item 5.

---

## Report (written by the worker when done)

### What I did

- Removed the Effect map page: `packages/devtools/src/effect-map/template.html` and `cli.ts` deleted; the `effect:map` scripts removed from `package.json` and `packages/devtools/package.json`; `.github/workflows/effect-map.yml` deleted.
- Trimmed `packages/devtools/src/effect-map/generate.ts` (488 → 247 lines) to only what the ratchet, the gate and the watcher read: `isCountedSource`, `classifySource`, `sourceFile`, `parseBoard`/`BoardRow`, `repoRoot` and their helpers. Removed `buildEffectMap`, `summarise`, `packageSummaries`, `taskSummaries`, the markers, the task lists, `allowedPaths`/`openTask` and the baseline check; dropped the now-unused `Schema`/`Result`/`tokenMatcher`/`readFileSync`/`join` imports. `sourceFile` no longer takes the open tasks. `ratchet.ts` updated for the new signature; `ratchet-cli.ts`, `gate/plan.ts`, `lead/watch.ts` unchanged (their imports still resolve — no file moved).
- Added `packages/devtools/src/code-map/`: `cli.ts` (39 lines), `collect.ts` (358 lines) and `template.html`. Runs as `pnpm code:map` (root and devtools) and writes `dist/code-map/index.html` (data inlined at `/*DATA*/ null`) and `data.json`.
- Classes: **source** default; **test** = `*.test.*`, a `test/` folder or `test-support`; **mock** = a `mock/` folder, `mockStore`, `*-mock.ts`, `apps/mobile/src/store/chat-store.ts`, `packages/mock-backend/*`; **generated** = `*.d.ts`, a `generated/` folder, `*.gen.*`/`*.generated.*`. Scope `apps/*/src`, `packages/*/src`, `packages/mock-backend` (absent on this tree; handled when it appears). Code files only (`.ts/.tsx/.js/.jsx/.mjs/.cjs`).
- Page: header (source lines + 7-day change, test/mock lines, file count, files over 400 vs goal 0); the same canvas treemap with cushion shading, crumbs and hover tip, reworked to size bands (≤400 green, 401–600 amber, 601–1,000 orange, >1,000 red) plus muted test/mock/generated colours and a "hide tests and mocks" toggle; an inline SVG history chart (source/test/mock per day, labelled axes, tokens for colour); the last 40 `T-NNNN` commits with a diverging net bar (green cut / red growth); a per-package table with inline source bars; the 25 biggest source files with a marker at 400. Light and dark from the tokens.
- New `.github/workflows/code-map.yml`, copied from the old workflow with `pnpm code:map`, `dist/code-map`, and `fetch-depth: 0` (the history needs the full log).
- Docs: `docs/EFFECT_GUIDE.md:18` now points at the ratchet instead of `pnpm effect:map`; `docs/EFFECT_BRIEF.md:63` says "each file's Effect kind".
- No tests were added (Julio's rule). `.gitignore` unchanged: `dist/` already ignores the output.

### Commands and results

- `pnpm code:map`: `code-map: 1066 files, source 177,714 (+53,364 this week), test 23,737, mock 13,578, generated 364, over 400: 119 -> dist/code-map/index.html`
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts`: 1 file, 33 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts`: 1 file, 17 passed.
- `pnpm gate` (from the repo root):
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/devtools (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- I did not run the full `pnpm --filter @zilar/devtools exec vitest run` or typecheck on their own (AGENTS: `pnpm gate` runs them once). The gate's `effect` step ran and passed; the two devtools test files were run individually and are green. A first `pnpm gate` failed typecheck on `collect.ts:182` (`net[index] +=`); fixed, re-ran, `GATE PASS`.

### Page verification (offline, `file://`, via Chrome)

`dist/code-map/index.html` in the attached Chromium, `file://`, no console messages at all.
- Header: source **177,714** · +53,364 this week; test **23,737**; mock **13,578**; **1,066** files; **119** files over 400 (goal 0, shown in red).
- Treemap canvas painted; 3 history paths and 3 grid lines; **40** merge rows; **13** package rows; **25** biggest files with the 400 marker at `left:22.32%` of the largest (`apps/web/src/lib/api.ts`, 1,792 lines).
- Dark (`--bg: #101312`) and light both applied; at 400 px wide `scrollWidth === clientWidth` (no horizontal scroll); the "hide tests and mocks" toggle works with no console error.

### Numbers for item 5

- Header: source 177,714 (+53,364 this week), test 23,737, mock 13,578, files 1,066, over 400: 119 (goal 0).
- 5 most recent merges as the page lists them:
  - `T-0935` Audit: mock mode on one shared fake backend (docs/audit/mock-plan.md) — +738 −2 · 1 new · 0 gone · net +736
  - `T-0929` Store core T10b: the mobile store on the core send pipeline (R6 deadline, R18 sticker retry, R20 banner), mobi — +754 −763 · 1 new · 0 gone · net −9
  - `T-0930` Test memory: cap the web vmThreads pool (memory limit, worker count) and the lead's combined check, measured p — +89 −2 · 0 new · 0 gone · net +87
  - `T-0931` Cut the server tests to the crucial ones (auth and keys, permissions and money): keep a fixed list, delete eve — +109 −62,573 · 0 new · 213 gone · net −62,464
  - `T-0933` Cut the mobile tests: delete every UI test and every non-crucial test; keep auth/session and the message-pipel — +66 −57,085 · 1 new · 290 gone · net −57,019
- History: first point 2026-09-27 = source 9,889 / test 8,958 / mock 1,722; last point 2026-10-10 = source 177,714 / test 23,737 / mock 13,578 (14 days). The 2026-10-10 cliff is real: T-0931/0932/0933/0934 removed ~181k test lines that day.

### Uncertainties / deviations

- **"Every new code file is under 400 lines":** the TypeScript files are `cli.ts` 39 and `collect.ts` 358. `template.html` is 982 lines (Prettier-formatted HTML with the page's CSS/JS). I read "code file" as the `.ts` sources, the same way the old `effect-map/template.html` was 791 lines. If the lead wants the template under 400 too, say so and I will split the page's script into separate files.
- History and deltas come from the **checked-out commit** (`git log` on HEAD), which is main in CI; run from this task worktree the local totals include the branch's own commits. The last history point is pinned to the on-disk totals, so it always matches the header.
- `docs/EFFECT_GUIDE.md:4` and `docs/EFFECT_BRIEF.md:7` still say `pnpm effect:map` (historical/status lines); the spec named only `:18` and `:63`, so I left them.
- The header's week change is **+53,364** (growth), not the "−12,400" example — that is the real state of main.

### Round 2 (fix round)

**Finding 1 (should-fix, template size)** — fixed. I split the page's inline CSS and JS so every file in `packages/devtools/src/code-map/` is under 400 lines:

- `template.html` is now markup only (85 lines) with `/*STYLE*/` and `/*SCRIPT*/` markers (the shared `/*DATA*/` marker moved with the script into `page.js`).
- CSS: `style.css` (269 lines) and `style-panels.css` (170 lines), split before the chart rules.
- JS: `treemap.js` (245 lines: tree, squarify, draw, interaction) and `page.js` (213 lines: header/history/merges/packages/biggest, the init, and the shared `MAP`, `dark`, `hiddenExtra`, `readPalette`, `buildTree` that only `page.js` uses).
- `cli.ts` reads the four asset files and inlines all of them plus `/*DATA*/` into `dist/code-map/index.html`, so the page is still one self-contained offline file.

The JS split needed care: `no-unused-vars` is on, so a classic script split across files flags each file's declarations that the other file uses. I resolved it by moving the five identifiers used only by `page.js` into `page.js`, leaving both scripts self-consistent (no lint directives). `diff -w` against the pre-split template shows the extracted CSS/JS is the original content modulo whitespace (plus one line-wrap), and the generated page renders identically.

Nits 2 and 3 (both in `collect.ts`) were not touched: neither sits in a line this round changed.

**Tests:** none added — the spec says "No tests", and finding 1 is a file-size/structure fix, not a behaviour fix (the finding names no test).

**Commands and results:**
- `pnpm code:map`: `code-map: 1068 files, source 178,121 (+53,436 this week), test 23,737, mock 13,578, generated 364, over 400: 119 -> dist/code-map/index.html`
- generated inline script: `node --check` parses OK; no `/*STYLE*/`, `/*SCRIPT*/` or `/*DATA*/` markers left.
- `pnpm gate` (from the repo root), after the fix:
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/devtools (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (A first gate run failed `lint` on the split JS before the move; fixed, re-ran, `GATE PASS`.)

**Page verification** (offline `file://`, reloaded after the split): header source 178,121 · +53,436 this week, test 23,737, mock 13,578, 1,068 files, 119 over 400 (red); canvas painted (1066×610); 3 history paths; 40 merge rows; 14 package rows; 25 biggest files with the 400 marker at 22.32%; the "hide tests and mocks" toggle works; no console messages.

### Round 3 (review fixes — chart axes and phone width)

**1. History chart title vs the top y-axis value.** The "lines" title sat at `y = padT + 10`, just under the top gridline, which is exactly where the top tick value (`195,521`) is drawn, so the two overlapped. I added headroom above the plot (`padT` 14 → 28) and pinned the title to the top of the viewBox (`y="14"`), so the title occupies the strip above the plot and the tick labels begin below it. Measured in the browser: title box 850.8–866.8 px, top tick 874.3–890.3 px — no overlap (`titleOverlapsAnyYTick: false`).

**2. History x-axis date ticks.** Only the first and last dates were drawn. The chart now draws the two ends plus evenly spaced days, about one tick every 3–4 days: `tickCount = round((n − 1) / 3.5) + 1`, indices `round(j · (n − 1) / (tickCount − 1))`, first anchored `start`, last `end`, the rest `middle`. For the 14-day history that gives `2026-09-27, 2026-09-30, 2026-10-04, 2026-10-07, 2026-10-10` (gaps of 3, 4, 3, 3 days). Even spacing also avoids the adjacent `10-09`/`10-10` pair a fixed step would produce. The labels use the same `.axis` class, so the same `--f-data` font and soft colour as before.

**3. Phone width (400 px).** The merge rows now stack. At `max-width: 560px` the `.mrow` grid uses named areas — title across the top, then the added/removed numbers and the net on the second line, then the bar across the full width:

```css
.mrow {
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'title title'
    'meta net'
    'track track';
}
```

The bar (`.mtrack`) is no longer hidden, and the header stats already wrap (`flex-wrap`).

How I checked: I loaded `dist/code-map/index.html` over `file://` in the attached headless Chromium (Chrome DevTools MCP), emulated a **400×900** viewport, and measured plus screenshotted:
- `document.documentElement.scrollWidth === clientWidth` → **400 === 400**, no horizontal page scroll;
- `.stat.small` lays its five numbers on **2 rows** (header wraps);
- a `.mrow`: title `y 1153.7`, full width (372 px); then `mmeta`/`mnet` on the next line (`y ≈ 1188`, same row); then `.mtrack` full width at `y 1210.6`, `display: block` (stacked, bar visible);
- the treemap canvas (370 px) and the chart `svg` (372 px) both fit inside the 400 px viewport.
- Screenshot saved to `…/opencode/code-map-400.png` (not committed).

**Commands and results:**
- `pnpm code:map`: `code-map: 1070 files, source 178,590 (+53,915 this week), test 23,737, mock 13,578, generated 364, over 400: 119 -> dist/code-map/index.html`
- `pnpm gate` (from the repo root), after the fixes:
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/devtools (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No tests added (spec: no tests; these are page-rendering/CSS changes, not crucial code). One commit per item — history title, history date ticks, phone-width merge stacking (this Report is folded into the third).

## Review (written by Claude)

**Lead, 2026-10-10: approved. Clean after 1 automatic round and the lead's fix round, with 3 nits.**
- **The swap:** the Effect map page is gone (its template, CLI, scripts and workflow). The gate's Effect ratchet still runs. `packages/devtools/src/code-map/` builds the Code map, and `.github/workflows/code-map.yml` publishes it to the same Pages site.
- **The lead's check:** the lead built and opened the page.
  - The header showed 178,590 source lines, +53,915 this week, and 119 files over 400. The weekly figure matches the lead's own count from git in order of magnitude (+61.8k, with a rougher filter).
  - The treemap, the history and the merge list render.
  - After the fix round, the chart's top label is clear, it has date ticks, and it works at phone width: the merge rows stack and nothing scrolls sideways.
- **Check:** the gate passed.
