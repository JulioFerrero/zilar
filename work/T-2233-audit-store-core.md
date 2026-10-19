---
id: T-2233
title: "Rewrite map (no code change), messages core A1: the shared client-core store (ledger, history, incoming, send, cache, lifecycle). Behaviour list, slop with file:line, lean target structure with line budgets"
status: merged
milestone: M5
branch: task/T-2233-audit-store-core
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2233: Rewrite map, the shared store

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: the code base is 240k lines of "slop", and trimming a few lines per task does not help. We will **rewrite** the messages core feature by feature, to a line budget, following `docs/LEAN_CODE.md` (read it first). This task is the map a rewrite is written from. It writes one document and changes no code.

The store already went through three "phase" plans (`docs/STORE_CORE_PLAN.md`, `docs/audit/store-phase2-plan.md`, `docs/audit/store-phase3-plan.md`), each saving 15 to 92 lines per task. This map does not continue those plans. It asks what a lean store that does the same job would look like, and how big it would be.

### Scope (7,504 lines, counted 2026-10-19)
Every `.ts` file under `packages/client-core/src/store/` (including `send/`), plus `packages/client-core/src/atom-store.ts` and `packages/chat-core/src/store/ledger.ts`. The biggest:
- `history.ts` (471), `message-cache.ts` (374), `incoming.ts` (372);
- `ledger-edits.ts` (308), `send/outbox.ts` (307), `ledger-ids.ts` (305);
- `actions.ts` (288), `lifecycle.ts` (276), `ledger-history-ingest.ts` (253);
- `ctx.ts` (229), `ledger-incoming.ts` (228), `send/forward.ts` (221);
- `draft-stream.ts` (219), `pins.ts` (211);
- and 30 more files under 200 lines (eleven `ledger-*` files make about 1.8k together).

Read every file in scope fully. Read the app store layers (`apps/web/src/store/`, `apps/mobile/src/store/`) only to learn how the core is used. A twin task (T-2234) maps those layers.

### Write `docs/audit/store-core-rewrite.md`
1. **Behaviour list.** Number every guarantee the store gives the apps, for example:
   - message identity and dedupe (ids, stanza ids, local ids);
   - ordering;
   - history pages and gaps;
   - incoming messages, edits, deletes, reactions;
   - the send pipeline (text, attachment, voice, forward, retry, outbox across restarts, failure states);
   - delivered and read marks, typing, draft streaming, pins, prefs, folders, chat rows, the cache snapshot, the lifecycle (start, stop, suspend, wake, reconnect, sign-out reset).

   For each, give the `file:line` where it lives today and the tests that pin it (tests are allowed here: this is the message pipeline).
2. **Slop by rule.** For each rule in `docs/LEAN_CODE.md`, the places in scope that break it, with `file:line` and the lines it costs. Look hard at:
   - the `ledger-*` split: eleven files for one data structure;
   - `ctx.ts` and its wiring;
   - the `send/*` split;
   - re-exports in `index.ts`;
   - types repeated across files.
3. **Dead code:** exports, ports, fields and branches nothing reaches (prove it with `git grep` over `apps/` and `packages/`).
4. **Lean target structure:**
   - the new files, each with what it owns and a line budget: one ledger module, one history module, one send module, one lifecycle module, and so on, as the code really needs;
   - the files to delete;
   - the total budget against today's 7,504. Aim for at least 40% fewer lines with every guarantee from part 1 kept and the pipeline tests passing.

   Be concrete: someone must be able to write the rewrite spec from this part alone. Say which existing tests guard each new module.
5. **Order and risks.** A rewrite order in steps of at most about 1.5k lines each, each step mergeable alone with the tests green. Name the guarantees that are easy to lose (dedupe, the outbox across restarts, the sign-out reset), and how the lead should check each one (tests, web mock, the phone emulator, or a read-only live look).

Every number traces to a `file:line` you read. Change no code.

