---
id: T-1036
title: "Size split T116: apps/server/src/routines/api.ts (409 lines) into routines/{wire,access,reads,status-errors}.ts, api.ts keeps deps, handlers, changeStatus and mount"
status: merged
milestone: M5
branch: task/T-1036-split-server-routines-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1036: Split `routines/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/routines/api.ts` is 409 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #112 (task T116). The new files go in `apps/server/src/routines/`: `wire.ts`, `access.ts`, `reads.ts` and `status-errors.ts`. `api.ts` keeps the deps, the handlers, `changeStatus`, the mount and every export it has today; `apps/server/src/app.ts` imports it.

- **Existing files:** the folder already holds `audit.ts`, `execute.ts`, `outcomes.ts`, `preflight.ts`, `queries.ts`, `schedule.ts`, `scheduler.ts`, `schemas.ts`, `service.ts`, `support.ts` and `wiring.ts`. Leave them as they are, and note that `wire.ts` is a new, different file from `wiring.ts`.
- **Move unchanged:** move the code as it is, and skip both Dedup items. `accessFor` and `deletedAccessFor` decide who may manage a routine, which is permissions code: not one line of them changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #112, and `apps/server/src/routines/api.ts`.

### Allowed files
`apps/server/src/routines/api.ts`, `apps/server/src/routines/wire.ts`, `apps/server/src/routines/access.ts`, `apps/server/src/routines/reads.ts`, `apps/server/src/routines/status-errors.ts`, `work/T-1036-split-server-routines-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/routines/api.ts` (409 lines) into four new files plus the kept
`api.ts`, following `docs/audit/split-rules.md` and the §2.2 #112 ranges:

- `wire.ts` — `toListWire`, `toDetailWire` (was 167–215).
- `access.ts` — `RoutineAccess`, `routineAccess`, `routineAccessIncludingDeleted`, and
  the private `accessFor`/`deletedAccessFor` (was 217–312). Carries the effect marker (below).
- `reads.ts` — `findTopicById`, `listTopicsByGroup`, `findRoutineById`, `findAiOwner`,
  `findOwnedAiRow`, `findMembership` (was 314–383).
- `status-errors.ts` — private `mapServiceError` and `withServiceErrors` (was 385–409).
- `api.ts` — keeps the header, `RoutinesApi`, `RoutinesApiDependencies`, the five
  handlers, `changeStatus`, `apiLayer` and `mountApi`; it now imports the moved helpers.

Both Dedup items in the plan entry were skipped, as the spec says (`accessFor`/
`deletedAccessFor` stay separate; the reads keep their `runSql(...SqlClient...)`
boilerplate). No line of moved code changed. A byte diff of the old ranges against the
new files shows only: added imports, the marker line, the added `export` keywords, and
Prettier re-wrapping the `findRoutineById`/`findAiOwner` signatures because the `export `
prefix pushed them past the print width. The `api.ts` body (`const RoutinesApi` →
`mountApi`, old lines 37–165) is byte-identical.

No importer changed: `apps/server/src/app.ts:57` still imports `createRoutinesApi` from
`./routines/api`. No import cycle: `access.ts` imports `reads.ts`, never the reverse.

**Effect marker:** `access.ts` is plain `async`/`await` code moved out of an `api.ts` the
base counts as `effect`, so it would be a new `needs-effect` file; it carries
`// effect-plain: moved unchanged from apps/server/src/routines/api.ts (size split)` in
line 1 (split-rules item 6). `reads.ts` and `status-errors.ts` import `effect` (`Effect`,
`SqlClient`) as values and classify as `effect`; `wire.ts` has no signals and is `plain`;
`api.ts` stays `effect`. Gate printed `PASS effect`.

### Files changed

- `apps/server/src/routines/api.ts` (trimmed to the kept code)
- `apps/server/src/routines/wire.ts` (new)
- `apps/server/src/routines/access.ts` (new)
- `apps/server/src/routines/reads.ts` (new)
- `apps/server/src/routines/status-errors.ts` (new)
- `work/T-1036-split-server-routines-api.md` (this file)

