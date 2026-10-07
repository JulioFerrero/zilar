# Chat backgrounds: audit and plan (T-0456)

Audit and plan for custom chat backgrounds (dot colours and images), web first,
mobile after. Document only: no code, config, schema or package change.

Every code claim carries a `file:line`. Line numbers are from the worktree at
`/Users/julio/personal-projects/zilar-T-0456` on branch
`task/T-0456-chat-backgrounds-plan` on 2026-10-07.

## 1. Today

### 1.1 How the web background is drawn

- The value is one CSS custom property on `:root`:
  `--chat-background: radial-gradient(#1c1c1c 1px, transparent 1px) 0 0 / 22px 22px var(--panel)`
  (`apps/web/src/index.css:133`). `--panel` is `#0a0a0a`
  (`apps/web/src/index.css:71`), so the grid is a 1 px `#1c1c1c` dot every 22 px
  on a near-black ground.
- The only consumer is `.chat-background { background: var(--chat-background); }`
  (`apps/web/src/index.css:585-587`). Because the variable holds a full
  `background` shorthand (gradient, size, position, base colour), a new look can
  be swapped by overriding just this variable on the element.
- `MessageList` applies the class in three places: the load-error state
  (`apps/web/src/components/MessageList.tsx:201`), the empty state
  (`:213`) and the scrolling message area (`:226`). The scrolling element is the
  one bubbles render inside (`:222-231`); the empty and error states render text
  directly on the background, not inside a bubble.
- Layout: `ChatView` is a flex column (`apps/web/src/routes/ChatView.tsx:134`)
  where `MessageList` is `flex-1 min-h-0` and the composer (`:184`) or channel
  bar (`:182`) is a following sibling. The composer is **below** the background
  area, on its own panel ground; it is not over the chat background. Bubbles sit
  **on top of** the background, in the scroll area.

### 1.2 How the mobile background is drawn

- `ChatBackground` renders a full-screen `react-native-svg` tree with
  `StyleSheet.absoluteFill` and `pointerEvents="none"`
  (`apps/mobile/src/components/chat/chat-background.tsx:6-29`): a `<Rect>` filled
  with `chatGrid.background`, then a `<Rect>` filled with an SVG `<Pattern>`
  `zilar-dots` whose `<Circle>` uses `chatGrid.dot`.
- The numbers come from `chatGrid` in `packages/ui-tokens/src/index.ts:54-59`:
  `cell: 22`, `dotRadius: 1`, `dot: '#1c1c1c'`, `background: palette.panel`
  (`#0a0a0a`, `packages/ui-tokens/src/index.ts:12`). So web and mobile draw the
  same 22 px `#1c1c1c` dot on `#0a0a0a`.
- It is mounted in four places in the chat screen
  (`apps/mobile/src/app/chat/[id].tsx:355`, `:510`, `:677`, `:840`), always as a
  sibling **before** the message list, so it paints underneath the bubbles. As on
  web, it also shows behind the loading/empty states.

### 1.3 Which tokens they use, and the theme

- Web reads `--panel` and the literal dot `#1c1c1c` inside `--chat-background`
  (`apps/web/src/index.css:133`); mobile reads `chatGrid`, which is
  `palette.panel` plus the same literal dot (`packages/ui-tokens/src/index.ts:54-59`).
- There is **no light mode today**, so the theme does not affect the background.
  Web declares `color-scheme: dark` and keeps every token in `:root` with "no
  system-scheme switch" (`apps/web/src/index.css:4-10`, `:66-68`); the `dark:`
  variant is class-based and therefore inert (`apps/web/src/index.css:10`).
  Mobile's palette is likewise a single dark set
  (`packages/ui-tokens/src/index.ts:10-34`). Any preset list is a single dark set,
  but the token shape should allow a light variant later (section 7).

### 1.4 What sits on top, and the contrast it needs

The background is only visible in the gutters and behind the empty/error text.
Three things sit on it:

