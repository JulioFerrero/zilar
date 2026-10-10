---
id: T-0935
title: "Audit (no code): plan a better mock mode, where both apps' real stores run on one shared fake backend (fake HTTP plus fake XMPP), replacing the two hand-written mock stores and the duplicated mock data"
status: merged
milestone: M5
branch: task/T-0935-mock-plan-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0935: Mock mode plan (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: "we need the mock mode so you can test and we can see new features, etc, its good but maybe we can do better". Today the mock code is 12,447 lines (the lead measured it):
- **web:** `apps/web/src/mock/` (12 files, 6,331 lines, with `api.ts` at 4,297) and `apps/web/src/store/mockStore.ts` (1,294; `createChatStore` at `:434`, re-exported at `apps/web/src/store/store.ts:40`);
- **mobile:** `apps/mobile/src/mock/` (26 files, 3,227 lines, one per domain) and `apps/mobile/src/store/chat-store.ts` (1,595, an in-memory mock store);
- **the switches:** web decides in `apps/web/src/mock/gate.ts` (`resolveMockMode`), and in mock mode `request()` in `apps/web/src/lib/api.ts` answers from `mock/api.ts`. Mobile decides in `apps/mobile/src/store/chat-store-provider.tsx`.
- `packages/xmpp-core/src/testing.ts` (88 lines) already has `createFakeXmppCore`.

So each app keeps its own fake store next to the real one, and its own copy of the fake data. The real stores now run on `packages/client-core/src/store`.

### What to build
One document, `docs/audit/mock-plan.md`, covering:
1. **Inventory:** what each mock file fakes (which endpoints, which store actions, which seed data), with `file:line`, and where web and mobile duplicate each other.
2. **The design:** mock mode runs each app's **real** store, unchanged, against a shared fake backend in one package:
   - a fake HTTP layer answering the `packages/api-contract` endpoints from in-memory data. Say whether the contract's HttpApi groups can be served by an in-memory handler, or whether a plain `request()` switch is simpler;
   - a fake XMPP core built on `createFakeXmppCore`: send and echo, rooms, MAM history, typing, reads;
   - one seed data set.

   Name the package, its folders and its public API.
3. **What it must cover:** every screen Julio uses to see a new feature (chats, topics, groups, AIs, approvals, stickers, voice, attachments, search, settings), so mock mode stays useful for demos and the lead's checks. List anything that is not worth faking.
4. **The task split:** ordered tasks of at most about 800 changed lines each, every one with its files, `file:line` anchors, what gets deleted, and how to check it (the app runs in mock mode on web at `?mock=1`, and on the mobile emulator). Include the target total line count.
5. **Risks and open questions** for Julio, if any.

Change no code.

### Read first
`AGENTS.md`, `docs/STORE_CORE_PLAN.md` (sections 4 and 9), the files above, `apps/web/src/lib/api.ts` (the `request()` mock branch), and `packages/api-contract/src/api.ts`.

### Allowed files
`docs/audit/mock-plan.md`, `work/T-0935-mock-plan-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/mock-plan.md
```

### Acceptance
- `docs/audit/mock-plan.md` exists, cites `file:line` for every claim, and gives the task split and the target line count.
- No code changes.

---

## Report (written by the worker when done)

**Status:** review. Audit only — no code changed.

### What I did

Wrote `docs/audit/mock-plan.md` (a new document) covering all five points the
spec asks for:

1. **Inventory.** All 12 web mock files and all 26 mobile mock files (plus the
   five `components/*/*-mock.ts` outside `src/mock/`, which the task's 12,447
   count excludes), with line counts, what each fakes and `file:line` anchors:
   the web route table (`mock/api.ts` `mockRequest` at `:2179` and its sections),
   the web seed files, `store/mockStore.ts`, the mobile `src/mock/` tree and
   `store/chat-store.ts`, and the switches. A duplication table maps each web
   fake to its mobile twin, with anchors.
2. **The design.** One shared package `@zilar/mock-backend`
   (`packages/mock-backend/`), its folders and public API; a `Response`-returning
   fake HTTP layer with both apps' seams explained; a fake XMPP core built on
   `createFakeXmppCore` (`packages/xmpp-core/src/testing.ts:32`); one JID-keyed
   seed; and how each app runs its real store unchanged through
   `RealStoreDeps`/`fetchImpl`.
3. **Coverage.** A per-area table (chats, sending, topics, groups, AIs,
   approvals, tools, stickers/GIFs, voice, attachments/media, search, pins,
   settings, directory, push, machines) and a "not worth faking" list.
4. **Task split.** Twenty-six ordered tasks with files, anchors, deletions and
   checks: ten build/switch tasks (A–H + F2 + S) followed by a sixteen-task
   deletion sweep (I–R2). Target line count: from 12,447 (13,596 with the
   component mocks) down to ≈5,750 (≈18,350 changed lines).
5. **Risks and open questions** (R1–R7) and three questions for Julio (Q1–Q3).

Answers to the spec's explicit design questions:

- **HttpApi handler vs plain `request()` switch:** the doc recommends the plain
  switch, because the server's `HttpApiBuilder` handlers run on server-only
  services/DB (e.g. `apps/server/src/pins/api.ts:71`), both clients already
  validate decoded bodies, mobile never calls web's `mockRequest` (it injects
  `fetchImpl`), and the switch must keep the existing `Blob`-body upload paths.
- **Package/folders/API, seed, coverage, target count:** all in §2 and §4.

### Files changed

