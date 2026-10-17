---
id: T-1885
title: "Topic AIs carry their JID (TopicAi.jid, optional in the contract; listTopicAis + listGeneralAis select ais.jid) so the topic panel's AI rows open the AI on web (PersonLink) and phone (PersonPressable), like people rows already do"
status: merged
milestone: M5
branch: task/T-1885-topic-ai-links
model: auto
effort: default
depends_on: [T-1882]
estimate: 30 min
---

# T-1885: Topic AI rows open the AI

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17):** tapping a person's picture should open them everywhere. People rows in the topic panel and sheet already do (T-1851, T-1859), and group AI rows do too (T-1882). **Topic AI rows can't,** because the topic AI list carries no JID.

### Facts (read by the lead on 2026-10-17)
- **The contract:** `TopicAi` is `{ id, name, avatarUrl? }` (`packages/api-contract/src/topics.ts:171-178`).
- **The server:**
  - `listTopicAis` selects `a.id, a.name` from `topic_ais` joined to `ais` (`apps/server/src/topics/views.ts:162-181`);
  - `listGeneralAis` selects `a.id, a.name` from `group_ais` joined to `ais` (`apps/server/src/topics/general-ais.ts:12-31`);
  - the view type is `TopicAiView` (`apps/server/src/topics/types.ts:84-89`, re-exported via `topics/access.ts:243`);
  - the `ais` table has a `jid` column (the gateway reads `ai.jid`, e.g. `apps/server/src/agents/gateway/dm-turn.ts:262`).
- **Web:** `apps/web/src/components/panels/TopicAisSection.tsx` (142 lines). Each AI row draws `EntityAvatar person={{ id: ai.id, … }}` and the name (`:101-105`). `PersonLink` is in `apps/web/src/components/personLink.tsx:107`.
- **Phone:** `apps/mobile/src/components/chat/topic-info-sheet.tsx` (366 lines). The AI rows are at `:238-260` (a `View` with `EntityAvatar` and the name). `PersonPressable` (`apps/mobile/src/components/chat/person-pressable.tsx`) takes `className` since T-1882.

### Steps
1. **The contract:** add `jid: Schema.optional(Schema.String)` to `TopicAi`, with a T-1885 comment. It's optional so old servers and clients keep decoding.
2. **The server:**
   - `TopicAiView` gets `jid?: string`;
   - both queries select `a.jid` and pass it through;
   - `withAiAvatars` must keep the field. Read it and adjust it if it rebuilds objects.
3. **Web `TopicAisSection.tsx`:** when `ai.jid` is set, wrap the avatar and the name in `PersonLink target={{ jid: ai.jid }} name={ai.name} className="flex min-w-0 flex-1 items-center gap-2.5"`. Without a JID, render as today.
4. **Phone `topic-info-sheet.tsx`:** the same with `PersonPressable` and `className="min-w-0 flex-1 flex-row items-center gap-3"`. The owner label and ⋮ keys stay outside.
5. **No tests** (a read-only view field plus UI). If an existing test compares a full topic view object, update its expectation; that file then counts as allowed. Every file stays at most 400 lines.

