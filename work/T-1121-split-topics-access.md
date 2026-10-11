---
id: T-1121
title: "Size split: apps/server/src/topics/access.ts (688) — the topic view builders move unchanged to topics/views.ts and are re-exported; access checks stay"
status: merged
milestone: M5
branch: task/T-1121-split-topics-access
model: auto
effort: default
depends_on: [T-1118]
estimate: 0.1 day
---

# T-1121: Split `topics/access.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10). `apps/server/src/topics/access.ts` has 688 lines (read by the lead). It mixes the access checks with the code that builds topic views for responses.

**The view builders (move these):**
- `countTopicMembers` (`:280`), `resolveOwnerName` (`:312`), `buildTopicView` (`:350`), `toTopicView` (`:382`);
- `listTopicAis` (`:494`), `TopicViewParts` (`:508`), `groupBy` (`:515`), `loadTopicViewParts` (`:527`), `toTopicViews` (`:664`) to the end.

**The access checks (they stay):**
- the schemas and types at `:16-85`;
- `getTopic` (`:86`), `getGroupMembership` (`:97`), `isPrivateMember` (`:114`), `canSeeTopic` (`:135`), `requireVisibleTopic` (`:156`), `visibleTopics` (`:172`);
- `canManageTopic` (`:224`), `requireManagedTopic` (`:242`), `canCreateTopic` (`:264`);
- `aiMayBeInTopic` (`:407`) and `allowedTopicAiIds` (`:437`).

### What to build
1. **A new `apps/server/src/topics/views.ts`** holds the view builders listed above, **moved byte-for-byte** with the imports they need.
   - Non-exported helpers stay non-exported unless another file now needs them.
   - If a moved function calls an access check (for example `canSeeTopic`), import it from `./access`.
   - `access.ts` must **not** import from `./views`, so there is no cycle.
2. **`access.ts` re-exports every moved name it exported before** (`export { … } from './views';`), so no importer changes.
   - **One exception:** if a re-export would create a cycle because `views.ts` imports `./access`, use `grep -rln "from '\./access'\|topics/access'" apps/server/src` to update just those importers of view names to `./views`. List them in the Report, and only touch files in the Allowed list. If an importer outside the list needs a change, stop and report BLOCKED instead.
3. **No behaviour change.** No access check moves or changes.
4. **Line counts:** both files stay at most 400 lines. Paste `wc -l` in the Report.
5. **Tests** (permissions): there are no tests in `topics/`. Run `apps/server/src/roles/roles.test.ts` and `apps/server/src/invite-links/invite-links.test.ts`, which exercise topics, and paste the results.

### Read first
`AGENTS.md`, and `apps/server/src/topics/access.ts`.

### Allowed files
`apps/server/src/topics/access.ts`, `apps/server/src/topics/views.ts`, `work/T-1121-split-topics-access.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/roles/roles.test.ts src/invite-links/invite-links.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Both files are at most 400 lines.

---

## Report (written by the worker when done)

**Result:** done — split complete, gate passes.

**What I did**
- Moved the view builders out of `apps/server/src/topics/access.ts` into a new `apps/server/src/topics/views.ts`, byte-for-byte: `countTopicMembers`, `resolveOwnerName`, `buildTopicView` (stays non-exported), `toTopicView`, `listTopicAis`, `TopicViewParts` (stays non-exported), `groupBy` (stays non-exported), `loadTopicViewParts` (stays non-exported), `toTopicViews`.
- `views.ts` imports only what it needs: `Effect`, `SqlClient`, `ServerDatabase`, `TopicRow`, `GroupRoleRow`, `runSql`, `rolesOfTopic`, `topicRoleHolderIds`, plus `import type` for `TopicView`, `TopicOwnerView`, `TopicAiView`.
- The access checks stayed in `access.ts`, untouched: the schemas/types at `:16-85`, `getTopic`, `getGroupMembership`, `isPrivateMember`, `canSeeTopic`, `requireVisibleTopic`, `visibleTopics`, `canManageTopic`, `requireManagedTopic`, `canCreateTopic`, `aiMayBeInTopic`, `allowedTopicAiIds`.
- `access.ts` re-exports the five exported moved names (`countTopicMembers`, `resolveOwnerName`, `toTopicView`, `listTopicAis`, `toTopicViews`) from `./views`, so no importer changed.
- Removed the now-unused `GroupRoleRow` and `rolesOfTopic` imports from `access.ts`.

**Cycle note (decision).** The view types (`TopicView`, `TopicOwnerView`, `TopicAiView`) stay in `access.ts` per the spec. `views.ts` imports them with `import type`, which is erased, so there is no runtime edge `views -> access`; the only runtime edge is `access -> views` (the re-export). No cycle. The spec's exception (`views.ts` value-importing `./access`) does not apply because none of the moved functions call an access check. It could not have been used anyway: the only importers of view names are `apps/server/src/chats/api.ts` and `apps/server/src/topics/api.ts`, both outside the Allowed files, so re-exporting (no importer changes) was the only in-scope path.

**Files changed** (all inside Allowed files)
- `apps/server/src/topics/access.ts` — 688 -> 382 lines.
- `apps/server/src/topics/views.ts` — new, 325 lines.
- `work/T-1121-split-topics-access.md` — status/report.

**Commands and results**
- `pnpm install` -> `Done in 12.3s`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts src/invite-links/invite-links.test.ts` -> `Test Files 2 passed (2)`, `Tests 43 passed (43)`. (Used the AGENTS form with the worker cap instead of the task's bare `exec vitest run`.)
- `pnpm gate` -> `GATE PASS`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.3s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.6s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  `gate` skips server tests because there are no tests under `topics/`; the two tests above exercise this code and passed.

**Line counts (`wc -l`)**
```
382 apps/server/src/topics/access.ts
325 apps/server/src/topics/views.ts
```

**No behaviour change.** No access check moved or changed. Non-exported helpers stayed non-exported.

**Open questions / deviations:** none.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The split:** `topics/access.ts` goes from 688 to 382 lines. The view builders move to `topics/views.ts` (325) and are re-exported from `access.ts`. Every access check stays in `access.ts`, unchanged.
- **No runtime cycle:** `views.ts` imports only **types** from `./access` (`:11`, `import type`), which are erased at runtime.
- **The lead's line check:** the removed lines missing from `views.ts` are only import lines.
- **Tests:** the lead ran `roles/roles.test.ts` and `invite-links/invite-links.test.ts` on the branch: 43 green. The gate passed.
