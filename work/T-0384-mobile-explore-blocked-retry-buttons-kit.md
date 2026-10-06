---
id: T-0384
title: "Mobile kit: Explore Show more, Blocked Unblock and the sticker and GIF panel Retry buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0384-mobile-explore-blocked-retry-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0384: Explore, Blocked and panel Retry buttons on the kit

## Spec (written by Claude, do not edit)

### Why
Four raw `Pressable` text pills are left outside the kit on these screens.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `default`, `destructive`, `outline`, `secondary` and `ghost`;
  - sizes `default`, `sm`, `lg` and `icon`.
  - **Labels must be inside `<Text>`.** A bare string renders a blank pill (the T-0349 bug).
- **The buttons to migrate** (the line is the `<Pressable`):

| File | Line | `accessibilityLabel` / content | Kit | Imports `Button`? |
| --- | --- | --- | --- | --- |
| `apps/mobile/src/app/explore.tsx` | 306 | "Show more", `disabled={loadingMore}`, `onPress={loadMore}`, text `loadingMore ? 'Loading…' : 'Show more'`, `rounded-full border border-border-strong` | `variant="outline" size="sm"` | yes, line 18 |
| `apps/mobile/src/app/settings/blocked.tsx` | 197 | `` `Unblock ${person.name}` ``, `disabled={busy}`, `onPress={onUnblock}`, text `busy ? 'Unblocking…' : 'Unblock'` | `variant="outline" size="sm"` | no |
| `apps/mobile/src/components/chat/sticker-panel.tsx` | 165 | "Retry loading stickers", `onPress={onRetry}`, text "Retry" | `variant="ghost"` | no |
| `apps/mobile/src/components/chat/gif-panel.tsx` | 257 | "Retry loading GIFs", `onPress={() => load(queryRef.current, undefined, false)}`, text "Retry" | `variant="ghost"` | no |

- **Leave alone:** the image viewer Close in `apps/mobile/src/components/chat/attachment-message.tsx:321`. It sits on a black overlay.
- **Tests that reach these files:**
  - `apps/mobile/src/components/contacts/blocked-screen.test.tsx` (it imports `@/app/settings/blocked` at line 121);
  - `apps/mobile/src/components/chat/sticker-panel.test.tsx`;
  - `apps/mobile/src/components/chat/gif-panel.test.tsx`;
  - `apps/mobile/src/components/chat/emoji-sheet.test.tsx`, because `emoji-sheet.tsx` renders `StickerGrid` (line 15) and `GifPanel` (line 164);
  - `apps/mobile/src/components/chat/composer-gifs.test.tsx`.

  When a test now renders the kit `Button`, add mocks only:
  - `Platform.select`;
  - reanimated `useReducedMotion`;
  - `TextClassContext` in the `@/components/ui/text` mock;
  - the `@/lib/depth` key exports (`primaryKey`, `KEY_PRIMARY_PRESSED_SHADOW`, `pressStyle`);
  - `@/components/ui/use-key-press`.

  Change no assertion.

### What to build
1. Replace the four `Pressable`s with `<Button variant=… size=… accessibilityLabel=… disabled=… onPress=…><Text>…</Text></Button>`, using the table.
2. Import `Button` from `@/components/ui/button` where it is missing. Drop a `Pressable` import only if nothing else in that file uses it.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, each file around the line above, and the three tests' mock blocks.

### Allowed files
`apps/mobile/src/app/explore.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/components/chat/sticker-panel.tsx`, `apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/contacts/blocked-screen.test.tsx`, `apps/mobile/src/components/chat/sticker-panel.test.tsx`, `apps/mobile/src/components/chat/gif-panel.test.tsx`, `apps/mobile/src/components/chat/emoji-sheet.test.tsx`, `apps/mobile/src/components/chat/composer-gifs.test.tsx`, `work/T-0384-mobile-explore-blocked-retry-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot blocked-screen sticker-panel gif-panel emoji-sheet composer-gifs
pnpm gate
```

### Acceptance
- The four buttons are kit `Button`s with labels inside `<Text>`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
