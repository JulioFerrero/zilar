---
id: T-0654
title: "zod: db/schema.ts drops its two zod enums (E4); GroupKind and AvatarOwnerKind become plain union types; no runtime or table change"
status: todo
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

## Review (written by Claude)
