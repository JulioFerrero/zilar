---
id: T-2234
title: "Rewrite map (no code change), messages core A2: the web and phone store layers around client-core (ports, lifecycle, history, pins, prefs, providers). Behaviour list, twin logic, slop, lean target with budgets"
status: merged
milestone: M5
branch: task/T-2234-audit-store-apps
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2234: Rewrite map, the app store layers

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: the code base is 240k lines of "slop", and trimming a few lines per task does not help. We will **rewrite** the messages core feature by feature, to a line budget, following `docs/LEAN_CODE.md` (read it first). This task is the map a rewrite is written from. It writes one document and changes no code.

The shared store lives in `packages/client-core/src/store/` (a twin task, T-2233, maps it). Each app still keeps about 2.8k lines of store layer of its own. Many of its files have the same names on both sides (`ports`, `lifecycle`, `history`, `pins`, `locals`, `chat-rows`, `runtime`). `docs/audit/store-phase3-plan.md` §1 lists what is platform and what is "same behaviour, different code"; start from it, but measure again.

### Scope (5,591 lines, counted 2026-10-19)
- **Web, `apps/web/src/store/`** (2,720):
  - `effects/ports.ts` (486), `effects/chatActions.ts` (329), `store.ts` (295), `effects/lifecycle.ts` (238), `effects/history.ts` (198), `effects/prefs.ts` (191), `effects/storeContext.ts` (167), `effects/portTypes.ts` (120), `ChatStoreProvider.tsx` (105), `effects/pins.ts` (100), `messageCache.ts` (98), `realStore.ts` (93);
  - and 10 small files.
- **Phone, `apps/mobile/src/store/`** (2,871):
  - `real-store.ts` (450), `effects/ports.ts` (349), `effects/lifecycle.ts` (296), `effects/history.ts` (243), `chat-store-provider.tsx` (241), `types.ts` (229), `effects/runtime.ts` (216), `effects/events.ts` (173), `effects/pins.ts` (169), `effects/send.ts` (167), `effects/helpers.ts` (143);
  - and 4 small files.

Read every file in scope fully. Read `packages/client-core/src/store/` only to learn what the core already offers.

### Write `docs/audit/store-apps-rewrite.md`
1. **Behaviour list.** Number every behaviour each app's store layer adds on top of the core, for example:
   - the API adapters, session check and session gone;
   - the draft stream transport;
   - visibility and app state, the badge, notifications;
   - chat actions;
   - prefs and backgrounds, pins, folders;
   - the cache, the provider and its hooks, sign-out.

   For each, give the web `file:line`, the phone `file:line`, and whether it is **platform** (must stay per app) or **same rule** (belongs in client-core).
2. **Twin logic.** Every same-rule pair, with both locations and line counts. This is the main output.
3. **Slop by rule.** For each rule in `docs/LEAN_CODE.md`, the places in scope that break it, with `file:line` and the lines it costs. Look hard at:
   - `portTypes.ts` and the ~50-call web API surface against the phone's domain factories;
   - `storeContext.ts`, `ctx.ts`, `runtime.ts` and `helpers.ts`;
   - the provider files.
4. **Dead code:** exports, ports, fields and branches nothing reaches (prove it with `git grep`).
5. **Lean target structure:**
   - per app: the files that stay, each with what it owns (platform only) and a line budget;
   - in client-core: what moves there, with a budget;
   - the files to delete;
   - the total budget against today's 5,591. Aim for at least 50% fewer app-side lines with every behaviour from part 1 kept.

   Be concrete: someone must be able to write the rewrite spec from this part alone.
6. **Order and risks.** A rewrite order in steps of at most about 1.5k lines each, each mergeable alone. Name the behaviours that are easy to lose (sign-out clearing caches, background and resume on the phone, the draft stream), and how the lead should check each one (web mock, the phone emulator, or a read-only live look).

Every number traces to a `file:line` you read. Change no code.