- **Outgoing bubble** — a glossy white card, `linear-gradient(180deg, #ffffff,
  #dedede)` with `color: #0a0a0a` (`apps/web/src/index.css:331-340`; mobile
  `depth.bubbleOutGradient`, `packages/ui-tokens/src/index.ts:84`). Near-black
  text on white; contrast is unaffected by the background.
- **Incoming bubble** — `linear-gradient(180deg, #252525, #161616)`, a 1 px
  `var(--edge)` (`#050505`, `apps/web/src/index.css:77`) border, and
  `color: var(--foreground)` (`#ededed`, `:79`) (`apps/web/src/index.css:342-352`;
  mobile `depth.bubbleInGradient`, `packages/ui-tokens/src/index.ts:87`).
- **Empty/error copy** — `StateMessage` renders its title in `text-foreground`
  (`#ededed`) and its hint in `text-muted-foreground` (`#a1a1a1`)
  (`apps/web/src/components/ui/state-message.tsx:34`, `:58-59`; tokens at
  `apps/web/src/index.css:79-80`). This text sits directly on the background.

The binding constraint is the **incoming bubble**: its fill (`#161616`, relative
luminance ≈ 0.0065) is barely distinguishable from today's `#0a0a0a` ground
(≈ 0.0030) — about 1.07:1. Its separation comes from the 1 px `#050505` border
(≈ 0.0015) and its drop shadow, not from fill-vs-ground luminance. Therefore a
background preset must keep the ground **darker than `#161616` so the bubble does
not recede, and lighter than `#050505` so the border stays visible**: a relative
luminance band of roughly `0.0015 < L < 0.0065`. All presets in section 2 stay in
that band, and the empty/error copy (`#ededed` on the lightest preset,
`#0b1424`) is well above 4.5:1.

## 2. What to offer

A preset list of **dot colours on the dark ground**, plus a few **solid or
gradient grounds**, plus **default**, plus a **custom image** with fit and a dim
slider. All presets below keep the section 1.4 luminance band.

Dot presets (1 px dot on the `#0a0a0a` panel ground, 22 px cell; only the dot
changes from today):

| id | dot | ground | note |
| --- | --- | --- | --- |
| `slate` | `#1c1c1c` | `#0a0a0a` | **default**; exactly today's value (`index.css:133`). |
| `graphite` | `#2e2e2e` | `#0a0a0a` | neutral, a step brighter than default. |
| `ocean` | `#1e4d6b` | `#0a0a0a` | desaturated blue. |
| `teal` | `#155e52` | `#0a0a0a` | deep teal. |
| `plum` | `#4a2560` | `#0a0a0a` | deep purple. |
| `ember` | `#5c3317` | `#0a0a0a` | warm amber/brown. |

Ground presets (no dots):

| id | value | note |
| --- | --- | --- |
| `charcoal` | solid `#0d0d0d` | a hair above panel, flat. |
| `midnight` | radial-gradient `#0b1424` → `#05070d` | blue-black, darker at the edges. |
| `espresso` | linear-gradient `#140e09` → `#0a0705` | warm black. |

The dot colours are decorative 1 px marks, so no text sits on them; they only
need to read against the ground and stay under the bubble fill. The three ground
presets stay under `#161616` and over `#050505`, so incoming-bubble borders and
empty-state text both hold.

**Custom image:** upload, choose **fit** (`cover` fills, crops the overflow) or
**contain** (letterboxes on the preset ground), and a **dim slider** (a black
overlay, `0–80%`, default `40%`) so bubbles and text stay readable over a busy
photo. `default` (or clearing the choice) removes any override and restores the
`slate` grid.

A preset is stored on the wire as a small **id** (`slate`, `ocean`, …), not as
CSS. The id → concrete CSS value map is the shared token list (section 6, task
3), so web and mobile render the same look.

## 3. Scope of a choice: per chat, globally, or both

Recommend **both**: a **global default** plus a **per-chat override**, with the
per-chat value winning. A DM or a favourite topic can have its own wallpaper while
the rest of the app keeps one default.

### Where each is stored

