---
id: T-1498
title: "Approvals carry names (approved Approvals canvas): PublicApproval gains aiName and groupName, filled in one query each for list, detail and decide; the mock matches"
status: merged
milestone: M5
branch: task/T-1498-approval-names
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1498: Approvals carry the AI and group names

## Spec (written by Claude, do not edit)

### Why
Julio approved a simpler Approvals design on 2026-10-15. The card in the chat reads "Dev-1 asks", and each row on the Approvals page reads "Dev-1 · Dev team". The clients cannot show that today: `PublicApproval` has `aiId` and `groupId` but no names. This task adds the names on the server and in the mock; the web and phone use them in later tasks.

### Facts (the lead read them on main, 2026-10-15)
- **The contract,** `packages/api-contract/src/approvals.ts`:
  - `PublicApproval` (`:43-66`) has `aiId`, `groupId`, `topicName`, `approverNames`, …;
  - `alwaysEligible` decodes with a default (`:60`, `Schema.withDecodingDefaultTypeKey(Effect.succeed(false))`), so an older server still decodes.
- **`apps/server/src/approvals/api.ts`** (367 lines):
  - `list` (`:80-104`) loads the rows, `managedGroupIds` and `topicNames` once each, then maps each row through `decoratePublic`;
  - `detail` (`:106-131`) does the same for one row;
  - `decide` follows.
- **`apps/server/src/approvals/api-reads.ts`** (222 lines) holds `decoratePublic` (`:159-165`), the batch helpers `visibleTopicNames` (`:170-185`) and `managedGroupIdsForUser` (`:209-222`, "one query for the whole list response — never one query per row").
- **Names:** the AI's is `ais.name` (`apps/server/drizzle/0005_clean_frightful_four.sql:8-11`); the group's is `groups.title` (`GroupRow.title`, `apps/server/src/db/rows.ts:28-31`).
- **The mock's approvals** live in `packages/mock-backend/src/domains/approvals/` (`routes.ts` 91 lines, `seed.ts` 59 lines). The seed uses `aiId: 'ai-dev-1'` and `groupId: null` (`seed.ts:23-24`).

### What to build
1. **Contract:** add to `PublicApproval`, both with decoding defaults like `alwaysEligible` so an older server still decodes:
   - `aiName: Schema.String`, defaulting to `''`;
   - `groupName: Schema.NullOr(Schema.String)`, defaulting to `null`.
2. **Server:** in `api-reads.ts`, add `approvalNames(db, rows)`. It returns two maps, AI id → name and group id → title, with **one** query for the AIs (`WHERE id IN …`) and **one** for the groups. Rows with no group skip the second.
   - `list`, `detail` and `decide` pass the names into each approval they return, so every `PublicApproval` the API sends has them.
   - An AI or group that was deleted gives `''` or `null`.
   - Keep `api.ts` at most 400 lines; if it would grow past that, put the glue in `api-reads.ts`.
3. **Mock:** the mock's approvals answer `aiName` from the mock AI (Dev-1 for `ai-dev-1`) and `groupName` from the mock group, or `null`.
4. **One test,** in `apps/server/src/approvals/service.test.ts` or a new `apps/server/src/approvals/names.test.ts`:
   - the list returns `aiName` and `groupName` for a group approval, and `groupName: null` for a DM one;
   - the two names cost two queries, not one per row (count the queries or assert the helper is called once).

### Allowed files
- `packages/api-contract/src/approvals.ts`
- `apps/server/src/approvals/api.ts`
- `apps/server/src/approvals/api-reads.ts`
- `apps/server/src/approvals/names.test.ts`
- `apps/server/src/approvals/service.test.ts`
- `packages/mock-backend/src/domains/approvals/routes.ts`
- `packages/mock-backend/src/domains/approvals/seed.ts`
- `work/T-1498-approval-names.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/approvals --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- In web `?mock=1`, `GET /api/approvals` carries `aiName: "Dev-1"`.
- After the deploy, `/api/approvals` still answers 401 signed out, and the server logs stay clean.

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/approvals.ts`): added `aiName: Schema.String`
  and `groupName: Schema.NullOr(Schema.String)` to `PublicApproval`, both with
  `Schema.withDecodingDefaultTypeKey` (defaults `''` and `null`), so an older
  server still decodes. Updated the doc comment.
