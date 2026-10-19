---
id: T-2159
title: "Clean-up (web, phone, devtools): repeated blocks inside one file become one helper or one loop; no behaviour change"
status: merged
milestone: M5
branch: task/T-2159-intra-dedupe-clients
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2159: One copy of each block repeated inside a file (web, phone, devtools)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned each file at `3b06cd0a4` for runs of 6 or more normalised lines (comments, blanks, imports and lone braces ignored) that appear twice or more in the same file. The ranges below are where the copies sit; the groups are separated by `;`.

| File (lines) | Repeated ranges |
| --- | --- |
| `apps/mobile/src/components/chat/plain-bubble-body.tsx` (510) | 283-305, 334-356 |
| `apps/web/src/routes/ChatView.tsx` (654) | 593-603, 614-624, 629-639 |
| `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (310) | 242-257, 290-305 |
| `apps/web/src/components/ais/AiFormFields.tsx` (323) | 13-27, 141-155 |
| `apps/web/src/components/ais/AiDangerZone.tsx` (197) | 90-122, 153-185 |
| `apps/web/src/components/MessageBubble.tsx` (763) | 409-419, 427-437 ; 651-657, 742-748 |
| `apps/mobile/src/components/stickers/use-stickers-panel.ts` (329) | 165-173, 226-234, 259-267 |
| `packages/devtools/src/lead/switch-model.ts` (197) | 66-83, 159-176 |

### Steps
For each group, read every copy:
1. **Same code:** keep one copy, as a local helper, a shared row-to-view mapper, a loop over a small table, or a shared JSX piece in the same file. Make the other places use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the group.
3. **A call site, not a copy:** skip the group when the repeat is only a call site or a destructure.
4. **Keep the sum smaller:** a helper must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same SQL, the same values and order, the same log texts, the same markup, labels and styles.
- Keep every "why" comment, once.
- No new tests. Run the nearest existing tests with `--reporter=dot`.

### Allowed files
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/web/src/components/ais/AiFormFields.tsx`
- `apps/web/src/components/ais/AiDangerZone.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `packages/devtools/src/lead/switch-model.ts`
- `work/T-2159-intra-dedupe-clients.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each group: merged (lines saved) or skipped (why).
- **Lead check:** web mock: the AI edit page's danger zone (stop, resume, delete) and the AI form fields, plus a chat's bubbles. Phone emulator: chat bubbles with link previews, and the Telegram sticker import sheet.

---

## Report (written by the worker when done)

### What I did

Deduplicated each repeated group inside its own file, keeping behaviour, markup, copy and order identical:

| Group | Result |
| --- | --- |
| `plain-bubble-body.tsx` 283-305 / 334-356 | Merged: one `metaTail` + `metaOverlay` JSX pair reused by both branches (−8 lines). |
| `ChatView.tsx` 593-603 / 614-624 / 629-639 | Merged: `openSearch` / `openMedia` handlers passed to all three panels (−10 lines). |
| `telegram-import-sheet.tsx` 242-257 / 290-305 | Merged: one `progress` JSX pair for the busy and error rows (−8 lines). |
| `AiFormFields.tsx` 13-27 / 141-155 | Merged: the `LimitsFields` body is now exported directly as `AiLimitsFields`; the forwarding wrapper is gone (−27 lines). |
| `AiDangerZone.tsx` 90-122 / 153-185 | Skipped: the two confirm rows differ in labels, pending flag and handlers, and a helper (props signature plus two call sites) would be longer than the 50 lines it replaces. |
| `MessageBubble.tsx` 409-419 / 427-437 | Merged: local `BubbleMeta` component used by both text bodies. |
| `MessageBubble.tsx` 651-657 / 742-748 | Merged: one `openMenu` handler used by both `MessageActionsButton` call sites (both MessageBubble groups net −1 line). |
| `use-stickers-panel.ts` 165-173 / 226-234 / 259-267 | Merged: `releaseBusy()` used by all three `Effect.ensuring` calls (−9 lines). |
| `devtools/switch-model.ts` 66-83 / 159-176 | Merged: `workerFor(task, deps)` loads and validates the worker once, used by both switch functions (−6 lines). |

Net product lines from `git diff main --numstat`: 116 additions, 185 deletions, **−69 lines**. The remaining `work/T-2159-intra-dedupe-clients.md` entry in that diff is the task file itself (+72, new on this branch).

### Checks run

- `pnpm install` — done, 1155 packages, no errors.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/launch.test.ts` — 1 file, 3 tests passed (nearest existing test for `switch-model.ts`; the other touched files have no test files).
- `pnpm gate` — `GATE PASS`. Summary:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/devtools
  PASS  tests @zilar/mobile
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  Size warnings only (existing soft-limit warnings for the three large files; all shrank or stayed the same).

### Notes for the lead

- No behaviour, markup, copy or style changes intended; every extracted value is the same object passed to the same props.
- `AiDangerZone.tsx` was left untouched, per the "keep the sum smaller" rule.
- The lead's web/phone smoke checks still apply: AI edit danger zone and form fields, chat bubbles, Telegram sticker import sheet.


## Review (written by Claude)

Approved; the pre-review was clean. Net −69. Seven of eight files now keep one copy of each repeated block: the phone bubble body, the Telegram import sheet, the sticker panel, `MessageBubble`, `AiFormFields`, `ChatView` and devtools `switch-model`.

**Skip:** `AiDangerZone` was skipped correctly; the two confirm rows differ in labels, pending flags and handlers.

**Comments:** none were lost.

**Web mock:**
- The New AI walk passes, including the limits fields in the setup step.
- The dev-team chat matches main pixel for pixel, apart from a spinner's animation frame.
- No page errors.

**Phone emulator:**
- The smoke passed: the dev-team and Marta chats, Stickers.
- The Import from Telegram sheet opens.
- The composer Stickers tab shows the packs.
