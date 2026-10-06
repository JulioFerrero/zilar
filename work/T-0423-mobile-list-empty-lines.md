---
id: T-0423
title: "Mobile kit: the empty chat, the tool versions and runs lists, and the empty sticker pack use StateMessage"
status: todo
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

## Review (written by Claude)
