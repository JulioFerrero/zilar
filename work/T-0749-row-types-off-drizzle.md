---
id: T-0749
title: "row types off drizzle: new db/rows.ts with hand-written interfaces for the 28 tables the server types against (+ AvatarOwnerKind, ApprovalInsert), a type-level test proving each equals drizzle's $inferSelect, and the 27 non-test importers of db/schema switched to db/rows"
status: todo
milestone: M5
branch: task/T-0749-row-types-off-drizzle
model: auto
effort: default
depends_on: [T-0741]
estimate: 0.5 day
---

# T-0749: row types without drizzle

## Spec (written by Claude, do not edit)

### Why
`db/schema.ts` can only be deleted (the DEL task, `docs/audit/drizzle-removal-plan.md` §5) once no module needs it. Today, 27 non-test files import table objects from `../db/schema`, but only to derive row types (`typeof <table>.$inferSelect`). The plan's recipe (§2.3, lines 370-381) is a hand-written type per table. This task writes those types in one place and proves each one equals drizzle's, so behaviour and type-checking stay the same.

### Verified facts (do not re-derive)
- **The importers:** the 27 non-test files that import from `'../db/schema'` are exactly the Allowed source files below. `auth/cli-config.ts` also imports it, but it goes with DEL.
- **The tables used:** `ais`, `aiToolRuns`, `aiTools`, `aiToolVersions`, `approvalRules`, `approvals`, `avatars`, `chatBackgrounds`, `chatFolders`, `chatPrefs`, `groupAis`, `groupInviteLinks`, `groupMembers`, `groupRoles`, `groups`, `invites`, `machinePairingCodes`, `machines`, `mediaItems`, `pendingActions`, `pinnedMessages`, `pushSettings`, `pushSubscriptions`, `routines`, `stickerPacks`, `stickers`, `topics` and `xmppAccounts`, plus the type `AvatarOwnerKind` (`db/schema.ts:896`).
- **Every use is a type use:** `typeof <table>.$inferSelect` (counted by `git grep`), plus one `typeof approvals.$inferInsert` at `approvals/service.ts:280`. The lead found no runtime use of a table object, such as column references or query builders, in these files. Some files import the table as a value only to write `typeof`, so switch those to `import type`.
- **Test files are out of scope.** They are handled by S1 and DEL.

### What to build
1. **New `apps/server/src/db/rows.ts`:** one exported `interface` per table above, named `<Pascal>Row` (for example `ApprovalRow`, `GroupMemberRow`, `MachinePairingCodeRow`), plus `ApprovalInsert` and `AvatarOwnerKind`. Write every field out by hand with its exact type: nullability (`| null`), `Date`, `number` or `string`, string-literal unions for enum columns, and the right shape for json columns. Copy the shapes from what drizzle infers; check them in your editor or with a scratch `type X = typeof t.$inferSelect` that you do not commit. Add a one-line comment per interface naming its table. Do not import from `db/schema` in this file.
2. **New `apps/server/src/db/rows.test.ts`:** for every interface, `expectTypeOf<XRow>().toEqualTypeOf<typeof table.$inferSelect>()` (vitest), plus `ApprovalInsert` against `$inferInsert`. This is the one file allowed to import `db/schema`; DEL deletes it with the schema.
3. **The 27 source files:** replace each `typeof <table>.$inferSelect` (or `$inferInsert`) with the matching type from `../db/rows` and remove the `../db/schema` import. Local aliases such as `type ApprovalRow = …` may stay as aliases of the new interface, or be removed if the name is the same. Nothing else changes.
4. **Check:** `git grep -n "db/schema" -- apps/server/src ':!*.test.ts'` shows only `db/client.ts` and `auth/cli-config.ts`.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` (lines 234-246, 370-381), `apps/server/src/db/schema.ts` (the tables listed), and two examples: `apps/server/src/pins/service.ts` (lines 1-40) and `apps/server/src/actions/gateway.ts` (lines 1-20, 110-125).

### Allowed files
`apps/server/src/db/rows.ts`, `apps/server/src/db/rows.test.ts`, `apps/server/src/actions/announce.ts`, `apps/server/src/actions/gateway.ts`, `apps/server/src/actions/production-announcer.ts`, `apps/server/src/approvals/api.ts`, `apps/server/src/approvals/rules.ts`, `apps/server/src/approvals/service.ts`, `apps/server/src/auth/invites.ts`, `apps/server/src/avatars/service.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/chat-folders/service.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/groups/service.ts`, `apps/server/src/invite-links/service.ts`, `apps/server/src/machines/service.ts`, `apps/server/src/media/api.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/store.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/routines/execute.ts`, `apps/server/src/routines/scheduler.ts`, `apps/server/src/routines/service.ts`, `apps/server/src/stickers/service.ts`, `apps/server/src/tools/service.ts`, `apps/server/src/topics/access.ts`, `apps/server/src/xmpp/provisioning.ts`, `work/T-0749-row-types-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/db/rows.test
pnpm gate
```

### Acceptance
- `rows.test.ts` passes, and typecheck passes with every equality assertion.
- Only `db/client.ts` and `auth/cli-config.ts` import `db/schema` outside tests.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
