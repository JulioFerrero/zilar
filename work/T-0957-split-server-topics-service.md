---
id: T-0957
title: "Size split T14: apps/server/src/topics/service.ts (1,127 lines) into topics/{schemas,members,roles,ais,queries}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0957-split-server-topics-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0957: Split `topics/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/topics/service.ts` is 1,127 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #10 (task T14): `topics/schemas.ts`, `topics/members.ts`, `topics/roles.ts`, `topics/ais.ts`, `topics/queries.ts`, under `apps/server/src/`. `topics/service.ts` becomes the barrel.

Skip the entry's cross-file dedup items (`isUniqueViolation` → `handles/store.ts`, and `mapXmppError`); they belong to the F tasks. This is permissions code (topic access and roles), so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #10, and `apps/server/src/topics/service.ts`.

### Allowed files
`apps/server/src/topics/service.ts`, `apps/server/src/topics/schemas.ts`, `apps/server/src/topics/members.ts`, `apps/server/src/topics/roles.ts`, `apps/server/src/topics/ais.ts`, `apps/server/src/topics/queries.ts`, `work/T-0957-split-server-topics-service.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/topics/service.ts` (1,127 lines) into the five modules that
`docs/audit/size-plan.md` §2.1 #10 (task T14) names, following `docs/audit/split-rules.md`.
`topics/service.ts` stays as the entry point: it keeps the create/patch/archive
orchestrators and re-exports every moved name.

Module assignment (original line ranges):
- `topics/schemas.ts`: `CreateTopicBody`, `PatchTopicBody`, `TopicServiceDeps`,
  `CreateTopicInput`, `defaultGlyph`, `auditDetail`, `toAuditEntry` (33–134).
- `topics/members.ts`: `assertNameFree`, `assertOwner`, `assertLink`,
  `assertMembersAreGroupMembers` (135–223), `addTopicMember`, `removeTopicMember` (619–768).
- `topics/roles.ts`: `emitDroppedTopicAis`, `AddTopicAiBody`, `SetTopicRolesBody`,
  `SetTopicRolesInput`, `setTopicRoles` (769–928).
- `topics/ais.ts`: `AddTopicAiInput`, `addTopicAi`, `removeTopicAi` (929–1094).
- `topics/queries.ts`: `uniqueRoomLocalpart` (78–105), `deleteTopicRows` (225–235),
  `listTopicMembers` (552–618).
- `topics/service.ts` keeps `createTopic`, `patchTopic`, `archiveTopic`, `snakeCaseKeys`,
  `mapXmppError`, `isUniqueViolation`, `destroyQuietly`, plus the re-exports.

Code moved unchanged. The only edits besides the move: `export` was added to the internal
helpers that now cross module boundaries (`toAuditEntry`, `assertNameFree`, `assertOwner`,
`assertLink`, `assertMembersAreGroupMembers`, `emitDroppedTopicAis`, `uniqueRoomLocalpart`,
`deleteTopicRows`), and the barrel gained `export … from` lines. No renames were needed.

The entry's cross-file dedup items were skipped as the spec says (they belong to the F tasks):
`isUniqueViolation` → `handles/store.ts`, `mapXmppError` → `groups/service.ts` shared
constructor, and the `FROM group_members` copies → `groups/access.ts`. So `mapXmppError` and
`isUniqueViolation` stay in the barrel and the SQL copies are untouched.

### Files changed
- `apps/server/src/topics/service.ts` (modified, now barrel + core mutations)
- `apps/server/src/topics/schemas.ts` (new)
- `apps/server/src/topics/members.ts` (new)
- `apps/server/src/topics/roles.ts` (new)
- `apps/server/src/topics/ais.ts` (new)
- `apps/server/src/topics/queries.ts` (new)
- `work/T-0957-split-server-topics-service.md` (this report)

No file outside the Allowed files was touched (gate scope: "every changed file is inside the
Allowed files"). `topics/api.ts` (the only importer, via `./service`) is unchanged.

### Size (`wc -l`)
- old `apps/server/src/topics/service.ts`: 1,127
- new `apps/server/src/topics/service.ts`: 389
- new `apps/server/src/topics/schemas.ts`: 79
- new `apps/server/src/topics/members.ts`: 257
- new `apps/server/src/topics/roles.ts`: 174
- new `apps/server/src/topics/ais.ts`: 179
- new `apps/server/src/topics/queries.ts`: 117

Every file is ≤ 400 lines.

### Export diff (`grep -E "^export"`)

Old `service.ts` (20 names) with their new home:
- `CreateTopicBody`, `PatchTopicBody`, `TopicServiceDeps`, `CreateTopicInput` → `schemas.ts`
- `defaultGlyph`, `auditDetail` → `schemas.ts`
- `createTopic`, `patchTopic`, `archiveTopic` → stay in `service.ts`
- `PatchTopicInput` → stays in `service.ts`
- `listTopicMembers` → `queries.ts`
- `addTopicMember`, `removeTopicMember` → `members.ts`
- `AddTopicAiBody`, `SetTopicRolesBody`, `SetTopicRolesInput`, `setTopicRoles` → `roles.ts`
- `AddTopicAiInput`, `addTopicAi`, `removeTopicAi` → `ais.ts`

New `service.ts` barrel:
```
export { auditDetail, defaultGlyph } from './schemas';
export type { CreateTopicBody, CreateTopicInput, PatchTopicBody, TopicServiceDeps } from './schemas';
export { listTopicMembers } from './queries';
export { addTopicMember, removeTopicMember } from './members';
export { setTopicRoles } from './roles';
export type { AddTopicAiBody, SetTopicRolesBody, SetTopicRolesInput } from './roles';
export { addTopicAi, removeTopicAi } from './ais';
export type { AddTopicAiInput } from './ais';
export async function createTopic( … )
export interface PatchTopicInput extends PatchTopicBody { … }
export async function patchTopic( … )
export async function archiveTopic( … )
```
The barrel exports exactly the same 20 names with the same kinds (11 values, 9 types) as the
old file. The new module files also export the internal helpers above so the barrel can import
them; those were file-local before and are not part of the barrel's public surface.

### Effect ratchet
No `// effect-plain:` marker was added. `schemas.ts` is plain but has no hard signals;
`queries.ts`, `members.ts`, `roles.ts`, `ais.ts` and the barrel all import `effect`, so none is
`needs-effect` and the ratchet has nothing to flag (gate `effect` step passed).

### Commands and results
- `pnpm install` — ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts` —
  1 file passed, 22 tests passed. This is the nearest kept test that drives the topics service
  (via the HTTP API: create/patch/archive, members, roles, hidden-topic 404s).
- `pnpm gate` (from repo root):
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.4s)
PASS  lint  (0.7s)
PASS  typecheck  (3.5s)
PASS  effect  (1.1s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Notes / deviations
- The gate's tests step reports `SKIP tests @zilar/server (no nearby test files)` because there
  is no test file directly in `apps/server/src/topics/`; the nearest-test rule only picks tests
  in the changed file's own folder. I ran `roles.test.ts` manually (it exercises the moved code
  through the topics API) to cover the change.
- No new tests were written and no test was edited (split-rules item 5).
- No open questions; nothing blocked.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `topics/service.ts` (1,127 lines) is now 389 lines, plus `schemas`, `members`, `roles`, `ais` and `queries`; every file is under 400.
- **Check:** the gate passed. It found no nearby test, so the lead ran the server tests that exercise topics, `roles.test.ts`, `approvals/service.test.ts` and `invite-links.test.ts`, on the branch: 90 passed.
