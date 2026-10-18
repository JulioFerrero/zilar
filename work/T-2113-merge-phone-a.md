---
id: T-2113
title: "Merge back 9 size-split pieces into their only user (phone, part 1): a hook returning a big object, or a child with a long prop list, goes back into the one file that uses it, so the return object, the destructuring and the prop types disappear — no behaviour change"
status: merged
milestone: M5
branch: task/T-2113-merge-phone-a
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2113: Merge split pieces back (phone, part 1)

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
- `apps/mobile/src/components/chat/message-actions-sheet.tsx` (325) → `apps/mobile/src/components/chat/message-bubble-actions.tsx` (184) — props
- `apps/mobile/src/components/chat/composer-input-row.tsx` (207) → `apps/mobile/src/components/chat/composer.tsx` (359) — props
- `apps/mobile/src/components/chat/message-list-row.tsx` (195) → `apps/mobile/src/components/chat/message-list.tsx` (464) — props
- `apps/mobile/src/components/chat/use-group-invite-links.ts` (123) → `apps/mobile/src/app/group-info/[id].tsx` (463) — hook
- `apps/mobile/src/components/chat/use-chat-actions.ts` (177) → `apps/mobile/src/app/(tabs)/index.tsx` (355) — hook
- `apps/mobile/src/components/chat/topic-info-roles.tsx` (205) → `apps/mobile/src/components/chat/topic-info-sheet.tsx` (481) — props
- `apps/mobile/src/components/chat/use-voice-transcribe.ts` (240) → `apps/mobile/src/components/chat/voice-message.tsx` (294) — hook
- `apps/mobile/src/components/group-info/topics-section.tsx` (284) → `apps/mobile/src/components/group-info/root-page.tsx` (213) — props

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
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/components/chat/composer-input-row.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/message-actions-sheet.tsx`
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`
- `apps/mobile/src/components/chat/message-list-row.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/topic-info-roles.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/use-chat-actions.ts`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/use-group-invite-links.ts`
- `apps/mobile/src/components/chat/use-voice-transcribe.ts`
- `apps/mobile/src/components/chat/voice-message.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/components/group-info/topics-section.tsx`
- `work/T-2113-merge-phone-a.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 199 lower.

---

## Report (written by the worker when done)

### What I did

Merged 8 of the 9 split pieces back into their only production user. Hook rows: the body moved into the calling component, the return object and the host destructuring are gone, and the host uses the values directly. Props rows: the child's JSX now lives in the parent (inline where the child was rendered once; as a same-file function where it must stay a `memo` row or has a non-production caller), and the child props interface is gone where the parent's scope supplies the values.

Line counts per row (old piece + old host → merged file(s)):

| Row | Old | New | Saved |
|---|---|---|---|
| `message-actions-sheet.tsx` → `message-bubble-actions.tsx` | 325 + 184 = 509 | 397 | 112 |
| `composer-input-row.tsx` → `composer.tsx` | 207 + 359 = 566 | 492 | 74 |
| `message-list-row.tsx` → `message-list.tsx` | 195 + 464 = 659 | 641 + 12 | 6 |
| `use-group-invite-links.ts` → `app/group-info/[id].tsx` | 123 + 463 = 586 | 552 | 34 |
| `use-chat-actions.ts` → `app/(tabs)/index.tsx` | 177 + 355 = 532 | 475 | 57 |
| `topic-info-roles.tsx` → `topic-info-sheet.tsx` | 205 + 481 = 686 | 633 | 53 |
| `use-voice-transcribe.ts` → `voice-message.tsx` | 240 + 294 = 534 | 460 | 74 |
| `topics-section.tsx` → `root-page.tsx` | 284 + 213 = 497 | 491 + 1 | 5 |
| **Total** |  |  | **415** |

Deleted files: `message-actions-sheet.tsx`, `composer-input-row.tsx`, `topic-info-roles.tsx`, `use-group-invite-links.ts`, `use-chat-actions.ts`, `use-voice-transcribe.ts`.

### Checks run

`pnpm gate` (final run):

```text
PASS  install (frozen)  (1.0s)
PASS  format  (0.8s)
PASS  lint  (1.0s)
PASS  typecheck  (2.7s)
PASS  effect  (0.7s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

Gate size warnings are all soft-limit warnings; every changed file is below 800 lines (largest is `message-list.tsx` at 641). No tests were run separately because no test imports a merged piece; the gate ran the mobile package tests.

### Notes for the lead

- **Skipped row:** `use-chat-screen.ts` (301) → `app/chat/[id].tsx` (383). The hook's `ChatScreen` return type is imported by `chat-thread.tsx`, `chat-composer-dock.tsx` and `topic-info-host.tsx` (all outside Allowed files). Merging would move the type into the route file and make those three import from `app/chat/[id].tsx`, which already imports them: an import cycle, and the child imports cannot be updated within scope. Also, the screen passes all hook values to those children as one `screen` object, so deleting the return object would only recreate an equivalent object literal.
- **Two files kept as shims, so not deleted:** `message-list-row.tsx` now holds only the exported `ListEntry` type (12 lines) because `use-message-list-scroll.ts`, outside Allowed files, imports that type from it; moving the type to `message-list.tsx` would create a type-level cycle. `topics-section.tsx` is now a one-line re-export of `TopicsSection` from `root-page.tsx` because `src/mock/dev-topic-header-screen.tsx`, outside Allowed files, imports it (and its `ComponentProps` type).
- **No behaviour changes intended:** JSX, logic, wording, styling and existing hook order are unchanged; the only new hooks are the ones moved with their piece (appended at the same call site). No new dependencies or tests.
- First gate run failed on Prettier formatting and two missing local helpers (`openClear`/`closeClear`); both fixed, final run is green.


## Review (written by Claude)

Approved; the pre-review was clean. Net −415; 8 of the 9 pairs merged back.
- **Skipped:** `use-chat-screen.ts`. Its `ChatScreen` type is used by three children, so merging it would create an import cycle.
- **Shims kept,** each to avoid a cycle with a file outside scope:
  - `message-list-row.tsx` now holds only the `ListEntry` type (12 lines);
  - `topics-section.tsx` is a one-line re-export.
- **Phone emulator smoke:** `/`, `/chat/ana@zilar.test`, `/chat/viernes@rooms.zilar.test`, `/group-info/g-devteam` and `/chat/acme@rooms.zilar.test` all PASS.
- **Lead re-check.** The first chat captures caught loading placeholders, so the lead reopened Ana and Viernes with a 12 s wait:
  - both show the full list (pinned bar, replies, deleted states, attachments, reactions, sender names);
  - long-pressing a message opens the actions sheet (reactions, Reply, Forward, Select, Copy text, Delete for me, Pin);
  - Dev team group info shows its members and topics.
