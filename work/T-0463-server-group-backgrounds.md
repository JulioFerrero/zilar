---
id: T-0463
title: "Backgrounds F (server): group background set by owner/admin (PATCH /groups/:id), returned in group detail + list; members can read its image"
status: todo
milestone: M5
branch: task/T-0463-server-group-backgrounds
model: auto
effort: low
depends_on: [T-0460]
estimate: 0.5 day
---

# T-0463: group backgrounds on the server

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §8, decision 4 and task F. A group owner or admin sets one background for the group, and every member sees it unless they set their own per-chat choice. The client's precedence is: my per-chat choice, then the group's, then my default, then slate. That is the client's job; this task is server only.

### Verified facts (do not re-derive)
- **`groups` table:** `apps/server/src/db/schema.ts:216-246`, with columns `id`, `roomLocalpart`, `title`, `createdBy`, `membersCanCreateTopics`, `kind`, `description`, `visibility`, `createdAt`. `chatBackgrounds` (T-0458) is declared at line 602, after `groups`. `chatPrefs` references it with `ON DELETE set null`.
- **Migrations:** run `pnpm --filter @zilar/server db:generate`. The head is `apps/server/drizzle/0043_giant_nitro.sql`, so yours is `0044_*`.
- **Group service (`apps/server/src/groups/service.ts`):**
  - `GroupDetail` (lines 62-85) and `ChatGroup` (lines 96-108);
  - `PatchGroupInput` (lines 162-166);
  - `patchGroup` (lines 169-191) treats a non-member as a 404 and a `member` role as a 403 "Only owners and admins can change group settings";
  - `getGroupDetail` is at line 359 and `listGroupsForUser` at line 1021. It selects explicit group columns.
- **Group routes (`apps/server/src/groups/routes.ts`):** `patchGroupSchema` (lines 73-82) is strict. `PATCH /groups/:id` is at lines 293-343 and calls `patchGroup` at lines 337-341.
- **Background service (`apps/server/src/backgrounds/service.ts`, T-0460):**
  - `readBackgroundFile(deps, id, userId)` (line 210) returns null unless the caller owns the image;
  - `deleteBackground(deps, id, userId)` (line 242) nulls the image and dim on `chatPrefs` and `chatBackgroundDefaults` in one transaction, then deletes.
- **Background routes:** `GET /backgrounds/:id` is in `apps/server/src/backgrounds/routes.ts`.
- **Validation (T-0458):** `CHAT_BACKGROUND_PRESET_IDS` is in `apps/server/src/chat-prefs/service.ts`. The rules are: a preset or an image, not both; a dim needs an image; the dim is 0-80.

### What to build
1. **Schema:**
   - add `backgroundPreset`, `backgroundImageId` and `backgroundDim` to `groups`, all nullable, with the same three checks as `chat_prefs`;
   - the FK goes to `chatBackgrounds.id` with `onDelete: 'set null'`. Because `chatBackgrounds` is declared later, use drizzle's lazy `references(() => chatBackgrounds.id, ...)`, which works across declaration order. If typecheck refuses it, move the `chatBackgrounds` declaration above `groups` and say so in the Report;
   - generate `0044_*`.
2. **Service:**
   - **Read:** `GroupDetail` and `ChatGroup` get `background: { backgroundPreset: string | null; backgroundImageId: string | null; backgroundDim: number | null }`, filled by `getGroupDetail` and `listGroupsForUser`.
   - **Write:** `PatchGroupInput` gets an optional `background` with the same three fields; `undefined` keeps the stored value and `null` clears it.
     - In `patchGroup`, after the role check, merge with the stored values and validate with the T-0458 rules and messages.
     - The image must be owned by the **actor**. Otherwise give the same 400 "Unknown background image" as T-0458.
     - Then update.
3. **Routes:** `patchGroupSchema` gets `background: z.object({ backgroundPreset: z.enum(CHAT_BACKGROUND_PRESET_IDS).nullable().optional(), backgroundImageId: z.string().min(1).max(64).nullable().optional(), backgroundDim: z.number().int().min(0).max(80).nullable().optional() }).strict().optional()`, passed to `patchGroup`.
4. **Members can read a group's image (`backgrounds/service.ts` and `routes.ts`):** `GET /backgrounds/:id` also serves the image when the caller is a member (`groupMembers`) of a group whose `backgroundImageId` is that id. Everyone else still gets the same 404.
5. **Deleting:** in `deleteBackground`, also null `backgroundImageId` and `backgroundDim` on `groups` rows that reference the image, in the same transaction.
6. **Tests:**
   - **`apps/server/src/groups/groups.test.ts`:**
     - an admin sets the `navy` preset, and the detail and list show it;
     - a member gives 403;
     - a non-member gives 404;
     - a preset and an image together give 400;
     - an admin uses their own uploaded image (insert a `chatBackgrounds` row) with dim 30, which is saved;
     - another user's image gives 400;
     - null clears it.
   - **`apps/server/src/backgrounds/routes.test.ts`:**
     - a group member can GET the group's image;
     - a non-member gets 404;
     - after the owner deletes the image, the group's background fields are null.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §8, `apps/server/src/db/schema.ts:216-250` and `:595-680`, `apps/server/src/groups/service.ts:60-200` and `:359-415`, `:1021-1080`, `apps/server/src/groups/routes.ts:70-90` and `:290-345`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/chat-prefs/service.ts` (the validation rules), `work/T-0458-server-background-prefs.md`.

### Allowed files
`apps/server/src/db/schema.ts`, `apps/server/drizzle/0044_*.sql` (generated), `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0044_snapshot.json`, `apps/server/src/groups/service.ts`, `apps/server/src/groups/routes.ts`, `apps/server/src/groups/groups.test.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/backgrounds/routes.test.ts`, `work/T-0463-server-group-backgrounds.md`.

If any other test breaks (for example a snapshot of the group detail shape), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups backgrounds
pnpm gate
```

### Acceptance
- Owners and admins set or clear a group background (a preset, or their own image with a dim) through `PATCH /groups/:id`. Members get 403, and others get 404.
- The background appears in the group detail and the group list.
- Members can load the group's image.
- Deleting the image clears it from the group.
- One generated migration.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
