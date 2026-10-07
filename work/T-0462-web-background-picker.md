---
id: T-0462
title: "Backgrounds E (web): 'Chat background' dialog from the chat menu — pick a preset for this chat or for all chats"
status: merged
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

**Status:** done — all checks pass. T-0461 already painted backgrounds; this task adds the picker.

### What I did

- `apps/web/src/lib/api.ts`: added the three optional/nullable background fields to
  `PutChatPrefInput`; added `putChatBackgroundDefault(input: ChatBackgroundChoice)`, which
  `PUT`s `/chat-background` and returns `defaultBackground`.
- `apps/web/src/mock/api.ts`: `PUT /chat-prefs/:chatJid` now accepts and stores
  `backgroundPreset`/`backgroundImageId`/`backgroundDim`; a row is deleted only when mute,
  archive, pin **and** all three background fields are default. Added `backgroundDefault` to
  the mock state, `GET /chat-background` returns it, and a new `PUT /chat-background` writes
  it (rejecting a preset together with an image).
- `apps/web/src/store/realStore.ts`: `updatePref`'s optimistic row and its delete-when-default
  check now carry the three background fields (patch value, else previous, else null). Added
  `putChatBackgroundDefault` to `ApiClient` and to the default API object, plus
  `setChatBackground(chatId, presetId)` and optimistic-with-rollback
  `setDefaultBackground(presetId)`.
- `apps/web/src/store/store.ts`: declared both actions on `ChatStore` and implemented them in
  the mock store (through `putChatPref` and `putChatBackgroundDefault`).
- `apps/web/src/components/ChatBackgroundDialog.tsx` (new): a `Dialog` titled "Chat background"
  with a `radio` `SegmentedControl` ("This chat" / "All chats"), a 4-column grid of the 7 preset
  swatches (each uses `chatBackgroundStyle` with a fixed square size and rounded corners, a
  title-cased `aria-label`, `aria-pressed`, and a lucide `Check` when selected), a "Use default"
  button that sends null, and an inline `role="alert"` "Couldn't save the background" on failure.
  "This chat" selects the chat's own preset (none when unset); "All chats" selects the default,
  else `slate`.
- `apps/web/src/components/ChatHeader.tsx`: a "Chat background" `MenuItem` in both the topic and
  non-topic menus, just before `ChatPrefMenuItems`; it closes the menu and opens the dialog.
- Tests: new `ChatBackgroundDialog.test.tsx` (5 cases); 2 new cases in
  `ChatHeader.menu.test.tsx`; 3 new cases in `realStore.test.tsx`. Added the
  `putChatBackgroundDefault` stub to the five test fakes (`realStore.test.tsx`, `reload.test.tsx`,
  `realStore.forward.test.tsx`, `realStore.media.test.tsx`, `realStore.topics.test.tsx`).

### Commands and results

- `pnpm install`: Done (0 errors).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatBackgroundDialog`: 1 file, **5 passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatHeader`: 1 file, **4 passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.test.tsx`: 1 file, **132 passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatBackgroundDialog ChatHeader realStore reload`: 7 files, **178 passed**.
- `pnpm gate` (second run):
  ```
  PASS  install (frozen)  (1.9s)
  PASS  format  (20.5s)
  PASS  lint  (1.2s)
  PASS  typecheck  (11.3s)
  PASS  tests @zilar/web  (34.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed only `format` on `apps/web/src/lib/api.ts` and
  `apps/web/src/mock/api.ts`; I fixed it with `pnpm exec prettier --write` on those two files and
  re-ran the gate, which then passed.

### Notes / deviations

- No deviations from the spec. No new dependencies. No file changed outside the Allowed list.
- The mock `PUT /chat-background` validates field types and rejects a preset together with an
  image, mirroring the server rule, but keeps the rest deliberately light like the existing mock.

### Fix round

- `ChatBackgroundDialog.tsx`: the dialog's close handler now resets `error` to false and `scope`
  to `'chat'` so a reopen never shows a stale alert or the previous scope. (An effect was tried
  first; oxlint's `react(set-state-in-effect)` rule rejects it, so the reset lives in the close
  handler.)
- `ChatBackgroundDialog.test.tsx`: added "failed save → close → reopen shows no alert and
  'This chat' selected", "All chats + Use default → `setDefaultBackground(null)`", plus a
  small stateful harness for the reopen case (7 dialog tests total).
- `mock/api.ts`: `PUT /chat-prefs/:chatJid` now answers `400 invalid_request` when the merged
  row would carry both a preset and an image, matching the mock `PUT /chat-background`.
- Commands: `pnpm --filter @zilar/web test ... ChatBackgroundDialog ChatHeader realStore reload`
  → 7 files, **180 passed**; `pnpm gate` → **GATE PASS**.

## Review (written by Claude)

Approved (lead, 2026-10-07). A "Chat background" item in both chat menus opens ChatBackgroundDialog: This chat / All chats, 7 preset swatches with aria-pressed and a Check icon, and Use default. Saves are optimistic with rollback and an inline alert, and the dialog resets on reopen (lead fix round). updatePref now keeps background fields and deletes a row only when everything is default. The mock API mirrors the server rules. Nit accepted: mock PUT /chat-background replaces the whole row.
