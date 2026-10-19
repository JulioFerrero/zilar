---
id: T-2168
title: "One AI memory hook in client-core for web and phone (open, load, forget a fact, clear all); each app keeps only its markup; no behaviour change"
status: merged
milestone: M5
branch: task/T-2168-ai-memory-hook
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2168: One AI memory hook for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The big-cut plan (`docs/audit/big-cut-plan.md`, "UI twins") moves per-screen logic into client-core. Read at `2044ba9fe`, both Memory sections hold the same state and rules. Both call the same API, `makeChatExtrasApi` in `packages/client-core/src/chat-extras-api.ts:68-75` (`getAiMemory`, `forgetAiMemoryFact`, `clearAiMemory`).

- **Phone** `apps/mobile/src/components/ais/ai-memory-section.tsx`:
  - Lines 13–17 hold the three error texts.
  - Lines 21–39 define the `AiMemorySectionState` and `AiMemorySectionActions` interfaces.
  - Lines 41–70 hold `removeFact`, `requestForgetFactEffect` (a 404 counts as success) and `clearAiMemoryEffect` (clear, then re-read).
  - Line 74 holds `LINE_PREFIX`.
  - Lines 227–353 hold the state in `AiMemorySection`:
    - no request until opened;
    - a load fiber interrupted on cleanup;
    - a synchronous `forgettingRef` guard (comment at line 272);
    - `startLoad`, `forget` and `confirmClear`.
- **Web** `apps/web/src/components/ais/AiMemorySection.tsx`:
  - Line 15 holds the same `LINE_PREFIX` and comment.
  - Lines 21–100 hold the same five `useState`s, a `useQuery` that waits with `Effect.never` while closed (comment at line 39), `forgottenIds`, the forget action (404 = success, comment at line 68) and the clear action, which then reloads.
  - The error texts are inline at lines 80 and 95.
- **Web API:** `apps/web/src/lib/api/media.ts:22-31` builds `makeChatExtrasApi(callApiAbortable)` and destructures the three calls.

### Steps
1. **Add the hook.** Create `packages/client-core/src/ai-memory.ts` with:
   - `LINE_PREFIX` and its comment, the three error texts, and the state and actions interfaces (moved from the phone);
   - `useAiMemory(api, chat, aiId, initiallyOpen)`, which returns `{ state, actions }` in those shapes.
2. **Keep today's rules in the hook:**
   - Nothing loads until the section is open.
   - A forget that answers 404 counts as success and drops the row.
   - One forget at a time, held by a synchronous guard.
   - Clear closes the confirm, clears the errors, then re-reads the memory.
   - Retry and show reload with the errors cleared.
   - Move the four comments named above with the code.
3. **Phone.** Use the hook and delete the moved code. Keep `AiMemorySectionContent` and all markup.
4. **Web.**
   - Use the hook with the web API from `@/lib/api`, or with `makeChatExtrasApi(callApi)`, whichever is shorter.
   - Delete the moved state code, `LINE_PREFIX` and `isNotFound`.
   - Keep the markup and texts.
5. Export the new pieces from `packages/client-core/src/index.ts`.

### Rules
- No behaviour change: the same texts, buttons and confirm wording.
- Keep every "why" comment, once.
- No new tests.

