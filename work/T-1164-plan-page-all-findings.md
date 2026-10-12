---
id: T-1164
title: "Plan page v2: list EVERY finding of every audit (P0–P3, id, severity, platform, one line, 'fixed by' chip), the full Telegram parity matrix, filters by severity/audit/status, and 'in progress' from the BOARD; drop the sensitive redaction"
status: merged
milestone: M5
branch: task/T-1164-plan-page-all-findings
model: auto
effort: default
depends_on: [T-1163]
estimate: 0.5 day
---

# T-1164: Plan page with every finding

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-12, about the page T-1163 shipped: "you only show the P0? I'd like to see all the P and the Telegram part." Today the page (`packages/devtools/src/plan-page/`) shows only counts and 3 or 4 highlights per audit, and no parity matrix. Julio also decided that everything stays public: the audit docs are already in the public repo. So the **sensitive redaction goes away**, and `docs/plan/plan.json` no longer has `sensitive` flags. Running tasks show "todo", because main's task files keep `todo` until merge (the T-1163 review follow-up).

### The sources
These are the audit docs under `docs/audit/`. Each one gives its findings in one or more of these formats; read each doc to confirm:
- **Summary tables:** `| SEC-1 | P1 | Area | text |` (security, performance, ai-features, ops-reliability), and `| MUX-1 | P1 | text |` or `| WUX-1 | P1 | text |` (mobile-ux, web-ux). These tables may list only part of the findings: the rest are under headings or bold paragraphs further down, so collect **all ids** in the doc.
- **Bold paragraphs:** `**MP-1 P0 mobile, confirmed (known K1).** text` (message-pipeline, features-ui), and `**SG-1 (P0, both, confirmed) — title.** text` (social-graph).
- **The Telegram parity matrix:** a markdown table in section 2 of `docs/audit/telegram-parity-audit.md`, with feature, web status, mobile status and evidence. Line 41 holds the counts.
- **`docs/plan/plan.json`:** items may have `closes: [finding ids]`.

### What to build
1. **A new `packages/devtools/src/plan-page/findings.ts`** (at most 400 lines) that parses every audit doc into `{ id, audit, severity, platform?, title, status? }`:
   - **severity:** P0, P1, P2 or P3;
   - **title:** the first sentence, at most ~140 characters, with markdown and backticks stripped to plain text;
   - **dedupe:** one entry per id;
   - **a finding with no severity anywhere** is listed under "Unrated", never dropped;
   - **the count per doc** goes to the CLI log line.
2. **A new `packages/devtools/src/plan-page/parity.ts`** that parses the parity matrix rows into `{ area?, feature, web, mobile, evidence }`.
3. **Linking:** a finding is "fixed" when a `plan.json` item that `closes` it has a merged task; it shows a "fixed by T-XXXX" chip, linked to the task file.
4. **Status fallback:** when a task file says `todo` but its `work/BOARD.md` row says `in-progress` or `review`, show that (parse the BOARD row by its `[T-XXXX]` link). An item's optional `status` field in `plan.json` overrides both, for work the lead did directly.
5. **Remove the sensitive redaction** from `collect.ts`, and change its test so it checks that a merged item shows its title.
6. **The page:**
   - **Findings section:** grouped by audit, with filter chips for severity (P0, P1, P2, P3, Unrated), audit, and "open / fixed". Each row shows the id, a severity pill, the platform, the one-line title and the fixed chip. Use a `<details>` per audit, open by default for P0 and P1;
   - **Telegram parity section:** the matrix as a table, with coloured status cells (solid, weak, missing) for web and mobile, plus the totals. It scrolls inside its own container on a phone;
   - keep the waves and audits sections; keep the style, light and dark, icons and no emoji; it must work at phone width;
   - files stay at most 400 lines, so split `page.js` and `style.css` if they would grow past that.
7. **Tests** (no UI tests; these guard the parsers), at most 3, in `packages/devtools/src/plan-page/findings.test.ts`:
   - each of the three finding formats parses (id, severity, title);
   - the real `docs/audit/` set gives at least 190 findings with no duplicate ids;
   - the parity parser reads the real matrix with at least 70 rows.

