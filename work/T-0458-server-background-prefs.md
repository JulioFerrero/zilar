---
id: T-0458
title: "Backgrounds B (server): per-chat background prefs, a per-user default and the chat_backgrounds table; GET/PUT /chat-background"
status: todo
milestone: M5
branch: task/T-0458-server-background-prefs
model: auto
effort: low
depends_on: [T-0456]
estimate: 0.5 day
---

# T-0458: background prefs on the server

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §3 and §8, task B. A user picks a background per chat and a global default, and both sync through the existing `GET /chat-prefs`. This task creates the image table so a pref can reference an image. Uploading and serving images is the next task.

### Verified facts (do not re-derive)
- **Schema (`apps/server/src/db/schema.ts`):**
  - `chatPrefs` is at lines 604-621, with columns `userId`, `chatJid`, `mutedUntil`, `archived`, `pinnedAt`, `updatedAt`, primary key `(userId, chatJid)`, a check and an index;
  - `avatars` (lines 739-757) is the pattern for an image row: `id` text PK, `mime` enum `image/webp|image/png`, `width`, `height`, `bytes`, `storageKey`, `createdAt`, plus checks.
- **Migrations:** run `pnpm --filter @zilar/server db:generate`. The head is `apps/server/drizzle/0042_lethal_tattoo.sql`, so yours is `0043_*`. Never hand-edit the SQL.
- **Service (`apps/server/src/chat-prefs/service.ts`):**
  - `ChatPrefView` (lines 13-19);
  - `toChatPrefView` (lines 122-130);
  - `listChatPrefs` (lines 132-135);
  - `PutChatPrefInput` (lines 137-145);
  - `putChatPref` (lines 147+), where the all-defaults delete check is at line 173 and the row cap (`CHAT_PREFS_MAX_ROWS`) is checked when inserting.
- **Routes (`apps/server/src/chat-prefs/routes.ts`):**
  - `putChatPrefSchema` (lines 25-34) is strict and refined so it is not empty;
  - `GET /chat-prefs` (lines 65-68) returns `{ prefs }`;
  - `PUT /chat-prefs/:chatJid` (lines 70-100) runs `requireChatAccess`, then the write limiter (`CHAT_PREFS_WRITE_RATE_LIMIT_MAX`, line 11), and returns `{ prefs: null }` when a row is deleted.
- **Tests:** `apps/server/src/chat-prefs/chat-prefs.test.ts`.
- **The server does not depend on `@zilar/ui-tokens`,** so it keeps its own list of ids.

### What to build
1. **Schema.**
   - **Add to `chatPrefs`:**
     - `backgroundPreset: text('background_preset')`, nullable;
     - `backgroundImageId: text('background_image_id')`, nullable, referencing `chatBackgrounds.id` with `onDelete: 'set null'`;
     - `backgroundDim: integer('background_dim')`, nullable.
   - **Add these checks:**
     - the preset is null or in `('slate','gold','blue','navy','forest','wine','amber')`;
     - the dim is null or 0-80;
     - not both the preset and the image are set.
   - **New table `chatBackgrounds`, `chat_backgrounds`:**
     - `id` text PK;
     - `userId` FK `user.id` with cascade delete;
     - `mime` enum `image/webp|image/png`;
     - `width`, `height`, `bytes`;
     - `storageKey` not null;
     - `createdAt`;
     - an index on `userId` and the mime check, as on `avatars`.
     
     Declare it **before** `chatPrefs` so the FK resolves.
   - **New table `chatBackgroundDefaults`, `chat_background_defaults`:**
     - `userId` text PK, FK `user.id` with cascade delete;
     - the same three background columns, with the same checks and FK;
     - `updatedAt`.
   - **Generate the migration** `0043_*`.
2. **Service.**
   - **Export** `CHAT_BACKGROUND_PRESET_IDS`, the 7 ids above, with a comment that it mirrors `packages/ui-tokens` `CHAT_BACKGROUND_PRESET_IDS`.
   - **`ChatPrefView`:** add `backgroundPreset: string | null`, `backgroundImageId: string | null` and `backgroundDim: number | null`.
   - **`PutChatPrefInput`:** add the same three fields as optional, where `undefined` keeps the stored value and `null` clears it.
   - **Validation in `putChatPref`,** after merging with the existing row:
     - the preset and the image both set → 400 `invalid_request` "Choose a preset or an image";
     - a dim with no image → 400 "Dim needs an image";
     - an image id that does not exist **or** belongs to another user → the same 400 "Unknown background image".
   - **The all-defaults delete** also requires all three background fields to be null.
   - **New** `getChatBackgroundDefault(db, userId)` returns `{ backgroundPreset, backgroundImageId, backgroundDim }`, all null when there is no row.
   - **New** `putChatBackgroundDefault(db, userId, input)` follows the same merge and validation rules, and deletes the row when all fields are null.
3. **Routes.**
   - **`putChatPrefSchema`:** add
     - `backgroundPreset: z.enum(CHAT_BACKGROUND_PRESET_IDS).nullable().optional()`;
     - `backgroundImageId: z.string().min(1).max(64).nullable().optional()`;
     - `backgroundDim: z.number().int().min(0).max(80).nullable().optional()`.
     
     Pass them to `putChatPref`.
   - **`GET /chat-prefs`** returns `{ prefs, defaultBackground }`.
   - **New** `GET /chat-background` returns `{ defaultBackground }`.
   - **New** `PUT /chat-background` takes a strict, non-empty body with the same three fields. It shares the existing write limiter and returns `{ defaultBackground }`.
   - **Both new routes** require a session.
4. **Tests in `chat-prefs.test.ts`:**
   - a preset-only write is saved, and clearing it back to null deletes the row;
   - an unknown preset gives 400 from zod;
   - both the preset and an image give 400;
   - a dim without an image gives 400;
   - another user's image id and a nonexistent id give the same 400 body;
   - a valid own image (insert a `chatBackgrounds` row directly) with a dim is saved;
   - `GET /chat-prefs` includes `defaultBackground`;
   - `PUT /chat-background` sets, reads back and clears;
   - deleting the image row nulls the pref's `backgroundImageId` (the FK sets null);
   - the existing mute, archive and pin tests still pass.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §3 and §8, `apps/server/src/db/schema.ts:595-625` and `:735-757`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/routes.ts`, `apps/server/src/chat-prefs/chat-prefs.test.ts`, `work/T-0433-ai-memory-schema-core.md` (an earlier migration task).

### Allowed files
`apps/server/src/db/schema.ts`, `apps/server/drizzle/0043_*.sql` (generated), `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0043_snapshot.json`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/routes.ts`, `apps/server/src/chat-prefs/chat-prefs.test.ts`, `work/T-0458-server-background-prefs.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chat-prefs
pnpm gate
```

### Acceptance
- Per-chat and default background fields are stored, validated (including the same 400 for a foreign or unknown image), returned by `GET /chat-prefs`, and writable through `PUT /chat-prefs/:chatJid` and `PUT /chat-background`.
- One generated migration.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
