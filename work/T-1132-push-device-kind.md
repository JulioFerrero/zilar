---
id: T-1132
title: "Native push 1/6: push_subscriptions gets a device kind (webpush | fcm | apns) and a token column — hand-written migration 0047, rows.ts, store.ts saveDevice/openNativeDevice"
status: todo
milestone: M5
branch: task/T-1132-push-device-kind
model: auto
effort: default
depends_on: [T-1129]
estimate: 0.3 day
---

# T-1132: A device kind for push

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: Android push through FCM, with no text in the push. This is Task 1 of `docs/audit/native-push-plan.md` §7, and it is the only schema task, so it runs alone.

**Facts** (the plan §1, re-read by the lead):
- **The table:** `push_subscriptions` (`apps/server/drizzle/0031_glossy_wasp.sql:7-20`) is Web-Push shaped: `endpoint`, `p256dh` and `auth`, sealed with `PushCipher`.
- **The row type:** `apps/server/src/db/rows.ts` `PushSubscriptionRow` (`:221-233`).
- **`apps/server/src/push/store.ts`:**
  - `saveDevice` (`:68-129`) runs under an advisory lock, with the 20-device cap (`PUSH_MAX_DEVICES_PER_USER`, `:16`) and the `(user_id, endpoint)` dedupe;
  - `openDevice` (`:275-283`) decrypts the keys.
- **The loader** reads `apps/server/drizzle/*.sql` by file name (`apps/server/src/effect/sql.ts:169-172`). The last file is `0046_membership-indexes.sql`.

### What to build
1. **A new `apps/server/drizzle/0047_native_push.sql`,** exactly the statements in the plan §1.2:
   - the `kind` column (`DEFAULT 'webpush' NOT NULL`) and a nullable `token`;
   - the three Web Push columns become nullable;
   - `kind_check`, `shape_check`, and the partial unique index on `(user_id, token)`.
   - Use the statement-breakpoint style of the earlier hand-written files (compare `0046_membership-indexes.sql`).
2. **`rows.ts`:** `PushDeviceKind` and the new `PushSubscriptionRow` fields, as in the plan §1.3.
3. **`store.ts`, as in the plan §1.4:**
   - `SaveDeviceInput` becomes a union: `{ kind: 'webpush', subscription }` or `{ kind: 'fcm' | 'apns', token }`;
   - `saveDevice` branches inside the **same** transaction, the same lock and the same cap: it dedupes on `(user_id, endpoint)` for webpush and on `(user_id, token)` for native;
   - add `openNativeDevice(row)`;
   - `openDevice` stays Web-Push only;
   - every existing caller keeps compiling (update call sites in `apps/server/src/push/api-subscribe.ts` to pass `kind: 'webpush'` if needed).
4. **`apps/server/src/push/subscriptions.ts`:** add the native token schema (a non-empty string of at most 4096 characters), for Task 4 to use later.
5. **Tests** (keys and the device store), in a new `apps/server/src/push/store.test.ts`:
   - a Web Push row round-trips unchanged;
   - a native row stores the kind and token, and `openNativeDevice` returns them;
   - the 20-device cap still holds across both kinds;
   - the same token registered twice leaves one row;
   - a mismatched shape is rejected by the constraint.

   Use the server's test DB helpers; see `apps/server/src/push/candidates.test.ts` for the setup.
   - **If an existing test pins the migration count or the last migration** (T-0849 had to touch `apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts` and `apps/server/src/topics/backfill.test.ts`), update only that expectation.
6. **No delivery or API changes;** those are later tasks.

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §1 and §7, `apps/server/src/push/store.ts`, `apps/server/src/push/subscriptions.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/drizzle/0031_glossy_wasp.sql` and `apps/server/drizzle/0046_membership-indexes.sql`.

### Allowed files
`apps/server/drizzle/0047_native_push.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/push/store.ts`, `apps/server/src/push/store.test.ts`, `apps/server/src/push/subscriptions.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/topics/backfill.test.ts`, `work/T-1132-push-device-kind.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/store.test.ts src/push/candidates.test.ts src/db/migrate.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The migration applies on a fresh database and on one at 0046.

---

## Report (written by the worker when done)

## Review (written by Claude)
