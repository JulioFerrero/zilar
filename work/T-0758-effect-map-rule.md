---
id: T-0758
title: "R1: the Effect map implements the 100% rule from docs/audit/effect-100-plan.md §1.4 — kinds effect / needs-effect / plain / exempt (+ legacy), hard and weak signals, effect-plain markers (max 25), Tier B count, coverage = Effect lines / (Effect + needs-effect lines); page and summary show it"
status: merged
milestone: M5
branch: task/T-0758-effect-map-rule
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0758 (R1): the map measures the 100% rule

## Spec (written by Claude, do not edit)

### Why
Julio accepted the 100% Effect plan on 2026-10-09 (`docs/audit/effect-100-plan.md`, with the decisions recorded at the top of §6). The map at https://julioferrero.github.io/zilar/ must measure the plan's target metric, not only "imports Effect".

### Verified facts (do not re-derive)
- **The map code** is `packages/devtools/src/effect-map/generate.ts`:
  - `Kind = 'effect' | 'plain' | 'legacy'` (line 10);
  - `LEGACY_LIBS` (line 61), the `IMPORT` regex (line 67), `EFFECT_MODULE` (line 68) and the `EXCLUDED` path filter (line 69);
  - `classifySource` (line 80) decides legacy, then effect, then plain;
  - `sourceFile` (line 152), `summarise` (line 163) and `packageSummaries` (line 184).
- **The page and the CLI:** `packages/devtools/src/effect-map/template.html` names the kinds at around line 327 (`KIND_NAME`). `packages/devtools/src/effect-map/cli.ts:20-30` prints the summary line and the `GITHUB_STEP_SUMMARY` table. The tests are in `generate.test.ts`.
- **The rule is specified exactly in `docs/audit/effect-100-plan.md`:**
  - §1.4: scope additions, the class order, the signals table H1, H2, H3, H5, H8, H9, W4, W6 and W7 with their regexes, the marker comment `// effect-plain: <reason>` in the first 15 lines with at most 25 markers, Tier B, and the coverage formula;
  - §1.5: a reference implementation, including the string and comment blanking;
  - §1.6: the baseline numbers to compare against.
- **Decisions (§6, decided 2026-10-09):** `apps/site/**` is exempt (D2), dev mock backends are exempt (D3), and **`packages/devtools/**` is exempt (D7)**.

### What to build
1. **In `generate.ts`:**
   - `Kind` becomes `'effect' | 'needs-effect' | 'plain' | 'exempt' | 'legacy'`, with legacy still winning;
   - add the extra scope exclusions from §1.4 (the `.fixture.` files, `test-harness.ts`, `test-support.ts`, `fake-*.ts`);
   - implement the exempt rules (the §1.4 path list plus `packages/devtools/**`, and the marker);
   - implement the signals from §1.4 and §1.5. Hard and weak hits are kept per file as `signals: string[]` (ids such as `H1`, `W4`) plus `firstHit: { line: number; text: string } | null` (the first matching line, trimmed to 120 characters). `effect` counts only value imports: `import type` is not Effect.
   - Per file, also set `tierB: boolean`: an effect file that matches any hard signal.
   - `Summary` gains `coveragePct` (Effect lines / (Effect + needs-effect lines), or 100 when both are 0), the counts per kind, `tierB` files and lines, `needsWeak` (needs-effect files whose only hits are weak), and `markers: { path, reason }[]`.
   - Exceeding 25 markers is reported in the summary as `markersOverBudget: true`; it does not throw.
2. **`cli.ts`:**
   - the summary line becomes `effect-map: N files, coverage X% (effect A, needs-effect B, plain C, exempt D, legacy E), tier B F, markers G/25 -> ...`;
   - the step-summary table adds coverage and needs-effect columns;
   - add `--check-baseline <file>`, which reads a JSON `{ needsEffectFiles: number }` and exits 1 when the current count is higher. This is for the later ratchet (R6); add the flag and a test, but no baseline file.