### Read first
`AGENTS.md`, `packages/devtools/src/plan-page/` (all files), `docs/plan/plan.json`, and the format examples in `docs/audit/security-audit.md:13-30`, `docs/audit/message-pipeline-audit.md:46-60`, `docs/audit/social-graph-audit.md:54-70`, `docs/audit/mobile-ux-audit.md:1-30` and `docs/audit/telegram-parity-audit.md:35-80`. Also `work/BOARD.md:1-20` for the row format.

### Allowed files
`packages/devtools/src/plan-page/findings.ts`, `packages/devtools/src/plan-page/findings.test.ts`, `packages/devtools/src/plan-page/parity.ts`, `packages/devtools/src/plan-page/collect.ts`, `packages/devtools/src/plan-page/collect.test.ts`, `packages/devtools/src/plan-page/cli.ts`, `packages/devtools/src/plan-page/template.html`, `packages/devtools/src/plan-page/page.js`, `packages/devtools/src/plan-page/page-findings.js`, `packages/devtools/src/plan-page/style.css`, `packages/devtools/src/plan-page/style-findings.css`, `work/T-1164-plan-page-all-findings.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/plan-page/findings.test.ts src/plan-page/collect.test.ts --reporter=dot
pnpm plan:page
pnpm gate
```

### Acceptance
- The Checks pass.
- The `pnpm plan:page` log shows the per-audit finding counts, and the page lists every finding with filters, plus the parity matrix.
- **The lead's check** at https://julioferrero.github.io/zilar/plan/ after the merge.

---

## Report (written by the worker when done)

### What I did

