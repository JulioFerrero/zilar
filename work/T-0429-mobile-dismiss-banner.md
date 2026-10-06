---
id: T-0429
title: "Mobile kit: one DismissBanner component replaces the 12 copied error and notice banners on the chat screen, with a kit Dismiss button"
status: todo
milestone: M5
branch: task/T-0429-mobile-dismiss-banner
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0429: DismissBanner (mobile)

## Spec (written by Claude, do not edit)

### Why
This is batch 17 of `docs/audit/ui-kit-leftovers.md` (M-chat-dismiss). `apps/mobile/src/app/chat/[id].tsx` repeats the same four banners in its three layouts, which makes 12 hand-rolled Dismiss `Pressable`s. One component with a kit Button removes the copies, and the banner gets a test.

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/chat/[id].tsx`**, three layouts with the same four banners each:
  - first block at lines ~523-574, second at ~702-753, third at ~935-986;
  - each block, in order:
    1. `pinError !== ''`: message `{pinError}`, `onPress={() => setPinError('')}`, label "Dismiss error";
    2. `actionError !== undefined`: message `{actionError.message}`, `onPress={() => dismissActionError()}`, label "Dismiss error";
    3. `openError !== ''`: message `{openError}`, `onPress={() => setOpenError('')}`, label "Dismiss error";
    4. `jumpMissed`: message "Message not found", `onPress={() => setJumpMissed(false)}`, label "Dismiss notice".
  - **Error banner markup:**
    - `<View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">`;
    - `<Text className="flex-1 text-[13px] text-danger">`;
    - `Pressable` with class `ml-2 rounded px-2 py-1 active:bg-surface-raised`, child `<Text className="text-[13px] font-semibold text-danger">Dismiss</Text>`.
  - **Notice banner:** the same, with `bg-surface-raised` and `text-muted-foreground` for both texts.
  - These 12 are the file's only `<Pressable` uses, so drop `Pressable` from the `react-native` import (line 3) once they are gone.
- **`apps/mobile/src/components/ui/button.tsx`:** `Button` (variant `ghost`, size `sm`; `cn` merges `className`). Labels MUST be inside `<Text>`.
- **`apps/mobile/src/components/chat/composer-layout.test.ts`** reads `[id].tsx` as text and checks only `behavior="padding"`. Do not touch those lines.
- **Static-markup test pattern** with `react-native`, `Text` and `Button` mocked as strings: `apps/mobile/src/components/ais/ai-activity.test.tsx:20-41`.

### What to build
1. **New `apps/mobile/src/components/chat/dismiss-banner.tsx`:**
   - export `DismissBanner({ message, tone, onDismiss }: { message: string; tone: 'error' | 'notice'; onDismiss: () => void })`;
   - the same View and message Text classes as today, chosen by tone;
   - the message Text gets `accessibilityRole="alert"` for the error tone only;
   - the Dismiss control is `<Button variant="ghost" size="sm" className="ml-2 h-7 px-2" accessibilityLabel={tone === 'error' ? 'Dismiss error' : 'Dismiss notice'} onPress={onDismiss}>` around `<Text className="text-[13px] font-semibold text-danger">Dismiss</Text>` (`text-muted-foreground` for notice).
2. **`[id].tsx`:** replace each of the 12 banners with `{cond ? <DismissBanner tone=… message={…} onDismiss={…} /> : null}`, keeping each condition and handler exactly. Change nothing else.
3. **New `apps/mobile/src/components/chat/dismiss-banner.test.tsx`** (static markup, mocks as in ai-activity.test):
   - error tone: shows the message, the "Dismiss error" label and `text-danger`, and the message carries `accessibilityRole="alert"`;
   - notice tone: shows "Dismiss notice" and `text-muted-foreground`, with no alert role.
4. If another test breaks through an import, stop and report BLOCKED with the file name.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/chat/[id].tsx:515-580`, `apps/mobile/src/components/ais/ai-activity.test.tsx:1-45`.

### Allowed files
`apps/mobile/src/components/chat/dismiss-banner.tsx`, `apps/mobile/src/components/chat/dismiss-banner.test.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0429-mobile-dismiss-banner.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot dismiss-banner composer-layout
pnpm gate
```

### Acceptance
- `[id].tsx` has no hand-rolled Dismiss `Pressable` left: the 12 banners are `DismissBanner`s with the same conditions and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
