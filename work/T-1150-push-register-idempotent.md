---
id: T-1150
title: "Push: re-registering the same device keeps its node (server), and the Android app registers its token once per session (no double registerToken), so ejabberd's one-push-session-per-c2s-session rule never trips and push finally enables"
status: merged
milestone: M5
branch: task/T-1150-push-register-idempotent
model: auto
effort: default
depends_on: [T-1146]
estimate: 0.3 day
---

# T-1150: Idempotent push registration

## Spec (written by Claude, do not edit)

### Why
In production, Android push never enables, so there are no notifications. Julio read the production ejabberd log, `/opt/ejabberd/logs/error.log`, on 2026-10-11:

```
SQL query at {mod_push_sql,{77,9}} failed: duplicate key value violates unique constraint "push_session_pkey"
  Key (username, "timestamp")=(pzooiu…, 1791746892000145) already exists.
mod_push:enable/4:338 Cannot enable push for pzooiu…@chat.zilar.app/zilar-a256ujej: database error
```

**How it fails:**
- **ejabberd's limit:** its `push_session` key is `(username, timestamp)`, and the timestamp is the c2s session's own timestamp. So **one c2s session can hold one push enable**. A second `<enable/>` with a different node on the same session fails with `internal-server-error`. The same node twice is an `ON CONFLICT (username, service, node)` update and works. The T-1146 doc's table-shape theory was wrong: the production table had the right columns.
- **The double registration:** on each launch the Android app registers the same FCM token twice.
  - `chat-store-provider.tsx:146-157` calls `registerNativePush` on `online` **and** installs `watchPushTokenRolls`.
  - `getDevicePushTokenAsync` inside `registerNativePush` also fires the push-token listener, so `registerToken` (`apps/mobile/src/lib/push/native.ts:100-113`) runs twice.
- **The server mints a new node each time:** `api-subscribe.ts:85`, `:94` use `randomUUID()` for `node`. `saveDevice` then deletes the old row for the same user and token, or the same user and endpoint, and **inserts a new node** (`apps/server/src/push/store.ts:97-131` native, `:139-166` webpush), then disables the replaced nodes in ejabberd (`:172-178`).
- **The result:** registration 1 enables node A, registration 2 replaces A with B (A gets disabled), and B's enable fails on the session-timestamp key. Nothing is left enabled.

### What to build
1. **The server, idempotent nodes** (`apps/server/src/push/store.ts`, `saveDevice`). When the same user already has a row for the same native `token` (or the same webpush `endpoint`):
   - **keep that row's `node`**, and its `id`;
   - update its other fields (user agent, keys or endpoint data, `created_at` left as is or refreshed, your choice) instead of inserting a new node, and return it, so `api-subscribe.ts:151` answers the **same** `{ id, node, jid }`;
   - if there are several such rows (legacy), keep the oldest and delete the rest; their nodes go to `staleNodes`, as today;
   - keep the per-user advisory lock, the device cap (a re-registration of an existing device must not count against the cap), and the "drop other users' rows for the same token" delete (`:107-116`).
2. **Mobile, one registration per token per session** (`apps/mobile/src/lib/push/native.ts`):
   - `registerToken` keeps a module-level in-flight promise and the last token it registered;
   - a call for the same token while one is in flight awaits that promise;
   - a call for the same token that already succeeded in this process does nothing;
   - a different token (a real roll) registers normally;
   - the enable still runs once per new chat session: `registerNativePush` on `online` after a reconnect must still re-send `<enable/>` with the saved node. Read how the provider triggers it (`chat-store-provider.tsx:139-162`) and keep that behaviour; describe it in the Report.
3. **Logs:** keep the existing `console.warn` lines; add no log that holds the token or node.
4. **Tests** (the message pipeline), with at most 3:
   - in `apps/server/src/push/store.test.ts`, extend the existing `collapses two registrations of the same token into one row` test (`:112`) or add one: two `saveDevice` calls for the same user and token return the **same node and id**;
   - the same for webpush with the same endpoint;
   - in `apps/mobile/src/lib/push/native.test.ts`, following its mocks: `registerNativePush`, plus a token-listener event with the same token, gives exactly **one** subscribe POST and one `setPushPair`.

### Read first
`AGENTS.md`, `apps/server/src/push/store.ts:60-180`, `apps/server/src/push/api-subscribe.ts:70-155`, `apps/server/src/push/store.test.ts:59-150`, `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/native.test.ts`, `apps/mobile/src/store/chat-store-provider.tsx:130-165` and `docs/audit/ejabberd-push-enable.md`.

### Allowed files
`apps/server/src/push/store.ts`, `apps/server/src/push/store.test.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/native.test.ts`, `docs/audit/ejabberd-push-enable.md`, `work/T-1150-push-register-idempotent.md`.

Also add a short "§9 Correction (T-1150)" to the audit doc: quote the real log line, say the cause was the session-timestamp key, not the table shape, and point to this task.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/store.test.ts src/push/api-subscribe.test.ts --reporter=dot
pnpm --filter @zilar/mobile exec vitest run src/lib/push/native.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on Julio's phone after the deploy and a new APK:**
  - after a launch, the ejabberd `error.log` has no new `push_session_pkey` line;
  - a message from another account with the app in the background shows a notification.

