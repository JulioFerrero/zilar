---
id: T-1678
title: "Size split: move changeMemberRole and syncChannelVoice (with their comments) out of apps/server/src/groups/members.ts (393 lines) into a new groups/member-roles.ts; re-export them so every importer keeps working — a pure move"
status: merged
milestone: M5
branch: task/T-1678-split-group-members
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1678: Split member roles out of groups/members.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/groups/members.ts` is 393 of 400 lines. The next change to group membership (for example a ban list, finding SG-8) can't land until it's split. The role functions are a clean second half.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/groups/members.ts`** (393 lines):
  - `addGroupMembers` (`:25`) and `removeGroupMember` (`:116`);
  - then a comment block and `export async function changeMemberRole(db, adminClient, input)` (the comment starts a few lines above `:246`; the function runs to before the next comment);
  - then a comment block and `export async function syncChannelVoice(db, adminClient, groupId, …)` (`:350-…`, to the end of the file).
  - `changeMemberRole` calls `syncChannelVoice`.
- **Importers:**
  - `apps/server/src/groups/ownership.ts:17` (`import { syncChannelVoice } from './members';`);
  - `apps/server/src/groups/service.ts:296` (`export { addGroupMembers, changeMemberRole, removeGroupMember, syncChannelVoice } from './members';`).
  - Nothing else imports these two. `apps/server/src/topics/*` import from their own `topics/members`.
- **The folder `apps/server/src/groups/`** has no `member-roles.ts`.

### Steps
1. **Create `apps/server/src/groups/member-roles.ts`** with `changeMemberRole` and `syncChannelVoice` moved **word for word**, including the comment blocks above each, plus the imports they need. Move any small private helper or type that only these two use, and leave shared ones in `members.ts` (export them if needed).
2. **`members.ts`** keeps `addGroupMembers` and `removeGroupMember`. Drop the imports that are no longer used.
3. **Update `service.ts:296`** to re-export the two functions from `./member-roles`, and `ownership.ts:17` to import `syncChannelVoice` from `./member-roles`.
4. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/groups/service.ts`
- `apps/server/src/groups/ownership.ts`
- `work/T-1678-split-group-members.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/ownership.test.ts src/groups/access.test.ts src/groups/ais.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`members.ts` is about 240 lines,** and `member-roles.ts` holds the two functions unchanged.
- **The listed tests pass.**

---

## Report (written by the worker when done)

### What I did

Pure move of the two role functions out of `groups/members.ts` into a new
`groups/member-roles.ts`, word for word including the comment blocks above
each function. No behaviour change, no new tests.

- **Created `apps/server/src/groups/member-roles.ts`** (176 lines) with
  `changeMemberRole` and `syncChannelVoice` (and their doc comments) plus the
  imports they need: `Effect`, `SqlClient`, `recordAudit`, `ServerDatabase`,
  `GroupRow`, `runSql`, `HttpError`, `EjabberdAdminClient`, `jidFor`/`localpartFor`,
  `assertChannelKeepsAnAdmin`/`getGroupDetail`/`getMembership`/`requireGroup`
  from `./queries`, and `mapXmppError` plus the `ChangeMemberRoleInput`,
  `GroupDetail`, `GroupRole`, `InviteLogger` types from `./schemas`.
- **`apps/server/src/groups/members.ts`** (393 → 230 lines) keeps
  `addGroupMembers` and `removeGroupMember`. Dropped the imports no longer
  used: `GroupRow`, `ChangeMemberRoleInput`, `GroupRole`, `InviteLogger`.
  `assertChannelKeepsAnAdmin` stays (still used by `removeGroupMember`).
- **`apps/server/src/groups/service.ts`**: line 296 now splits into
  `export { addGroupMembers, removeGroupMember } from './members';` and
  `export { changeMemberRole, syncChannelVoice } from './member-roles';`.
- **`apps/server/src/groups/ownership.ts`**: line 17 now imports
  `syncChannelVoice` from `./member-roles`.

See-grep confirms every remaining user of the two names goes through the
re-export (`api.ts:36` imports `changeMemberRole` from `./service`) or is a
comment reference; no other file imports them directly.

Changed files (all inside the Allowed list):
`apps/server/src/groups/member-roles.ts` (new),
`apps/server/src/groups/members.ts`, `apps/server/src/groups/service.ts`,
`apps/server/src/groups/ownership.ts`, `work/T-1678-split-group-members.md`.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/groups/ownership.test.ts src/groups/access.test.ts src/groups/ais.test.ts --maxWorkers=2 --reporter=dot`
  → Test Files 3 passed (3), Tests 9 passed (9).
- `pnpm gate` (from repo root) summary lines:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (11.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  All changed files are inside scope; no files outside the Allowed list.

### Notes for the lead

`members.ts` landed at 230 lines (spec said "about 240"), not 393.
`member-roles.ts` is 176 lines. No deviations from the spec; nothing blocked.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `member-roles.ts` apart from one added type import.
- **The tests:** the lead ran `src/groups`: 5 files, 36 tests passed.
- **Result:** `members.ts` drops from 393 to 230 lines, which makes room for a ban list (SG-8) when Julio wants one.
