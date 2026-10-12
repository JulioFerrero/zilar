---
id: T-1238
title: "Delivered tick step 3a, clients: a connected app confirms delivery over HTTP (PUT /api/chats/:jid/delivered, newest origin id per chat, debounced) for live messages and for every chat-list refresh preview, and the sender's app applies deliveredUntil from /api/chats to its own messages (sent → delivered, never downgrading read)"
status: merged
milestone: M5
branch: task/T-1238-delivered-clients
model: auto
effort: default
depends_on: [T-1228, T-1229]
estimate: 0.5 day
---

# T-1238: Delivered tick, the client side (confirm and apply)

## Spec (written by Claude, do not edit)

### Why
Julio chose three ticks: sent, delivered and seen (`docs/plan/delivered-tick.md`, "Decisions"). Delivery is recorded on the server over HTTP and named by the **origin id**.
- **Done:** T-1228 added `'delivered'` to the status ladder, and T-1229 added the server part:
  - `markDelivered` = PUT `/chats/:jid/delivered` with `{ originIds }`, 1 to 50 ids (`packages/api-contract/src/chats.ts:122-141`);
  - `deliveredUntil` on every `/api/chats` row (`:52-56`, `:96-100`): an archive id in the caller's own-message terms.
- **Server behaviour this relies on:**
  - it keeps the max (`putChatDelivery`, `apps/server/src/chats/deliveries.ts:99-110`);
  - it **ignores the caller's own messages** (`isCallerRow` filter, `:91-93`), so confirming a chat's newest message is always safe, even when it's mine.
- **The missing part:** no app sends confirmations yet, and no app reads `deliveredUntil`.

### What to build
1. **Port:** add the optional `markChatDelivered?(jid: string, originIds: string[]): Promise<unknown>` to `packages/client-core/src/store/ports.ts`, next to `markChatRead` (`:49-53`). Implement it on web next to `markChatRead` (`apps/web/src/lib/api/chats.ts:87`), and on mobile next to `markChatRead` (`apps/mobile/src/lib/chat-api.ts:64,195`); both call `client.chats.markDelivered(...)`.
2. **The new `packages/client-core/src/store/delivered.ts`:**
   - **`confirmDelivered(ctx, chatId, originId)`:** debounced per chat at 1 s through `ctx.rt.forkKeyed('mark-delivered:'+chatId, …)`, the way `recordRead` debounces (`packages/client-core/src/store/reads.ts:55-70`). It collects the ids queued for that chat (at most 50, newest last), sends one call, and ignores errors.
   - **`applyDeliveredUntil(ctx, chatId, until)`:** for each of **my own** messages in `messagesByChat[chatId]` whose archive id is ≤ `until`, move the status to `'delivered'` through `advanceStatus` (`packages/client-core/src/store/rows.ts:50-62`), which never downgrades `read`.
     - Compare ids as decimal strings: length first, then lexicographic. **Never `BigInt`** (the T-1198 lesson).
     - The archive id of my own message is its `id` when numeric, else the archive id the ledger holds for it; find where the stanza-id of an own echo is recorded and cite it. A message with no known archive id is left as it is.
