---
id: T-1356
title: "Push diagnostics in Settings → Notifications (web + mobile): per device show kind, last push sent, last failure time and reason (FCM error code); on the phone also 'last push received on this phone'; one migration adds the failure reason"
status: merged
milestone: M5
branch: task/T-1356-push-diagnostics
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1356: Push diagnostics

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "in firefox the notifications work, but in the android app i never get notifications, how can we debug this". The lead's live debugging on his phone (vivo V2454A, Android 16) found two problems:
- **Pushes do reach the phone,** but Play Services logs `No response to broadcast from app.zilar.chat … time=2ms`. That's vivo's autostart block on a cold app; Julio is changing phone settings.
- **One DM produced no push at all,** sent while the app process was dead.

The lead **can't see the server's push logs** (Coolify exposes only the web proxy log). So the user needs to see, in the app, what the server did for each device.

**What exists today:**
- `push_subscriptions` rows have `kind`, `lastUsedAt` and `failedAt` (`apps/server/src/db/rows.ts:233-247`);
- the list route `GET /push/subscriptions` answers `PushDevice` = `{id, userAgent, createdAt, lastUsedAt, inactive}` (`packages/api-contract/src/push.ts:29-35`);
- the web shows it in `apps/web/src/components/push/DevicesSection.tsx` (51 lines; `· inactive` at `:33`), on `apps/web/src/routes/NotificationsPage.tsx`;
- the mobile `apps/mobile/src/app/settings/notifications.tsx` (335 lines) shows permission state and a "Send test", but **no device list**;
- delivery failures are only counted globally (`markPushFailed` in `apps/server/src/push/delivery.ts:79,88`; `apps/server/src/health-status.ts:19-30`);
- the FCM error code is parsed in `apps/server/src/push/fcm.ts` (`FcmSendError.status`/`.code`, around `:40-46`).

### What to build
1. **Server:**
   - a hand-written migration `apps/server/drizzle/0054_push_failure_reason.sql` adds `last_failure text NULL` (at most 64 chars) to `push_subscriptions`, and `rows.ts` gets `lastFailure`;
   - when a send to a device fails, store a short reason with `failedAt`: the FCM `code`, e.g. `UNREGISTERED`, `SENDER_ID_MISMATCH`, `INVALID_ARGUMENT`, `QUOTA_EXCEEDED`, `UNAVAILABLE`, or `http-<status>`; for Web Push, the HTTP status. A later success clears `failedAt` and `lastFailure` if the current code doesn't already;
   - set `lastUsedAt` on every **successful** send, for both kinds. Check that it does and cite the line.
2. **Contract:** `PushDevice` adds `kind` (`'webpush' | 'fcm' | 'apns'`), `failedAt: NullOr(String)` and `lastFailure: NullOr(String)`. Keep `inactive`. Update the mock backend route to return the new fields.
3. **Web `DevicesSection`:** each row shows a readable device name ("Android app" for `fcm`, "iPhone app" for `apns`, else the browser from `userAgent`); "Last push: <relative time>" or "No push yet"; and, if `failedAt` is set, "Failed <relative time>: <reason>" in the error colour. Keep the remove button.
4. **Mobile Notifications screen:**
   - add the same device list from `GET /push/subscriptions`, marking **this phone** (match its registered token or node, whatever `native.ts` already stores);
   - add one line, **"Last push received on this phone: <time>"**: record the time in the existing background wake handler (`apps/mobile/src/lib/push/background.ts`) into the app's existing storage (AsyncStorage or SecureStore, whichever the app already uses; cite it), and read it here;
   - after "Send test", refresh the list so the result shows.
5. **Tests:** one server test is allowed (the message pipeline): an FCM failure stores the reason and a later success clears it. **No UI tests.** Every file stays at most 400 lines; split `notifications.tsx` if it would pass 400.

