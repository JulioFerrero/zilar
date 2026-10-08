---
id: T-0551
title: "Effect lane E, batch 7: mobile topics-api and chat-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports (parseTopic and friends stay), same errors, tests unchanged"
status: todo
milestone: M5
branch: task/T-0551-effect-mobile-api-batch-7
model: auto
effort: low
depends_on: [T-0547]
estimate: 1 day
---

# T-0551: mobile API clients batch 7 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase moves to Effect 4, mobile included.
- **Recipe:** `apps/mobile/src/lib/pins-api.ts` (T-0506) and `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect".
- **Recent examples:** `apps/mobile/src/lib/profile-api.ts` (T-0541) and `apps/mobile/src/lib/ais-api.ts` (T-0547).
- **Shared lenient error envelope:** `apps/mobile/src/lib/api-error-body.ts`. Use it; never write a local `ErrorBodySchema`.

`chat-api.ts` reads topics from the chats list, so the two files move together.

### Verified facts (do not re-derive)
These files validate by hand today. **Every export stays the same.**
- **`apps/mobile/src/lib/topics-api.ts`** (508 lines):
  - `TopicsApiError` (line 109) and `createTopicsApi` (341);
  - **these exported parsers keep their signatures and results:**
    - `parseTopicKind(value)` (135), `parseTopicStatus(value)` (149) and `parseTopicVisibility(value)` (163). These map unknown values to a default; keep the same defaults;
    - `parseTopic(value): Topic | null` (209);
    - `chatEntryTopics(entry): Topic[]` (293);
  - `glyphForTopicName` (505) is pure and stays as it is.
- **`apps/mobile/src/lib/chat-api.ts`** (439 lines): `ChatApiError` (102) and `createChatApi` (380), plus the exported types.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{chat-api,chat-api.topics,topics-api,topics}.test.ts`;
  - `apps/mobile/src/components/chat/{chat-list-item,message-list,new-group-sheet,new-topic-sheet,topic-row}.test.tsx`;
  - every `apps/mobile/src/store/*.test.ts`. The real store runs these clients, so this is the main proof.

### What to build
1. **Convert both files with the recipe** and the shared envelope:
   - the same exported names, types and signatures;
   - the same tolerance. The chats list is the app's home screen: one malformed chat or topic entry is dropped or defaulted **exactly** as today, and never fails the whole list unless it does today;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   The `parse*` exports become thin wrappers over schema decodes, with the same defaults.
2. **Tests:** every existing test passes **unchanged**. You may add one new `*.effect.test.ts` per client.
3. **In the Report,** list each place where the hand validator dropped or defaulted a value, and the schema construct that now does it.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/api-error-body.ts`, `apps/mobile/src/lib/profile-api.ts`, then both files and their tests.

### Allowed files
- `apps/mobile/src/lib/topics-api.ts`, `apps/mobile/src/lib/chat-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/topics-api.effect.test.ts`, `apps/mobile/src/lib/chat-api.effect.test.ts`;
- `work/T-0551-effect-mobile-api-batch-7.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot chat-api topics chat-list-item message-list new-group-sheet new-topic-sheet topic-row src/store
pnpm gate
```

### Acceptance
- Both clients decode with Effect Schema and the shared envelope, and run as Effect pipelines, with the same exports, defaults and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
