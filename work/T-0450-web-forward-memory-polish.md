---
id: T-0450
title: "Web polish: Forget a fact once per click (no false error); multi-select tests prove chat order and the chat-switch reset"
status: todo
milestone: M5
branch: task/T-0450-web-forward-memory-polish
model: auto
effort: low
depends_on: [T-0439, T-0447]
estimate: 0.15 day
---

# T-0450: web polish (memory Forget, multi-select tests)

## Spec (written by Claude, do not edit)

### Why
These are the pre-review nits of T-0443 and T-0439, kept for one small pass.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ais/AiMemorySection.tsx:74-87`:** `forget(factId)` has no pending guard. A double click sends two DELETEs; the second answers 404 and shows "Could not forget that fact", even though the fact is gone.
- **`apps/web/src/routes/ChatView.test.tsx`:**
  - the test "selects several messages and forwards them in chat order" (line 132) selects `m-1`, then `m-2`, which is already chat order, so the ordering in `ChatView` is never proven;
  - no test covers leaving select mode on a chat switch. `ChatView.tsx:70-71` resets with the `selectionChatId` pattern.
  - The panel reset test at lines 64-75 shows the `rerender(tree(dm))` pattern.

### What to build
1. **`AiMemorySection.tsx`:**
   - keep a `forgettingId: string | null` state. While a forget is pending, that row's Forget button is `disabled` and a second call for any fact returns at once;
   - **a 404 answer counts as success:** remove the row and show no error. The web `request` throws an error carrying the HTTP status; read `apps/web/src/lib/api.ts` around line 191 for its shape.
2. **`AiMemorySection.test.tsx`:**
   - a double click sends one DELETE;
   - a 404 on DELETE removes the row without the error line.
3. **`ChatView.test.tsx`:**
   - change the order test to start select mode from `m-2` and then check `m-1`; the picker must still get `[m-1, m-2]`;
   - add "leaves select mode when the chat changes": start select mode in `group`, `rerender(tree(dm))`, and assert that no "selected" bar and no "Select message" checkbox remain; then `rerender(tree(group))` and assert the same.

### Read first
`AGENTS.md`, `apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ais/AiMemorySection.test.tsx`, `apps/web/src/lib/api.ts:185-240`, `apps/web/src/routes/ChatView.tsx:60-80`, `apps/web/src/routes/ChatView.test.tsx:1-185`.

### Allowed files
`apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ais/AiMemorySection.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0450-web-forward-memory-polish.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiMemorySection ChatView
pnpm gate
```

### Acceptance
- Forget sends one request per fact and never shows a false error.
- The two ChatView tests prove chat order and the chat-switch reset.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
