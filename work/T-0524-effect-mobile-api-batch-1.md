---
id: T-0524
title: "Effect lane E, batch 1: mobile invites-api, chat-prefs-api, search-api and audit-api onto Effect Schema + the T-0506 request pipeline; same exports, same errors, tests unchanged"
status: todo
milestone: M5
branch: task/T-0524-effect-mobile-api-batch-1
model: auto
effort: low
depends_on: [T-0506]
estimate: 0.5 day
---

# T-0524: mobile API clients batch 1 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, mobile included. T-0506 converted `apps/mobile/src/lib/pins-api.ts` as **the recipe for the other `*-api.ts` files**. Read its header comment and its Report in `work/T-0506-effect-mobile-pins-api.md`. In short:
- the wire boundary is decoded with Effect Schema (`struct` from `@zilar/protocol`);
- lenient fields use `Schema.decodeTo` with a `SchemaGetter.transform`;
- the request is an Effect pipeline, cut back to a `Promise` at the edge with `Effect.runPromise`;
- the error class and its `status`/`code`/`message` stay the same.

This task applies the recipe to four small clients.

### Verified facts (do not re-derive)
Mobile validates these boundaries by hand today (no zod). The files, with their exports, which **all stay the same**:
- **`apps/mobile/src/lib/invites-api.ts`** (115 lines): `Invite`, `InvitesApi`, `InvitesApiError` and `createInvitesApi`.
- **`apps/mobile/src/lib/chat-prefs-api.ts`** (174 lines): `ChatPref`, `PutChatPrefInput`, `ChatPrefsApi`, `ChatPrefsApiError`, **`parseChatPref(value): ChatPref | null`** (imported elsewhere, so keep its signature and its null on a bad row) and `createChatPrefsApi`.
- **`apps/mobile/src/lib/search-api.ts`** (175 lines): `SearchMark`, `SearchItem`, `SearchPage`, `SearchMessagesInput`, `SearchApi`, `SearchApiError` and `createSearchApi`.
- **`apps/mobile/src/lib/audit-api.ts`** (199 lines): `AuditResult`, `AuditCost`, `PublicAuditEntry`, `AuditPage`, `AuditApi`, `AuditApiError`, `AUDIT_PAGE_LIMIT` and `createAuditApi`.
- **Each has a test next to it** (`*-api.test.ts`). Other tests that use them: `apps/mobile/src/store/real-store.prefs-pins.test.ts`, `apps/mobile/src/lib/chat-prefs.test.ts`, `apps/mobile/src/mock/search.test.ts` and `apps/mobile/src/components/chat/use-message-search.test.ts`.

### What to build
1. **Convert the four files with the T-0506 recipe:**
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   Keep `parseChatPref` as a thin wrapper over the schema, like `parsePin` in T-0506.
2. **Tests:** every existing test passes **unchanged**. You may add one `*-api.effect.test.ts` per file, as T-0506 did, for a lenient-field or whole-list case the old tests miss.
3. **No new dependencies** (`effect` is already in `apps/mobile/package.json`).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.effect.test.ts`, `work/T-0506-effect-mobile-pins-api.md` (its Report), then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/invites-api.ts`, `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/lib/search-api.ts`, `apps/mobile/src/lib/audit-api.ts`;
- the four matching new, optional test files: `apps/mobile/src/lib/invites-api.effect.test.ts`, `apps/mobile/src/lib/chat-prefs-api.effect.test.ts`, `apps/mobile/src/lib/search-api.effect.test.ts` and `apps/mobile/src/lib/audit-api.effect.test.ts`;
- `work/T-0524-effect-mobile-api-batch-1.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot invites-api chat-prefs search audit-api real-store.prefs-pins use-message-search
pnpm gate
```

### Acceptance
- The four clients decode with Effect Schema and run their requests as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
