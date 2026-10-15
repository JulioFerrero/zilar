---
id: T-1474
title: "A new AI's chat leads the chat list: AI DM entries carry the AI's createdAt (contract, server, mock), and both apps' New AI insert sets it, so an empty new AI chat no longer sinks to the bottom"
status: merged
milestone: M5
branch: task/T-1474-new-ai-chat-leads-list
model: auto
effort: default
depends_on: [T-1472]
estimate: 0.2 day
---

# T-1474: A new AI chat leads the list

## Spec (written by Claude, do not edit)

### Why
On the emulator (main, mock, 2026-10-15), a just-created AI's chat ("Finch", no messages yet) sorted near the bottom of the chat list. Telegram puts a new chat on top.
- The client sorts by the last message, else by `createdAt` (`packages/chat-core/src/topics.ts:9-13`). A row with neither sorts last.
- T-1318 gave groups a `createdAt` for exactly this; AI DMs never got one.

### Facts (the lead read them on main, 2026-10-15)
- **`packages/api-contract/src/chats.ts`** (177 lines): `DmChatEntry` (`:39-70`) has no `createdAt`; `GroupChatEntry` has an optional one (`:101-107`).
- **`apps/server/src/chats/api.ts`** is **400 lines**.
  - The AI DM entries are built at `:188-201` from `listAis` (`apps/server/src/ais/queries.ts:9`, which returns `PublicAi` with `createdAt`).
  - Groups set `createdAt: group.createdAt.toISOString()` (`:225`).
- **The client already reads `createdAt` for any entry:** `packages/client-core/src/store/chat-rows.ts:200-209` (`summaryFor`, `createdAtOf(server.createdAt)`).
- **The New AI inserts build a `ChatSummary` without `createdAt`:**
  - web `apps/web/src/components/ais/NewAiDialog.tsx:25-35`;
  - mobile `apps/mobile/src/app/(tabs)/ais.tsx:184`, in `handleCreated`.
- **The mock** `createAi` adds the AI's chat with `addChat(data, { kind: 'dm', chatJid, title, isAi: true })` (`packages/mock-backend/src/domains/ais/routes.ts:110`, T-1470).

### What to build
1. **Contract:** `DmChatEntry` gains `createdAt: Schema.optional(Schema.String)`, documented as "for an AI DM, when the AI was created".
2. **Server:** each AI DM entry carries `createdAt: ai.createdAt`.
   - `api.ts` must not grow past 400: move the AI DM entry mapping (`:188-201`) into a small helper in a new file `apps/server/src/chats/ai-entries.ts` and call it.
   - Human DMs are unchanged.
3. **Both apps:** the New AI insert sets `createdAt: new Date(created.createdAt)` on the summary (web `NewAiDialog.tsx`, mobile `ais.tsx`).
4. **Mock:** the `addChat` call in `createAi` adds `createdAt: created.createdAt`.

### Tests
None new. The server chat and client-core tests must keep passing.

### Allowed files
- `packages/api-contract/src/chats.ts`
- `apps/server/src/chats/api.ts`, `apps/server/src/chats/ai-entries.ts`
- `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/mobile/src/app/(tabs)/ais.tsx`
- `packages/mock-backend/src/domains/ais/routes.ts`
- `apps/mobile/src/lib/chat-api-schemas.ts` (added by the lead after the emulator check)
- **Added by the lead for the mobile ordering trace:**
  - `apps/mobile/src/store/effects/history.ts`, `apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/lib/chat-list-cache.ts`;
  - one existing mobile store test file next to the cause (`apps/mobile/src/store/**/*.test.ts`);
  - `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/rows.ts`.
