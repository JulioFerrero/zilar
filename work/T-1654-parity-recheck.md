---
id: T-1654
title: "Audit (docs only): web vs phone parity for every user-facing change merged 2026-10-10..10-16 — list each web feature, where its phone twin is (file:line) or that it is missing, and the gaps as small tasks"
status: merged
milestone: M5
branch: task/T-1654-parity-recheck
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1654: Parity re-check, web vs phone

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-13): every user-facing change ships on web, Android and iOS. The phone app is one React Native codebase, so phone means both.
- **The old map is stale:** `docs/audit/mobile-parity-gaps.md` dates from 2026-10-05.
- **Since then** many web features have landed (topics, AI work cards, approvals, stickers, group info, settings, AI computers, routines).

The lead needs a fresh, verified list of what the phone still lacks. **Docs only. No code.**

### Facts (the lead read them on 2026-10-16)
- **`work/BOARD.md`** lists merged tasks with their dates (`| [T-XXXX](…) | title | 2026-10-1x |`). The ones dated 2026-10-10 to 2026-10-16 are the scope.
- **Web UI** is in `apps/web/src/` (`components/`, `routes/`). **Phone UI** is in `apps/mobile/src/` (`app/`, `components/`).
- **Shared logic** is in `packages/client-core`, `packages/chat-core` and `packages/api-contract`.

### Steps
1. **From `work/BOARD.md`,** take every merged task dated 2026-10-10..10-16 whose title names a user-facing web change (skip server-only, docs, tooling and size splits).
2. **For each one, find its phone twin** by searching `apps/mobile/src/` for the same feature: the same API call, the same contract type, or the same copy. Record `present` (with `file:line`), `partial` (what is missing, with `file:line`) or `missing`.
3. **Write `docs/audit/parity-2026-10-16.md`:**
   - one table (task id, feature, web `file:line`, phone status and evidence);
   - then **Gaps as tasks:** each `partial`/`missing` row as a small task (goal, files, estimate in minutes), tagged `behaviour` or `visual` (visual means it needs a design canvas first);
   - the counts.
4. **Change no source file.**

### Allowed files
- `docs/audit/parity-2026-10-16.md`
- `work/T-1654-parity-recheck.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Every in-scope web task has a phone row with `file:line` evidence or `missing`.**
- **The gaps are listed as small tagged tasks.**
- **No source changes.**

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/parity-2026-10-16.md`. It replaces the stale
`docs/audit/mobile-parity-gaps.md` (2026-10-05).

1. Read `work/BOARD.md` for the window 2026-10-10..10-16. The window holds 773
   merged rows; I skipped the simplify, size-split, test-cut, mock-sweep,
   Effect/SQL and deploy waves (internal / docs / tooling / size splits) and
   kept the user-facing web changes.
2. For each one I found the phone twin in `apps/mobile/src` (and the shared
   packages) and recorded `present` / `partial` / `missing` with a `file:line`.
   I did the mobile search across five scoped searches and then **opened and
   re-checked every `partial` / `missing` row myself** (people search,
   new-message sheet, archive confirm, reply quote, topic-header group link,
   export, contact-panel shared media, file Download, chat menu, handle skip,
   New group step bar, sticker reorder, approvals header).
3. The doc has the required table (task id, feature, web file, phone status +
   evidence), "Gaps as tasks" (16 small tasks, each with goal, files and
   estimate, tagged behaviour/visual), and the counts.

**123 rows: 95 present, 24 partial, 4 missing.** 16 gap tasks cover 17 rows
(T-1249g merges T-1249 + T-1254); 11 partial/missing rows are not gaps (web-only
input such as keyboard arrows and mouse wheel, a phone-appropriate equivalent
such as the native avatar cropper and Move-up/down reordering, or a
web-platform concern such as ARIA).

No source file changed. Only the two Allowed files are touched.

### Checks run

- `pnpm gate` from the repo root: **GATE PASS**. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: ...`, `size: every changed source file is within 400 lines`
- Ran no package tests: the change touches docs only, so the gate skipped
  tests/effect (no source files changed).

### Notes for the lead

- **The window is very large.** 2026-10-10..10-16 is 773 merged rows, most of
  them internal (the 10-10 refactor/split/test-cut wave and the 10-15 split
  wave). The audit covers 123 user-facing web tasks. If you want a narrower or
  wider net (for example, including bug-fix-only tasks I treated as UX, or the
  mock/perf rows I skipped), say so and I will re-cut it.
- **Biggest real gaps:** export my messages (T-1265) is web-only; the group
  panel is not reachable from a topic header (T-1249/T-1254); people search on
  the phone matches only an exact `@handle` (T-1148).
- **Deliberately not gaps:** keyboard/mouse interactions (T-1219, T-1239,
  T-1339, T-1340), the native avatar cropper (T-1346) and Move-up/down
  reordering (T-1347, T-1523) are phone-appropriate; T-1178's "only while open"
  card is a Web Push concept the phone does not have.
- Every phone `file:line` in the table was opened during this task. A few web
  rows (T-1231, T-1307, T-1483) have no `apps/web/src` file because they are
  phone/shared tasks in a web-oriented window; the table says so.

### Round 1 (fix round)

- **Fixed finding 1 (should-fix).** The not-gap arithmetic was wrong. Section (b)
  lists **11** not-gap rows (T-1178, T-1219, T-1239, T-1284, T-1285, T-1339,
  T-1340, T-1346, T-1347, T-1485, T-1523) and the 16 gap tasks cover **17** rows
  (T-1249g merges T-1249 + T-1254), so 17 + 11 = 28 = 24 partial + 4 missing.
  Changed `docs/audit/parity-2026-10-16.md` to "16 become gap tasks (covering 17
  rows …) and 11 are not gaps" and corrected the same sentence in this Report.
- **Finding 2 is a nit** (web column is `file` only): left untouched, as nits in
  lines I did not otherwise change stay as they are.
- **Tests added:** none. The change is docs only; no behaviour changed and no
  source file was touched, so there is nothing to test.
- **Gate:** `pnpm gate` from the repo root: **GATE PASS** — `gate: 2 changed
  file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`; `SKIP effect (no source files changed)`; scope clean; no new
  migrations. No package tests run (docs-only change).

## Review (written by Claude)

**Approved and merged** (docs only).

- **Pre-review:** clean after 1 auto round, 1 nit (the web column gives files, not lines; that's accepted).
- **The audit:** `docs/audit/parity-2026-10-16.md` checks 123 web rows from 10-10..10-16. **95 present, 24 partial, 4 missing → 16 gap tasks** (12 behaviour, 4 visual) and 11 rows that aren't gaps (keyboard, mouse, web-only).
- **The lead's order:** the behaviour gaps go first, in small mobile batches (at most 3 mobile workers). The visual ones (11, 13, 15, 16) wait for a D24 canvas.
- **Lead docs edit in this commit:** `docs/FEATURES.md` gains:
  - smart wake (T-1631, T-1633) in "AIs in groups";
  - prompt routines (T-1638..T-1655) in "Routines scheduler" and "Tool and routine actions".