### Allowed files
- `docs/audit/store-core-rewrite.md`
- `work/T-2233-audit-store-core.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc has all five parts.
- The target structure has budgets per file and a total, and an order of steps.

---

## Report (written by the worker when done)

### What I did

- Read `docs/LEAN_CODE.md` and `AGENTS.md` completely, then every production file in
  scope (55 files: the 11 ledger files, the 9 `send/` files, `send.ts`,
  `send-failure.ts`, and the remaining store modules) plus `atom-store.ts` and
  `chat-core/src/store/ledger.ts`. Read the test names and the relevant assertions in all
  17 store test files, and read the web store wiring (`effects/ctx.ts`,
  `effects/storeContext.ts`) only to learn usage.
- Wrote `docs/audit/store-core-rewrite.md` (525 lines) with all five required parts:
  1. **Behaviour list**: 62 numbered guarantees, each with `file:line` and the test that
     pins it (identity/dedupe/order, history, incoming, send, marks/drafts/pins/prefs/
     rows/caches/lifecycle).
  2. **Slop by rule**: one subsection per `LEAN_CODE.md` rule, with tables of `file:line`
     and lines involved. Covers the eleven-file ledger split (~110 lines of plumbing),
     the `ctx.ts` bridge (~81 core lines plus ~90 duplicated per app), the `send/*` split
     (~250 duplicated lines), `index.ts`/`ledger.ts`/`send.ts` re-exports, repeated types,
     comment volume (920 lines, 10.7%), and speculative options.
  3. **Dead code**: `git grep` proof per item (`Lifetime.isStoreOpen`,
     `OutgoingBytes.cancel?`, package exports `isAiOnlyCardType`/`senderAiId`, test-only
     constants, unused exports, the `image` branches). 327 exported declarations, 62 used
     only in their own file, 133 names actually imported by apps.
  4. **Lean target structure**: 21 files with what each owns, today's count, a line
     budget, and the tests that guard it. Store target **4,163 against 8,581 today**;
     **4,379 against 8,797** including the two untouched primitives; **41.7% below the
     task's 7,504 baseline** and **50.2% below today's measured count**. Lists the 54
     modules deleted and the 133-name public surface.
  5. **Order and risks**: six steps, each at or below 1.5k touched lines and mergeable
     alone, with the tests to run before each merge; a table of the easy-to-lose
     guarantees (dedupe/first-author, outbox across reconnects, sign-out reset, status
     ladder, one-write history, echo/edit race, group reaction target, visible read marks,
     cache safety, per-user last read) and how to check each (test, web mock, phone
     emulator, read-only live look).

Counting note for the lead: `wc -l` on the scope today is 8,797, not 7,504. The doc shows
both numbers and the percentages against each, so the 40% target holds on either count.
The report's "Dead code" says a few exports are used only by tests; those are marked, not
deleted by this task.

### Files changed

- `docs/audit/store-core-rewrite.md` (new, 525 lines).
- `work/T-2233-audit-store-core.md` (status and this report).

No code changed.

### Commands and real results

- `pnpm install --silent` — success (no output).
- `pnpm exec prettier --check docs/audit/store-core-rewrite.md` — "All matched files use
  Prettier code style!".
- `pnpm gate` (repo root) — **GATE PASS**:

```text
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.5s)
PASS  format  (0.7s)
PASS  lint  (1.4s)
PASS  typecheck  (1.6s)
SKIP effect (no source files changed)
SKIP build @zilar/server (no server, package or manifest change)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No single test file was run separately: the task changes documentation only, and the gate
reported `SKIP effect (no source files changed)`, so no package tests were due.

### Problems, deviations, open questions

- No deviations from the spec; no code was changed.
- `docs/audit/store-core-rewrite.md` notes one open question for the lead (last section):
  the 300-line `history.ts` budget assumes `openAtMessage`'s bounded page walk stays as it
  is. If the lead wants it rewritten differently, the budget still holds but the test at
  `history.test.ts:355-484` must stay the exact contract. This does not block the map.
- The gate's test step was skipped because only docs changed; that is expected, but it
  means the map's test references were read, not executed, in this task.

### Round: prereview fixes

- Finding 1 (should-fix): fixed. The order-and-risks sentence now states the real step
  sizes ("about 1.5k", with Step 1 at 1,809 and Step 2 at 1,651 named as the two
  largest) instead of claiming every step is at or below 1.5k.
- Finding 2 (nit): not changed, because it names lines outside the one line this round
  touched; it stays for the lead to decide.
- Tests: none added or adjusted. The finding is a wording error in a documentation file
  and no code or behaviour changed.
- `pnpm gate` (repo root): **GATE PASS** — PASS install (frozen) (1.5s), PASS format
  (1.1s), PASS lint (0.8s), PASS typecheck (0.8s), SKIP effect (no source files changed);
  scope, migration, images, size and comments checks pass. No single test file was run.

### Round: prereview should-fix

- Finding 1 (should-fix): fixed. B6, B9, B13, B31, B36 and B54 now name the tests that
  pin them (`ledger.test.ts`, `history-page.test.ts`, `history.test.ts`, `send.test.ts`)
  or say "No core test" where none exists (B31 and B54; B13 for the jump caps).
- Finding 2 (should-fix): fixed. New subsection 2.10 covers the platform-and-libraries
  rule and says why there are no violations in scope.
- Findings 3-5 (nits): not changed, because they are outside the lines this round edits.
- Tests: none added or adjusted; this round changes documentation only, no behaviour.
- `pnpm gate` (repo root): **GATE PASS** — PASS install (frozen) (1.2s), PASS format
  (1.2s), PASS lint (1.0s), PASS typecheck (0.9s), SKIP effect (no source files changed);
  scope, migration, images, size and comments checks pass. No single test file was run.

## Review (written by Claude)

Approved; clean after 2 auto rounds (2 nits). The map:
- the store's guarantees as behaviours with `file:line` and the tests that pin each;
- the slop (eleven ledger files and nine send files for two jobs; a 327-declaration barrel against the apps' 133 imported names);
- a target of 21 modules and 4,163 lines against 8,581 (−51%);
- six steps of about 1.5k lines, each with its tests;
- the guarantees that are easy to lose, with a check for each.

**Lead answer to the open question:** keep `openAtMessage`'s 20-iteration loop as it is inside `history.ts`. No rewrite of the walk; `history.test.ts:355-484` stays the exact contract.

**Next:** step 1, the ledger collapse (1,809 → 600).