3. **`template.html`:**
   - colours for the 5 kinds (needs-effect clearly visible, exempt muted);
   - the headline shows **coverage** (the target metric), with "imports Effect: X% of lines" as a secondary figure;
   - the per-package table shows coverage, needs-effect files and Tier B;
   - the hover or detail line of a needs-effect file shows its signal ids and its first hit;
   - keep phone width and light and dark mode working.
4. **Tests in `generate.test.ts`:** one test per signal id with a hit and a known false positive from §1.4. Cover `Promise<void>` in a type (no hit), a comment or a string holding `fetch(` (no hit), `import type { Effect }` (not effect), a marker within 15 lines (exempt) and one at line 20 (not exempt), the devtools and site exemptions, Tier B, and the coverage formula.

### Read first
`AGENTS.md`, `docs/audit/effect-100-plan.md` (§1.2-1.6 and §6 in full), `packages/devtools/src/effect-map/generate.ts`, `generate.test.ts`, `cli.ts`, `template.html`.

### Allowed files
`packages/devtools/src/effect-map/generate.ts`, `packages/devtools/src/effect-map/generate.test.ts`, `packages/devtools/src/effect-map/cli.ts`, `packages/devtools/src/effect-map/template.html`, `work/T-0758-effect-map-rule.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/effect-map
pnpm effect:map
pnpm gate
```
In the Report, paste the new summary line and compare it per package with the §1.6 baseline. Differences are expected (devtools is now exempt, and main has moved); explain any package that differs by more than 3 points.

### Acceptance
- The map classifies by the §1.4 rule, with the §6 decisions.
- The summary and the page show coverage, needs-effect, Tier B and markers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What was done
- `generate.ts`: the five kinds (effect, needs-effect, plain, exempt, legacy), the §1.4 scope additions, the exempt rules (mock folders, `-mock.ts`, `.config.ts`, mobile ios/android/scripts, `apps/site/`, `packages/devtools/`, the marker), the nine signals H1 H2 H3 H5 H8 H9 W4 W6 W7, comment and string blanking, `signals`, `firstHit`, `tierB`, `marker` per file, and `coveragePct`, `tierB`, `needsWeak`, `markers`, `markersOverBudget` in the summary. `markerBudget` (25) is added to the map data for the page. `checkNeedsEffectBaseline` implements the `--check-baseline` ratchet check (validated with Effect `Schema`, not zod).
- `cli.ts`: the new summary line, the step-summary columns (Coverage, Needs-effect files), and `--check-baseline <file>`.
- `template.html`: five colours (needs-effect red, exempt muted blue-grey), the coverage headline with "imports Effect" as the secondary line, the per-package table (Coverage, Needs, Tier B, Legacy; Files hidden at phone width), a markers section, and signals and first hit in the tooltip of needs-effect files.
- `generate.test.ts`: 54 tests, all passing (the existing ones, with one changed: `import type { Effect }` is no longer Effect).

