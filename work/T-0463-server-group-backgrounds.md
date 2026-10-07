---
id: T-0463
title: "Backgrounds F (server): group background set by owner/admin (PATCH /groups/:id), returned in group detail + list; members can read its image"
status: merged
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

### What I did

- **Schema (`apps/server/src/db/schema.ts`):** added three nullable columns to `groups`: `backgroundPreset` (`background_preset`), `backgroundImageId` (`background_image_id`) and `backgroundDim` (`background_dim`). The image FK uses the lazy `references(() => chatBackgrounds.id, { onDelete: 'set null' })`, so `chatBackgrounds` can stay declared later (typecheck accepted it; nothing had to move). Added the same three checks as `chat_prefs`: `groups_background_preset_check` (null or one of the 7 ids), `groups_background_dim_check` (null or 0-80) and `groups_background_exclusive_check` (not both a preset and an image).
- **Migration:** generated with `pnpm --filter @zilar/server db:generate`, not hand-edited: `apps/server/drizzle/0044_demonic_gressill.sql` plus `meta/0044_snapshot.json` and the `_journal.json` entry. It only adds the three columns, the set-null FK and the three checks.
- **Service (`apps/server/src/groups/service.ts`):**
  - New exported `GroupBackground` (`backgroundPreset`, `backgroundImageId`, `backgroundDim`, all `string | null` / `number | null`).
  - `GroupDetail` and `ChatGroup` gain `background: GroupBackground`, filled by `getGroupDetail` and `listGroupsForUser` (`listGroupsForUser` selects the three columns in the same query as the other group fields).
  - `PatchGroupInput` gains `background?: BackgroundFieldsInput` (`undefined` keeps, `null` clears). After the existing 404/403 role check, `patchGroup` merges the patch with the stored values and validates with the T-0458 rules and messages ("Choose a preset or an image", "Dim needs an image", "Unknown background image"). The image is looked up by `(id, actorId)`, so an unknown id and another user's id answer the same 400. Only then does it write.
- **Routes (`apps/server/src/groups/routes.ts`):** `patchGroupSchema` gains the exact `background` object from the spec (`z.enum(CHAT_BACKGROUND_PRESET_IDS)` / `z.string().min(1).max(64)` / `z.number().int().min(0).max(80)`, all `.nullable().optional()`, `.strict()`, `.optional()`), imported `CHAT_BACKGROUND_PRESET_IDS` from `../chat-prefs/service`, and passed `background` through to `patchGroup`.
- **Member image read (`apps/server/src/backgrounds/service.ts`):** `readBackgroundFile` now loads the row by id, serves it to the owner, and otherwise serves it when the caller has a `group_members` row for a group whose `backgroundImageId` is that id. Unknown, foreign-not-a-member and missing-file all still return `null` → the same 404. `routes.ts` comment updated; no route logic change was needed.
- **Delete (`apps/server/src/backgrounds/service.ts`):** `deleteBackground` now also nulls `backgroundImageId` and `backgroundDim` on `groups` rows that referenced the image, inside the same transaction.
- **Tests:** added a `group backgrounds (T-0463)` describe to `groups.test.ts` (7 tests: admin sets `navy` and detail + `listGroupsForUser` show it; member 403; non-member 404; preset+image 400; foreign and unknown image both 400; own image + dim 30 saved; null clears) and one test to `backgrounds/routes.test.ts` (a group member can GET the image, a stranger gets 404, and after the owner deletes it the group's `backgroundImageId`/`backgroundDim` are null). `GroupDetailBody` in `groups.test.ts` gained an optional `background` field.

### Files changed

`apps/server/src/db/schema.ts`, `apps/server/drizzle/0044_demonic_gressill.sql`, `apps/server/drizzle/meta/0044_snapshot.json`, `apps/server/drizzle/meta/_journal.json`, `apps/server/src/groups/service.ts`, `apps/server/src/groups/routes.ts`, `apps/server/src/groups/groups.test.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/backgrounds/routes.test.ts`, `work/T-0463-server-group-backgrounds.md` — all inside the Allowed files.

### Commands run (real results)

- `pnpm install` → done, no lockfile change.
- `pnpm --filter @zilar/server db:generate` → wrote `drizzle/0044_demonic_gressill.sql` (+ snapshot + journal entry).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups backgrounds` → 1 failed, 85 passed. The failure was my own new test: its first draft promoted the member through `PUT /groups/:id/members/:userId/role` over HTTP, which answered 404 in this context. I switched the helper to a direct `group_members` update (the pattern the existing tests use).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/groups.test.ts` → 1 file, 51 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/backgrounds/routes.test.ts` → 1 file, 13 tests passed.
- `pnpm gate` (first run) → `FAIL format`: prettier wanted `_journal.json`, `0044_snapshot.json` and `backgrounds/service.ts`. Fixed with `pnpm exec prettier --write` on those three.
- `pnpm gate` (second run) → `FAIL lint`: `unicorn(no-useless-fallback-in-spread)` on `...(background ?? {})`. Changed to `...background` (spreading `undefined` adds nothing).
- `pnpm gate` (final, from repo root):
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (13.3s)
  PASS  lint  (0.5s)
  PASS  typecheck  (7.3s)
  PASS  tests @zilar/server  (297.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec / open questions

- The spec's acceptance says the background appears in the "group list". At the service level `ChatGroup` is returned by `listGroupsForUser` with the `background` object (tested directly). However, the HTTP `GET /api/chats` handler (`apps/server/src/chats/routes.ts`, which is **not** an Allowed file) builds each group entry from an explicit field list and does **not** copy `background` into the response, so the web chat list will not see it until that route is touched. I did not change it because it is outside the Allowed files. Flagging so the lead can decide whether a follow-up task should expose it.
- Everything else followed the spec. The image id schema is `z.string().min(1).max(64)` exactly as the task text specifies.

### Security checklist

- Permission is checked before any write: the 404/403 role check runs before the background merge/validation and the update; a member gets 403 and a non-member 404 (same body as a missing group).
- Image ownership is enforced by `(id, actorId)` in one query, so a foreign image id and an unknown one answer the identical 400 "Unknown background image".
- The member-read path answers the same 404 for an unknown id, a foreign image the caller cannot see, and a missing file, so ids cannot be probed.
- The delete's `groups` update is intentional and correct without a group filter: the FK is `on delete set null` anyway, and only the image owner can reach the delete; no user id is needed and no other row is touched.
- No secrets, logs, audit entries, new routes, new dependencies or env vars. The existing `PATCH /groups/:id` route already requires a session and is covered by the 401 sweep.

## Review (written by Claude)

Approved (lead, 2026-10-07). Migration 0044 adds the background columns, checks and a set-null FK to groups. PATCH /groups/:id takes an optional background: 404 for a non-member, 403 for a member, then merge and the T-0458 rules; the image must be owned by the actor, otherwise the same 400. getGroupDetail and listGroupsForUser carry background. Members can read the group image; anyone else gets the same 404. Delete clears groups rows too. Follow-up for task G: GET /api/chats group entries must expose background.
