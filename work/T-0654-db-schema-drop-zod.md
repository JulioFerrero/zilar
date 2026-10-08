---
id: T-0654
title: "zod: db/schema.ts drops its two zod enums (E4); GroupKind and AvatarOwnerKind become plain union types; no runtime or table change"
status: merged
milestone: M5
branch: task/T-0654-db-schema-drop-zod
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0654: db/schema.ts without zod

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Schema replacing zod. This is E4 in the T-0626 last-mile audit. It is a type-only change: **no table, column or migration changes.**

### Verified facts (do not re-derive)
**`apps/server/src/db/schema.ts`:**
- `import { z } from 'zod';` at line 2;
- `export const groupKindSchema = z.enum(['group', 'channel']);` and `export type GroupKind = z.infer<typeof groupKindSchema>;` at lines 213-214;
- `export const avatarOwnerKindSchema = z.enum(['user', 'ai', 'group']);` and `export type AvatarOwnerKind = z.infer<typeof avatarOwnerKindSchema>;` at lines 898-899;
- a comment at lines 239-240 says "the service and zod own the friendly errors".

**Who uses them** (`git grep`):
- `groupKindSchema` and `avatarOwnerKindSchema` from `db/schema` are used nowhere else. `apps/server/src/avatars/service.ts:25` and `apps/server/src/directory/service.ts:25` define their own.
- `AvatarOwnerKind` is imported as a type by `apps/server/src/avatars/service.ts:8` and used at line 371.
- `GroupKind` from `db/schema` is imported nowhere; `directory` has its own.

### What to build
1. In `db/schema.ts`, replace the four lines with:
   - `export type GroupKind = 'group' | 'channel';`
   - `export type AvatarOwnerKind = 'user' | 'ai' | 'group';`
2. Delete the zod import.
3. Change the comment at lines 239-240 to "the service owns the friendly errors".
4. Change nothing else.

### Read first
`AGENTS.md`, `apps/server/src/db/schema.ts` (lines 1-10, 205-245 and 890-905).

### Allowed files
`apps/server/src/db/schema.ts`, `work/T-0654-db-schema-drop-zod.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars
pnpm gate
```

### Acceptance
- `git grep -n "zod" apps/server/src/db/schema.ts` shows nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Type-only change in `apps/server/src/db/schema.ts`, exactly per the spec:
- Deleted `import { z } from 'zod';`.
- Replaced `groupKindSchema` / `GroupKind` (lines 213-214) with
  `export type GroupKind = 'group' | 'channel';`.
- Replaced `avatarOwnerKindSchema` / `AvatarOwnerKind` (lines 898-899) with
  `export type AvatarOwnerKind = 'user' | 'ai' | 'group';`.
- Reworded the T-0164 comment to "...the service owns the friendly errors".
- No table, column, migration or runtime change; nothing else touched.

### Files changed
- `apps/server/src/db/schema.ts`
- `work/T-0654-db-schema-drop-zod.md` (status + this Report)

### Commands and real results
- `pnpm install`: done, 13 workspace projects, no errors.
- `git grep -n "zod\|groupKindSchema\|avatarOwnerKindSchema" apps/server/src/db/schema.ts`: no matches (exit 1) — acceptance holds.
- `git grep -n "groupKindSchema\|avatarOwnerKindSchema" -- ':!work' ':!apps/server/src/db/schema.ts'`: only
  `apps/server/src/avatars/api.ts` and `apps/server/src/avatars/service.ts`, which define/import their own
  Effect-Schema versions — nothing imports the removed `db/schema` exports.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars`: 1 test file passed, 18 tests passed.
- `pnpm gate` (repo root):

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (23.6s)
  PASS  lint  (1.6s)
  PASS  typecheck  (15.4s)
  PASS  tests @zilar/server  (16.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
None. No blockers, no open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is da993743, the current HEAD.
- **Lead check:** the diff is exactly the two union types, the dropped import and the comment.
