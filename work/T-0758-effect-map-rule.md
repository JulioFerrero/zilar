---
id: T-0758
title: "R1: the Effect map implements the 100% rule from docs/audit/effect-100-plan.md §1.4 — kinds effect / needs-effect / plain / exempt (+ legacy), hard and weak signals, effect-plain markers (max 25), Tier B count, coverage = Effect lines / (Effect + needs-effect lines); page and summary show it"
status: todo
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

## Review (written by Claude)