- `docs/audit/mock-plan.md` (new, 564 lines) — the only deliverable.
- `work/T-0935-mock-plan-audit.md` — status and this report.
- No source, test or config file was touched. `pnpm install` left the lockfile
  unchanged (frozen install passes in the gate).

### Commands and real results

- `pnpm install` — Done in 46.9s (1262 resolved, 1172 added). One peer warning:
  `apps/mobile` `@types/react-dom 19.3.0` wants `@types/react@^19.3.0`, found
  19.2.18. Pre-existing, not caused by this task.
- `pnpm exec prettier --check docs/audit/mock-plan.md` — `All matched files use
  Prettier code style!`
- `pnpm gate` (from the repo root):
  ```text
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (1.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No test files were run: the change touches only docs, so `pnpm gate` skipped
  the package tests (`SKIP effect (no source files changed)`).

### Deviations from the spec

- None. `Change no code` is honored: no non-doc file was modified.
- The spec's 12,447-line figure counts only `src/mock/` + the two stores; the
  doc also lists the five `components/*/*-mock.ts` (1,131 lines) so the plan's
  deletions account for all mock code. This is an addition to the inventory, not
  a change of scope.
- The task-split table's estimates are changed-line counts (added+removed); the
  deletion sweep's four over-budget tasks (J, N, O, Q) each remove one
  monolithic file or range, which cannot be half-deleted without leaving a
  broken, dead module between commits. The doc explains why and keeps every
  other task ≈800 changed lines or less.

### Blocked / needs a decision

Not blocked. Open questions are in §5 of the document and repeated here for the
lead: Q1 (may mobile mock mode use a fake session token and start the real store
without a login?), Q2 (must existing mock-mode deep links keep working, or may
ids change with the unified seed?), Q3 (is a first wave of chats/topics/groups/
AIs/approvals enough to start?).

### Round (fix round)

Pre-review finding 1 (should-fix) — §4's task-split estimates undercounted their
own deletions and the table sum did not reconcile with the plan's line budget.
Fixed in `docs/audit/mock-plan.md` §4:

- Each task now carries `Add`/`Del`/`Est.` (changed lines). The old
  aggregation lumps are split: backend building (A–F2) and app cutover (G, H)
  are separate from a sixteen-row **deletion sweep** (I–R2), one file or one
  contiguous `api.ts` range per task.
- Estimates are recomputed from measured file sizes (`wc -l`): `mockStore.ts`
  1,294; `chat-store.ts` 1,595; `mock/api.ts` 4,297; `mock/messages.ts` 1,148;
  the mobile `src/mock` tree 2,825; the five `components/*/*-mock.ts` 1,131.
- The tables now reconcile: adds 5,250 + deletes 13,108 = 18,358 ≈ 18,350
  changed lines; net removal ≈7,900; target ≈5,750 lines (488 kept + 5,250
  written). The budget paragraph states the net-vs-changed difference
  explicitly. Four deletion tasks are honestly over ~800 because each removes
  one monolithic file/range (J 853, N 1,148, O 1,294, Q 1,595); the document
  says why they cannot be split and that every other task is ≈800 or less.
- R1's stale task reference (`G, H, I`) updated to `O, Q, R1, R2`.

Tests: none. The change is docs-only and the finding names no test, so there is
no behaviour to cover.

Checks: `pnpm exec prettier --check docs/audit/mock-plan.md` — all matched files
use Prettier code style. `pnpm gate` from the repo root:

```text
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (0.8s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Round 2 (fix round)

Pre-review finding 1 (should-fix) — the Report's numbers were stale after the
previous round: it still said "Twelve ordered tasks (A–K)… down to ≈5,100" and
"555 lines", while the deliverable holds 26 tasks (A–H + F2 + S plus a
sixteen-task I–R2 deletion sweep) targeting ≈5,750 lines in a 564-line file.
Fixed the Report:

- §4 bullet now says twenty-six ordered tasks (ten build/switch: A–H + F2 + S,
  then the sixteen-task I–R2 deletion sweep) and a target of ≈5,750 lines
  (≈18,350 changed lines).
- Files changed now records `docs/audit/mock-plan.md` as 564 lines.
- The Deviations bullet no longer claims G/H are deletion-dominated; it names
  the sweep's four over-budget tasks (J, N, O, Q), matching the document, and
  no longer describes the abandoned "spread deletions across domain tasks"
  mechanism.

Pre-review finding 2 (nit) — demo task `S` sits between `H` and the I–R2 sweep
(`docs/audit/mock-plan.md:452`). Left unchanged: it is a nit and not a line this
round changes; the section already states `S` depends on `G, H` and presents
the deletion sweep separately below the build table.

Tests added: none. Docs-only; the finding names no test and there is no
behaviour to cover.

Checks: `pnpm exec prettier --check docs/audit/mock-plan.md
work/T-0935-mock-plan-audit.md` — all matched files use Prettier code style.
`pnpm gate` from the repo root:

```text
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (0.9s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-10: approved. Clean after 2 automatic rounds.**
- **The plan:** `docs/audit/mock-plan.md`. Both apps run their real store against one `@zilar/mock-backend` package, with a plain `(path, init) => Response` switch and a fake XMPP core on `createFakeXmppCore`.
- **Lines:** mock code goes from 13,596 to about 5,750, a net cut of about 7,900.
- **The split:** build tasks A–F2, the cutovers G and H, then the deletion sweep I–R2. Each switched domain's old mock code goes in its own task.
- **Open questions Q1–Q3:** for Julio.
- Docs only.