- **`findings.ts`** (new): parses every audit doc into `{ id, audit, severity, platform, title }`. It reads the three shapes the docs use — summary bullets (`- MP-13 P2 mobile: ...`), bold paragraphs (`**MP-1 P0 mobile, confirmed.** ...`, `**SG-1 (P0, both) — ...**`, `**OPS-3 (P1): ...**`) and summary tables (`| SEC-1 | P1 | Area | text |`) — plus a low-rank fallback for an id only named in prose. It dedupes by id, takes the highest-detail title, strips markdown/backticks, keeps the first sentence (≤ 140 chars), and marks a finding with no severity as `Unrated`. The AI table's extra `Status` column is handled by finding the title column from the header (`One line` / `Finding` / `What the user feels`); `MUX`/`WUX` findings, whose docs never state it, default to `mobile`/`web`.
- **`parity.ts`** (new): parses the section-2 matrix (`Telegram feature | Web | Mobile | Evidence`) into `{ area, feature, web, mobile, evidence }`, tracking the `### 2.x` heading as the area and unescaping `\|` inside evidence. Rows outside a parity table (section 4's fix plan) are ignored.
- **`collect.ts`**: removed the sensitive redaction (`REDACTED_TITLE`, `sensitive`); added `closes` and an optional `status` to plan items; added `boardStatuses()` and the status fallback (a task file that says `todo` shows the BOARD row's `in-progress`/`review`); added `linkFindings()` ("fixed by" comes from the merged item that `closes` a finding); `collectPlan()` now carries `findings` and `parity`.
- **`cli.ts`**: inlines `style-findings.css` and `page-findings.js` too, and the summary line now prints the per-audit finding counts and the parity row count.
- **`template.html`**, **`page-findings.js`** (new), **`style-findings.css`** (new): a Findings section (filter chips for severity, audit and open/fixed; one `<details>` per audit, open when it holds a P0/P1; each row has the id, a severity pill, the platform, the one-line title and the "fixed by" chip) and a Telegram parity section (a table with solid/weak/missing coloured cells and the totals, scrolling inside its own container). The style, light/dark tokens, icons and phone-width layout follow the existing page; no emoji.
- **Tests**: `findings.test.ts` (new, 3 tests) covers the three finding shapes, the real docs (≥ 190 findings, no duplicate ids) and the real matrix (≥ 70 rows). `collect.test.ts` now checks that a merged item shows its real title and its task link.

### Files changed

`packages/devtools/src/plan-page/{findings.ts,findings.test.ts,parity.ts,collect.ts,collect.test.ts,cli.ts,template.html,page-findings.js,style-findings.css}` and this task file. `page.js` and `style.css` were not touched (they stayed under 400 lines).

### Commands and results

- `pnpm install`: done (reused 1149, added, "Done in 10.5s").
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/plan-page/findings.test.ts src/plan-page/collect.test.ts`: 2 files, 4 tests passed.
- `pnpm plan:page`: `plan-page: 10 audits, 4 waves, 9/27 merged, 193 findings (MP 13, SG 11, SEC 15, UI 15, PERF 18, MUX 33, WUX 44, AI 23, OPS 21), 103 parity rows -> dist/code-map/plan/index.html`.
- I also loaded the generated page in Chrome DevTools: 193 finding rows, 103 parity rows, 16 filter chips, 9 audit `<details>` (all open), 16 "fixed by" chips, the P0 filter narrows to 8 rows, no console messages; at a 500 px viewport there is no body overflow and the parity table scrolls inside its own container.
- `pnpm gate` (from the repo root):
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (2.4s)`
  - `PASS  effect  (0.6s)`
  - `PASS  tests @zilar/devtools  (0.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Notes / deviations

- The first `pnpm gate` failed only on `format` for `cli.ts` and `collect.ts` (line wrapping); I ran `prettier --write` on those two files and the gate then passed.
- `docs/plan/plan.json` needed no edit: it already has no `sensitive` flags, so removing the redaction was enough.
- The wave tasks whose file still says `todo` (T-1153, T-1159, T-1160, T-1161) now show `in progress` from their BOARD rows, verified in the rendered page.

### Open questions

- None.

### Round (fix round, from PREREVIEW.md)

- **Findings fixed:** 1 of 1 should-fix (must-fix was 0).
  - PREREVIEW finding 1 (`page.js:86`): removed the dead `const mark = item.sensitive ? ICON.shield : '';`,
    the now-unused `ICON.shield` entry (`page.js:17`) and the `${mark}` reference in
    `renderItem`, since `PlanItem` no longer has `sensitive`. Commit `T-1164: fix finding 1 - remove dead sensitive mark code`.
- **Nits not touched:** findings 2 (`cli.ts:40-46` zero-count filter), 3 (`page-findings.js:32-35`
  Unrated chip) and 4 (`collect.ts:336-339` partial-failure handling) are nits and none sits in a line
  this round changed, so per instructions they were left as they are.
- **Tests added:** none. Finding 1 is a dead-code removal in UI template JS; the finding names no test,
  and UI code gets no tests (AGENTS.md). No test behaviour changed.
- **Commands run:**
  - `pnpm --filter @zilar/devtools exec vitest run src/plan-page/findings.test.ts src/plan-page/collect.test.ts --reporter=dot`: 2 files, 4 tests passed.
  - `pnpm plan:page`: `plan-page: 10 audits, 4 waves, 9/27 merged, 193 findings (MP 13, SG 11, SEC 15, UI 15, PERF 18, MUX 33, WUX 44, AI 23, OPS 21), 103 parity rows -> dist/code-map/plan/index.html`.
  - `pnpm gate` (from the repo root): `PASS install (frozen) (1.0s)`, `PASS format (1.4s)`, `PASS lint (0.7s)`, `PASS typecheck (1.8s)`, `PASS effect (0.5s)`, `PASS tests @zilar/devtools (0.7s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- **Disagreements:** none.
- **Gate result:** GATE PASS (11 changed files against main, all inside the Allowed files).

## Review (written by Claude)

**Lead, 2026-10-12: approved. Clean after 1 auto round, with 3 nits.**
- **The build:** `pnpm plan:page` reports 193 findings (MP 13, SG 11, SEC 15, UI 15, PERF 18, MUX 33, WUX 44, AI 23, OPS 21) and 103 parity rows. The per-audit counts match the docs.
- **The page,** viewed by the lead on localhost:
  - findings are grouped per audit, with severity pills, platform and a one-line title;
  - the "fixed by T-XXXX" chips are right;
  - the Telegram matrix has solid, weak and missing cells, and the totals;
  - there's no horizontal page scroll.
- **The redaction is gone,** as Julio decided on 10-12 (everything public).
- **Sizes:** every file is at most 400 lines (`collect.ts` 341, `style.css` 334).
