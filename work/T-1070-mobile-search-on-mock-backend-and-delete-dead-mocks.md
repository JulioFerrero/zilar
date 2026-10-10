---
id: T-1070
title: "Mock H2-4b + sweep (mobile): chat search runs on @zilar/mock-backend; delete contacts-mock, mock/directory and the mock/index chain once nothing imports them"
status: todo
milestone: M5
branch: task/T-1070-mobile-search-on-mock-backend-and-delete-dead-mocks
model: auto
effort: default
depends_on: [T-1069]
estimate: 0.25 day
---

# T-1070: Mobile search on the shared mock backend, and the dead mocks

## Spec (written by Claude, do not edit)

### Why
The lead checked with grep on main (2026-10-11):
- **Already dead after T-1069:** `apps/mobile/src/components/contacts/contacts-mock.ts` (337 lines) and `apps/mobile/src/mock/directory.ts` (116) have no importers.
- **The last live user of the old `mock/index` chain** is `apps/mobile/src/components/chat/chat-search-results.tsx:66-72`. It builds `createMockSearchApi()` from `mock/search.ts` (152 lines) when `NODE_ENV === 'test'` or `EXPO_PUBLIC_ZILAR_MOCK === '1'`.
- **The chain:** `mock/search.ts` imports `mock/index.ts` (30), which imports `mock/chats.ts` (113), `mock/channel.ts` (200), `mock/messages.ts` (258) and `mock/topics.ts` (374). `mock/messages.ts` imports `mock/voice.ts` (23).
- **The factory takes a fetch:** `createSearchApi(getToken, fetchImpl, apiUrl)` (`apps/mobile/src/lib/search-api.ts:54-57`), and the backend has a `search` domain.
- **The pattern:** `mockToken` comes from `@/mock/gate`, and `mockFetch` from a guarded `require('@/mock/backend')`, as in `apps/mobile/src/components/machines/use-machines-api.ts`.

### What to build
1. **Probe first.** List every method and path `lib/search-api.ts` calls, and probe each one against `createMockBackend({ delayMs: 0 }).http(path, init)` with a throwaway script, not committed. If any call gets no `Response`, stop after step 4 and report.
2. **The switch:** in `chat-search-results.tsx`, the mock branch builds `createSearchApi(mockToken, mockFetch, API_URL)`.
   - Load `mockFetch` with the guarded `require` inside the same build-time condition, so release builds still leave the mock out.
   - Keep the condition itself as it is. If a test file depends on `createMockSearchApi`, say so and keep that test working.
3. **Delete the dead files.** Before deleting each one, `grep -rn` its module name across `apps/mobile` (`src`, `app`, `test`), including `require(` / `import(` forms. Delete it only when nothing outside the files being deleted imports it. Note that `lib/` has its own `./voice`, `./gifs` and `./topics` modules, which are different files. The candidates:
   - `components/contacts/contacts-mock.ts` and `mock/directory.ts`;
   - after step 2: `mock/search.ts`, `mock/index.ts`, `mock/chats.ts`, `mock/channel.ts`, `mock/messages.ts`, `mock/topics.ts` and `mock/voice.ts`.
4. **Keep:** `mock/gate.ts`, `mock/backend.ts`, `mock/uploader.ts`, `mock/load.ts`, `mock/drafts.ts`, `mock/time.ts`, `mock/dev-kit-screen.tsx`, and every mock still imported, such as `mock/gifs.ts`, `mock/stickers.ts`, `mock/attachments.ts`, `mock/profile.ts` and `components/stickers/stickers-mock.ts`.
5. **No other change.** If typecheck or lint fails because of a deletion, restore that file and report it.

The lead runs a phone smoke in mock mode: Chats › search for "checkout", open a result, and open Explore.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/chat-search-results.tsx`, `apps/mobile/src/lib/search-api.ts`, `apps/mobile/src/components/machines/use-machines-api.ts`, and `apps/mobile/src/mock/`.

### Allowed files
`apps/mobile/src/components/chat/chat-search-results.tsx`, `apps/mobile/src/components/contacts/contacts-mock.ts`, `apps/mobile/src/mock/directory.ts`, `apps/mobile/src/mock/search.ts`, `apps/mobile/src/mock/index.ts`, `apps/mobile/src/mock/chats.ts`, `apps/mobile/src/mock/channel.ts`, `apps/mobile/src/mock/messages.ts`, `apps/mobile/src/mock/topics.ts`, `apps/mobile/src/mock/voice.ts`, `work/T-1070-mobile-search-on-mock-backend-and-delete-dead-mocks.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe table and the grep for each deleted file.

---

## Report (written by the worker when done)

## Review (written by Claude)
