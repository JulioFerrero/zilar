---
id: T-0393
title: "Mobile kit: the sticker and GIF panels' loading and error states use StateMessage; StateMessage's action takes an accessibilityLabel"
status: todo
milestone: M5
branch: task/T-0393-mobile-panels-state-message
model: auto
effort: low
depends_on: [T-0386]
estimate: 0.1 day
---

# T-0393: sticker and GIF panel states on the kit

## Spec (written by Claude, do not edit)

### Why
These are the first screens to adopt the mobile `StateMessage` (T-0386).

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`** (T-0386):
  - `StateMessage({ kind, title, hint?, icon?, action?: { label, onPress }, size? })`;
  - `loading` renders an `ActivityIndicator` with `accessibilityLabel={title}`;
  - `error` puts `accessibilityRole="alert"` on its root;
  - the action renders `<Button size="sm" className="mt-1" onPress={action.onPress}><Text>{action.label}</Text></Button>` and passes no `accessibilityLabel`.
- **`apps/mobile/src/components/chat/sticker-panel.tsx:157-169`:**
  - loading is `<View className="h-[180px] items-center justify-center"><ActivityIndicator accessibilityLabel="Loading stickers" /></View>`;
  - error is a `View` with `<Text>Couldn&apos;t load stickers.</Text>` and `<Button variant="ghost" accessibilityLabel="Retry loading stickers" onPress={onRetry}><Text>Retry</Text></Button>`.
- **`apps/mobile/src/components/chat/gif-panel.tsx:251-268`:**
  - loading has the same shape with `accessibilityLabel="Loading GIFs"`;
  - error shows `<Text>{error}</Text>`, a ghost Button `accessibilityLabel="Retry loading GIFs"` with `onPress={() => load(queryRef.current, undefined, false)}`, and then `{rateLimited ? <Text …>{GIF_ATTRIBUTION}</Text> : null}`.
- **Tests:**
  - `apps/mobile/src/components/chat/gif-panel.test.tsx:115,148` checks the markup for "Loading GIFs";
  - `apps/mobile/src/components/chat/sticker-panel.test.tsx:140-143` checks "Loading stickers" and "Couldn&#x27;t load stickers.";
  - `apps/mobile/src/components/chat/emoji-sheet.test.tsx`, `apps/mobile/src/components/chat/composer-gifs.test.tsx` and `apps/mobile/src/lib/stickers-storage.test.ts` also reach these panels.
  - Keep every visible text and label.

### What to build
1. **StateMessage:** extend the action to `action?: { label: string; onPress: () => void; accessibilityLabel?: string }` and pass `accessibilityLabel` to the `Button`. Add a kit test case for it in `apps/mobile/src/components/ui/kit.test.tsx`.
2. **Sticker panel:** inside the same `h-[180px]` wrappers, use:
   - loading → `<StateMessage kind="loading" title="Loading stickers" />`;
   - error → `<StateMessage kind="error" title="Couldn't load stickers." action={{ label: 'Retry', accessibilityLabel: 'Retry loading stickers', onPress: onRetry }} />`.
3. **GIF panel:**
   - loading → `<StateMessage kind="loading" title="Loading GIFs" />`;
   - error → `<StateMessage kind="error" title={error} action={{ label: 'Retry', accessibilityLabel: 'Retry loading GIFs', onPress: … }} />`, keeping the `rateLimited` attribution line after it.
4. Add mocks only where tests need them. Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, `apps/mobile/src/components/chat/sticker-panel.tsx:150-185`, `apps/mobile/src/components/chat/gif-panel.tsx:245-275` and the tests above.

### Allowed files
`apps/mobile/src/components/ui/state-message.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/components/chat/sticker-panel.tsx`, `apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/chat/sticker-panel.test.tsx`, `apps/mobile/src/components/chat/gif-panel.test.tsx`, `apps/mobile/src/components/chat/emoji-sheet.test.tsx`, `apps/mobile/src/components/chat/composer-gifs.test.tsx`, `apps/mobile/src/lib/stickers-storage.test.ts`, `work/T-0393-mobile-panels-state-message.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit sticker-panel gif-panel emoji-sheet composer-gifs stickers-storage
pnpm gate
```

### Acceptance
- No `ActivityIndicator` remains in `sticker-panel.tsx` or `gif-panel.tsx` for these states.
- The retry labels are kept.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
