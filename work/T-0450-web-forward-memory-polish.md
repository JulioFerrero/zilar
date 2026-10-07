---
id: T-0450
title: "Web polish: Forget a fact once per click (no false error); multi-select tests prove chat order and the chat-switch reset"
status: merged
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

### What I did
- **`AiMemorySection.tsx`**: added `forgettingId: string | null` state. `forget(factId)` now returns at once while any forget is in flight; the pending row's Forget button is `disabled={forgettingId === fact.id}`. A rejected delete is treated as success when it is an `ApiError` with `status === 404` (row removed, no error); any other failure still shows "Could not forget that fact" and keeps the row.
- **`AiMemorySection.test.tsx`**: added a `notFoundDelete` option to the fetch stub, plus two tests: a double click sends exactly one DELETE; a 404 on DELETE removes the row and shows no error line.
- **`ChatView.test.tsx`**: changed the order test to start select mode from `m-2` and then check `m-1`, so the forwarded picker must still receive `[m-1, m-2]` (chat order, not click order). Added "leaves select mode when the chat changes": select in `group`, `rerender(tree(dm))` shows no selection bar and no "Select message" checkbox, then `rerender(tree(group))` shows the same.

### Files changed
- `apps/web/src/components/ais/AiMemorySection.tsx`
- `apps/web/src/components/ais/AiMemorySection.test.tsx`
- `apps/web/src/routes/ChatView.test.tsx`
- `work/T-0450-web-forward-memory-polish.md` (status only)

### Commands and results
- `pnpm install`: done, 18.1s. (Pre-existing warn: `apps/mobile` `@types/react-dom` peer wants `@types/react@^19.3.0`, found `19.2.18`; untouched.)
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiMemorySection ChatView`: 2 files passed, 22 tests passed.
- `pnpm gate`: first run `FAIL format` on `AiMemorySection.tsx` and `AiMemorySection.test.tsx`; ran `pnpm exec prettier --write` on those two files, then re-ran gate:
  - `PASS install (frozen) (1.2s)`
  - `PASS format (20.6s)`
  - `PASS lint (1.1s)`
  - `PASS typecheck (12.7s)`
  - `PASS tests @zilar/web (33.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
- No deviations from the spec. Formatted my own two files after the first gate run reported format issues; no other checks were run separately.
- No other test broke.

### Open questions
- None.

## Review (written by Claude)

Approved (lead, 2026-10-07). Forget sends one request at a time (forgettingId, the row disabled while pending) and treats a 404 as success. The ChatView order test now selects out of order, and a new test proves the chat switch leaves select mode. Nit accepted: other rows ignore clicks silently while one forget is pending.
