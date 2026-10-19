---
id: T-2139
title: "Web (explore, new chat, stickers import, topic rows, AI forms, avatar, background, channel AIs, connections, folders): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2139-web-folds-a
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2139: Fold single-use web files (explore, new chat, stickers import, topic rows, AI forms, avatar, background, channel AIs, connections, folders)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `e4a868766`. Each mover has exactly one production importer, the host, and no test imports it. Each host stays at or below 650 lines.

| Mover (lines) | Host (lines) |
| --- | --- |
| `components/ExplorePage.tsx` (264) | `routes/ExploreRoute.tsx` (27) |
| `components/NewMessageDialog.tsx` (141) | `components/NewChatButton.tsx` (237) |
| `components/TelegramImportDialog.tsx` (196) | `routes/StickersPage.tsx` (336) |
| `components/TopicRow.tsx` (152) | `components/chatList/GroupHeaderRow.tsx` (170) |
| `components/ais/ModelPicker.tsx` (165) | `components/ais/AiFormFields.tsx` (160) |
| `components/ais/new-ai/OrbPicker.tsx` (160) | `components/ais/NewAiDialog.tsx` (242) |
| `components/ais/new-ai/useNewAiFlow.ts` (124) | `components/ais/NewAiDialog.tsx` (242) |
| `components/avatar/avatarImageCodec.ts` (124) | `components/AvatarUploader.tsx` (388) |
| `components/background/backgroundOps.ts` (50) | `components/ChatBackgroundDialog.tsx` (418) |
| `components/channel-info/ChannelAisPage.tsx` (170) | `components/ChannelPanel.tsx` (322) |
| `components/connections/AddKeyDialog.tsx` (83) | `routes/ConnectionsPage.tsx` (99) |
| `components/connections/ConnectionRow.tsx` (258) | `routes/ConnectionsPage.tsx` (99) |
| `components/folder/ChatPicker.tsx` (101) | `components/FolderEditorDialog.tsx` (337) |
| `components/folder/folderEditorModel.ts` (27) | `components/FolderEditorDialog.tsx` (337) |
| `lib/background-image.ts` (123) | `components/ChatBackgroundDialog.tsx` (418) |

All paths are under `apps/web/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or exceed 650 lines. Say why in the Report.

### Rules
- No behaviour change and no visual change: the same markup, class names, aria labels, focus order and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/web/src/store/**`;
  - `apps/web/src/lib/api.ts`;
  - `apps/web/src/lib/api/**`.
- No new tests.
- Product lines go down by at least 60.

### Allowed files
- `apps/web/src/components/ais/AiFormFields.tsx`
- `apps/web/src/components/ais/ModelPicker.tsx`
- `apps/web/src/components/ais/new-ai/OrbPicker.tsx`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/avatar/avatarImageCodec.ts`
- `apps/web/src/components/AvatarUploader.tsx`
- `apps/web/src/components/background/backgroundOps.ts`
- `apps/web/src/components/channel-info/ChannelAisPage.tsx`
- `apps/web/src/components/ChannelPanel.tsx`
- `apps/web/src/components/ChatBackgroundDialog.tsx`
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/connections/AddKeyDialog.tsx`
- `apps/web/src/components/connections/ConnectionRow.tsx`
- `apps/web/src/components/ExplorePage.tsx`
- `apps/web/src/components/folder/ChatPicker.tsx`
- `apps/web/src/components/folder/folderEditorModel.ts`
- `apps/web/src/components/FolderEditorDialog.tsx`
- `apps/web/src/components/NewChatButton.tsx`
- `apps/web/src/components/NewMessageDialog.tsx`
- `apps/web/src/components/TelegramImportDialog.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/lib/background-image.ts`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/ExploreRoute.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `work/T-2139-web-folds-a.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (web mock): /explore, New chat → New message, Stickers → Import from Telegram, the chat list group header with topic rows, New AI (model and orb pickers), the profile avatar upload, chat background dialog, a channel's AIs page, /settings/connections (add key, rows), the folder editor.

---

## Report (written by the worker when done)

### What I did

Folded each mover into its only production importer: moved the code below the host's main export, made the moved component/helper non-exported, merged imports, dropped declarations that became duplicates, and deleted the mover files. Markup, class names, aria labels, focus order and effects are unchanged.

Line savings below are `old host + mover(s) − new host`, measured with `wc -l`:

| Row | Result |
| --- | --- |
| `components/ExplorePage.tsx` (264) → `routes/ExploreRoute.tsx` (27) | folded, **3 saved** (291 → 288) |
| `components/NewMessageDialog.tsx` (141) → `components/NewChatButton.tsx` (237) | folded, **7 saved** (378 → 371) |
| `components/TelegramImportDialog.tsx` (196) → `routes/StickersPage.tsx` (336) | folded, **9 saved** (532 → 523) |
| `components/TopicRow.tsx` (152) → `components/chatList/GroupHeaderRow.tsx` (170) | folded, **6 saved** (322 → 316) |
| `components/ais/ModelPicker.tsx` (165) → `components/ais/AiFormFields.tsx` (160) | folded, **3 saved** (325 → 322) |
| `components/ais/new-ai/OrbPicker.tsx` (160) + `useNewAiFlow.ts` (124) → `components/ais/NewAiDialog.tsx` (242) | folded, **+1** (526 → 527); the extra line is the `// effect-plain:` marker the effect ratchet needs on the merged file |
| `components/avatar/avatarImageCodec.ts` (124) → `components/AvatarUploader.tsx` (388) | folded, **13 saved** (512 → 499) |
| `components/background/backgroundOps.ts` (50) → `components/ChatBackgroundDialog.tsx` (418) | **skipped**: it has a second production importer, `components/background/BackgroundImages.tsx:10` imports `type Scope` from it, and that file is outside the Allowed files |
| `lib/background-image.ts` (123) → `components/ChatBackgroundDialog.tsx` (418) | folded, **8 saved** (541 → 533) |
| `components/channel-info/ChannelAisPage.tsx` (170) → `components/ChannelPanel.tsx` (322) | folded, **5 saved** (492 → 487) |
| `components/connections/AddKeyDialog.tsx` (83) + `ConnectionRow.tsx` (258) → `routes/ConnectionsPage.tsx` (99) | folded, **14 saved** (440 → 426); duplicate `messageOf` dropped |
| `components/folder/ChatPicker.tsx` (101) + `folderEditorModel.ts` (27) → `components/FolderEditorDialog.tsx` (337) | folded, **14 saved** (465 → 451) |