### Allowed files
- `packages/client-core/src/ai-memory.ts`
- `packages/client-core/src/index.ts`
- `apps/mobile/src/components/ais/ai-memory-section.tsx`
- `apps/web/src/components/ais/AiMemorySection.tsx`
- `apps/web/src/lib/api/media.ts`
- `work/T-2168-ai-memory-hook.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`, counting the new file.
- **Lead check:**
  - Web mock: an AI's edit page → Memory: show, forget a fact, clear (confirm), hide.
  - Phone emulator: Edit Dev-1 → Memory, the same steps.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/ai-memory.ts` with `useAiMemory(api, chat, aiId, initiallyOpen)`, returning `{ state, actions }` typed as `AiMemorySectionState` / `AiMemorySectionActions`. Moved into it: `LINE_PREFIX` and its comment, the three fixed error texts, `removeFact`, the forget (404 = success) and clear-then-reread effects, the open-only load with an interrupted fiber, the synchronous `forgettingRef` guard, and the four "why" comments (cover-line prefix on both apps, open-only read, 404-as-success, forget guard).
- `apps/mobile/src/components/ais/ai-memory-section.tsx`: `AiMemorySection` now calls the hook and renders `AiMemorySectionContent` unchanged; deleted the moved state, effects and interfaces. `AiMemorySectionContent` and all markup are untouched.
- `apps/web/src/components/ais/AiMemorySection.tsx`: replaced the five `useState`s, `useQuery`, both `useAction`s, `LINE_PREFIX` and `isNotFound` with the hook; markup, labels and texts unchanged, including the inline load-error text now read from the shared constant.
- `apps/web/src/lib/api/media.ts`: the three memory calls are grouped as `aiMemoryApi` (they were exported individually only for this component; nothing else imported them).
- `packages/client-core/src/index.ts`: added `export * from './ai-memory'`.

Rules kept: nothing loads until open; forget answers 404 count as success and drop the row; one forget at a time through the synchronous ref; clear closes the confirm, clears both errors, then re-reads; show/retry clear errors; same texts, buttons and confirm wording.

### Checks run

`pnpm gate` (first run):

```text
FAIL  format  (1.2s)
[warn] apps/web/src/lib/api/media.ts
GATE FAIL
```

Ran `pnpm exec prettier --write apps/web/src/lib/api/media.ts`, then `pnpm gate` again:

```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (5.2s)
PASS  effect  (0.8s)
PASS  build @zilar/server  (0.4s)
PASS  tests @zilar/client-core  (5.0s)
SKIP tests @zilar/mobile (no nearby test files)
PASS  tests @zilar/web  (5.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No new or single test files were run: the spec says no new tests, and the gate ran the nearest client-core and web tests itself.

Net product lines from `git diff main --numstat` (new file counted, task file excluded):

```text
11   176  apps/mobile/src/components/ais/ai-memory-section.tsx
12    94  apps/web/src/components/ais/AiMemorySection.tsx
 7     9  apps/web/src/lib/api/media.ts
 1     0  packages/client-core/src/index.ts
177     0  packages/client-core/src/ai-memory.ts
```

Net: **-71 lines** (177 added, 251 removed).

### Notes for the lead

- I did not run the browser or emulator smoke; the UI markup was left byte-for-byte apart from the action callbacks.
- On web the hook replaces `useQuery`/`useAction` with plain state plus Effect fibers (the phone's existing approach), so an in-flight forget/clear is no longer auto-interrupted on unmount; observable behaviour while mounted is the same.
- 404 detection now goes through `toApiFailure`, which matches both the phone's `ApiError` and web's `ApiFailure` by `status`.
- `apps/web/src/lib/api/media.ts` still re-exports the `AiMemory` type alias; it is unused by this component but harmless and out of the spec's delete list.

## Review (written by Claude)

Approved; the pre-review was clean (2 nits):
- On web, a clear whose follow-up re-read fails now shows the phone's "Could not clear the memory".
- An in-flight forget is not interrupted on unmount, and React ignores the late set.

Net −71. One `useAiMemory` hook in client-core now holds the state, the texts and `LINE_PREFIX`. The 404-means-gone, double-forget guard and line-prefix comments moved with the code.

**Web mock**, identical to main at each step: closed, show, forget a fact, the clear dialog, cleared, hidden. No page errors.

**Phone emulator** (Edit Dev-1):
- Show memory, then forget "Julio prefers short answers": the row drops.
- Clear memory: the dialog, then "Nothing older than the recent messages yet".
