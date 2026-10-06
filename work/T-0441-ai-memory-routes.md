---
id: T-0441
title: "AI memory M4a (server): GET /api/ai-memory, delete a fact, clear memory; DM owner only, room members view, AI owner and room managers change"
status: todo
milestone: M5
branch: task/T-0441-ai-memory-routes
model: auto
effort: low
depends_on: [T-0438]
estimate: 0.4 day
---

# T-0441: AI memory routes

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.6 (M4, first part). People must be able to see what an AI remembers in a chat, delete one pinned fact, and clear the memory. **No schema change, no UI, no gateway change.** Cleanup when an AI leaves a room is the next task.

### Verified facts (do not re-derive)
- **The memory keys** used by the gateway:
  - a DM is `dm:<owner bare JID, lowercase>`; the owner's JID is `jidFor(localpartFor(ownerId), domain)` (`apps/server/src/agents/gateway.ts:1685-1686` and `:1720`);
  - a room is `room:<room JID>` (`gateway.ts:1432`).
- **`apps/server/src/agents/memory/store.ts`:**
  - `listFacts(db, aiId, chatKey)` returns `{ id, text }[]` (line 339);
  - `renderMemoryBlock(db, aiId, chatKey)` returns `string[]` (line 229);
  - `deleteFact(db, aiId, chatKey, factId)` returns `boolean` (line 416);
  - `clearMemory(db, aiId, chatKey)` (line 516).
- **`apps/server/src/pins/access.ts`:**
  - `resolvePinChat(db, { chatJid, userId, domain, mucDomain })` (line 38). For a room it returns `{ kind: 'room', chatJid: <bare lowercase room JID>, topic }`. For a chat the caller may not see, or a malformed JID, it throws a 404 (`toMissingChat`, line 12).
- **`apps/server/src/topics/access.ts`:** `canManageTopic(db, topic, userId)` (line 206) is true for the topic creator or a group owner or admin who can see the topic.
- **Routes:**
  - the shape to copy is `apps/server/src/pins/routes.ts`: `requireSession`, zod, `HttpError`;
  - mounting: `app.route('/api', createPinsRoutes({ auth, db, config, audit: auditRecorder }))` at `apps/server/src/app.ts:354`, imported at line 39.
- **Tests:**
  - `apps/server/src/pins/pins.test.ts` shows `createTestContext`, `testApp`, sign-up with cookies, and `createGroup` and `createTopic` helpers (lines 34-99);
  - `apps/server/src/search/search.test.ts:590-613` inserts a provider connection and an `ais` row directly.

### What to build
1. **New `apps/server/src/agents/memory/routes.ts`:** `createAiMemoryRoutes({ auth, db, config })` returns a Hono app.
   - **One shared resolver** `resolveMemoryChat(db, config, userId, chat, aiId)` returns `{ aiId, chatKey, canChange }` or throws `HttpError(404, 'not_found', 'Chat not found')`:
     - **Unknown AI:** an `aiId` with no `ais` row gives 404.
     - **DM:** the chat's host is `config.xmpp.domain` (case-insensitive).
       - It is allowed only when the caller owns the AI (`ais.owner = userId`) and `chat` equals the AI's `jid` (case-insensitive); anything else gives 404.
       - `chatKey` = `dm:${jidFor(localpartFor(userId), config.xmpp.domain).toLowerCase()}`.
       - `canChange` = true.
     - **Room:** the chat's host is `config.xmpp.mucDomain`.
       - `resolvePinChat` gives the topic (it throws the 404 for a stranger).
       - `chatKey` = `room:${resolved.chatJid}`.
       - `canChange` = the caller owns the AI, or `canManageTopic(db, topic, userId)`.
     - **Any other host:** 404.
   - **`GET /ai-memory?chat=<jid>&ai=<aiId>`:**
     - zod-validate both: strings of 1-256 characters, strict;
     - answer `{ facts: { id, text }[], lines: string[], canChange: boolean }` from `listFacts` and `renderMemoryBlock`.
   - **`DELETE /ai-memory/facts/:id?chat=<jid>&ai=<aiId>`:**
     - resolve the chat;
     - `!canChange` gives `HttpError(403, 'forbidden', 'Only the AI owner or a room admin can change this memory')`;
     - `deleteFact` false gives `HttpError(404, 'not_found', 'Fact not found')`;
     - otherwise answer `{ ok: true }`.
   - **`POST /ai-memory/clear`**, JSON body `{ chat, ai }` (strict zod):
     - resolve the chat, apply the same 403, then `clearMemory`;
     - answer `{ ok: true }`.
   - **Never** log fact or memory text.
2. **`apps/server/src/app.ts`:** import it and mount `app.route('/api', createAiMemoryRoutes({ auth, db, config }))` next to the pins routes.
3. **New `apps/server/src/agents/memory/routes.test.ts`:**
   - **DM:**
     - the owner GETs facts (seed `aiMemoryFacts` rows directly) and the lines;
     - another signed-in user gets 404 for the same `chat` and `ai`, and so does the owner with a different `chat`;
     - the owner deletes a fact; deleting it again gives 404;
     - clear removes the facts and sets `aiMemoryState.floorSeq` (seed 3 `aiMemoryMessages` rows first, so it becomes 3).
   - **Room** (a group with an admin, a plain member and the AI's owner as a member):
     - the plain member GETs with `canChange: false`, and DELETE and clear give 403;
     - the admin can delete and clear;
     - the AI owner (a plain member) can clear;
     - a non-member gets 404;
     - a private topic's room gives 404 to a group member who is not in the topic.
   - **Validation:** a missing `ai` or an unknown `ai` gives 400 or 404, and a fact of another AI cannot be deleted through this AI (404).
   - **Signed out:** 401.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.6, `apps/server/src/agents/memory/store.ts:229-254` and `:338-543`, `apps/server/src/pins/access.ts:1-70`, `apps/server/src/pins/routes.ts`, `apps/server/src/topics/access.ts:112-135` and `:203-225`, `apps/server/src/app.ts:350-356`, `apps/server/src/pins/pins.test.ts:1-100`, `apps/server/src/search/search.test.ts:585-615`.

### Allowed files
`apps/server/src/agents/memory/routes.ts`, `apps/server/src/agents/memory/routes.test.ts`, `apps/server/src/app.ts`, `work/T-0441-ai-memory-routes.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/routes
pnpm gate
```

### Acceptance
- A DM's memory is visible to and changeable by the AI's owner only.
- A room's memory is visible to everyone who can see the room, and changeable by the AI owner and the topic managers.
- Everyone else gets 404 (or 403 for a member who may only view).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