### Allowed files
- `packages/api-contract/src/topics.ts`
- `apps/server/src/topics/types.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/general-ais.ts`
- `apps/web/src/components/panels/TopicAisSection.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/lib/topics-api.ts`
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/topic-rows.ts`
- `packages/mock-backend/src/domains/topics/view.ts`
- `packages/mock-backend/src/domains/topics/routes.ts`
- `work/T-1885-topic-ai-links.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Topic views list each AI with its JID.**
- **Clicking or tapping an AI row's avatar or name** in a topic's panel or sheet opens that AI's chat (your own AI) or nothing (someone else's AI with no chat). Rows look the same.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/topics.ts`): added optional `jid: Schema.optional(Schema.String)` to `TopicAi`, with a T-1885 comment, so old servers/clients keep decoding.
- **Server** (`apps/server/src/topics/types.ts`, `views.ts`, `general-ais.ts`): `TopicAiView` got `jid?: string`; `listTopicAis` and `listGeneralAis` now select `a.jid` and pass it through. `withAiAvatars` already spreads the row, so it keeps the field unchanged.
- **Web** (`apps/web/src/components/panels/TopicAisSection.tsx`): when `ai.jid` is set, the avatar and name are wrapped in `PersonLink target={{ jid: ai.jid }}` with `className="flex min-w-0 flex-1 items-center gap-2.5"`; the owner label and ⋮ menu stay outside. Without a JID the row renders exactly as before.
- **Phone** (`apps/mobile/src/components/chat/topic-info-sheet.tsx`): same with `PersonPressable` and `className="min-w-0 flex-1 flex-row items-center gap-3"`; the owner label and memory button stay outside. General-topic AI rows (built from `GroupDetail.ais`) now forward `ai.jid` too.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ais.test.ts src/topics/visible-batch.test.ts` → 2 files passed, 5 tests passed.
- `pnpm gate` (repo root) summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (1.2s)
  PASS  lint  (1.4s)
  PASS  typecheck  (12.3s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (2.6s)
  PASS  tests @zilar/server  (30.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round (fix round 1)

**Finding 1 (must-fix) fixed:** `loadTopicViewParts` in `apps/server/src/topics/views.ts` now selects `a.jid` alongside `a.id, a.name` and passes it through the row mapping, so every `TopicView.ais` (topic list, topic detail, `/api/chats`, and General views built from the same parts) carries `jid`. `listTopicAis` and `listGeneralAis` were already fixed and stay as they were.

- Files changed this round: `apps/server/src/topics/views.ts` only.
- Tests: none added or adjusted. The Spec's step 5 says "No tests" for this read-only field plus UI, and the Allowed files list contains no test path; the gate's scope check flags any changed file outside that list, so adding a test file would turn the gate red. I checked the existing topic tests that call `toTopicViews` (`public-reads.test.ts`): none asserts the `ais` rows or a full topic view object, so no expectation needed updating (consistent with the pre-review). Coverage of the new field stays with the lead's smoke and Julio's live check.
- Single tests run:
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/public-reads.test.ts src/topics/visible-batch.test.ts src/topics/ais.test.ts` → 3 files passed, 9 tests passed.
- `pnpm gate` (repo root) summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.0s)
  PASS  tests @zilar/server  (11.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Re-ran both after a session interruption: single tests → 3 files passed, 9 tests passed; `pnpm gate` → `GATE PASS` (7 changed files, scope clean, every source file within 400 lines). No further code change was needed.
- Disagreements: none. Follow-up F1 (`apps/mobile/src/lib/topics-api.ts` missing `jid?: string`) stays open for a later task, as before.

### Round (fix round 2)

- **Follow-up F1 fixed:** `apps/mobile/src/lib/topics-api.ts` now gives the port's `TopicAi` an optional `jid?: string`, and `topic-info-sheet.tsx` uses `const ais: TopicAi[]` instead of a local `TopicAi & { jid?: string }` widening; the comment says the rows carry the JID. The lead allowed `apps/mobile/src/lib/topics-api.ts` for this round, so it is added to the Allowed files above.
- Files changed this round: `apps/mobile/src/lib/topics-api.ts`, `apps/mobile/src/components/chat/topic-info-sheet.tsx`.
- No tests added or adjusted (type-only port change plus the sheet's existing UI path; the Spec's step 5 says "No tests").
- `pnpm gate` (repo root) summary:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.4s)
  PASS  tests @zilar/server  (10.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round (fix round 3)

- **Mock backend now matches the server:** `packages/mock-backend/src/domains/topics/view.ts` gives each topic view's `ais` row a `jid` via `source.aiJid(aiId)` (spread only when defined), and the GET `/topics/:id/ais` list in `packages/mock-backend/src/domains/topics/routes.ts` resolves `jid` from `data.ais` the same way. Mock mode can now show and open the AI links. Both files were lead-allowed and are added to the Allowed files above.
- Files changed this round: `packages/mock-backend/src/domains/topics/view.ts`, `packages/mock-backend/src/domains/topics/routes.ts`.
- No tests added or adjusted (mock seed/response shape change, no test file nearby; the gate reports `SKIP tests @zilar/mock-backend`).
- `pnpm gate` (repo root) summary, after adding both files to the Allowed list:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.3s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (12.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round (fix round 4)

- **Topic rows keep the AI JID:** `packages/chat-core/src/types.ts` gives `TopicInfoAi` an optional `jid?: string`, and `packages/client-core/src/store/topic-rows.ts` now passes `jid` through from the server's `TopicAi` (spread only when defined). Non-General rows in the phone sheet read from `chat.topic.ais`, so Dev-1 now has a JID there too and the row opens the AI. Both files were lead-allowed and are added to the Allowed files above.
- Files changed this round: `packages/chat-core/src/types.ts`, `packages/client-core/src/store/topic-rows.ts`.
- No tests adjusted: `@zilar/chat-core` and `@zilar/client-core` pass unchanged, so no test compared a whole topic row with `ais`.
- `pnpm gate` (repo root) summary, after adding both files to the Allowed list:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.5s)
  PASS  tests @zilar/client-core  (4.6s)
  PASS  tests @zilar/mobile  (1.5s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (9.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The phone port's `TopicAi` used to lack `jid`; fix round 2 added `jid?: string` to `apps/mobile/src/lib/topics-api.ts` (lead-allowed) and dropped the local widening in `topic-info-sheet.tsx`. F1 is closed.
- No tests were added (read-only view field plus UI, per the spec) and no existing test compared a full topic view object, so no expectations needed updating.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `ee7b20f70`. The NEEDS LEAD packets were stale: they predate the batch-query fix `0fe4bbbc4`.

**Three lead fix rounds:**
1. the phone port's `TopicAi` type gains `jid`;
2. the mock backend's topic views and `/topics/:id/ais` carry `jid`;
3. client-core `topic-rows.ts` kept dropping `jid` from `chat.topic.ais`. It's found only on the emulator: Ana opened but Dev-1 didn't.

**Checked:**
- **Emulator (mock build, Checkout topic sheet):** tapping Dev-1 opens the Dev-1 chat. Tapping Ana opens Ana. The rows look the same as on main.
- **Web mock** at 1440 px: in the topic panel, clicking Dev-1 opens the Dev-1 chat.

