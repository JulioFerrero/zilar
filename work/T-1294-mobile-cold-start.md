---
id: T-1294
title: "Mobile cold start: the chat list paints from a saved cache before /api/chats answers, and the root no longer blocks on every font (PERF-12); list images set a recyclingKey so a recycled row never flashes the previous image (PERF-15)"
status: todo
milestone: M5
branch: task/T-1294-mobile-cold-start
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1294: Mobile cold start and image recycling

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md`:
- **PERF-12** (P2, `:135`): on a cold start the root waits for five fonts (`apps/mobile/src/app/_layout.tsx`, `return null` until loaded). The store then boots with no chat-list cache: `apps/mobile/src/store/effects/lifecycle.ts` has `saveChatList: () => {}`, so the first list paint waits for `/api/chats`. Web paints from `apps/web/src/store/chatListCache.ts`.
- **PERF-15** (P3, `:151`): list images (`expo-image` in the message bubble content and the GIF cells) have no `recyclingKey`, so a recycled row briefly shows the previous image.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **The chat-list cache:**
   - implement mobile `saveChatList` and a load at boot, the same shape as web's cache (`apps/web/src/store/chatListCache.ts`), stored with the storage the app already uses for small data (cite it; no new dependency);
   - clear it on sign-out;
   - never store message bodies beyond the preview the web cache stores.
2. **Fonts:** render the app as soon as the primary text font is loaded (or after a 1 s cap). Secondary fonts load in the background. Cite which font is primary.
3. **PERF-15:** set `recyclingKey` to the message or image id on list images.
4. **No tests** (UI and boot).

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (`:135-155`), `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/store/effects/lifecycle.ts` and `apps/web/src/store/chatListCache.ts`.

### Allowed files
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/lib/*.ts`, `apps/mobile/src/components/chat/*.tsx`, `work/T-1294-mobile-cold-start.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** a second cold start shows the chat list at once.

---

## Report (written by the worker when done)

## Review (written by Claude)
