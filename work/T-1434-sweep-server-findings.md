---
id: T-1434
title: "Findings sweep (server, security, perf, AI, ops): recheck the 59 open SG/SEC/PERF/AI/OPS findings against main and record which are fixed, open, partly open or need Julio, with file:line evidence"
status: merged
milestone: M5
branch: task/T-1434-sweep-server-findings
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1434: Findings sweep, server, security, perf, AI and ops

## Spec (written by Claude, do not edit)

### Why
The plan page (`docs/plan/plan.json`) marks a finding fixed only when a plan item's `closes` names it, and many were fixed by other tasks since the audits were written (2026-10-10 to 10-12). The lead needs the real open list to batch fixes tonight. **This task changes no code and touches no server.**

### Input
The 59 findings that plan.json leaves open:

`SG-4 SG-5 SG-6 SG-7 SG-8 SG-9 SG-10 SG-11 SEC-3 SEC-11 SEC-12 SEC-13 SEC-14 SEC-15 PERF-2 PERF-5 PERF-7 PERF-8 PERF-9 PERF-10 PERF-11 PERF-12 PERF-13 PERF-14 PERF-15 PERF-16 PERF-17 PERF-18 AI-9 AI-10 AI-11 AI-13 AI-14 AI-15 AI-16 AI-17 AI-18 AI-19 AI-20 AI-21 AI-22 AI-23 OPS-1 OPS-3 OPS-4 OPS-5 OPS-7 OPS-8 OPS-9 OPS-10 OPS-11 OPS-12 OPS-13 OPS-14 OPS-15 OPS-18 OPS-19 OPS-20 OPS-21`

Each one's full text is in its audit doc:
- `docs/audit/social-graph-audit.md` (SG);
- `docs/audit/security-audit.md` (SEC);
- `docs/audit/performance-audit.md` (PERF);
- `docs/audit/ai-features-audit.md` (AI);
- `docs/audit/ops-reliability-audit.md` (OPS).

### What to do
1. For each finding, read its text and the code it cites, then check **main as it is now**. Line numbers may have moved, so search for the code.
   - Note that the AI audit predates the agent system: T-1393 to T-1427 replaced LiteLLM with Effect AI, added desks, the session log and Stop.
   - For OPS findings, use only the repo: `deploy/`, `docs/RELEASING.md`, compose files and workflows. Don't contact any server.
2. Classify each one:
   - `fixed`: give the evidence `file:line` and the task id if known;
   - `open`: say what is still wrong in one line, with `file:line`;
   - `partly`: say what is done and what remains;
   - `needs Julio`: production config, accounts, keys or a product decision. Say what exactly;
   - `obsolete`: the code it describes no longer exists. Say what replaced it.
3. For each `open` or `partly` finding, add `area`: the main files it would touch (full repo paths).
4. Write `docs/audit/findings-sweep-server.md`, with a short intro and one table: `| id | status | evidence / what remains | area |`. End with counts per status.

### Tests
None.

### Allowed files
`docs/audit/findings-sweep-server.md`, `work/T-1434-sweep-server-findings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- All 59 ids are present, each with a status.
- Every `fixed` row has evidence, and every `open` or `partly` row names files.

---

## Report (written by the worker when done)

### What I did

- Read the task and AGENTS.md, then the five audit docs and `docs/plan/plan.json`.
- Ran `pnpm install` (done, 15.7s).
- Rechecked each of the 59 open ids (SG-4..11, SEC-3/11..15, PERF-2/5/7..18,
  AI-9..23, OPS-1/3..21) against the code on this branch. I did not trust the
  audit line numbers; I searched for the cited symbols/files and read the current
  code. Where the finding was fixed after the audit, I identified the closing task
  from `work/` and `git log`.
- Wrote `docs/audit/findings-sweep-server.md`: short intro, one
  `| id | status | evidence / what remains | area |` table with all 59 rows, and a
  counts table. `area` is filled for every `open` and `partly` row.

### Result

| status | count | ids |
| --- | --- | --- |
| fixed | 26 | SG-4, SG-5, SG-6, SG-9, SG-10, SG-11, SEC-11, PERF-2, PERF-7, PERF-9, PERF-12, PERF-13, PERF-14, PERF-15, PERF-17, AI-9, AI-10, AI-11, AI-13, AI-14, AI-18, AI-19, AI-20, AI-21, OPS-10, OPS-21 |
| partly | 17 | SG-7, SG-8, SEC-3, SEC-12, SEC-13, SEC-14, PERF-5, PERF-11, AI-15, AI-22, OPS-1, OPS-3, OPS-5, OPS-12, OPS-13, OPS-18, OPS-19 |
| open | 7 | AI-17, AI-23, OPS-7, OPS-8, OPS-11, OPS-14, OPS-20 |
| needs Julio | 8 | SEC-15, PERF-8, PERF-10, PERF-16, PERF-18, OPS-4, OPS-9, OPS-15 |
| obsolete | 1 | AI-16 |
| **total** | **59** | |

The most useful grouping for tonight's batch:

- Server-code fixes, no Julio needed: the `partly` SG-7 (N+1 relations),
  SG-8 (group ban list), SEC-12 (stored owner id), SEC-13 (per-group tool
  switch), SEC-14 (instance-settings key), PERF-5 (archive-scan cache/batching),
  PERF-11 (poll interval by socket state), AI-15 (usage cache), AI-22
  (`lastFailure` on `GET /api/ais`), AI-17 (time-zone column + prompt), AI-23
  (re-approve hosts on a new tool version).
- Ops docs/config in the repo: OPS-1 / OPS-5 / OPS-12 / OPS-13 (docs and
  compose clean-up).
- Needs Julio / live box: PERF-8 and PERF-16 (need `EXPLAIN ANALYZE` on the
  live `archive` table; the GIN index lives in ejabberd's DB), PERF-10 and
  PERF-18 (production ejabberd config), SEC-15 (product trade-off), and the
  Coolify-side OPS-4, OPS-9, OPS-15.

### Files changed

- `docs/audit/findings-sweep-server.md` (new).
- `work/T-1434-sweep-server-findings.md` (status + this Report).

### Commands run (real results)

- `pnpm install --frozen-lockfile`: done in 15.7s, exit 0.
- No tests: the spec says "Tests: None", and I touched only docs.
- `pnpm gate` (from the repo root), summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.1s)
PASS  lint  (1.2s)
PASS  typecheck  (1.3s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Problems and deviations

- None. I changed no code and touched no server. Every id is present once, every
  `fixed` row carries `file:line`, and every `open`/`partly` row names files.
- Method note: two claims in the sweep are inherited from other tasks' reports
  rather than re-derived from first principles — `AI-16 obsolete` (LiteLLM path
  removed, listener force-off) and the exact task ids credited for a few fixes.
  The `file:line` evidence for each was read directly; the task-id attribution is
  best effort.

### Open questions for the lead

- PERF-8/PERF-16 and the other `needs Julio` rows are recorded as such rather
  than `open`; if you would rather they stay in the code batch, say so and I (or
  the next task) can move them.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1 (two off-by-one line refs, harmless).
- Results: 7 open (AI-17, AI-23, OPS-7, OPS-8, OPS-11, OPS-14, OPS-20), 17 partly, 8 needing Julio, 1 obsolete.
- The lead batches the open and partly ones that touch no production config.