3. **Confirm on live arrival** (`packages/client-core/src/store/incoming.ts`, `handleMessage`): after the resend dedupe (`:126-132`), for a message that isn't outgoing and has an `originId` (`packages/xmpp-core/src/types.ts:52`), call `confirmDelivered(ctx, chatId, message.originId)`. This applies to DMs and groups, but not to AI-only DMs (the server ignores those anyway, so skip them to save calls when the chat row says `isAi`). Keep `incoming.ts` at most 400 lines.
4. **Confirm and apply on every chat-list refresh:** fresh `/api/chats` rows are merged with `mergeUnread` (`packages/client-core/src/store/chat-rows.ts:102`) in each app's store effects: web `apps/web/src/store/effects/history.ts:128-132` and mobile `apps/mobile/src/store/effects/history.ts:170-194`.
   - Put the per-row logic in one exported client-core helper in `delivered.ts`, and call it from both merge sites. Mobile `history.ts` is 388 lines, so add at most 3 lines there.
   - Find how those effects reach the ports and the store, and cite it.

   For each row:
   - if it has a `lastMessage`, call `confirmDelivered(ctx, row.id, lastMessage.id)`. The preview `id` is the origin id (`packages/api-contract/src/chats.ts:17-23`), and own messages are ignored by the server. This covers catch-up after reconnect, the app start and the push wake-up that refreshes the list;
   - if it has `deliveredUntil`, call `applyDeliveredUntil(ctx, row.id, deliveredUntil)`, and store `deliveredUntil` on the chat summary (add `deliveredUntil?: string` to `ChatSummary`, `packages/chat-core/src/types.ts`, and map it in `chat-rows.ts`). When a history page later loads my own messages, apply the stored mark to it too; find the one place pages are merged into `messagesByChat`, and keep `packages/client-core/src/store/history.ts` at most 400 lines (it's at 400 now, so put the call in `delivered.ts` or the merge helper, not in `history.ts`).
5. **Mock backend:** add the PUT delivered route to `packages/mock-backend/src/domains/chats/`, answering 204, so mock mode logs no errors.
6. **Tests** (message pipeline), in a new `packages/client-core/src/store/delivered.test.ts` following `incoming.test.ts` / `test-ctx.ts`, up to 4:
   - a live incoming message queues one confirmation with its origin id after the debounce, and two quick messages make one call with both ids;
   - an outgoing echo confirms nothing;
   - `applyDeliveredUntil` moves my `sent` messages at or below the mark to `delivered`, leaves `read` as `read`, and leaves later messages `sent`;
   - id compare: `'999'` < `'1000'`.

### Out of scope
- The live notice to the sender while both are online (step 3b). Until then, the sender sees delivered on the next chat-list refresh.
- The phone's push-wake confirmation (step 4).

### Read first
`AGENTS.md`, `docs/plan/delivered-tick.md` (Decisions, §4, §5, §9), `work/T-1229-delivered-server.md` (the Report and the Review), `packages/client-core/src/store/reads.ts`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/rows.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/ledger-ids.ts` and `packages/client-core/src/store/incoming.test.ts`.

### Allowed files
`apps/web/src/store/effects/ports.ts`, `apps/mobile/src/store/real-store.ts` (both added by the lead for the port wiring), `packages/client-core/src/store/delivered.ts`, `packages/client-core/src/store/delivered.test.ts`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/test-ctx.ts`, `packages/client-core/src/store/index.ts`, `packages/chat-core/src/types.ts`, `apps/web/src/store/effects/history.ts`, `apps/mobile/src/store/effects/history.ts`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/lib/api.ts`, `apps/mobile/src/lib/chat-api.ts`, `packages/mock-backend/src/domains/chats/**`, `work/T-1238-delivered-clients.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/delivered.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's check after deploy:** on Julio's web, `/api/chats` rows start carrying `deliveredUntil` once the other side's app has run this build (read-only fetch).

---

## Report (written by the worker when done)

**Status: review.** Done after the lead answered the round-1 blocker (see "Round 2"): the two port-wiring files were added to Allowed files and are now wired, and the history-page reading was accepted as a known gap.

### Round 2 (lead's answer)

Round 1 blocked because `confirmDelivered` sends through `ctx.ports.api.markChatDelivered` and neither app built that method into the object the core reads. The lead added both adapters to the Allowed files. Wired exactly as T-1207 wired `markChatRead`:

1. `apps/web/src/store/effects/ports.ts` — `markChatDelivered?` on `ApiClient` and `markChatDelivered: markChatDeliveredRequest` on `realApi`. The core reads `ctx.ports.api`, which is that very `realApi` (`storeContext.ts:94` passes the whole `PortsShape`), so confirmations now reach the server.
2. `apps/mobile/src/store/real-store.ts` — `markChatDelivered` on the `coreApi` literal (`:153-160`). Mobile's core reads `coreApi`, a separate object from `ports.api`, so the `chat-api.ts` implementation alone was not enough.

Both files stay under 400 lines (web `ports.ts` 365, mobile `real-store.ts` 355).

### Known gap (accepted by the lead)

The stored `deliveredUntil` is re-applied on every chat-list refresh by the shared `applyChatDelivery`, so an older history page that loads after the last refresh shows my own messages as `sent` until the next refresh (poll/focus/roster). Applying it at page-merge time would need client-core `history.ts` (at 400 lines, not in Allowed files), so `history.ts` stays untouched — the lead accepted this reading.

### What I built (all inside Allowed files)

- **`packages/client-core/src/store/delivered.ts`** (new): `confirmDelivered` (queues origin ids per chat in a `WeakMap<CoreCtx, …>` beside the state, one debounced 1 s HTTP call through `ctx.rt.forkKeyed` — the way `recordRead` debounces — at most 50 ids newest last, errors ignored); `applyDeliveredUntil` (my own messages at or below the mark go `sent -> delivered` through `advanceStatus`, so `read` never downgrades and a later message stays `sent`; decimal-string compare, **never `BigInt`**); `compareArchiveIds`; and `applyChatDelivery`, the shared per-row helper both merge sites call.
  - The archive id of an own message is its `id` when numeric, else the id the ledger linked when the own echo arrived (`linkLocalToServer`, `incoming.ts:46-47`), read back through the existing `ctx.k.wireTargetFor` (`ledger-ids.ts:146-153`). I used `wireTargetFor` because `ledger.ts` is not in Allowed files and cannot expose a new accessor.
- **`incoming.ts`**: after the resend dedupe, a received message with an `originId` calls `confirmDelivered`; an AI-only DM (`chat.isAI === true`) is skipped. The existing `chat` lookup moved one block up (no net lines).
- **`chat-rows.ts`**: reads `deliveredUntil` off the entry / topic object and maps it onto the summary.
- **`packages/chat-core/src/types.ts`**: `ChatSummary.deliveredUntil?: string`.
- **`ports.ts`**: optional `CoreApi.markChatDelivered?(jid, originIds): Promise<unknown>`.
- **`index.ts`**: exports `./delivered`.
- **`apps/web/src/lib/api/chats.ts` + `apps/web/src/lib/api.ts`**: `markChatDelivered` calling `client.chats.markDelivered`, re-exported.
- **`apps/mobile/src/lib/chat-api.ts`**: `ChatApi.markChatDelivered?` and its implementation.
- **Port wiring**: web `apps/web/src/store/effects/ports.ts` and mobile `apps/mobile/src/store/real-store.ts` hand `markChatDelivered` to the core the same way `markChatRead` is handed.
- **`packages/mock-backend/src/domains/chats/routes.ts`**: `PUT /chats/:jid/delivered` answers 204.
- **Merge sites**: web `apps/web/src/store/effects/history.ts` and mobile `apps/mobile/src/store/effects/history.ts` call `applyChatDelivery(ctx, row)` for every fresh row (web +5 lines incl. comment, mobile +3 lines).

### Commands and results

- `pnpm install` — OK.
- `pnpm --filter @zilar/client-core exec vitest run src/store/delivered.test.ts --maxWorkers=2 --reporter=dot` — **5 passed** (single confirm after the debounce; two quick messages batched into one call with both ids; outgoing echo confirms nothing; `applyDeliveredUntil` moves `sent -> delivered`/keeps `read`/leaves later `sent`; `'999' < '1000'`).
- `pnpm gate` (after the round-2 wiring) — **GATE PASS**:
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/chat-core
  PASS  tests @zilar/client-core
  PASS  tests @zilar/mobile
  SKIP  tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Security checklist

- No secrets/tokens in logs: confirmations carry ids only (chat JID + origin ids); failures are ignored.
- The write is scoped to the chat in the URL by the server (T-1229, unchanged); the client only calls it for the chat it just refreshed.
- No new route/table: the mock route answers 204 and stores nothing.
- The call is capped at 50 ids (the server's contract cap).
- Audit: none touched.

### Honesty

Every claim above is against the code: the port is wired on both apps (round 2), so a connected app now sends a confirmation and the sender applies `deliveredUntil`. The one known gap is the history-page timing stated above. The message-pipeline test passes and `pnpm gate` is green with clean scope. I did not run the phone smoke or a live server check (out of scope here; the lead's post-deploy check covers it).

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **The change:**
  - `confirmDelivered` queues origin ids per chat (deduped, at most 50, newest kept) and sends one PUT after 1 s of quiet, ignoring errors;
  - it runs on a live incoming message (AI DMs skipped) and on every chat-list refresh, for the preview's origin id;
  - `applyDeliveredUntil` moves my own messages at or below the mark to `delivered` through `advanceStatus` (it never downgrades `read`), comparing ids by length and then as strings, with no `BigInt`;
  - the port is wired on web (`effects/ports.ts`) and mobile (`real-store.ts`), and the mock answers 204.
- **Checked after rebasing onto T-1223:**
  - delivered, incoming and lifecycle tests: 41 passed;
  - tsc: client-core, web and mobile all 0 errors;
  - touched files at most 394 lines.
- **Known gaps:**
  - an older history page loaded after the last refresh shows `sent` until the next refresh;
  - the sender sees delivered only on the next chat-list refresh, not live (step 3b);
  - under constant traffic in a chat the 1 s debounce waits for a lull.
- **After deploy:** watch for `deliveredUntil` in the `/api/chats` rows (read-only).
