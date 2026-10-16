---
id: T-1689
title: "Size split of the web MessageList.tsx (393 lines): move its scroll state and effects (refs, prepend compensation, loading-older line, draft pin, resize observer, handleScroll, scrollToBottom) into a new components/useMessageListScroll.ts hook — a pure move, no behaviour change"
status: merged
milestone: M5
branch: task/T-1689-split-message-list
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1689: Split the scroll logic out of the web MessageList

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/components/MessageList.tsx` is 393 of 400 lines, so no change to the message list can land. Its scroll handling is one self-contained block, like the composer's recording lifecycle that T-1675 moved into a hook.

### Facts (the lead read them on 2026-10-16)
- **`MessageList.tsx`:**
  - imports `:1-21` (`Effect`, `Fiber` from `effect` `:8`; `useInitialScroll`, `useScrollMemory` from `./useScrollMemory` `:14`);
  - `const NEAR_BOTTOM_PX = 80;` (`:23`);
  - `function useLatestCallback :27`;
  - `export const MessageList = memo(function MessageList({…}) :37`;
  - `const draftText = draft?.text.trim() ?? '';` (`:76`);
  - `const [initialUnread] = useState(() => chat.unread);` (`:123`);
  - `useMessageWindow(chatId, items, dividerIndex)` returns `{ windowItems, start, hasHidden, reveals, grow }` (`:127-131`).
- **The block to move** runs from `const scrollRef = useRef<HTMLDivElement>(null);` (`:132`) to the end of `const scrollToBottom = (): void => {…};` (about `:298`), just before the comment `// Loading and empty are different states …`. It holds:
  - the refs `scrollRef`, `contentRef` and `dividerRef`;
  - `scrollMemory` (`useScrollMemory`), `restoredScroll`, `previousCount` and `prependScrollHeight`;
  - the `atBottom`/`atBottomRef`, `pending` and `loadingOlder`/`loadingOlderRef` state, and `stopLoadingOlder`;
  - `pendingJump` and `useInitialScroll(…)`;
  - the `useLayoutEffect` prepend compensation;
  - `const hasMore = useChatSelector((s) => s.hasMore(chatId))` and its effect;
  - the 8-second safety-net effect (`Effect.runFork` / `Fiber.interrupt`);
  - the draft pin effect (reads `draftText`);
  - `hasContent` and the `ResizeObserver` effect;
  - `handleScroll` (uses `storeApi`, `chat.id`, `hasHidden`, `grow` and `NEAR_BOTTOM_PX`) and `scrollToBottom`.
- **After the block,** the render uses only `scrollRef`, `contentRef`, `dividerRef`, `atBottom`, `pending`, `loadingOlder`, `handleScroll` and `scrollToBottom` (plus `start` and `windowItems`, which come from `useMessageWindow` and stay in the component).
- **The folder `apps/web/src/components/`** holds the hooks `useMessageWindow.ts` and `useScrollMemory.ts`; there's no `useMessageListScroll.ts`.

### Steps
1. **Create `apps/web/src/components/useMessageListScroll.ts`** exporting `useMessageListScroll(input)`.
   - `input` carries the block's free variables: `chatId`, `chat`, `storeApi`, `items`, `visibleMessages`, `windowItems`, `reveals`, `hasHidden`, `grow`, `initialUnread` and `draftText`; read the block for any other.
   - Move the block **word for word**, comments included, along with `NEAR_BOTTOM_PX` if only the block uses it (otherwise export it from the hook file and import it).
   - It returns `{ scrollRef, contentRef, dividerRef, atBottom, pending, loadingOlder, handleScroll, scrollToBottom }`.
2. **`MessageList.tsx`:** call the hook where the block was, destructure those eight names, and drop the imports that are no longer used (for example `Effect`, `Fiber`, `useLayoutEffect`, `useScrollMemory`).
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/web/src/components/useMessageListScroll.ts`
- `apps/web/src/components/MessageList.tsx`
- `work/T-1689-split-message-list.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`MessageList.tsx` is about 240 lines,** and the hook holds the block unchanged.
- **Unchanged behaviour:** opening a chat lands on the divider or the remembered spot; scrolling up loads older messages without a jump; new messages show the "pending" badge when scrolled up; an AI draft stays pinned at the bottom.
- **The web typecheck and build pass.**

---

## Report (written by the worker when done)

### What I did

Pure move of the scroll block out of `MessageList.tsx`, no behaviour change.

- Created `apps/web/src/components/useMessageListScroll.ts` exporting `useMessageListScroll(input)`. It holds `NEAR_BOTTOM_PX` (only the moved block used it) and the block from the old `:132-298` verbatim, comments included: the `scrollRef`/`contentRef`/`dividerRef` refs, `useScrollMemory`/`restoredScroll`/`previousCount`/`prependScrollHeight`, the `atBottom`/`pending`/`loadingOlder` state and `stopLoadingOlder`, `pendingJump` + `useInitialScroll`, the `useLayoutEffect` prepend compensation, `hasMore` + its effect, the 8s Effect/Fiber safety net, the draft pin effect, `hasContent` + the `ResizeObserver` effect, `handleScroll` and `scrollToBottom`. Input carries `chatId`, `chat`, `storeApi`, `items`, `visibleMessages`, `windowItems`, `reveals`, `hasHidden`, `grow`, `initialUnread`, `draftText`; it returns `{ scrollRef, contentRef, dividerRef, atBottom, pending, loadingOlder, handleScroll, scrollToBottom }`.
- In `MessageList.tsx` the block is now a single hook call with those eight names destructured; dropped the now-unused `import { Effect, Fiber } from 'effect'` and `import { useInitialScroll, useScrollMemory } from './useScrollMemory'`, removed `useLayoutEffect` from the react import and deleted the local `NEAR_BOTTOM_PX`.

`MessageList.tsx` is 246 lines (was 393); the hook is 227 lines.

### Checks run

- No test file imports `MessageList` or `useMessageListScroll` (grep over `apps/web/src` found none), so there were no nearby tests to run individually; the spec says no new tests.
- `pnpm install`: done, no errors.
- `pnpm gate` (repo root), last lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (4.0s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (1.9s)`
  - `PASS  typecheck  (6.2s)`
  - `PASS  effect  (1.2s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- `git status`: only `MessageList.tsx`, `useMessageListScroll.ts` and this task file changed; all inside Allowed files.
- Behaviour is unchanged (verbatim move); the acceptance items (divider/remembered spot on open, older-load without jump, pending badge, draft pin) are UI behaviour that the phone smoke covers.

## Review (written by Claude)

**Approved and merged.** A pure size split of the web message list.

- **Pre-review:** clean, 0 nits.
- **The lead's check:**
  - the block's body is unchanged in `useMessageListScroll.ts` (diff after stripping indentation); only the hook's header, input type and returned object are new;
  - the hook is called where the block was, so React's hook order is the same.
- **Live check, headless Chromium on the worktree's web app in mock mode (Ana's chat):**
  - it opens at the bottom (distance 0);
  - scrolling up shows "Scroll to bottom", and the button brings the view back to distance 0 and hides itself;
  - 0 page or console errors.
- **Result:** `MessageList.tsx` drops from 393 to 246 lines.