### Size (split-rules item 8)

```
old: apps/server/src/routines/api.ts   409

new:
  165  apps/server/src/routines/api.ts
   51  apps/server/src/routines/wire.ts
  103  apps/server/src/routines/access.ts
   83  apps/server/src/routines/reads.ts
   29  apps/server/src/routines/status-errors.ts
```

Every new file and `api.ts` are under 400 lines; no `max-lines` warning appears.

### Export list before and after (split-rules item 8)

`grep -nE '^export'` on `main:apps/server/src/routines/api.ts`:

```
39:export interface RoutinesApiDependencies {
48:export function createRoutinesApi(deps: RoutinesApiDependencies): EffectApiMount {
```

After the split, `api.ts` exports exactly the same two names, same kinds:

```
apps/server/src/routines/api.ts:39:export interface RoutinesApiDependencies {
apps/server/src/routines/api.ts:48:export function createRoutinesApi(deps: RoutinesApiDependencies): EffectApiMount {
```

New module-internal exports the split introduced (not previously exported by `api.ts`,
used only inside the routines module):

```
apps/server/src/routines/wire.ts:3:export function toListWire(routine: PublicRoutine) {
apps/server/src/routines/wire.ts:23:export function toDetailWire(
apps/server/src/routines/access.ts:8:export interface RoutineAccess {
apps/server/src/routines/access.ts:17:export async function routineAccess(
apps/server/src/routines/access.ts:31:export async function routineAccessIncludingDeleted(
apps/server/src/routines/reads.ts:11:export async function findTopicById(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
apps/server/src/routines/reads.ts:22:export async function listTopicsByGroup(db: ServerDatabase, groupId: string): Promise<TopicRow[]> {
apps/server/src/routines/reads.ts:33:export async function findRoutineById(
apps/server/src/routines/reads.ts:47:export async function findAiOwner(
apps/server/src/routines/reads.ts:61:export async function findOwnedAiRow(db: ServerDatabase, aiId: string, ownerId: string) {
apps/server/src/routines/reads.ts:73:export async function findMembership(db: ServerDatabase, groupId: string, userId: string) {
apps/server/src/routines/status-errors.ts:25:export function withServiceErrors<A>(promise: () => Promise<A>): Effect.Effect<A> {
```

`RoutineAccess` is exported so the exported `routineAccess*` signatures do not use a
private name. Net: the public surface of `routines/api.ts` is unchanged.

### Commands run

- `pnpm install` — run first: "Done in 33.3s", `Packages: +1172`, one deprecated
  subdependency (`uuid@7.0.3`) and one mobile peer-dependency warning
  (`@types/react-dom` unmet peer `@types/react@^19.3.0`). No lockfile change.
- `pnpm exec prettier --write` on the five source files — all "unchanged", so they match
  repo formatting.
- No single-file test run: `apps/server/src/routines/` holds no test file, and
  `rg -l routines apps/server/src --glob '*.test.ts'` returned nothing, so there is no
  nearest kept test to run.
- `pnpm gate` — see below.

### Gate (from the repo root)

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (4.4s)
PASS  effect  (1.2s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 6 changed files are the five source files above plus this task file. No file outside
the Allowed list.

### Deviations from the spec

- `findRoutineById` and `findAiOwner` in `reads.ts` are wrapped over several lines (the
  original single-line form plus the added `export ` exceeded the print width). Bodies
  are unchanged.
- `RoutineAccess` is exported (the plan only names it as part of the range); without the
  `export` the exported `routineAccess`/`routineAccessIncludingDeleted` would expose a
  private type name. Same reason the two `accessFor`/`deletedAccessFor` helpers stay
  private.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `routines/api.ts` (409 lines) is now 165 lines, plus `wire` (51), `access` (103), `reads` (83) and `status-errors` (29).
- **The lead's line check:** the old file's non-import code lines against the new files'. The only changes are the signatures of `findAiOwner` and `findRoutineById`, which Prettier wrapped once `export` was added. `accessFor` and `deletedAccessFor` are unchanged.
- **Check:** the gate passed.