### Read first
`AGENTS.md`, `apps/server/src/push/delivery.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/store.ts`, `packages/api-contract/src/push.ts`, `apps/web/src/components/push/DevicesSection.tsx`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/native.ts`, the memory note in `docs/` on hand-written migrations if any (`migrateSql`).

### Allowed files
`apps/server/drizzle/0054_push_failure_reason.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/push/*.ts`, `packages/api-contract/src/push.ts`, `packages/mock-backend/src/domains/push/*.ts`, `apps/web/src/components/push/*.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/lib/api.ts`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/components/settings/*.tsx`, `apps/mobile/src/lib/push/*.ts`, `work/T-1356-push-diagnostics.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **After the deploy, Julio's account shows on web and phone:**
  - his devices with kind and last push or failure;
  - and on the phone, "Last push received on this phone".

## Report

### What I did

**Server**
- `apps/server/drizzle/0054_push_failure_reason.sql` (new): adds `last_failure text` and a `push_subscriptions_last_failure_check` (`<= 64`) check. Starts with `SET lock_timeout = '5s';` per AGENTS.md.
- `apps/server/src/db/rows.ts`: `PushSubscriptionRow.lastFailure: string | null`.
- `apps/server/src/push/failure-reason.ts` (new): `pushFailureReason(error)` — an FCM rejection keeps its `code` (`UNREGISTERED`, `SENDER_ID_MISMATCH`, `INVALID_ARGUMENT`, `QUOTA_EXCEEDED`, `UNAVAILABLE`, …) or falls back to `http-<status>`; Web Push uses `error.statusCode`. Capped at 64 chars.
- `apps/server/src/push/service.ts`: `SendFailed` now carries `reason` so the pipeline keeps the failure text.
- `apps/server/src/push/delivery.ts`: `sendWithCleanupEffect` derives the reason and passes it to `markDeviceFailed`; the shared block covers both kinds (`:252-264`).
- `apps/server/src/push/store.ts`: `markDeviceFailed(db, id, now, lastFailure)` stamps `failed_at` + `last_failure`; `markDeviceUsed` now clears both (`last_failure = NULL`); `PushDeviceView`/`toPushDeviceView` add `kind`, `failedAt`, `lastFailure`.
- `apps/server/src/push/api-handlers.ts`: the `/push/test` route's native and Web Push failure paths store the same reason.

**lastUsedAt on success (spec asked to check and cite):** both kinds meet in `deliverToDevice`, and `handleIncomingPush` marks the device used on the shared `sent` outcome — `apps/server/src/push/delivery.ts:99-101` (`if (outcome.kind === 'sent') { markPushSent(); await markDeviceUsed(deps.db, device.id, now); }`). `group-notifier.ts:182` marks it for group pushes too. So every successful send sets `last_used_at`, and it also clears `failed_at`/`last_failure`.

**Contract + mock**
- `packages/api-contract/src/push.ts`: `PushDevice` adds `kind` (`'webpush' | 'fcm' | 'apns'`), `failedAt: NullOr(String)`, `lastFailure: NullOr(String)`; `inactive` kept.
- `packages/mock-backend/src/domains/push/routes.ts`: the created device carries `kind: 'webpush'`, `failedAt: null`, `lastFailure: null`.

**Web**
- `apps/web/src/components/push/DevicesSection.tsx`: each row names the device (`Android app` for `fcm`, `iPhone app` for `apns`, else `describeUserAgent(userAgent)`), shows `Last push: <relative>` or `No push yet`, and `Failed <relative>: <reason>` in `text-danger` when `failedAt` is set. Remove button kept.

**Mobile**
- `apps/mobile/src/lib/push/last-received.ts` (new): records/reads the receipt time in **SecureStore** — the store the push registration already uses (`apps/mobile/src/lib/push/native.ts:4,27`, key `zilar.push.registration`); this module uses key `zilar.push.lastReceived`. The `expo-secure-store` import is dynamic so the module loads under Vitest.
- `apps/mobile/src/lib/push/background.ts`: `onWake` records the receipt (`recordPushReceived()`) for every delivered wake.
- `apps/mobile/src/lib/push/native.ts`: exports `readStoredRegistration()` so the screen can match **this phone** by the stored registration `id`.
- `apps/mobile/src/components/settings/push-diagnostics.tsx` (new): the device list (name, last push/`No push yet`, failure + reason, `(this phone)` marker) and the "Last push received on this phone: …" line.
- `apps/mobile/src/app/settings/notifications.tsx`: loads `GET /push/subscriptions` plus the stored registration and last-received time; after "Send test" the list and the line refresh (a failed refresh is ignored so a successful send never shows an error). Split the list into the component above to stay under 400 lines (375 now).

**Tests**
- `apps/server/src/push/delivery.test.ts`: added "stores the FCM failure reason and clears it on a later success" — an FCM `UNAVAILABLE` failure stores `lastFailure`/`failedAt`, a later successful send clears both and sets `lastUsedAt`. No UI tests.

### Files changed
`apps/server/drizzle/0054_push_failure_reason.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/push/{delivery,delivery.test,service,store,api-handlers,failure-reason}.ts`, `packages/api-contract/src/push.ts`, `packages/mock-backend/src/domains/push/routes.ts`, `apps/web/src/components/push/DevicesSection.tsx`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/components/settings/push-diagnostics.tsx`, `apps/mobile/src/lib/push/{last-received,native,background,background.test}.ts`, `work/T-1356-push-diagnostics.md`.

### Commands run
- `pnpm install` — ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/delivery.test.ts` — 1 file passed, 9 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/background.test.ts` — 1 file passed, 6 tests passed.
- `pnpm gate` — **GATE PASS**:
```text
gate: 18 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.3s)
PASS  lint  (0.6s)
PASS  typecheck  (2.2s)
PASS  effect  (0.5s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/mobile  (0.9s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (12.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
Two earlier gate runs failed and were fixed: `Schema.Literal(a, b, c)` → `Schema.Literals([...])` (api-contract), a `readonly PushDevice[]` state/prop mismatch (mobile), and the Effect ratchet on `last-received.ts` (rewritten with Effect).

### Deviations / notes
- The migration adds a CHECK constraint (the 64-char cap). `migrateSql` already sets `SET LOCAL lock_timeout = '5s'` before every file (`apps/server/src/effect/sql.ts:190`); the file-level `SET lock_timeout = '5s';` is the AGENTS.md rule, so it is present.
- The mobile device list has no Remove button (spec item 4 did not ask for one; the phone unregisters on sign-out, `native.ts`).
- "A later success clears `failedAt` and `lastFailure`" is done in `markDeviceUsed`, called on the shared `sent` outcome in `handleIncomingPush`.

### Open questions / blocked
None.

### Round (fix, 2026-10-14)
- **Finding 1 (should-fix): fixed.** `readLastPushReceived` now appends
  `.pipe(Effect.orElseSucceed(() => null))` (`apps/mobile/src/lib/push/last-received.ts:40`),
  so a `SecureStore.getItemAsync` throw resolves `null` as the docstring promises
  instead of rejecting into the Settings screen's `Effect.all`.
- **Test added:** `apps/mobile/src/lib/push/last-received.test.ts` — reads the stored
  time, and resolves `null` when the store read throws (plus the write path: stores the
  ISO string, never rejects on a write failure). 4 passed.
- **Finding 2 (nit): left as is** per the round rules — it is a nit and it sits in
  `background.test.ts`, a file this round does not otherwise change.
- **Commands:** `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/last-received.test.ts` — 1 file passed, 4 tests passed. `pnpm gate` — **GATE PASS** (19 changed files; install/format/lint/typecheck/effect PASS, mobile + server tests PASS, scope + migration PASS).

### Disagreements
None.

**Lead, 2026-10-14: approved. Pre-review clean after 1 auto round (3 nits); the packet is current for `38073eef`.**
- **Migration 0054:** a nullable `last_failure` column, a length check of at most 64, and `lock_timeout 5s`, so it's safe live.
- **Lead ran** `delivery.test.ts`: 9 passed.
- **Live check after the deploy:** the column exists and the list route answers the new fields.