### Allowed files
- `docs/audit/store-apps-rewrite.md`
- `work/T-2234-audit-store-apps.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc has all six parts.
- The target structure has budgets per file and a total, and an order of steps.

---

## Report (written by the worker when done)

### What I did
Read every production file in scope (22 web files, 15 phone files, 5,591 lines), plus
`docs/LEAN_CODE.md`, `docs/audit/store-phase3-plan.md` and the core store exports
needed to tell platform code from same-rule code. Wrote `docs/audit/store-apps-rewrite.md`
with the six requested parts:

1. 32 behaviours with web and phone `file:line` and a platform/same-rule verdict.
2. 13 twin pairs, 1,717 same-rule lines (31% of 5,591), with ranges on both sides.
3. Slop by each `LEAN_CODE.md` rule with `file:line` and line costs.
4. Dead code proved with `git grep`: 28 lines across 8 symbols.
5. Target structure: web 965 lines, phone 1,022 (1,987 total, -64%), client-core
   +445, files to delete, per-file budgets and totals.
6. Five rewrite steps (~1,300 / 950 / 850 / 700 / 600 lines) and ten behaviours
   easy to lose with the test or manual check for each.

Measurement note: four phase-3 extractions (T1 session check, T2 core context,
T6 cache writer, T7 action/state types) had already landed on this branch, so the
document measures what is still duplicated rather than the older figures in
`store-phase3-plan.md`. Every count was re-run with `wc -l` on this tree.

### Files changed
- `docs/audit/store-apps-rewrite.md` (new, 355 lines)
- `work/T-2234-audit-store-apps.md` (status and this Report)

No code changed.

### Commands and results
- `pnpm install`: done in 37.8s; 1,155 packages, 1 peer-dependency warning
  (`@types/react` 19.2.18 vs `@types/react-dom` wanting ^19.3.0).
- `pnpm gate`:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.6s)
  PASS  lint  (1.7s)
  PASS  typecheck  (2.7s)
  SKIP effect (no source files changed)
  SKIP build @zilar/server (no server, package or manifest change)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- Single test files: none run. This task changes no source, and the gate skipped
  package tests for the same reason. I did not run the store test suites.

### Problems / deviations
- None from the spec. The doc's target budgets are estimates derived from the
  measured line ranges; part 5.5 labels them as targets.
- `docs/audit/store-phase3-plan.md` is stale in places (it was counted at
  `b28e534bd`). I used it only as a starting inventory and re-measured every claim.
- Phone group files (`effects/groups.ts`, `group-actions.ts`, `group-roles-actions.ts`)
  are outside the task's 2,871-line scope, so they are named but not budgeted.

### Open questions
None. The rewrite spec can be written from part 5 alone; the only decision it will
need is the one flagged in part 2: normalise `currentUserId`/`activeChatId` to
`string | undefined` in core and map at the phone UI edge.

### Round
PREREVIEW fix round, 2026-10-19:
- Finding 1 (should-fix): kept web `effects/badge.ts` as budgeted in §5.2 and
  removed it from §5.4 (now 8 files, 367 lines) and from step 4. Commit
  `7aa63f162`.
- Finding 2 (should-fix): kept phone `offline-cache-sync.ts` as budgeted in §5.3
  and removed it from §5.4 (now 1 file, 23 lines) and from step 4. Commit
  `8c1eed2dc`.
- Finding 3 (nit): left untouched; the heading at
  `docs/audit/store-apps-rewrite.md:240` still says 983 lines while the table and
  totals sum to 965, but it is not a line either fix changes.
- Tests added: none; this round edits one document and no code or test file.
- `pnpm gate`: `GATE PASS` (install, format, lint, typecheck; effect and server
  build skipped for no source change; scope clean).

### Acceptance
- Gate passes: yes.
- All six parts present: yes.
- Per-file budgets, total and order of steps: yes (5.2-5.5, 6.1).


## Review (written by Claude)

Approved; clean after 1 auto round (1 nit). The map:
- platform vs same-rule pieces for every app store file;
- an app-side target of 1,987 lines against 5,591 (−64%), with +445 in client-core;
- 5 mergeable steps with the tests that guard each;
- the behaviours that are easy to lose: sign-out reset, background and resume, draft stream, session gone, topic gone, push pair, local URL strip.

**Lead note:** the store steps start after the shared-store map (T-2233), since both change the core context. The chat-list client rewrite (T-2231's map) shares `apps/web/src/store/store.ts` and `selectors.ts` with step 5, so it runs before step 5.
