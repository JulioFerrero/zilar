---
id: T-1697
title: "Size split of the web routes/ChatView.tsx (390 lines): move the select-mode state (selectedIds and its chat-switch reset, startSelect, toggleSelect, the selection memo, forwardSelected) into a new components/useMessageSelection.ts hook — bodies moved word for word, no behaviour change"
status: merged
milestone: M5
branch: task/T-1697-split-chat-view
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1697: Split the select mode out of the web ChatView

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/routes/ChatView.tsx` is 390 of 400 lines, so no chat-screen change can land. Its select-mode state is self-contained.

### Facts (the lead read them on 2026-10-16)
- **`ChatView.tsx`:**
  - `export function ChatView({ chat }) :53`, with `const storeApi = useChatStoreApi();` (`:54`);
  - `const [forwarding, setForwarding] = useState<UiMessage[] | null>(null);` (`:100`).
- **Block A (`:101-108`):** the comment `// The ids checked in select mode; null means not selecting. …`, then:
  - `const [selectedIds, setSelectedIds] = useState<string[] | null>(null);`;
  - `const [selectionChatId, setSelectionChatId] = useState(chat.id);`;
  - the render-time reset `if (selectionChatId !== chat.id) { setSelectionChatId(chat.id); setSelectedIds(null); }`.
- **Block B (`:184-216`):**
  - `const startSelect = useCallback(…)`;
  - `const toggleSelect = useCallback(…)`;
  - `const selection = useMemo(() => ({ ids: new Set(selectedIds ?? []), onToggle: toggleSelect, onStart: startSelect }), […])`;
  - `const forwardSelected = (): void => {…}` (it calls `setForwarding(storeApi.getState().messages(chat.id).filter(…))` and `setSelectedIds(null)`).
- **The render uses:**
  - `selection` (`:302`);
  - `selectedIds !== null` (`:303`, `:305`);
  - `selectedIds` (`:308`);
  - `forwardSelected` (`:309`);
  - `setSelectedIds(null)` (`:310`).
- **The folder `apps/web/src/components/`** holds the hooks `useMessageWindow.ts`, `useScrollMemory.ts` and `useMessageListScroll.ts`; there's no `useMessageSelection.ts`.

### Steps
1. **Create `apps/web/src/components/useMessageSelection.ts`** exporting `useMessageSelection({ chatId, storeApi, setForwarding })`.
   - It holds block A and block B moved **word for word** (with `chat.id` read as `chatId`), comments included.
   - It returns `{ selectedIds, setSelectedIds, selection, forwardSelected }`.
   - Type `storeApi` like the other hooks do (for example `ReturnType<typeof useChatStoreApi>`), and `setForwarding` as React's `Dispatch<SetStateAction<UiMessage[] | null>>`.
2. **`ChatView.tsx`:** delete both blocks. Right after the `forwarding` state, call `const { selectedIds, setSelectedIds, selection, forwardSelected } = useMessageSelection({ chatId: chat.id, storeApi, setForwarding });`. Drop the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/web/src/components/useMessageSelection.ts`
- `apps/web/src/routes/ChatView.tsx`
- `work/T-1697-split-chat-view.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`ChatView.tsx` is about 345 lines,** and the hook holds both blocks unchanged.
- **Unchanged behaviour:** a long hold or Select starts select mode, taps toggle messages, Forward forwards the selection, Cancel and a chat switch clear it.
- **The web typecheck and build pass.**

---

## Report (written by the worker when done)

### What I did

- Created `apps/web/src/components/useMessageSelection.ts` (60 lines). It exports `useMessageSelection({ chatId, storeApi, setForwarding })` and returns `{ selectedIds, setSelectedIds, selection, forwardSelected }`.
  - Block A (the select-mode state and the render-time chat-switch reset) and block B (`startSelect`, `toggleSelect`, the `selection` memo and `forwardSelected`) are moved word for word, comments included; `chat.id` is read as `chatId` (in `useState(chatId)` and in `.messages(chatId)`).
  - `storeApi` is typed `ReturnType<typeof useChatStoreApi>`, like `useMessageListScroll.ts`; `setForwarding` is `Dispatch<SetStateAction<UiMessage[] | null>>`.
  - Added a short header comment, matching the other hooks in the folder.
- `apps/web/src/routes/ChatView.tsx`: deleted both blocks and, right after the `forwarding` state, added `const { selectedIds, setSelectedIds, selection, forwardSelected } = useMessageSelection({ chatId: chat.id, storeApi, setForwarding });`. Added the hook import and dropped the now-unused `useMemo` import. No other line changed.
- No behaviour change; no new tests (UI code, per AGENTS.md).

### Checks run

- `pnpm install` from the repo root: `Done in 1m 6.2s using pnpm v10.32.1`.
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (7.0s)
  PASS  format  (2.7s)
  PASS  lint  (4.5s)
  PASS  typecheck  (13.6s)
  PASS  effect  (3.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No test file was run individually: the change is UI-only and `@zilar/web` has no test near these files, so the spec's "no new tests" applies.

### Notes for the lead

- `ChatView.tsx` went from 390 to 354 lines (spec expected "about 345"); the extra lines are the hook import plus the 5-line destructuring call at the top of the component. It is under the 400-line limit (gate `size` check passed).
- Nobody else's file was touched; the three changed files are the two allowed sources plus this task file.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal the hook's body apart from `chat.id` → `chatId` (three places); only the hook's header and `return` are new.
- **Result:** `ChatView.tsx` drops from 390 to 354 lines.
