---
id: T-1433
title: "Findings sweep (client UX): recheck the 57 open MP/UI/MUX/WUX findings against main and record which are fixed, open, partly open or not actionable, with file:line evidence"
status: merged
milestone: M5
branch: task/T-1433-sweep-client-findings
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1433: Findings sweep, client UX

## Spec (written by Claude, do not edit)

### Why
The plan page (`docs/plan/plan.json`) marks a finding fixed only when a plan item's `closes` names it. Many findings were fixed by other tasks: for example WUX-33 and WUX-36 are fixed on main, and the code comments name them (`apps/web/src/routes/ChatShell.tsx:28-31`, `apps/web/src/components/MessageBubble.tsx:214`). The lead needs the real open list to batch fixes tonight. **This task changes no code.**

### Input
The 57 findings that plan.json leaves open:

`MP-9 UI-7 UI-8 UI-12 UI-13 UI-14 UI-15 MUX-13 MUX-16 MUX-17 MUX-18 MUX-19 MUX-20 MUX-21 MUX-22 MUX-23 MUX-24 MUX-25 MUX-26 MUX-27 MUX-28 MUX-29 MUX-30 MUX-31 MUX-32 MUX-33 WUX-10 WUX-14 WUX-16 WUX-17 WUX-18 WUX-19 WUX-20 WUX-21 WUX-22 WUX-23 WUX-24 WUX-25 WUX-26 WUX-27 WUX-28 WUX-29 WUX-30 WUX-31 WUX-32 WUX-33 WUX-34 WUX-35 WUX-36 WUX-37 WUX-38 WUX-39 WUX-40 WUX-41 WUX-42 WUX-43 WUX-44`

Each one's full text is in its audit doc:
- `docs/audit/message-pipeline-audit.md` (MP);
- `docs/audit/features-ui-audit.md` (UI);
- `docs/audit/mobile-ux-audit.md` (MUX);
- `docs/audit/web-ux-audit.md` (WUX).

### What to do
1. For each finding, read its text and the code it cites, then check **main as it is now**. The audit's line numbers may have moved, so search for the code.
2. Classify each one:
   - `fixed`: give the evidence `file:line` and the task id if a comment or `git log -S` names one;
   - `open`: say what is still wrong in one line, with `file:line`;
   - `partly`: say what is done and what remains;
   - `not actionable`: the finding is praise ("solid", "good") or a deliberate decision (for example dark only, D24). Say which.
3. For each `open` or `partly` finding, add `area`: the main files it would touch (full repo paths), so the lead can batch findings without file overlaps.
4. Write `docs/audit/findings-sweep-client.md`, with a short intro and one table: `| id | status | evidence / what remains | area |`. End with counts per status.

### Tests
None.

### Allowed files
`docs/audit/findings-sweep-client.md`, `work/T-1433-sweep-client-findings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- All 57 ids are present, each with a status.
- Every `fixed` row has evidence, and every `open` or `partly` row names files.

---

## Report (written by the worker when done)

**What I did.** Read the four audit docs and re-verified all 57 findings against the code on
this branch (`4ff4ed187`). For each finding I searched for the code it cites (the audit line
numbers have moved) and classified it `fixed` / `open` / `partly` / `not actionable`, with
`file:line` evidence for `fixed` rows and the files to touch for `open`/`partly` rows.
Wrote `docs/audit/findings-sweep-client.md` (intro + one table + counts). No code changed.

Result: **32 fixed, 13 partly, 7 open, 5 not actionable** (57 total).

- open: UI-15, MUX-18, MUX-19, MUX-20, MUX-24, WUX-17, WUX-18.
- partly: MP-9, MUX-13, MUX-17, MUX-21, MUX-22, MUX-23, MUX-26, MUX-27, WUX-10, WUX-14,
  WUX-27, WUX-39, WUX-44.
- The full evidence table is in the doc.

**Files changed.**
- `docs/audit/findings-sweep-client.md` (new)
- `work/T-1433-sweep-client-findings.md` (this report + status)

**Commands and real results.**
- `pnpm install` — Done in 17.7s.
- `pnpm gate` (repo root) — `GATE PASS`. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (1.4s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test file was run: the task says "Tests: None" and only docs changed.

**Acceptance check.** All 57 ids are present with exactly one status (diffed the table's ids
against the task's list: 57/57 match, no duplicates). Every `fixed` row has `file:line`
evidence; every `open`/`partly` row names files.

**Problems / deviations.** None material. Two notes for the reviewer:
- WUX-36's fix is present at `apps/web/src/components/MessageBubble.tsx:214`
  (`motion-reduce:animate-none`), but no comment on that line names WUX-36 (the task said a
  comment did). Status is `fixed` either way.
- MUX-13's "Save" shipped but "Share" did not (`expo-sharing` is not a dependency), so it is
  `partly`, not `fixed`.

**Open questions.** None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN.
- The lead spot-checked WUX-17, WUX-18, WUX-33, WUX-36 and the MUX-20 lines on main, and all match.
- Results: 32 fixed, 13 partly, 7 open, 5 not actionable.
- Follow-ups: T-1435 (web) and T-1436 (mobile) batch the small ones. MP-9, UI-15, MUX-13, MUX-19, MUX-21, MUX-23, MUX-24 and WUX-10 wait for Julio's morning: a design, native modules or pipeline work.
