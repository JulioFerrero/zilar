---
id: T-2114
title: "Merge back 9 size-split pieces into their only user (phone, part 2): a hook returning a big object, or a child with a long prop list, goes back into the one file that uses it, so the return object, the destructuring and the prop types disappear — no behaviour change"
status: merged
milestone: M5
branch: task/T-2114-merge-phone-b
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2114: Merge split pieces back (phone, part 2)

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

- `apps/mobile/src/components/chat/use-channel-invites.ts` (135) → `apps/mobile/src/components/chat/channel-screen.tsx` (411) — hook
- `apps/mobile/src/components/stickers/use-pack-items.ts` (370) → `apps/mobile/src/components/stickers/use-pack-editor.ts` (297) — hook
- `apps/mobile/src/components/approvals/use-approvals.ts` (331) → `apps/mobile/src/app/settings/approvals.tsx` (340) — hook
- `apps/mobile/src/components/connections/use-connections.ts` (265) → `apps/mobile/src/app/settings/connections.tsx` (326) — hook
- `apps/mobile/src/components/chat/chat-list-page.tsx` (144) → `apps/mobile/src/components/chat/chat-list.tsx` (131) — props
- `apps/mobile/src/components/chat/topic-add-sheet.tsx` (377) → `apps/mobile/src/components/chat/topic-info-host.tsx` (289) — props
- `apps/mobile/src/components/chat/channel-composer-bar.tsx` (127) → `apps/mobile/src/components/chat/chat-composer-dock.tsx` (348) — props
- `apps/mobile/src/components/group-info/use-group-picture.ts` (209) → `apps/mobile/src/components/group-info/settings-page.tsx` (148) — hook
- `apps/mobile/src/components/chat/group-topic-list.tsx` (143) → `apps/mobile/src/app/group/[id].tsx` (432) — props

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
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/app/settings/approvals.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/components/approvals/use-approvals.ts`
- `apps/mobile/src/components/chat/channel-composer-bar.tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/chat-list-page.tsx`
- `apps/mobile/src/components/chat/chat-list.tsx`
- `apps/mobile/src/components/chat/group-topic-list.tsx`
- `apps/mobile/src/components/chat/topic-add-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/use-channel-invites.ts`
- `apps/mobile/src/components/connections/use-connections.ts`
- `apps/mobile/src/components/group-info/settings-page.tsx`
- `apps/mobile/src/components/group-info/use-group-picture.ts`
- `apps/mobile/src/components/stickers/use-pack-editor.ts`
- `apps/mobile/src/components/stickers/use-pack-items.ts`
- `work/T-2114-merge-phone-b.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 159 lower.

---

## Report (written by the worker when done)

### What I did

Merged 8 of the 9 rows; the diff on `apps/mobile` is 1,905 lines deleted and 1,554 added (**351 fewer**, acceptance wanted 159). One row was skipped (see Notes).

Hook rows (piece + host → merged file, before → after lines):
- `use-channel-invites.ts` (135) + `channel-screen.tsx` (411) → 523 (**−23**)
- `use-pack-items.ts` (370) + `use-pack-editor.ts` (297) → 518 (**−149**)
- `use-approvals.ts` (331) + `approvals.tsx` (340) → 610 (**−61**)
- `use-connections.ts` (265) + `connections.tsx` (326) → 537 (**−54**)
- `use-group-picture.ts` (209) + `settings-page.tsx` (148) → 326 (**−31**)

Props rows (piece + host → merged file):
- `chat-list-page.tsx` (144) + `chat-list.tsx` (131) → 265 (**−10**)
- `channel-composer-bar.tsx` (127) + `chat-composer-dock.tsx` (348) → 463 (**−12**)
- `group-topic-list.tsx` (143) + `group/[id].tsx` (432) → 564 (**−11**)

For every hook row the hook body now sits at the hook's old call site, so hook order is unchanged; the return object and the destructuring are gone and the host reads the variables directly. The two small helpers a hook exported (`GroupPicture`, `groupAvatarSlot` for the group picture; `LoadStatus`/`OwnedRule` for rules) were only used by the host and are now local. `ChannelCallFailed`/`callStore` and the connection error mapper also moved into their host as local declarations. For props rows the JSX moved unchanged; `chat-list.tsx` and `group/[id].tsx` keep a props list because their component sits at module scope where the parent's locals are not in scope, while `channel-composer-dock.tsx` keeps the same list its child already had.

Deleted the eight merged piece files. No behaviour, wording, styling or hook-order changes; Prettier formatting only. No new tests.

### Checks run

- `pnpm install --frozen-lockfile`: `Done in 15.3s using pnpm v10.32.1`.
- Single tests: none. These files are UI code with no tests of their own (`grep` found no test importing any merged piece); `pnpm gate` runs the mobile tests.
- `pnpm gate` (final run):
  - `PASS install (frozen) (4.6s)`
  - `PASS format (3.0s)`
  - `PASS lint (1.5s)`
  - `PASS typecheck (8.5s)`
  - `PASS effect (2.2s)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `PASS tests @zilar/mobile (5.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`
  - It also warned that six merged files are over the 400-line soft limit (523, 610, 537, 564, 463, 518), which the task explicitly allows.
- Two earlier gate runs failed and were fixed in scope: prettier wanted a line wrapped in `chat-list.tsx`; lint then caught unused props in `chat-list.tsx` (the moved page needed the full prop list after all) and unused `activePicker`/`activePreparer` in `use-pack-editor.ts`.

### Notes for the lead

- **Skipped row (1):** `topic-add-sheet.tsx` (377) → `topic-info-host.tsx` (289). `apps/mobile/src/mock/dev-topic-header-screen.tsx` imports `TopicAddContent` and `AddTab` from `topic-add-sheet.tsx`, and that mock file is not in the Allowed files, so deleting the piece would leave a broken import outside my scope. Merging it needs either a change to that mock file's import or a decision to delete the mock.
- `apps/mobile/src/app/settings/sticker-pack.tsx` imports `PackEditorDeps` and `PackVisibility` from `use-pack-editor.ts` (an allowed file), so both stay exported there; `use-pack-items` is gone.
- No security surface touched (no routes, queries, logging or secrets).

## Review (written by Claude)

Approved; the pre-review was clean. Net −351; 8 of the 9 pairs merged back.
- **Skipped:** `topic-add-sheet.tsx`, because the mock dev screen imports it.
- **Phone emulator smoke:** `/`, `/chat/acme@rooms.zilar.test`, `/settings/approvals`, `/settings/connections`, `/group-info/g-devteam`, `/group/g-devteam` and `/settings/stickers` all PASS. On a contact sheet of all seven, each screen shows its content:
  - the chat list and the channel post;
  - the approval card;
  - the three keys;
  - group info with its members and topics;
  - the group's topic list;
  - the sticker packs.