- `work/T-1474-new-ai-chat-leads-list.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- In mock on the emulator, a new AI chat sits at the top of the chat list.
- After the deploy, `/api/chats` lists AI DMs with a `createdAt`.

---

## Report (written by the worker when done)

### What I did
- **Contract** (`packages/api-contract/src/chats.ts`): added `createdAt: Schema.optional(Schema.String)` to `DmChatEntry`, documented as "for an AI DM, when the AI was created" (ISO). Optional, so older payloads still parse.
- **Server** (`apps/server/src/chats/ai-entries.ts`, new): added `aiDmEntries(ais, aiAvatars)`, which filters to active AIs and maps each to a DM entry. It now sets `createdAt: ai.createdAt.toISOString()`. `apps/server/src/chats/api.ts` calls the helper (`...aiDmEntries(ais, aiAvatars)`) instead of the old inline `.filter().map()`; human DMs and groups are untouched. `api.ts` stays inside the 400-line bar.
- **Web** (`apps/web/src/components/ais/NewAiDialog.tsx`): the New AI insert summary now sets `createdAt: new Date(created.createdAt)`.
- **Mobile** (`apps/mobile/src/app/(tabs)/ais.tsx`): `handleCreated` summary now sets `createdAt: new Date(ai.createdAt)`.
- **Mock** (`packages/mock-backend/src/domains/ais/routes.ts`): the `createAi` `addChat` call now passes `createdAt: created.createdAt`.
- **Mobile ordering fix** (`apps/mobile/src/lib/chat-list.ts`): the row comparator sorted with `timeOf(right) - timeOf(left)`; two rows with neither a message nor a `createdAt` both sort at `-Infinity`, and `-Infinity - -Infinity` is `NaN`, making the comparator inconsistent so Hermes misplaced the new AI row. Replaced the subtraction with an explicit NaN-safe comparison. Added a store test.
- **Mobile store test** (`apps/mobile/src/store/real-store.lifecycle.test.ts`): boots two rows with no time (a DM and an empty group) plus the new AI DM whose `createdAt` is newer than everything, and asserts the AI row leads the list.

### Files changed
- `packages/api-contract/src/chats.ts`
- `apps/server/src/chats/api.ts`, `apps/server/src/chats/ai-entries.ts` (new)
- `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/mobile/src/app/(tabs)/ais.tsx`
- `packages/mock-backend/src/domains/ais/routes.ts`
- `apps/mobile/src/lib/chat-list.ts`
- `apps/mobile/src/store/real-store.lifecycle.test.ts`
- `work/T-1474-new-ai-chat-leads-list.md`

All inside the Allowed files (gate confirms: "scope: every changed file is inside the Allowed files").

### Commands and real results
- `pnpm install` — done in 11.3s, 1137 packages, one pre-existing peer-dependency warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18), unrelated to this task.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats` — **7 files passed, 25 tests passed**. (Ran the worker-capped form AGENTS.md requires instead of the task's bare `vitest run`, same test files.)
- `pnpm gate` (from repo root) — summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (12.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Follow-up rounds (the lead's emulator checks):
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot real-store.lifecycle` — **1 file passed, 9 tests passed** (includes the new T-1474 ordering test).
- I also confirmed the new test passes against the pre-fix `chat-list.ts` (stashed just that file): **9 passed** — i.e. it does not fail on the old comparator under node/V8 (see the honesty note above).
- Final `pnpm gate` (from repo root, all rounds' changes) — summary lines:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (12.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations from the spec
- The spec says the server sets `createdAt: ai.createdAt`. On the server `PublicAi.createdAt` is a `Date` (`apps/server/src/ais/persona.ts:47`), while the contract field is an ISO string, so I used `ai.createdAt.toISOString()`, matching how groups do it (`api.ts` group entries). No behaviour change from the intent.

### Problems / concerns
- Emulator follow-up 1 (lead): mobile stripped `createdAt` because `DmEntrySchema` in `apps/mobile/src/lib/chat-api-schemas.ts` lacked it, so a new AI still sorted last; added `createdAt: Schema.optional(Schema.String)` there (T-1474).
- Emulator follow-up 2 (lead hint) — the cause: `apps/mobile/src/lib/chat-list.ts:72` returned `timeOf(right) - timeOf(left)`. Two rows with no message and no `createdAt` both have time `-Infinity`, so `-Infinity - -Infinity` is `NaN`; that compare result makes the sort inconsistent and Hermes then misplaced the new AI row (the schema/store/refresh path was already correct — a store test through `parseChatsList` with a finite `createdAt` sorted the AI row first). Fixed with an explicit `leftTime === rightTime ? 0 : (rightTime > leftTime ? 1 : -1)`.
  - Honesty note on the test: on node/V8 the old comparator still ordered the rows correctly (per the ECMAScript sort rule a `NaN` compare result is read as `+0`), so the added test does not fail against the old code under `pnpm gate`; the misplacement the lead saw is Hermes-specific. The test still pins the scenario the fix targets.
- New test: one store test (allowed here — the chat list is part of the message pipeline). No dependencies added.

### Open questions
- None.

### Acceptance notes
- Gate passes and nothing outside scope changed.
- The emulator/`/api/chats` acceptance checks are the lead's and Julio's to run; I did not run the app on the emulator.

### Round (2026-10-15) — PREREVIEW
- **Fixed finding 1 (must-fix)**: `apps/mobile/src/lib/chat-list-cache.ts`'s read path rehydrated only `lastMessage.createdAt`, so a cached row's own `createdAt` (and `pinnedAt`) came back from JSON as an ISO **string**; the list comparator then called `.getTime()` on it and threw on the first cold start after an AI chat reached the cache. Added `parseCachedDate` and rehydrate `createdAt`/`pinnedAt` in the map, mirroring `lastMessage`. An absent or unparsable value is dropped.
- **Test**: added `a cold start rehydrates a cached row created time, so a new AI chat leads (T-1474)` to the existing `apps/mobile/src/store/real-store.lifecycle.test.ts` (allowed: store test next to the cause). It seeds the cache file with an AI row whose `createdAt` is a JSON string (via a mocked `expo-file-system/legacy`), reads it back through `readChatListCache`, and asserts it is a `Date` and sorts first through `chatListModel`/`chatSortTime`. Verified it **fails** on the pre-fix read path (`AssertionError: expected '2026-09-28T11:59:00Z' to be an instance of Date`) and passes with the fix — unlike the earlier ordering test, this one is a real guard.
- **Nits 2 and 3 not touched**: the instruction allows nits only in lines this round already changes; neither the old ordering test's comment (finding 2) nor `packages/client-core/src/store/rows.ts` / `packages/chat-core/src/topics.ts` (finding 3) is such a line. No disagreement with them.
- **Single test run**: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts` — **1 file passed, 10 tests passed**.
- **`pnpm gate`** (from repo root) — summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.7s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (13.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Disagreements
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round, nit 3, follow-up 1.
- **Emulator, mock, build `b129def05`:** DeepSeek → key → Heron → Create, then the chat list. Heron leads, right under the contact requests (before the fix it sat near the bottom).
- **The mobile cause:** the NaN comparator at `chat-list.ts:72`. Hermes misorders where V8 hides it.
- **Cold start after backgrounding:** no `TypeError` in logcat, and the list paints. The round-1 must-fix (cache `createdAt` and `pinnedAt` rehydration) holds.
- **Web:** checked headless earlier; Heron leads the DMs.
- **Nits:**
  - nit 2's `chatGroups.ts` comparator is already fixed on main (T-1476), and the others fall back through `||`;
  - the follow-up (the web cache twin) is T-1479, merged and live.