- **Server** (`apps/server/src/approvals/api-reads.ts`): added `approvalNames(db, rows)`,
  returning `{ aiNames, groupNames }` — one `WHERE id IN …` query for the AIs and
  one for the groups, and no group query at all when no row has a group. Added
  `namesForApproval(names, row)` (missing AI → `''`, no/deleted group → `null`).
  `decoratePublic` takes the resolved names and merges them into the wire row;
  `toWireApproval` takes `WireApprovalInput` (the service row plus the two names).
- **Server routes** (`apps/server/src/approvals/api.ts`): `list`, `detail` and
  `decide` each call `approvalNames` once and pass `namesForApproval` into
  `decoratePublic`. `api.ts` is 375 lines (limit 400).
- **Mock** (`packages/mock-backend/src/domains/approvals/routes.ts`): a
  `withNames` helper resolves `aiName` from `data.findAi(aiId)?.name ?? ''` and
  `groupName` from `data.findGroup(groupId)?.title ?? null`; the list, detail and
  decision responses all go through it. `pendingApprovals` is now typed as the
  approval row instead of `unknown[]`.
- **Test** (`apps/server/src/approvals/names.test.ts`, new): one route-level test
  (`GET /api/approvals`) asserting the group approval has `aiName: 'Dev-1'` /
  `groupName: 'Dev team'` and the DM has `aiName: 'Dev-1'` / `groupName: null`;
  one test spying on `runSql` proving `approvalNames` over two AIs and two
  groups costs exactly two queries.
- `seed.ts` was left unchanged: the mock names are resolved at read time from its
  own tables, the same shape as the server, so no seed column was needed.

### Checks run

- `pnpm install` → done, no changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/names.test.ts`
  → 1 file, 2 passed (the spec's `vitest run` form has no worker cap, which AGENTS.md forbids).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals`
  → 4 files, 85 passed.
- `pnpm gate` (from the repo root), real summary lines:

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.4s)
PASS  lint  (0.5s)
PASS  typecheck  (1.6s)
PASS  effect  (0.8s)
SKIP tests @zilar/api-contract (no nearby test files)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (11.6s)
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The gate's scope report lists 7 files outside the Allowed files
(`docs/design/mockups/approvals/*`). Those are not mine: they are the two
commits the branch already carried before I started (`T-1498: spec` and
`T-1498: approved approvals boards`). Every file I changed is inside the Allowed
files, and the scope report is informational — no gate step fails on it.

### Notes for the lead

- The `docs/design/mockups/approvals/*` files show up in the gate's scope report
  because they are committed on this branch ahead of the worker's changes. They
  are the lead's own branch commits, not changes made by me.
- The mock acceptance (`?mock=1` → `GET /api/approvals` carries `aiName: "Dev-1"`)
  is verified by reading the code: the seed AI `ai-dev-1` is named `Dev-1`
  (`apps/mock-backend/src/domains/ais/seed.ts:18-19`) and `findAi` reads that table.
  I did not run the web mock server, and no automated test covers it.
- The "401 signed out / clean logs" acceptance is not something I could exercise
  here: the list/detail/decide handlers keep the same `sessionLayer` middleware
  and no new logging was added.
- Deviations from the spec: none. `seed.ts` is an Allowed file but needed no change.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** the packet was clean (0 of everything) for head `cc076c4c2`.
- **The code follows the spec:**
  - `approvalNames` uses one `ais` query and one `groups` query per batch, and skips the group query when no row has a group;
  - a deleted AI gives `''`, and a missing or absent group gives `null`;
  - `decoratePublic` merges the names for list, detail and decide;
  - the contract fields decode with defaults, so an older server still decodes;
  - the new test checks the names and the query count.
- **Mock:** `withNames` reads `findAi(aiId).name` and `findGroup(groupId).title`. The seeded `ai-dev-1` is Dev-1.
- **Not checked live:** the mock answers inside the app's client, so a page `fetch` cannot see it. T-1499's headless check shows the names on screen.
- **Carried:** the approved Approvals boards and README in `docs/design/mockups/approvals/`.

