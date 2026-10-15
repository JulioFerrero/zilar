---
id: T-1546
title: "Split apps/server/src/topics/access.ts (400 lines, the limit): the topic schemas and view types move to topics/types.ts and the AI-in-topic checks (aiMayBeInTopic, allowedTopicAiIds) to topics/ai-access.ts; access.ts re-exports everything it exported; no behaviour change"
status: merged
milestone: M5
branch: task/T-1546-split-topics-access
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1546: Split topics/access.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/topics/access.ts` is exactly 400 lines after T-1537. It holds topic visibility and permissions (crucial code), and 44 files import it. **Follow `docs/audit/split-rules.md`:** the original path stays a barrel that re-exports every name, so **no importer changes**.

### Facts (the lead read them on main, 2026-10-15)
- **Types and schemas (`:17-89`):**
  - `topicVisibilitySchema`, `TopicVisibility`, `topicKindSchema`, `TopicKind`, `topicStatusSchema`, `TopicStatus`;
  - `export type { TopicRow }`;
  - `TopicOwnerView`, `TopicRoleView`, `TopicActivityEntry` (with `jid?`), `TopicView` and `TopicAiView`.
- **Access functions:**
  - `MISSING_TOPIC_MESSAGE`, `TOPIC_NOT_FOUND`, `toMissingTopic` (`:91-102`);
  - `getTopic` (`:104`), `getGroupMembership` (`:115`), `isPrivateMember` (internal, `:132`);
  - `canSeeTopic` (`:153`), `requireVisibleTopic` (`:174`), `visibleTopics` (`:190`);
  - `canManageTopic` (`:242`), `requireManagedTopic` (`:260`), `canCreateTopic` (`:282`);
  - `aiMayBeInTopic` (`:309`) and `allowedTopicAiIds` (`:339-392`).
- **Trailing re-exports** (`:394-400`): `countTopicMembers`, `resolveOwnerName`, `toTopicView`, `listTopicAis` and `toTopicViews` from `./views`.
- **Imports** at `:8-16`.

### Steps
1. **New `apps/server/src/topics/types.ts`:** move the schemas and view types (`:17-89`) unchanged, with the imports they need. `access.ts` re-exports them all, value or type exactly as before.
2. **New `apps/server/src/topics/ai-access.ts`:** move `aiMayBeInTopic` and `allowedTopicAiIds` unchanged. Import what they need from `./access`, or from the original modules, whichever avoids a runtime cycle. A type-only import from `./types` is fine. `access.ts` re-exports both.
3. **`access.ts`** keeps the visibility and manage functions, the not-found helpers, and every export and re-export, so all 44 importers work unchanged. It ends under about 250 lines.
4. **No behaviour change.** Moved code is unchanged. If the Effect ratchet trips, use the `effect-plain` marker as `split-rules.md` §6 says.

### Tests
None new. The topic tests (`apps/server/src/topics/*.test.ts`) must pass in the gate.

### Allowed files
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/types.ts` (new)
- `apps/server/src/topics/ai-access.ts` (new)
- `work/T-1546-split-topics-access.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of the three files;
  - the export list of `access.ts` before and after (identical names and kinds);
  - the gate summary.
- No other file changes.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/topics/access.ts` (400 lines on main) into three files, no behaviour change, per `docs/audit/split-rules.md`:

- `topics/types.ts` (new): the schemas (`topicVisibilitySchema`, `topicKindSchema`, `topicStatusSchema` and their `Type`s), `export type { TopicRow }`, and the view types (`TopicOwnerView`, `TopicRoleView`, `TopicActivityEntry`, `TopicView`, `TopicAiView`), moved unchanged. Imports `Schema` from `effect`, `TopicRow` (type) from `../db/rows`, `AiActivityState` (type) from `./ai-activity`.
- `topics/ai-access.ts` (new): `aiMayBeInTopic` and `allowedTopicAiIds`, moved unchanged. Imports `canSeeTopic` from `./access` (the only runtime back-edge; a documented ESM function-hoisting cycle, verified by the passing tests) and `topicRoleHolderIds` from `../roles/service`.
- `topics/access.ts`: keeps the not-found helpers and the visibility/manage functions (`MISSING_TOPIC_MESSAGE`, `TOPIC_NOT_FOUND`, `toMissingTopic`, `getTopic`, `getGroupMembership`, `isPrivateMember`, `canSeeTopic`, `requireVisibleTopic`, `visibleTopics`, `canManageTopic`, `requireManagedTopic`, `canCreateTopic`) and re-exports every name it exported before.

`wc -l` of the three files:

```
246 apps/server/src/topics/access.ts
 80 apps/server/src/topics/types.ts
106 apps/server/src/topics/ai-access.ts
```

Export list before (`git show HEAD:apps/server/src/topics/access.ts`) vs after (barrel + `types.ts` + `ai-access.ts`), identical names and kinds, 29 each:

```
BEFORE (29): TOPIC_NOT_FOUND, TopicActivityEntry, TopicAiView, TopicKind, TopicOwnerView, TopicRoleView, TopicRow, TopicStatus, TopicView, TopicVisibility, aiMayBeInTopic, allowedTopicAiIds, canCreateTopic, canManageTopic, canSeeTopic, countTopicMembers, getGroupMembership, getTopic, listTopicAis, requireManagedTopic, requireVisibleTopic, resolveOwnerName, toMissingTopic, toTopicView, toTopicViews, topicKindSchema, topicStatusSchema, topicVisibilitySchema, visibleTopics
AFTER  (29): (same list, order-sorted identical)
missing after: []
extra after: []
```

Kinds preserved: the three schemas stay `const` (value re-exports), the interfaces/`type`s stay `export type` re-exports, the functions stay value re-exports; the trailing `./views` re-export is unchanged. No importer changed.

No `effect-plain` marker was needed: `types.ts` imports `{ Schema }` (value) from `effect` and `ai-access.ts` imports `{ Effect }`/`SqlClient` (values), so both classify as `effect` and do not trip the ratchet.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ai-activity.test.ts src/topics/visible-batch.test.ts` → `Test Files 2 passed (2)`, `Tests 11 passed (11)`.
- `pnpm gate` (from repo root) → `GATE PASS`, exit 0. Summary:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.8s)
PASS  format  (1.0s)
PASS  lint  (2.1s)
PASS  typecheck  (8.3s)
PASS  effect  (2.9s)
PASS  tests @zilar/server  (23.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- `ai-access.ts` imports `canSeeTopic` from `./access`, while `access.ts` re-exports `aiMayBeInTopic`/`allowedTopicAiIds` from `./ai-access`: a runtime import cycle. It is safe (function declarations are initialized during module instantiation, so no TDZ), and both topic tests import through the barrel and pass. The spec allows this ("import what they need from `./access` ... whichever avoids a runtime cycle"); there is no other home for `canSeeTopic`, which the spec keeps in `access.ts`.
- No deviations from the spec. Only the four Allowed files changed.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `access.ts` 247, `types.ts` 80 and `ai-access.ts` 106 lines (was 400).
  - **Exports:** `access.ts` still exports every name, with the same kinds:
    - the types `TopicActivityEntry`, `TopicAiView`, `TopicKind`, `TopicOwnerView`, `TopicRoleView`, `TopicRow`, `TopicStatus`, `TopicView` and `TopicVisibility`;
    - the three schemas;
    - `aiMayBeInTopic` and `allowedTopicAiIds`;
    - the access functions;
    - the `./views` re-exports.
    
    The 44 importers are untouched.
- **One note:** `ai-access.ts` imports `canSeeTopic` from `./access`, which re-exports `./ai-access`, so the two modules import each other. It is safe because `canSeeTopic` is only called inside function bodies, never at module load, and the topic tests passed in the gate. A later move of `canSeeTopic` into its own module would remove it.
- **After the deploy,** the lead checks the topic routes answer 401 signed out.