Recommend extending the existing table and adding one small table — not a whole
new backgrounds table:

- **Per chat** — three nullable columns on `chat_prefs`
  (`apps/server/src/db/schema.ts:604-621`):
  - `background_preset text` (null = inherit the global default);
  - `background_image_id text` (nullable, references the caller's own upload);
  - `background_dim integer` (null = the preset's default dim).
  Add checks: `background_preset` is null or one of the known ids; `background_dim`
  is between 0 and 80; and **at most one** of `background_preset` /
  `background_image_id` is set. Keep the existing `chat_prefs_jid_length_check`
  and indexes (`apps/server/src/db/schema.ts:616-620`).
- **Global default** — a new tiny per-user table `chat_background_defaults`
  (`user_id` PK, `background_preset`, `background_image_id`, `background_dim`,
  `updated_at`). One row per user, no sentinel chat JID and no clash with real
  JIDs. There is no per-user settings table to reuse: `instance_settings` is
  server-wide (`apps/server/src/db/schema.ts:31`) and `chat_prefs` is keyed by
  `(userId, chatJid)` (`:604-621`).

Why not a single new backgrounds table? It would duplicate the existing
mute/archive/pin rows or need a polymorphic `(userId, scope, chatJid)` key, and
the per-chat read is already one query for all of a user's prefs
(`apps/server/src/chat-prefs/service.ts:132-135`). Columns on `chat_prefs` keep
that read and the row-cap logic (`service.ts:8`, `:182-190`) intact.

### API changes to `/chat-prefs`

Current contract: `GET /chat-prefs` returns `{ prefs: [...] }`
(`apps/server/src/chat-prefs/routes.ts:65-68`); `PUT /chat-prefs/:chatJid`
validates `mutedUntil`/`archived`/`pinned` with a strict zod object
(`routes.ts:25-34`) and returns the saved row, or `{ prefs: null }` when the
write lands back on all defaults (`routes.ts:98-99`; deletion in
`apps/server/src/chat-prefs/service.ts:173-180`).

1. **Read:** add the three background fields to `ChatPrefView`
   (`apps/server/src/chat-prefs/service.ts:13-19`) and `toChatPrefView`
   (`:122-130`), and add a top-level `defaultBackground` to the `GET /chat-prefs`
   body so a client loads everything in one call.
2. **Per-chat write:** extend `putChatPrefSchema` (`routes.ts:25-34`) with:
   - `backgroundPreset: z.enum(BACKGROUND_PRESET_IDS).nullable().optional()`,
     where `BACKGROUND_PRESET_IDS` is a server-owned list that mirrors the shared
     token list;
   - `backgroundImageId: z.uuid().nullable().optional()`;
   - `backgroundDim: z.number().int().min(0).max(80).nullable().optional()`.
   The object stays `.strict()`, and the existing non-empty refine (`:32-34`)
   already accepts a background-only patch because it counts keys.
3. **Cross-field validation** (a `.superRefine` on the schema, or a check in
   `putChatPref`): reject a request that sets both `backgroundPreset` and
   `backgroundImageId`, and reject `backgroundDim` without an image. Unknown and
   not-owned image ids both answer the **same** `400 invalid_request`
   ("Unknown background image") so an id cannot be probed.
4. **All-defaults deletion:** widen the condition at
   `apps/server/src/chat-prefs/service.ts:173` so a row is deleted only when
   mute, archive, pin **and all three background fields** are at defaults.
5. **Global default write:** add `GET`/`PUT /chat-background` (a distinct path,
   so it never collides with the `:chatJid` param on `/chat-prefs/:chatJid`).
   `PUT` takes the same three fields (no `chatJid`) and returns the saved default.
   Reuse `CHAT_PREFS_WRITE_RATE_LIMIT_MAX` (`routes.ts:11-12`) for both writes.
6. **Ownership:** image ids are always checked against the session user, so a
   pref can never reference another user's upload (section 4).

## 4. Images

An uploaded background is a **personal** setting, read by its owner only — not a
capability URL. This is a deliberate difference from avatars, which are served to
any signed-in caller who holds the exact URL
(`apps/server/src/avatars/routes.ts:135-140`).

- **Storage.** Copy the avatar pattern:
  - new table `chat_backgrounds` (`id` uuid PK, `user_id` FK `user.id` with
    `onDelete: 'cascade'`, `mime` `image/webp | image/png`, `width`, `height`,
    `bytes`, `storage_key`, `created_at`), with an index on `user_id`; model it on
    `avatars` (`apps/server/src/db/schema.ts:739-757`).
  - new env `BACKGROUND_STORAGE_DIR` default `./data/backgrounds`, mirroring
    `AVATAR_STORAGE_DIR` (`apps/server/src/config.ts:68-72`), with
    `resolveStorageDir` + `ensureWritableDir` at startup
    (`apps/server/src/index.ts:97-118`). File names are `<uuid>.<ext>`, never user
    input (`apps/server/src/avatars/service.ts:177-182`).
- **Routes.** `PUT /backgrounds` (raw body, session required), `GET /backgrounds/:id`
  and `DELETE /backgrounds/:id`, modelled on `apps/server/src/avatars/routes.ts:98-166`.
- **Size and type limits.** At most **512 KiB** (the shared sticker probe already
  caps at `STICKER_MAX_BYTES = 512 * 1024`, `apps/server/src/stickers/image.ts:8`),
  WebP or PNG detected by magic bytes, largest side ≤ **2048** px. The browser
  crops and re-encodes before upload (avatars already do this:
  `apps/server/src/avatars/service.ts:13-16`). **The shared probe cannot be reused
  as-is**: it caps every dimension at `STICKER_MAX_DIMENSION = 512`
  (`apps/server/src/stickers/image.ts:9`, `:150-152`), and a phone wallpaper is
  far larger. Add a wallpaper probe (in `apps/server/src/backgrounds/image.ts`)
  that reuses the same PNG/WebP header parsers but with a 2048 px cap, or
  parameterise `checkDimensions`. Phone photos are JPEG, so the client re-encodes
  to WebP before upload (AGENTS.md pitfall; `probeStickerBytes` accepts only
  PNG/WebP, `apps/server/src/stickers/image.ts:264-281`).
- **Who can read it.** `GET /backgrounds/:id` requires a session **and**
  `row.userId === user.id`; anyone else and an unknown id answer the same `404`
  (the "unknown and not-visible answer the same 404" rule). Serve with
  `content-type: nosniff`, a `Content-Security-Policy: default-src 'none'`, and a
  long private cache, copied from the avatar read route
  (`apps/server/src/avatars/routes.ts:154-165`). Because the id only changes when
  the file changes, `private, immutable` is still safe.
- **Replacing and deleting.** Reuse the avatar replace flow: write the new file,
  swap the row inside the per-owner advisory-locked transaction, then `rm` the old
  file best-effort (`apps/server/src/avatars/service.ts:186-236`). Deleting a
  background removes its row and file; any `chat_prefs.background_image_id` that
  referenced it falls back to the default via `on delete set null`. Clearing the
  choice in the picker just nulls the pref column; the image remains until the
  owner deletes it, so it can be re-picked.

## 5. Sync

Both clients already load `GET /chat-prefs` into a per-chat map on start and on
focus:

- Web: `listChatPrefs()` populates `chatPrefs` by JID
  (`apps/web/src/store/store.ts:1037-1047`; type at `apps/web/src/lib/api.ts:768`)
  and merges it into chat summaries through `applyChatPrefs`
  (`apps/web/src/lib/chatPrefs.ts:53-99`).
- Mobile: `ChatPrefsApi.listChatPrefs()` (`apps/mobile/src/lib/chat-prefs-api.ts:141-153`)
  feeds `chatPrefRows`, which `RealStore` re-applies
  (`apps/mobile/src/store/real-store.ts:497-502`, `:2715`).

The data each client needs, once section 3 ships: `backgroundPreset`,
`backgroundImageId`, `backgroundDim` on each pref row, plus the single global
`defaultBackground` object. Both reach the clients through the **existing**
`GET /chat-prefs` load, so no new polling or realtime channel is needed — the
setting is per-user and changes only on that user's own device. Writes go through
`PUT /chat-prefs/:chatJid` and `PUT /chat-background`; the web store already does
an optimistic update then a refresh (`apps/web/src/store/realStore.ts:3204-3264`),
and mobile mirrors it (`apps/mobile/src/store/real-store.ts:3897-3932`).

One resolve step: the server returns the image URL as `/api/backgrounds/<id>`
(like `avatarUrlFor`, `apps/server/src/avatars/service.ts:33-35`). Web loads it
directly; mobile must resolve a relative URL against the API origin (AGENTS.md
pitfall; mobile already does this for avatars). The effective look per chat
resolves in this order: if `row.backgroundPreset` is set it wins; otherwise, if
`row.backgroundImageId` is set, the chat uses that image; otherwise the chat
falls back to `globalDefault`, and finally to the `slate` preset.

## 6. Task split (ordered; one PR each)

**Server first, then web; mobile tasks wait.**

1. **server — background prefs (columns, validation, API).**
   Files: `apps/server/src/db/schema.ts`, a new `apps/server/drizzle/*.sql`
   migration, `apps/server/src/chat-prefs/service.ts`,
   `apps/server/src/chat-prefs/routes.ts`, `apps/server/src/app.ts`, and their
   tests. Adds the three `chat_prefs` columns, the `chat_background_defaults`
   table, `GET /chat-prefs` fields + `defaultBackground`, `PUT /chat-prefs/:chatJid`
   validation, `GET`/`PUT /chat-background`, and the widened all-defaults
   deletion. Tests: schema/route tests for each field, the cross-field rules, the
   same-400 for unknown/foreign image ids, and the delete-at-defaults case.
2. **server — background image storage and routes.**
   Files: new `apps/server/src/backgrounds/{routes,service,image}.ts`,
   `apps/server/src/config.ts`, `apps/server/src/index.ts`,
   `apps/server/src/app.ts`, plus tests. Adds `BACKGROUND_STORAGE_DIR`, the
   `chat_backgrounds` table, upload/serve/delete with owner-only reads, size/type
   caps, and the replace/delete file flow. Tests: magic-byte and dimension caps,
   owner-only 404, replace removes the old file.
3. **shared — preset tokens.**
   Files: `packages/ui-tokens/src/index.ts`, `packages/ui-tokens/src/index.test.ts`.
   Adds the `backgroundPresets` list (ids + hex/gradient values) and the default
   id, so both apps and the server validation mirror one source. Test: the ids
   are unique and the default exists.
4. **web — render the per-chat background.**
   Files: `apps/web/src/index.css` (a `.chat-background` that accepts an inline
   override variable plus the preset classes), `apps/web/src/components/MessageList.tsx`
   (apply the effective look in all three `chat-background` places),
   `apps/web/src/routes/ChatView.tsx`, `apps/web/src/lib/api.ts`,
   `apps/web/src/lib/chatPrefs.ts`, `apps/web/src/store/store.ts` /
   `realStore.ts`, and tests. Reads the new fields and paints preset or image
   + dim behind the bubbles and the empty/error states.
5. **web — the picker UI.**
   Files: a new `apps/web/src/components/ChatBackgroundPanel.tsx`, wired from
   `apps/web/src/components/ChatHeader.tsx` and `ChatView.tsx`; image upload with
   fit + dim slider; reuses the group/user panel pattern. Tests: choosing a
   preset, uploading, clearing to default, dim clamping.
6. **mobile — render the background (waits on 1, 3).**
   Files: `apps/mobile/src/components/chat/chat-background.tsx`
   (take the effective look; SVG dots with the preset dot colour, or an `Image`
   with a dim overlay), `apps/mobile/src/app/chat/[id].tsx`,
   `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/store/real-store.ts`,
   and tests. Give the background element a `key` that changes with the look so
   React Native swaps instead of animating (AGENTS.md pitfall;
   `apps/mobile/src/lib/gradient-swap.test.ts`). Resolve the relative image URL
   against the API origin.
7. **mobile — the picker UI (waits on 6).**
   Files: new `apps/mobile/src/app/settings/…` screen, the per-chat action sheet
   in `apps/mobile/src/app/(tabs)/index.tsx` / `apps/mobile/src/app/group/[id].tsx`,
   one row appended to `apps/mobile/src/lib/settings-items.ts` (one entry only —
   AGENTS.md pitfall), and tests.

Tasks 1–2 are server, 3 is shared, 4–5 are web; 6–7 are **mobile** and wait.

## 7. Open questions for Julio

1. **Per-chat, global, or both?** Recommended: **both**, per-chat wins (section
   3). This matches how Telegram wallpapers work (a global default plus per-chat
   overrides).
2. **Are image uploads in scope for v1?** Recommended: presets ship in the first
   web PR, and the custom-image upload + dim slider land in the same milestone but
   as a later PR (task 5), so the preset path is usable early. The server storage
   (task 2) can ship alongside presets without blocking them.
3. **Do the presets follow light and dark mode?** Recommended: **one dark set**
   now, because both apps are dark-only (`apps/web/src/index.css:4-10`, `:66-68`;
   `packages/ui-tokens/src/index.ts:10-34`). Define the tokens so a light variant
   can be added later without a wire change.
4. **Do other group members see my wallpaper?** Recommended: **no** — a personal
   setting, owner-only reads (section 4). A shared group wallpaper is out of
   scope for v1.
5. **Dim slider default and range?** Recommended: **0–80%**, default **40%**,
   applied as a black overlay.
6. **Animated backgrounds?** Recommended: **still images only** for v1 (avatars
   already reject animated, `apps/server/src/avatars/service.ts:79-81`).

---

## 8. Decisions (Julio, 2026-10-07) and lead changes

1. **Scope:** both. The order for one chat is:
   1. my per-chat choice;
   2. the group background (see 4);
   3. my global default;
   4. `slate`.
2. **Images:** yes, in a later PR after the presets. Still images only, 0-80% dim, default 40%.
3. **Colours:** Julio wants coloured grounds and the brand gold, not the §2 list. The Zilar icon is a silver planet with a gold moon (`tools/brand-3d/main.js:134-137`, gold `#f0b445`). There is no brand blue, so the blue below is a plain blue. Dots are 1 px on a 22 px cell.

   The final preset list replaces §2:

   | id | ground | dot | note |
   | --- | --- | --- | --- |
   | `slate` | `#0a0a0a` | `#1c1c1c` | default, today's look |
   | `gold` | `#0a0a0a` | `#715625` | brand gold `#f0b445` at 45% over the panel |
   | `blue` | `#0a0a0a` | `#204074` | `#3b82f6` at 45% over the panel |
   | `navy` | `#0b1322` | `#1d3357` | coloured ground |
   | `forest` | `#0a1510` | `#1b3a2a` | coloured ground |
   | `wine` | `#160a10` | `#42192b` | coloured ground |
   | `amber` | `#15100a` | `#4a3818` | gold-tinted ground |

   Every ground stays darker than the incoming bubble `#161616` in luminance.
4. **Group backgrounds:** admins can set one per group, and every member sees it unless that member set their own per-chat choice. The group background is stored per room. Its image is readable by members of that room, and not owner-only like a personal image.

**New task order** (one schema task at a time):
- **A. shared:** the preset tokens.
- **B. server:** personal prefs (the `chat_prefs` columns, `chat_background_defaults`, the `chat_backgrounds` table and its schema, the API).
- **C. server:** image upload and serving.
- **D. web:** render.
- **E. web:** picker.
- **F. server:** the group background (admin write, member read, image read for members).
- **G. web:** the group background in the group panel.
- **Mobile:** render and picker wait.