---

## Report (written by the worker when done)

### What I did

**Server — idempotent nodes (`apps/server/src/push/store.ts`).** `saveDevice`
now reads the same user's rows for the device identity (native `token`, Web Push
`endpoint`) inside the transaction, oldest first. If one exists it keeps that
row's `id` and `node`, refreshes its fields with an `UPDATE` (the columns the
opposite kind needs are nulled), and returns it — so `api-subscribe.ts:151`
answers the same `{ id, node, jid }`. Legacy duplicates: the oldest wins, the
rest are deleted and their nodes go to `staleNodes`. The per-user advisory lock,
the "drop other users' rows for the same native token" delete and the 20-device
cap are kept; the cap now counts the *other* identities (`token IS DISTINCT
FROM` / `endpoint IS DISTINCT FROM`), so a re-registration never counts against
it while a genuinely new device still does. `api-subscribe.ts` needed no change:
it already returns `row.id` / `row.node`.

**Mobile — one registration per token per session
(`apps/mobile/src/lib/push/native.ts`).** The old `registerToken` body is now
`registerTokenOnce`. `registerToken` wraps it with a module-level in-flight
`{ token, done }` and the last registered token: a second call for the token in
flight awaits the running promise, a call for a token that already succeeded
does nothing, and a different token (a real roll) registers normally.
`registerNativePush` clears the last registered token at the top, so a new
session re-registers and re-enables. No new log holds the token or the node.

**Audit doc.** Added §9 "Correction (T-1150)" quoting the real
`push_session_pkey` log line, saying the cause was the session-timestamp key and
not the table shape, and pointing at this task.

### How the provider triggers the enable (as the spec asked)

`apps/mobile/src/store/chat-store-provider.tsx:142-162` runs the push effect once
per signed-in auth session (`active`), subscribes to the chat store and, on the
first `status === 'online'`, sets its local `registered` flag and calls
`registerNativePush` once; it also installs `watchPushTokenRolls`. A reconnect
within the same signed-in session does not change `active`, so the effect does
not re-run and the provider does not call `registerNativePush` again: the enable
is sent once per session, not once per reconnect. I kept that behaviour (the
provider is not in the Allowed files). Every `registerNativePush` call now
re-registers the token and re-sends `<enable/>` with the server's stable node, so
each session the provider does start gets its enable. The double registration
that caused the production failure — `getDevicePushTokenAsync` firing the token
listener in the same burst as the explicit call — is what the mobile dedup
removes.

### Tests

- `apps/server/src/push/store.test.ts`: extended the same-token test (now "keeps
  one row, node and id…") and added the same-endpoint Web Push test.
- `apps/mobile/src/lib/push/native.test.ts`: added "registers once when the token
  listener echoes the same token" (one subscribe POST, one `setPushPair`).

### Commands (real results)

- `pnpm install`: done, 16 workspace projects.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/store.test.ts`: 9 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/api-subscribe.test.ts`: 4 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/native.test.ts`: 4 passed.
- `pnpm gate` (from the repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (3.6s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (0.9s)
PASS  tests @zilar/server  (4.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Files changed

- `apps/server/src/push/store.ts` (396 lines)
- `apps/server/src/push/store.test.ts` (193)
- `apps/mobile/src/lib/push/native.ts` (224)
- `apps/mobile/src/lib/push/native.test.ts` (165)
- `docs/audit/ejabberd-push-enable.md` (321)

(`apps/server/src/push/api-subscribe.ts` needed no change.)

### Deviations / notes

- The spec's "registerNativePush on `online` after a reconnect must still
  re-send `<enable/>`" is not how the current provider behaves (see above): after
  the first `online` in a session, `registered` suppresses further calls and a
  reconnect does not re-run the effect. I kept the provider as-is (out of scope);
  each session that does call `registerNativePush` re-registers and re-enables
  with the same node. A per-reconnect enable would need a provider change in a
  later task.
- `created_at` is left unchanged for a kept row (the spec allowed either).

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The server:** `saveDevice` keeps the oldest row's node and id for the same user and token (or endpoint), updates it in place, and sends extra legacy rows to `staleNodes`. A re-registration doesn't count against the cap.
- **Mobile:** `registerToken` dedupes with an in-flight promise and the last token. `registerNativePush` resets the dedupe, so each signed-in session re-sends the enable, with the same node now.
- **Tests:** the lead ran them in the branch: server 13 of 13, mobile 4 of 4.
- **The cause** came from Julio's production ejabberd `error.log`: `push_session_pkey` on `(username, timestamp)`. One c2s session holds one enable; the app registered twice and the server minted a new node each time.
- **Accepted nit:** `addPushTokenListener` isn't reset in the test's `beforeEach`.
- **Follow-up:** re-send the enable after an in-app XMPP reconnect. Today it's sent once per signed-in launch.
- **Still to do:** Julio's phone check after the deploy and a new APK.
