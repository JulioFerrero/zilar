---
id: T-1070
title: "Mock H2-4b + sweep (mobile): chat search runs on @zilar/mock-backend; delete contacts-mock, mock/directory and the mock/index chain once nothing imports them"
status: merged
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

### What I did

1. **Probed the mock backend first** (step 1). `lib/search-api.ts` exposes one
   method, `searchMessages`, which the derived contract client resolves to a
   single call: `GET /api/search?<query>` (`SearchGroup` endpoint `search` at
   `/search` with `prefix('/api')`, `packages/api-contract/src/search.ts:63-72`).
   I probed that path against `createMockBackend({ delayMs: 0 })`:

   | method | path | result |
   | --- | --- | --- |
   | GET | `/api/search?q=checkout` | `200`, `{ items: [...] }` |
   | GET | `/api/search?q=checkout&limit=5` | `200`, `{ items: [...] }` |
   | GET | `/api/search?q=checkout&chat=dev-team` | `200`, `{ items: [] }` |
   | GET | `/api/search?q=checkout&before=9999999999999` | `200`, `{ items: [...] }` |

   Every call got a `Response`, so I continued. The probe was a throwaway
   script under the approved temp dir
   (`$TMPDIR/opencode/probe-t1070.mts`), run with
   `pnpm --filter @zilar/devtools exec tsx <path>`; it was not committed.

2. **The switch** in `apps/mobile/src/components/chat/chat-search-results.tsx`:
   the mock branch now builds `createSearchApi(mockToken, mockFetch, API_URL)`.
   The `mockFetch` is loaded with the guarded `require('@/mock/backend')` inside
   the same build-time condition (`NODE_ENV === 'test' || EXPO_PUBLIC_ZILAR_MOCK === '1'`),
   matching `use-machines-api.ts` / `use-approvals-api.ts`, so a release build
   still leaves the mock out. `createMockSearchApi` was removed. **No test file
   depends on `createMockSearchApi`** (`grep -rn "createMockSearchApi" apps/mobile`
   matches nothing after the edit), so nothing else changed for tests.

3. **Deleted the dead files.** Grepped each module name across `apps/mobile`
   (`src`, `app`, `test`) including `require(` / `import(` forms before deleting.
   All importers of the `mock/index` chain were inside the deleted set:

   - `components/contacts/contacts-mock.ts`: `grep -rn "contacts-mock" apps/mobile/src` → no matches.
   - `mock/directory.ts`: `grep -rn "mock/directory\|['\"]\./directory"` → no matches.
   - `mock/search.ts`: only importer was `chat-search-results.tsx` (rewritten in step 2); `grep -rn "@/mock/search"` → no matches.
   - `mock/index.ts`: only importer `mock/search.ts` (deleted); no `@/mock` bare or `@/mock/index` importer.
   - `mock/chats.ts`, `mock/channel.ts`, `mock/messages.ts`, `mock/topics.ts`: only importer `mock/index.ts` (deleted).
   - `mock/voice.ts`: only importer `mock/messages.ts` (deleted); `lib/voice.ts` is a different file and imports nothing from the mock.

   Broader sweep `grep -rn "contacts-mock\|mock/directory\|mock/search\|mock/index\|mock/chats\|mock/channel\|mock/messages\|mock/topics\|mock/voice" --exclude-dir=node_modules apps/mobile`
   returned only two self-references in comments of the files being deleted
   (`mock/topics.ts:6`, `mock/voice.ts:4`).
   `grep -rn "createMockSearchApi\|mockChats\|mockMessagesByChat\|chatSeeds\|mockTopicChats\|mockChannelChats\|mockDemoVoice" --exclude-dir=node_modules apps/mobile`
   → no matches.

   Kept as required: `mock/gate.ts`, `mock/backend.ts`, `mock/uploader.ts`,
   `mock/load.ts`, `mock/drafts.ts`, `mock/time.ts`, `mock/dev-kit-screen.tsx`,
   and every still-imported mock (`gifs`, `stickers`, `attachments`, `profile`,
   `components/stickers/stickers-mock.ts`). `mock/drafts.ts` keeps importing
   `./time`, which is kept.

### Files changed

- `apps/mobile/src/components/chat/chat-search-results.tsx` (modified)
- `apps/mobile/src/components/contacts/contacts-mock.ts` (deleted)
- `apps/mobile/src/mock/directory.ts`, `search.ts`, `index.ts`, `chats.ts`,
  `channel.ts`, `messages.ts`, `topics.ts`, `voice.ts` (deleted)
- `work/T-1070-...md` (this file)

### Commands run

- `pnpm install` → done in 10.2s (only an unrelated peer-dependency warning for `@types/react-dom`).
- probe script (above) → 4/4 `200` responses.
- `grep` sweeps (above) → confirmed no live importers.
- `pnpm gate` → summary:

  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  No single test file was run separately: the change is UI code and a deletion
  of unreferenced mocks, and the gate reports no nearby test files. `git status
  --short` lists exactly the 11 changed files above.

### Deviations / notes

- None from the spec. No dependency added; no file outside the Allowed list touched.
- Step 2's condition is unchanged; only the mock branch body changed.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The switch:** `chat-search-results.tsx`'s mock branch builds `createSearchApi(mockToken, mockFetch, API_URL)`, behind a guarded `require('@/mock/backend')` inside the same build-time condition.
- **The deletions:** 9 files, no longer imported, 1,603 lines:
  - `components/contacts/contacts-mock.ts`;
  - `mock/directory.ts`;
  - the `mock/index` chain: `search`, `index`, `chats`, `channel`, `messages`, `topics` and `voice`.
- **The lead's phone smoke** (mock):
  - Chats › search finds the Dev team chat and, under Messages, Dev-1's review summary from Dev AI;
  - tapping the result opens the Dev AI chat;
  - Explore opens.
- **The follow-up (board):** the backend's `search` returns the whole message body as `snippet`, while the real server returns a `ts_headline` fragment. So in mock mode a long message fills the result row.
- **Check:** the gate passed.
