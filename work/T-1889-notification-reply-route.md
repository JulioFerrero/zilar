---
id: T-1889
title: "Notification reply, server side (plan task 1): POST /api/chats/:jid/reply {clientId, text} sends the text as the caller through ejabberd send_stanza (the same stanza the app builds), after access → DM block → rate limit → an idempotency claim row (migration 0075 notification_replies); 204 sent, 409 in flight, 404 invisible/blocked, 429, 503"
status: merged
milestone: M5
branch: task/T-1889-notification-reply-route
model: auto
effort: default
depends_on: [T-1887]
estimate: 45 min
---

# T-1889: The reply route behind a notification's Reply action

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/notification-actions.md` §2 and §6 task 1** (merged T-1887, part of Julio's easy-life pass, 2026-10-17). A phone notification's Reply action runs in a headless task without the XMPP connection, so it needs an HTTP route that sends the reply as the signed-in user. A retried action must never send twice. This task is the server side only; the phone side comes later.

### Facts (read by the lead on 2026-10-17)
- **The contract:** `ChatsGroup` (`packages/api-contract/src/chats.ts:148-183`, 183 lines) has `markRead` `PUT /chats/:jid/read` (`:150-156`). The group carries `.middleware(Session)` (`:180`), so a new endpoint there is signed-in only and joins the 401 sweep automatically.
- **The pattern to copy:** `apps/server/src/chats/mark-handlers.ts` (95 lines):
  - `chatAccessForMark` (`:25-42`) decodes the JID param (a bad one is a 404) and calls `requireChatReadAccess` → `requireChatAccess`, so unknown and invisible chats answer the same 404;
  - `markReadFor` (`:46-64`) checks access, then `limiter.allow(user.id)` → 429, then writes.
- **Wiring:** `apps/server/src/chats/api.ts` (102 lines):
  - `createChatsApi` builds `readLimiter` with `createRateLimiter` (`:60-64`);
  - handlers are wired at `:72-86`;
  - `ChatsApiDependencies` has `adminClient?: EjabberdAdminClient` (`:45`).
- **Sending as a person:** `EjabberdAdminClient.sendStanza(from, to, stanza)` (`apps/server/src/xmpp/admin/client.ts:312-317`), already used as a person in `apps/server/src/chats/delivered-notice.ts:65-87`.
- **DM blocks:** `isDmBlocked(db, userId, peerJid)` (`apps/server/src/blocks/service.ts:70`).
- **The stanza the app sends:** `buildMessage({ id, to, kind, text })` (`packages/xmpp-core/src/stanza/build-outgoing.ts:95-148`) returns an `@xmpp/client` element with `type`, `<body>` and `<origin-id/>`, and its `.toString()` is the XML. It is **not exported** from `packages/xmpp-core/src/index.ts` (76 lines; the value exports are at `:38-56`). `ChatKind` is `'groupchat' | 'chat'` (`packages/xmpp-core/src/types.ts:29`).
- **The caller's bare JID:** `jidFor(localpartFor(user.id), deps.config.xmpp.domain)` (`apps/server/src/xmpp/provisioning.ts:29,37`). A room JID is on `deps.config.xmpp.mucDomain`.
- **Migrations:** hand-written, numbered files in `apps/server/drizzle/`. The latest is `0074_alert-card-link.sql`; a new-table example is `0072_group-bans.sql` (opens with `SET lock_timeout = '5s';--> statement-breakpoint`).
- **`apps/server/src/db/rows.ts` is 396 lines,** so the row type for the new table lives in the new module, not there.

### Steps
1. **The contract (`chats.ts`):** add
   ```ts
   // T-1889: a reply sent from a phone notification, as the caller.
   HttpApiEndpoint.post('reply', '/chats/:jid/reply', {
     params: { jid: Schema.String },
     payload: Schema.Struct({ clientId: <String 1..128>, text: <String 1..4000> }),
     success: HttpApiSchema.NoContent,
   })
   ```
2. **`xmpp-core` `index.ts`:** export `buildMessage` from `./stanza/build-outgoing`, with a T-1889 comment (the server builds the same stanza the app sends).
3. **The migration `apps/server/drizzle/0075_notification-replies.sql`:**
   ```sql
   SET lock_timeout = '5s';--> statement-breakpoint
   CREATE TABLE "notification_replies" (
     "user_id" text NOT NULL,
     "client_id" text NOT NULL,
     "chat_jid" text NOT NULL,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL,
     "sent_at" timestamp with time zone,
     CONSTRAINT "notification_replies_pk" PRIMARY KEY("user_id","client_id")
   );
   ```
   If the migrator needs a journal entry for new files, add it the way 0074 was added.
4. **New `apps/server/src/chats/reply-handler.ts`** with `replyFor(deps, limiter, request, user)`, in this order:
   1. **Access:** like `chatAccessForMark` → `{ bare }` (404 on a bad, unknown or invisible chat). The kind is `groupchat` when the bare JID's domain is `mucDomain`, otherwise `chat`.
   2. **Blocks:** for `chat`, `isDmBlocked(db, user.id, bare)` → the same 404 `not_found` "Chat not found".
   3. **Rate limit:** `limiter.allow(user.id)` false → 429 `rate_limited` "Too many replies, try again later".
   4. **No admin client:** `deps.adminClient` undefined → 503 `xmpp_unavailable`, using the existing code in `apps/server/src/errors.ts`.
   5. **Claim:** `INSERT … ON CONFLICT DO NOTHING RETURNING 1`. With no row returned, read the existing claim:
      - `sent_at` set → return (204);
      - else `created_at` under 2 minutes old → 409 `reply_in_flight` "The reply is still sending";
      - else take it over (`UPDATE … SET created_at = now() WHERE … AND sent_at IS NULL RETURNING 1`); if that update returns nothing, answer 409.
   6. **Send:** `buildMessage({ id: clientId, to: bare, kind, text }).toString()` → `deps.adminClient.sendStanza(callerBare, bare, stanza)`.
      - On success: `UPDATE … SET sent_at = now()` and return (204).
      - On failure: `DELETE` the claim and answer 503 `send_failed` "Could not send the reply. Try again."
   7. **Logging:** ids and outcomes only, never the text.
5. **`api.ts`:** build `replyLimiter = createRateLimiter({ max: 60, windowMs: 10 * 60 * 1000, now })` and `.handle('reply', handler(logger, (request, user) => replyFor(deps, replyLimiter, request, user)))`, with a one-line comment. Keep `api.ts` at most 400 lines.
6. **New `apps/server/src/chats/reply-handler.test.ts`** (message pipeline plus permissions, so tests are wanted), on the existing chats test setup (copy the harness from `apps/server/src/chats/read-marks.test.ts`):
   - an invisible chat → 404 and no `sendStanza` call;
   - a blocked DM → 404 and no send;
   - a first reply → `sendStanza` called once with `from` = the caller's bare JID, and the stanza contains `<body>` and the `clientId` origin id;
   - the same `clientId` again → 204 and **no second send**;
   - a claim with no `sent_at` under 2 min old → 409;
   - `sendStanza` throwing → 503, the claim is removed, and a retry with the same id sends.

### Allowed files
- `packages/api-contract/src/chats.ts`
- `packages/xmpp-core/src/index.ts`
- `apps/server/drizzle/0075_notification-replies.sql`
- `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/chats/reply-handler.test.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/errors.ts`
- `work/T-1889-notification-reply-route.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/reply-handler.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`POST /api/chats/:jid/reply` sends the text as the caller,** and the stanza is the same one the app builds.
- **Access, block, rate limit and claim are checked in that order.** A repeated `clientId` never sends twice.
- **No reply text** appears in logs.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Contract:** added `reply` (`POST /api/chats/:jid/reply`) to `ChatsGroup`, payload `{ clientId: 1..128, text: 1..4000 }`, `HttpApiSchema.NoContent`. The group keeps `Session`, so the route joins the 401 sweep.
- **`xmpp-core`:** exported `buildMessage` from `src/index.ts` (with a T-1889 comment), so the server builds the same stanza the app sends.
- **Migration:** added `apps/server/drizzle/0075_notification-replies.sql` with the spec's `notification_replies` table and `SET lock_timeout = '5s';`. No journal entry was needed: the migrator reads the folder, and the hand-written 0072–0074 migrations are not in `meta/_journal.json` either (the journal stops at 0046).
- **Handler (`apps/server/src/chats/reply-handler.ts`):** `replyFor` checks, in order: chat access (same 404 for bad/unknown/invisible), DM block (same 404), rate limit (429), missing admin client (503 `xmpp_unavailable`), idempotency claim (`INSERT … ON CONFLICT DO NOTHING RETURNING 1`; no row → 204 if `sent_at` is set, 409 `reply_in_flight` while fresh, otherwise atomic takeover of a claim older than 2 minutes). It then sends `buildMessage({ id: clientId, to, kind, text }).toString()` via `adminClient.sendStanza(callerBare, bare, stanza)`, sets `sent_at` on success, and deletes the claim + answers 503 `send_failed` on failure. `kind` is `groupchat` on the MUC domain, `chat` otherwise. Logs carry ids and outcomes only, never the text.
- **Wiring (`apps/server/src/chats/api.ts`):** own `replyLimiter` (`max: 60`, 10-minute window) and the `reply` handler next to the mark handlers; file is 107 lines.
- **Tests (`apps/server/src/chats/reply-handler.test.ts`, 7 cases):** invisible chat 404/no send; blocked DM 404/no send; first reply 204 with `from` = caller's bare JID and a stanza carrying `type="chat"`, `<body>`, `<origin-id>` and `clientId`; repeated `clientId` 204 with one send; fresh unsent claim 409; stale claim taken over and sent; failed send 503 + claim removed + retry sends. One case also asserts the reply text never appears in the log output.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/chats/reply-handler.test.ts --reporter=dot --maxWorkers=2` → **7 passed** (1 file).
- `pnpm gate` (from the repo root) → summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (15.9s)
  PASS  tests @zilar/xmpp-core  (1.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (The first `pnpm gate` run failed only on Prettier formatting in `api.ts` and `reply-handler.ts`; I formatted those two files and the rerun above is green.)

### Notes for the lead

- **Deviation from `docs/plan/notification-actions.md`:** the plan's route body mentions optional `readUpTo`/`displayed`; the task spec's contract has only `{ clientId, text }`, so only those two are implemented. Read-mark/displayed work belongs to later plan tasks.
- **No test for the "no admin client" 503 branch:** `AppDependencies.adminClient` is required, so `createApp` cannot build an app without one; the branch is implemented as spec step 4 but is unreachable through the app wiring. The spec's test list did not include it.
- The "claim disappeared between insert and read" race (another retry released a failed claim) answers 409 rather than sending without a claim; the request can retry.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `99f79372b`. The lead read `reply-handler.ts` in full.

**Checks, in order:**
1. access 404, the same as unknown or invisible;
2. DM block 404;
3. its own 60-per-10-minute budget, giving 429;
4. no admin client gives 503;
5. the atomic claim: an `INSERT … ON CONFLICT DO NOTHING`, and a takeover of a stale claim is a guarded `UPDATE`;
6. `send_stanza` from the caller's bare JID with the app's own `buildMessage` stanza;
7. `sent_at` marked. A failed send releases the claim.

**Text and tests:**
- the text is never logged; the log lines carry ids only;
- 7 tests cover 404 ×2, a single send, a duplicate, 409, takeover and 503 + retry.

**The two nits are accepted:**
- a double send needs a DB failure between a successful send and `markSent`, or a send hanging over 2 minutes;
- `chat_jid` is bookkeeping only.

**Still to prove live (plan review item 3):** a `groupchat` reply from the bare JID must reach a topic room. The proof comes from the first phone build with notification Reply, or a lead call with Julio's OK.

