---
id: T-1132
title: "Native push 1/6: push_subscriptions gets a device kind (webpush | fcm | apns) and a token column — hand-written migration 0047, rows.ts, store.ts saveDevice/openNativeDevice"
status: merged
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

### What I did

- **`apps/server/drizzle/0047_native_push.sql`** (new): `kind` `text NOT NULL
  DEFAULT 'webpush'`, `token text`, `endpoint`/`p256dh`/`auth` relaxed to
  nullable, `push_subscriptions_kind_check`, `push_subscriptions_shape_check`,
  and the partial unique index `push_subscriptions_user_token_idx` on
  `(user_id, token) WHERE token IS NOT NULL`. Same `--> statement-breakpoint`
  style as `0046_membership-indexes.sql`. The loader reads the directory by file
  name, so no `meta/_journal.json` entry (that file is not in Allowed files).
- **`apps/server/src/db/rows.ts`**: `PushDeviceKind` and the new `kind` and
  `token` fields on `PushSubscriptionRow`.
- **`apps/server/src/push/store.ts`**: `SaveDeviceInput` is now the union
  `{ kind: 'webpush'; subscription } | { kind: 'fcm' | 'apns'; token }`;
  `saveDevice` branches inside the **same** advisory-lock transaction and the
  **same** 20-device cap, deduping on `(user_id, endpoint)` for Web Push and
  `(user_id, token)` for native; new `openNativeDevice(row)`; `openDevice` stays
  Web Push only.
- **`apps/server/src/push/subscriptions.ts`**: `NativePushTokenSchema` (a
  non-empty string, at most 4096 characters) for Task 4.
- **`apps/server/src/push/api-subscribe.ts`**: the existing save passes
  `kind: 'webpush'`.
- **`apps/server/src/push/store.test.ts`** (new): 6 tests — Web Push round-trip,
  native row + `openNativeDevice`, the 20-device cap across both kinds, the same
  token twice leaves one row, a mismatched kind/shape rejected by the
  constraint, and an `apns` row.
- `work/T-1132-push-device-kind.md`.

### Commands and results

- `pnpm install` — OK.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/store.test.ts` — **6 passed**.
- Checks `pnpm --filter @zilar/server exec vitest run src/push/store.test.ts src/push/candidates.test.ts src/db/migrate.test.ts --reporter=dot` — **11 passed, 2 files** (6 store + 5 candidates; Vitest drops the `src/db/migrate.test.ts` filter because that file no longer exists, see Deviations).
- `pnpm gate` — summary lines:
  ```
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (4.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec

1. **`rows.ts`: the three Web Push columns stay typed non-null** instead of
   `string | null` as in plan §1.3. The migration **does** make the columns
   nullable and the DB is exactly as the plan says; only the TypeScript view
   keeps the legacy non-null typing. Reason: `string | null` makes the existing
   test-send handler read fail typecheck —
   `apps/server/src/push/api-handlers.ts(188,17)`, `(189,48)`, `(189,85)`
   (`cipher.decrypt(target.p256dh)` and the `subscription.endpoint` assignment)
   — and `api-handlers.ts` is **not** in this task's Allowed files (the plan §7
   gives it to Task 4). I verified the failure with `tsc --noEmit` before
   choosing this route. The alternative is a 3-line null guard in
   `api-handlers.ts` plus adding that file to Allowed files. The spec sentence
   "every existing caller keeps compiling" is what I honoured; a native row is
   read through `openNativeDevice`, never off the raw columns. **Needs the
   lead's confirmation.**
2. **`apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts`
   and `apps/server/src/topics/backfill.test.ts` do not exist** in this worktree
   (T-0931 cut the server tests), so nothing pins the migration count and I
   changed none of them.
3. **`drizzle/meta/_journal.json` left untouched** (not an Allowed file; the
   effect loader ignores it). Hand-written `0047_*.sql` is enough.

### Acceptance

- The fresh-database path is exercised by every test: the shared PGlite snapshot
  applies all migrations in order, including `0047` (the store tests could not
  pass otherwise).
- The "at 0046" upgrade is a pure `ALTER TABLE ... ADD COLUMN ... DEFAULT
  'webpush' NOT NULL` (backfills every existing row) plus checks that existing
  rows already satisfy, so no data rewrite and no failing constraint. I did not
  build a separate up-to-0046 harness (out of scope); the migration order in the
  fresh run applies `0046` then `0047` sequentially.

### Security checklist

- The native token is stored in the clear on purpose (plan §1.1: a token is a
  delivery address, not the send credential); `p256dh`/`auth` stay sealed.
- The 20-device cap and both dedupe rules are enforced inside one transaction
  under the per-user advisory lock, never check-then-insert.
- `openNativeDevice` and the save path carry no keys or tokens in errors; no new
  route, so the 401 sweep is unchanged.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 2 follow-ups, both carried into Task 3.**
- **Migration `0047_native_push.sql`:** matches plan §1.2 statement for statement. It is additive and safe live: the constant-default `kind` column needs no table rewrite, and every existing row passes `shape_check`.
- **`store.ts`:** the native path runs under the same advisory lock, the same 20-device cap and the same dedupe-in-transaction as Web Push. `openNativeDevice` is added; `openDevice` stays Web-Push only. No token or key appears in any error.
- **Tests:** the lead ran `store.test.ts` on the branch against the local Postgres: all 6 pass (Web Push round-trip, native row, cap across kinds, token dedupe, shape rejected, apns kind).
- **The follow-ups for Task 3 (the delivery branch):**
  - **F1:** `rows.ts` keeps `endpoint`, `p256dh` and `auth` typed `string`, while they are nullable in the DB. Task 3 must narrow them by `kind` or make them `string | null`.
  - **F2:** until Task 3, a native row would be dropped as `undecryptable` in `delivery.ts`. That can't happen today, because only `api-subscribe.ts` saves rows, always as webpush.
