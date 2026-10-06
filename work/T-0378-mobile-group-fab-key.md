---
id: T-0378
title: "Mobile: the group screen's New topic FAB uses the same raised key as the New chat FAB, not a flat accent with a hard-coded icon color"
status: merged
milestone: M5
branch: task/T-0378-mobile-group-fab-key
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0378: group New topic FAB as a raised key

## Spec (written by Claude, do not edit)

### Why
The chats tab New chat FAB is a raised key with a press animation. The group screen's New topic FAB is a flat `bg-accent` square, and its icon color is hard-coded as `#0a0a0a`, which ignores the theme tokens.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/new-chat-button.tsx`:**
  - line 17 imports `useKeyPress` from `@/components/ui/use-key-press`;
  - line 18 imports `ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey` from `@/lib/depth`;
  - line 49: `const { pressed, reduceMotion, setPressed } = useKeyPress();`;
  - lines 151-167: a `Pressable` with `onPressIn`/`onPressOut` calling `setPressed`, `className="absolute right-5 h-14 w-14 items-center justify-center rounded-[18px]"`, `style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion), { bottom: … }]}` and `<Plus size={24} color={ACCENT_FOREGROUND} />`.
- **`apps/mobile/src/app/group/[id].tsx:578-591`:**
  - `{canCreate ? (<Pressable accessibilityRole="button" accessibilityLabel="New topic" onPress={…} className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-[18px] bg-accent active:opacity-90"><Plus size={24} color="#0a0a0a" /></Pressable>) : null}`;
  - `Pressable` and `Plus` are already imported (lines 3 and 6).
- **Tests that render the group screen:** `apps/mobile/src/components/chat/group-roles-mounted.test.tsx` and `apps/mobile/src/components/chat/group-roles-load.test.tsx`.

### What to build
1. In `GroupTopics` (`apps/mobile/src/app/group/[id].tsx:55`, the component whose hooks start at line 59), call `useKeyPress()` at the top level, unconditionally, next to the other hooks.
2. Give the FAB:
   - `onPressIn={() => setPressed(true)}` and `onPressOut={() => setPressed(false)}`;
   - `className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-[18px]"` (drop `bg-accent active:opacity-90`);
   - `style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}`;
   - `<Plus size={24} color={ACCENT_FOREGROUND} />`.
3. Import the hook and the `@/lib/depth` names as `new-chat-button.tsx` does. Keep the `accessibilityLabel` and `onPress`.
4. If the two tests fail on the new imports, add mocks only:
   - `@/components/ui/use-key-press` returning `{ pressed: false, reduceMotion: false, setPressed: () => {} }`;
   - the `@/lib/depth` exports.

   Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/new-chat-button.tsx:1-60` and `:148-170`, `apps/mobile/src/app/group/[id].tsx:50-70` and `:575-592`, and the two tests' mock blocks.

### Allowed files
`apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `work/T-0378-mobile-group-fab-key.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles-mounted group-roles-load
pnpm gate
```

### Acceptance
- No `bg-accent` and no `#0a0a0a` in the group screen FAB.
- It uses `primaryKey`, `pressStyle` and `ACCENT_FOREGROUND`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Changed `apps/mobile/src/app/group/[id].tsx`: added `useKeyPress()` hook at top of `GroupTopics`, imported `useKeyPress` and `ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey` from `@/lib/depth` (same as `new-chat-button.tsx`); FAB now uses `onPressIn`/`onPressOut`, `style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}`, `<Plus color={ACCENT_FOREGROUND} />`; dropped `bg-accent active:opacity-90` and `#0a0a0a`. Kept `accessibilityLabel` and `onPress`. No test files changed (existing tests pass unmocked, no assertion changes).
- Commands:
  - `pnpm install`: done, exit 0.
  - `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles-mounted group-roles-load`: 2 files passed, 8 tests passed.
  - `pnpm gate`: PASS install (3.1s), PASS format (58.2s), PASS lint (2.3s), PASS typecheck (25.0s), PASS tests @zilar/mobile (5.7s); scope: every changed file is inside the Allowed files; GATE PASS. Changed files: task md + `apps/mobile/src/app/group/[id].tsx` (2 changed files against main).
- Security checklist: N/A (pure UI styling change, no secrets, no deletes/updates, no caps, no permission flow, no routes, no audit entries).

## Review (written by Claude)

Approved (lead, 2026-10-06). The group FAB now uses `primaryKey`, `pressStyle` and `ACCENT_FOREGROUND` like the New chat FAB; `useKeyPress()` is top-level in `GroupTopics` before any early return; `bg-accent` and `#0a0a0a` are gone. Pre-review clean (0 findings).
