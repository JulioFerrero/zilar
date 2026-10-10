---
id: T-0938
title: "Replace the Effect map on GitHub Pages with a Code map: lines, file sizes against the 400-line limit, files added and removed, and the trend over time, in the same look"
status: todo
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

## Review (written by Claude)
