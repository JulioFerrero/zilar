---
id: T-0462
title: "Backgrounds E (web): 'Chat background' dialog from the chat menu — pick a preset for this chat or for all chats"
status: todo
milestone: M5
branch: task/T-0462-web-background-picker
model: auto
effort: low
depends_on: [T-0461]
estimate: 0.5 day
---

# T-0462: web background picker (presets)

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §8, task E. T-0461 paints backgrounds. This task lets the user choose one: a preset for this chat, or for all chats. Image upload is a later task. **No emoji: icons only** (Julio's rule).

### Verified facts (do not re-derive)
- **Server writes:**
  - `PUT /api/chat-prefs/:chatJid` accepts `backgroundPreset` (one of the 7 ids, or null), `backgroundImageId` and `backgroundDim`;
  - `PUT /api/chat-background` takes the same three fields and returns `{ defaultBackground }`;
  - a preset and an image together give 400.
- **Web API (`apps/web/src/lib/api.ts`):**
  - `PutChatPrefInput` (line 777) has `mutedUntil`, `archived` and `pinned`;
  - `putChatPref` follows it;
  - T-0461 added `ChatBackgroundChoice` and `getChatBackgroundDefault`.
- **Store (`apps/web/src/store/realStore.ts`):** `updatePref(chatId, patch)` starts at line 3211. It builds an optimistic `ChatPref` from `mutedUntil`, `archived` and `pinnedAt` only, so it **drops the background fields**. It deletes the row when those three are default (lines 3234-3241), **ignoring the background**. It calls `api.putChatPref`, rolls back on failure, then merges the saved row. `setPinned`, `setMuted` and `setArchived` (lines 4666-4680) call it. T-0461 added `defaultBackground` and `refreshDefaultBackground`.
- **Mock API (`apps/web/src/mock/api.ts:2474-2500`):** `PUT /chat-prefs` allows only `mutedUntil`, `archived` and `pinned`. T-0461 added `GET /chat-background`.
- **Menus (`apps/web/src/components/ChatHeader.tsx`):**
  - the topic menu (lines 174-228) has `MenuItem`s "Topic info", "Pinned messages", "Media, files and links" and "Search", then `ChatPrefMenuItems`;
  - the non-topic menu (lines 229-256) has two `MenuItem`s, then `ChatPrefMenuItems` at line 254;
  - state is declared with `useState` at lines 62-64.
  
  Tests: `apps/web/src/components/ChatHeader.menu.test.tsx`.
- **Kit:**
  - `Dialog({ open, onClose, title, description?, children, actions?, size? })` in `apps/web/src/components/ui/dialog.tsx`;
  - `SegmentedControl({ options, value, onChange, ariaLabel, mode })` in `apps/web/src/components/ui/segmented-control.tsx`.
- **Presets:** `CHAT_BACKGROUND_PRESET_IDS`, `chatBackgroundPresets` and `DEFAULT_CHAT_BACKGROUND_PRESET` are in `@zilar/ui-tokens`. The painting helpers are in `apps/web/src/lib/chatBackground.ts`.

### What to build
1. **`lib/api.ts`:**
   - add the three background fields, as optional and nullable, to `PutChatPrefInput`;
   - add `putChatBackgroundDefault(input): Promise<ChatBackgroundChoice>`, calling `PUT /chat-background`.
2. **`mock/api.ts`:**
   - `PUT /chat-prefs` also allows and stores the three fields;
   - a row is deleted only when mute, archive, pin **and** the background are all default;
   - add `PUT /chat-background`, held in mock state and returned by `GET`.
3. **`realStore.ts` `updatePref`:**
   - the optimistic row carries the three background fields: the patch value if given, else the previous value, else null;
   - the delete-when-default check also requires them all to be null.
   
   Then add these store actions (declared in `store.ts`, also implemented in the mock store):
   - `setChatBackground(chatId, presetId: string | null)` calls `updatePref` with `{ backgroundPreset: presetId, backgroundImageId: null, backgroundDim: null }`;
   - `setDefaultBackground(presetId: string | null)` is optimistic with rollback and calls `putChatBackgroundDefault` with the same three fields.
4. **New `components/ChatBackgroundDialog.tsx`, `ChatBackgroundDialog({ chat, open, onClose })`:**
   - a `Dialog` titled "Chat background";
   - a `SegmentedControl` (mode `radio`) with "This chat" and "All chats";
   - a grid of 7 swatch buttons, one per preset. Each preview uses `chatBackgroundStyle` with a fixed size and rounded corners, has an `aria-label` with the preset name in title case, and has `aria-pressed`. The selected swatch shows a lucide `Check` icon;
   - a "Use default" text button that clears the choice (null).
   - **"This chat"** shows the chat's own preset as selected, and none when it is unset. Picking calls `setChatBackground`.
   - **"All chats"** shows the default's preset, else `slate`. Picking calls `setDefaultBackground`.
   - **Errors:** the store rolls back and the dialog shows "Couldn't save the background" inline (`role="alert"`).
   - **The choice paints at once,** through the store's optimistic state.
5. **`ChatHeader.tsx`:** add a "Chat background" `MenuItem` to both menus, just before `ChatPrefMenuItems`. It closes the menu and opens the dialog.
6. **Tests:**
   - **New `components/ChatBackgroundDialog.test.tsx`:**
     - picking `navy` for this chat calls the store with `navy`;
     - "All chats" plus `gold` calls `setDefaultBackground('gold')`;
     - "Use default" sends null;
     - the selected swatch has `aria-pressed="true"`;
     - a rejected save shows the alert.
   - **`ChatHeader.menu.test.tsx`:** the item is in both menus and opens the dialog.
   - **`store/realStore.test.tsx`:**
     - a chat with only a background pref keeps its row after toggling pin on and off;
     - `setChatBackground` sends the three fields;
     - `setDefaultBackground` updates `defaultBackground` and rolls back on failure.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §8, `apps/web/src/lib/api.ts:755-830`, `apps/web/src/mock/api.ts:2460-2530`, `apps/web/src/store/realStore.ts:3211-3280` and `:4660-4685`, `apps/web/src/store/store.ts:240-270`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/lib/chatBackground.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatHeader.menu.test.tsx`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `work/T-0462-web-background-picker.md`.

Touch the four `realStore.*`/`reload` test fakes only if a new `ApiClient` method needs a stub there. If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatBackgroundDialog ChatHeader realStore
pnpm gate
```

### Acceptance
- From either chat menu, "Chat background" opens a dialog where the user picks one of the 7 presets for this chat or for all chats, or resets to default. It paints at once and is saved to the server.
- Mute, archive and pin no longer drop or delete a background pref.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
