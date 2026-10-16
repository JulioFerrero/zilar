---
id: T-1687
title: "Size split of apps/server/src/groups/ais.ts (390 lines): move the topic-room helpers (groupTopicRows, syncGroupTopicRooms, emitDroppedGroupTopicAis, archiveDrainedPrivateTopics) into a new groups/topic-rooms.ts and re-export the three public ones from ais.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1687-split-group-ais
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1687: Split the topic-room helpers out of groups/ais.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/groups/ais.ts` is 390 of 400 lines. Its last part is the group-wide topic-room sync, which the member and ownership flows use too, not only the AI flow.

### Facts (the lead read them on 2026-10-16)
- **`ais.ts`:**
  - imports `:1-35`;
  - `export async function addGroupAi :36` and `export async function removeGroupAi :149-274`;
  - **then the block to move:**
    - `async function groupTopicRows(db, groupId) :276-285` (private);
    - the T-0108 comment and `export async function syncGroupTopicRooms(db, adminClient, …) :287-…`;
    - `export async function emitDroppedGroupTopicAis(db, groupId) :325-…`;
    - `export async function archiveDrainedPrivateTopics :357-390`.
- **Importers:**
  - `apps/server/src/groups/members.ts:10` (`import { archiveDrainedPrivateTopics, emitDroppedGroupTopicAis, syncGroupTopicRooms } from './ais';`);
  - `apps/server/src/groups/ownership.ts:16` (`syncGroupTopicRooms`);
  - `apps/server/src/groups/room-sync-retry.test.ts:11` (`syncGroupTopicRooms`);
  - `apps/server/src/groups/service.ts:298` (only `addGroupAi` and `removeGroupAi`);
  - `apps/server/src/groups/ais.test.ts:10` (only `removeGroupAi`).
- **The folder `apps/server/src/groups/`** has no `topic-rooms.ts`.

### Steps
1. **Create `apps/server/src/groups/topic-rooms.ts`** with the four functions and their comments moved **word for word**, plus the imports they need.
   - `groupTopicRows` stays unexported unless `ais.ts` still calls it; if it does, export it.
   - It must not import from `./ais`.
2. **`ais.ts`:**
   - delete the block;
   - if `addGroupAi` or `removeGroupAi` call any of the four, import them from `./topic-rooms`;
   - add `export { archiveDrainedPrivateTopics, emitDroppedGroupTopicAis, syncGroupTopicRooms } from './topic-rooms';` so `members.ts`, `ownership.ts` and the test keep working unchanged;
   - drop the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/groups/topic-rooms.ts`
- `apps/server/src/groups/ais.ts`
- `work/T-1687-split-group-ais.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups --reporter=dot
pnpm gate
```

### Acceptance
- **`ais.ts` is about 280 lines,** and `topic-rooms.ts` holds the four functions unchanged.
- **The `src/groups` tests and the server typecheck pass.**

---

## Report (written by the worker when done)

### What I did

Pure move, no behaviour change.

- Created `apps/server/src/groups/topic-rooms.ts` (127 lines) holding the four
  topic-room helpers moved word for word from `ais.ts`: `groupTopicRows`
  (kept unexported — `ais.ts` no longer calls it), `syncGroupTopicRooms`,
  `emitDroppedGroupTopicAis` and `archiveDrainedPrivateTopics`, with their
  original comments and the imports they need (`Effect`, `SqlClient`,
  `ServerDatabase`, `runSql`, `topicRoleHolderIds`, `aiMayBeInTopic`/`TopicRow`,
  `syncTopicRoom`, `EjabberdAdminClient`, `emitTopicAi`,
  `notePendingGroupSync`, `InviteLogger`). It imports nothing from `./ais`.
  I verified the moved block is byte-identical to the old lines 276-390 with
  `diff <(git show HEAD:...ais.ts | sed -n '276,390p') <(tail -n +13 topic-rooms.ts)`.
- `apps/server/src/groups/ais.ts`: deleted the moved block (now 274 lines),
  added `import { syncGroupTopicRooms } from './topic-rooms';` for the one
  call in `removeGroupAi`, and added
  `export { archiveDrainedPrivateTopics, emitDroppedGroupTopicAis, syncGroupTopicRooms } from './topic-rooms';`
  so `members.ts`, `ownership.ts` and `room-sync-retry.test.ts` keep importing
  from `./ais` unchanged. Dropped the imports the file no longer uses
  (`topicRoleHolderIds`, `aiMayBeInTopic`, `emitTopicAi`,
  `notePendingGroupSync`, `type InviteLogger`); kept `type TopicRow` because
  `addGroupAi` still uses it at line 127, and kept `MAX_GROUP_MEMBERS`,
  `syncTopicRoom`, `emitGroupAi`.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/groups --maxWorkers=2 --reporter=dot`
  → **5 test files passed, 36 tests passed** (0 failed), 25.4s.
- `pnpm gate` (from repo root) → **GATE PASS**. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (18.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes for the lead

- `ais.ts` ends at 274 lines (spec said "about 280"); no behaviour change.
- The only edits outside `ais.ts`/`topic-rooms.ts` are the front-matter status
  line and this Report in `work/T-1687-split-group-ais.md`.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `topic-rooms.ts` apart from one type name dropped from an import list.
- **The tests:** the lead ran `src/groups` in the worktree: 5 files, 36 tests passed.
- **Result:** `groups/ais.ts` drops from 390 to 278 lines, and the re-export keeps `members.ts`, `ownership.ts` and the test unchanged.