Net product lines: **−81** (`git diff --numstat` over `apps/web/src`: 2055 added, 2136 deleted). Every host stays under 650 lines; the largest is `ChatBackgroundDialog.tsx` at 533.

Files changed: the eleven hosts above; deleted `ExplorePage.tsx`, `NewMessageDialog.tsx`, `TelegramImportDialog.tsx`, `TopicRow.tsx`, `ModelPicker.tsx`, `OrbPicker.tsx`, `useNewAiFlow.ts`, `avatarImageCodec.ts`, `ChannelAisPage.tsx`, `AddKeyDialog.tsx`, `ConnectionRow.tsx`, `ChatPicker.tsx`, `folderEditorModel.ts`, `lib/background-image.ts`.

### Checks run

- `pnpm gate` (first run failed on Prettier formatting in `AvatarUploader.tsx` and `FolderEditorDialog.tsx`; ran `pnpm exec prettier --write` on those two files, then reran).
- Final `pnpm gate`:

```
PASS  install (frozen)  (1.4s)
PASS  format  (0.8s)
PASS  lint  (1.5s)
PASS  typecheck  (6.4s)
PASS  effect  (1.1s)
SKIP build @zilar/server (no server, package or manifest change)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

- No single test files were run: no test imports any mover, and the gate reports `SKIP tests @zilar/web (no nearby test files)`.

### Notes for the lead

- `backgroundOps.ts` is the only skipped row, for the reason above. If you want it folded later, `BackgroundImages.tsx` needs to take `Scope` from `ChatBackgroundDialog` (or a shared type file); that file was outside this task's Allowed files.
- The `// effect-plain:` marker moved from `useNewAiFlow.ts` to `NewAiDialog.tsx` unchanged in reason, because the merged file now holds the plain React hook plus the orb PNG promise edge; the rebuilt `pnpm gate` passed its `effect` step.
- No behaviour, logic, markup or styling was edited; only code movement and import/export/prop-name plumbing.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit: the Report's sum was off by 2). Net −79: 14 single-use web files folded into their only importer. `backgroundOps.ts` was skipped, correctly, because it has a second importer.

**Web mock** (`:5256`, no page errors):
- all 25 routes render;
- `/explore` lists the groups;
- New chat → New message lists people;
- the chat list shows Dev team with its topic rows;
- Settings → Stickers → Import from Telegram opens;
- the full New AI walk (provider → key → model → setup → Create AI) creates the AI;
- `/settings/connections` lists 3 keys and Add key opens;
- Create new folder opens the editor with its chat picker;
- the chat background dialog opens;
- Acme channel info → AIs shows the empty state with "Add my AI";
- Profile shows Add picture.
