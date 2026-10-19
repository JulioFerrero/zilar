---
id: T-2123
title: "Merge back 5 size-split pieces into their only user (phone, part 3): a hook returning a big object, or a child with a long prop list, goes back into the one file that uses it, so the return object, the destructuring and the prop types disappear — no behaviour change"
status: merged
milestone: M5
branch: task/T-2123-merge-phone-c
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2123: Merge split pieces back (phone, part 3)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "we can overwrite the 400 lines if we can save on lines of code". About 400 lines per file is now a soft limit; only a file over 800 lines must be split. Files that the old hard cap split only for size may be merged back when that saves lines (`CLAUDE.md`, `docs/ARCHITECTURE.md`).

The old splits left plumbing behind:
- a hook returns 20 fields, and its one screen destructures all 20;
- a child declares a 15-prop interface that only its one parent fills.

Merging each piece back deletes that plumbing.

### Facts (the lead's import graph on 2026-10-19)
Each row is `piece (lines) → its only production user (lines)`, with the kind of plumbing it carries:
- `hook` means the hook's return object;
- `props` means the child's props type.

- `apps/mobile/src/components/chat/use-chat-screen.ts` (301) → `apps/mobile/src/app/chat/[id].tsx` (383) — hook
- `apps/mobile/src/components/chat/emoji-sheet.tsx` (128) → `apps/mobile/src/components/chat/composer.tsx` (492) — props
- `apps/mobile/src/components/channel-info/people-page.tsx` (163) → `apps/mobile/src/components/chat/channel-screen.tsx` (523) — props
- `apps/mobile/src/components/chat/selection-bar.tsx` (233) → `apps/mobile/src/components/chat/chat-composer-dock.tsx` (463) — props
- `apps/mobile/src/components/chat/use-composer-mentions.ts` (136) → `apps/mobile/src/components/chat/composer.tsx` (492) — hook

### Steps
1. **Hook rows.** Move the hook's body into the component that calls it, at the top of that component. Delete the return object and the destructuring, so the component uses the variables directly. Then delete the hook file.
   - If the host passes the hook's values on to children, keep passing them; only the hook boundary goes.
2. **Props rows.** Move the child component into its parent's file, as a function in the same file, and keep its JSX as it is. Where the child only received values the parent computes, read them from the parent's scope or keep a short props list. Delete the child file.
3. **Exported types.** A type the piece exported moves with it. Keep it exported only if another file imports it, and update those imports.
4. **Skip a row**, and list it in the Report with the reason, when:
   - the merged file would pass 700 lines;
   - the piece is imported lazily (`lazy(() => import(…))`);
   - the piece is used by a test that tests it on its own;
   - the merge would create an import cycle.
5. **Change no behaviour:** no logic, no wording, no styling, no hook order change inside a component. Prettier formatting.
6. **No new tests.** Tests and fixtures that imported a merged piece import from its new home.
7. **Report** the line counts per row and the skipped rows.

### Allowed files
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/components/channel-info/people-page.tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/use-composer-mentions.ts`
- `work/T-2123-merge-phone-c.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 107 lower.

---

## Report (written by the worker when done)

### What I did

Merged four of the five rows. Product lines in the touched files: **2822 → 2693 (−129)**, so the acceptance target of −107 is met.

| Row | Before | After | Change |
| --- | --- | --- | --- |
| `emoji-sheet.tsx` → `composer.tsx` | 128 + 492 | 1 + 644 (shared with the mentions row) | component inlined |
| `use-composer-mentions.ts` → `composer.tsx` | 136 + 492 | 0 + 644 (shared with the emoji row) | hook body inlined |
| the two composer rows together | 756 | 645 | −111 |
| `people-page.tsx` → `channel-screen.tsx` | 163 + 523 | 0 + 674 | −12 |
| `selection-bar.tsx` → `chat-composer-dock.tsx` | 233 + 463 | 0 + 690 | −6 |
| `use-chat-screen.ts` → `app/chat/[id].tsx` | 301 + 383 | skipped, unchanged | 0 |