### Commands run
- `pnpm install`: done.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/effect-map`: 54 passed, 0 failed (run before and after prettier).
- `pnpm effect:map`: ran before the edits (baseline `852 files (Effect 197, plain 655, legacy 0), Effect 35.7%`) and after prettier (the line below).
- `pnpm effect:map -- --check-baseline <file>` with a baseline of 0 and one of 250: exit 1 with `needs-effect files 250 exceed the baseline 0`, and exit 0 for 250.
- `pnpm gate`: GATE PASS. The first gate run reported one file outside scope, which was my own `.gate-out.txt` log in the worktree; I deleted it, and the second run (log kept in scratchpad) printed `scope: every changed file is inside the Allowed files`.

### Summary line (after the change)
`effect-map: 832 files, coverage 46.6% (effect 189, needs-effect 250, plain 300, exempt 93, legacy 0), tier B 125, markers 0/25 -> dist/effect-map/index.html`

### Per package against the §1.6 baseline (coverage %, files)
| Package | §1.6 | now | Note |
| --- | --- | --- | --- |
| packages/protocol | 14 / 100 | 14 / 100.0 | same |
| packages/ui-tokens | 1 / n/a | 1 / 100.0 | page shows n/a (no Effect and no needs-effect lines) |
| packages/chat-core | 16 / n/a | 16 / 100.0 | page shows n/a |
| packages/agent-drivers | 4 / 100 | 4 / 100.0 | same |
| apps/runner | 5 / 59 | 5 / 58.5 | 635/1085; the plan rounds to 59, within 3 points |
| packages/runner-tunnel | 8 / 65 | 8 / 65.1 | same |
| packages/xmpp-core | 9 / 0 | 9 / 0.0 | same |
| packages/devtools | 38 / 24 | 41 / 100.0 | exempt (D7); the only difference over 3 points; main has 3 more devtools files |
| scripts | 2 / 0 | 2 / 0.0 | same |
| apps/server | 202 / 87 | 202 / 87.4 | effect, failing and tier B line counts identical to §1.6 |
| apps/web | 193 / 10 | 193 / 9.8 | 8 mock files moved plain to exempt; needs-effect lines identical |
| apps/mobile | 329 / 19 | 329 / 19.3 | 16 mock files moved plain to exempt; needs-effect lines identical |
| apps/site | 8 / n/a | 8 / 100.0 | exempt (D2); page shows n/a |
| Total | 829 / 45.4 | 832 / 46.6 | see reconciliation |

Reconciliation: effect lines 68206 to 66240 (minus 1966, exactly the devtools effect lines in §1.6), needs-effect lines 82143 to 75983 (minus 6160, exactly the devtools failing lines), so 66240 / (66240 + 75983) = 46.6%. Tier B 130 files / 56537 lines becomes 125 files / 54873 (minus the 5 devtools files, 1664 lines), exact.

### Decisions I made (please check)
- Legacy is checked before exempt, so an exempt file importing zod is still legacy. The spec said "legacy still winning"; I read it as winning over the exemptions too.
- Type-only imports (`import type`) are skipped for H8 and H9 as well as for Effect, since they are erased. §1.4 does not say this.
- Template literal text is not blanked, as §1.4 says, so `fetch(` inside a backtick template still hits (a known false positive). A `//` inside a string does not start a comment.
- A marker needs a non-empty reason to count.
- `needsWeak` and `tierB` are `{files, lines}` tallies. The summary line counts files for the kinds and Tier B.
- The `-mock.ts` rule is literal; no `-mock.tsx` file exists.

### Not verified
- The page was NOT viewed in a browser. The Chrome extension refused file:// URLs and I may not start a local server, so phone width, no horizontal scroll and dark mode are untested. Only the template's CSS and JS were read and the data was checked in Node.
- `cli.ts` `main` is not unit-tested (importing it runs the generator); the flag was checked by running it, as above.

### Open questions
- None blocking. Should the page be checked in Julio's browser before merge?

### Fix round 1 (lead review, one item)
- Treemap folder labels now show the folder's coverage, not the imports-Effect share. The aggregation lives only in `template.html` (`sum` adds `needsLines` and `exemptLines` per folder; `folderCoverage` at top level of the script), so there is no unit test for it. The formula is kept identical to `coveragePct` in `generate.ts`: Effect lines / (Effect + needs-effect lines), to one decimal. A folder with neither shows "exempt" when all its files are exempt, otherwise a dash.
- Checked from `dist/effect-map/data.json`: apps/server/src 87.4%, packages/devtools/src exempt, apps/web/src 9.8%, apps/mobile/src 19.3%, packages/chat-core/src dash, apps/site/src exempt. The page script passes `node --check`; the page itself was not rendered in a browser.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round (folder labels now show coverage). Worker: Haiku 5.5. The lead rendered the page in the browser.
- **The rule:** five kinds, hard and weak signals with blanking, markers (0 of 25), Tier B and coverage.
- **The map:** the baseline reconciles with plan §1.6 (46.6%; the difference is devtools, which is exempt under D7).
- **`--check-baseline`:** exists and is tested, for R6.
- **Results:** 54 tests pass, and the gate passed.
