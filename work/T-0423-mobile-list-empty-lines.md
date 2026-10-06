---
id: T-0423
title: "Mobile kit: the empty chat, the tool versions and runs lists, and the empty sticker pack use StateMessage"
status: merged
milestone: M5
branch: task/T-0423-mobile-list-empty-lines
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0423: list empty lines on StateMessage (mobile)

## Spec (written by Claude, do not edit)

### Why
These are the last rows of batch 28 of `docs/audit/ui-kit-leftovers.md`, apart from Stickers and Machines.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:** `StateMessage({ kind, title, size?: 'block' | 'inline', … })`. `block` is centred, with an Inbox icon and the title; `inline` is a small icon plus the title.
- **The lines:**

| File | Lines | Today | Becomes |
| --- | --- | --- | --- |
| `apps/mobile/src/components/chat/message-list.tsx` | 259-261 | `<View className="flex-1 items-center justify-center p-8"><Text className="text-[15px] text-muted-foreground">No messages yet</Text></View>` | keep the `View` (it centres in the chat); its child becomes `<StateMessage kind="empty" title="No messages yet" />` |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx` | 288-290 | `<Text className="px-2 text-[13px] text-muted-foreground">No versions yet.</Text>` | inline empty |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx` | 406-408 | the same style, "No runs yet." | inline empty |
| `apps/mobile/src/components/chat/sticker-panel.tsx` | 180-184 | `<View className="h-[180px] items-center justify-center px-4"><Text …>No stickers here yet.</Text></View>` | keep the `View`; its child becomes `<StateMessage kind="empty" title="No stickers here yet." />` |

- **Imports:** `sticker-panel.tsx` already imports `StateMessage` (T-0393); the other two do not.
- **Tests:**
  - `apps/mobile/src/components/chat/message-list.test.tsx`;
  - `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/sticker-panel.test.tsx`.

  The sticker panel is also imported by `apps/mobile/src/lib/stickers-storage.test.ts`, `apps/mobile/src/components/chat/emoji-sheet.test.tsx` and `apps/mobile/src/components/chat/composer-gifs.test.tsx`. Those already have the `StateMessage` mocks from T-0393.

  Mocks a test may need: `CircleAlert` and `Inbox` (lucide), `DANGER` and `MUTED_FOREGROUND` (colors), `ActivityIndicator` (react-native). See `apps/mobile/src/components/ais/tools-section.test.tsx`.

### What to build
1. Apply the table.
2. Add imports where they are missing.
3. Change no assertion. Add mocks only where needed. If a test outside the Allowed files breaks, stop and report BLOCKED with the file name.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, each file around its lines, and the three tests.

### Allowed files
`apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/chat/sticker-panel.tsx`, `apps/mobile/src/components/chat/message-list.test.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`, `apps/mobile/src/components/chat/sticker-panel.test.tsx`, `work/T-0423-mobile-list-empty-lines.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-list tool-detail-sheet sticker-panel
pnpm gate
```

### Acceptance
- The four places are empty `StateMessage`s with the same texts.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Applied the table in the Spec:
- `apps/mobile/src/components/chat/message-list.tsx`: kept the centering `View`
  (`flex-1 items-center justify-center p-8`), replaced its `Text` child with
  `<StateMessage kind="empty" title="No messages yet" />`. Added the
  `StateMessage` import and removed the now-unused `Text` import (its only use
  in the file was this line).
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`: the version-history
  and recent-runs empty lines are now
  `<StateMessage kind="empty" size="inline" title="No versions yet." />` and
  `<StateMessage kind="empty" size="inline" title="No runs yet." />`. Added the
  `StateMessage` import (`Text` is still used elsewhere in the file, so it
  stays).
- `apps/mobile/src/components/chat/sticker-panel.tsx`: kept the
  `h-[180px]` `View`, replaced its `Text` child with
  `<StateMessage kind="empty" title="No stickers here yet." />`. The
  `StateMessage` import was already present from T-0393.

Mocks: `tool-detail-sheet.test.tsx` is the only test that needed new mocks.
Added `ActivityIndicator: 'ActivityIndicator'` to the `react-native` mock and
`CircleAlert`/`Inbox` to the `lucide-react-native` mock, matching
`tools-section.test.tsx`. `sticker-panel.test.tsx` already had all the
`StateMessage` mocks from T-0393. `message-list.test.tsx` does not import
`message-list.tsx` (it only tests `filterBlockedMessages` from
`@/lib/blocked-users`), so it needed no mock. No assertion was changed in any
test. No test outside the Allowed files imports `message-list.tsx`, so nothing
broke.

### Files changed
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx`
- `work/T-0423-mobile-list-empty-lines.md`

### Commands and real results
- `pnpm install`: completed, exit 0.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-list tool-detail-sheet sticker-panel`:
  `Test Files 3 passed (3)`, `Tests 37 passed (37)`. (The stderr output is the
  pre-existing "incorrect casing" React warnings from the string component
  mocks; no failures.)
- `pnpm gate` (from repo root) summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (20.3s)
  PASS  lint  (1.9s)
  PASS  typecheck  (11.4s)
  PASS  tests @zilar/mobile  (4.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- None from the Spec. One extra change beyond the table row: removed the
  unused `Text` import in `message-list.tsx` (required for lint; its only use
  was the replaced line). This is inside the Allowed files.
- Security checklist: no secrets, no routes, no deletes/updates, no logging
  changes — this is a pure UI-copy change, so the checklist items are not
  applicable.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. The four places are empty StateMessages with the same texts. The chat and sticker-panel wrappers are kept; the tool lists are inline.