- **Emoji row:** the `EmojiSheet` component had no hooks, so its body is now inline in `Composer` where it was rendered. The props interface, `EmojiSheetBody` wrapper and 19-line prop type are gone. `EmojiSheetTab` stays in `emoji-sheet.tsx` as a one-line type-only file because `composer-sheet.ts` imports it and that file is outside Allowed files.
- **Mentions row:** `useComposerMentions`' body now runs directly in `Composer` at the same point in hook order (same three `useState` calls), so only the wrapper, argument object and return object disappeared. Its references were renamed to the locals (`candidates`, `pickerOpen`, `handleChange`, `pickMention`, `trackEmojiChange`, `clearMentions`).
- **People row:** `ChannelPeoplePage`, `ChannelPerson` and `RANK` moved into `channel-screen.tsx` as module-level values. `ChannelPerson`/`ChannelPeoplePage` are no longer exported because nothing outside imports them.
- **Selection row:** `SelectionDeleteConfirm`, `deleteActionFor`, `EMPTY_MESSAGES` and `SelectionBar` moved into `chat-composer-dock.tsx` verbatim; `SelectionBar` is no longer exported.
- No logic, wording, styling or hook order changed. No tests added.

### Checks run

- `pnpm gate` from the repo root: **GATE PASS**.
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.8s)
  SKIP  build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: channel-screen.tsx 674 lines (soft limit, kept whole)
  WARN  size: chat-composer-dock.tsx 690 lines (soft limit, kept whole)
  WARN  size: composer.tsx 644 lines (soft limit, kept whole)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- No single test file was run: no test imports any of the merged modules (searched `apps/mobile/src` and the repo). The gate's `@zilar/mobile` test run passed.

### Notes for the lead

- **Skipped row:** `use-chat-screen.ts` → `app/chat/[id].tsx`. Two reasons:
  1. `ChatScreen` is imported by `chat-thread.tsx` and `topic-info-host.tsx`, both outside Allowed files. Moving the hook would require updating those imports and deleting `use-chat-screen.ts`, which the task's Allowed files do not permit.
  2. `[id].tsx` passes the whole hook result as `screen` to `ChatThread`, `TopicInfoHost` and `ChatComposerDock`, whose props are `ChatScreen` in files outside scope. The 69-line return object and the 17-line destructuring therefore cannot be removed; a forced merge would add the hook body back into `[id].tsx` and save roughly no lines. If you want this row, add `chat-thread.tsx` and `topic-info-host.tsx` to a follow-up task (and `composer-sheet.ts` for the emoji type) so the children can take only the fields they use.
- **Deviation:** `emoji-sheet.tsx` was not deleted; it now contains only `export type EmojiSheetTab = 'emoji' | 'stickers' | 'gifs';` because `composer-sheet.ts` (outside Allowed files) imports that type. Deleting it needs that one-line import moved, which is a follow-up outside this task's scope.
- The three merged files are between 644 and 690 lines, under the 700 skip threshold.


## Review (written by Claude)

Approved; the pre-review was clean. Net −129.
- **Merged back:** `emoji-sheet` and `use-composer-mentions` → `composer.tsx` (644 lines now); `selection-bar` → `chat-composer-dock`; `people-page` → `channel-screen`.
- **Skipped:** `use-chat-screen`, because two other files import it. Follow-up: fold it together with `chat-thread.tsx` and `topic-info-host.tsx`.
- **Lead check:** no file references the 3 deleted paths.
- **Phone emulator:**
  - the smoke passed for Ana's chat, Acme Announcements and Dev team General;
  - in General, the emoji button opens the Emoji/Stickers/GIFs panel;
  - typing "@" lists Dev-1, QA-1, Ana, Luis and Marco;
  - long-press → Select shows the selection bar ("1 selected", copy, Forward).
