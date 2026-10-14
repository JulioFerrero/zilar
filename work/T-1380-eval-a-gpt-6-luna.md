---
id: T-1380
title: "Model eval A: replay of T-1356 on opencode-go/gpt-6-luna (base d3b297545; never merged)"
status: todo
milestone: M5
branch: task/T-1380-eval-a-gpt-6-luna
model: opencode-go/gpt-6-luna
effort: default
depends_on: []
estimate: 0.5 day
eval_base: d3b297545
---

# T-1380: Model eval A (gpt-6-luna)

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
`apps/server/drizzle/0054_push_failure_reason.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/push/*.ts`, `packages/api-contract/src/push.ts`, `packages/mock-backend/src/domains/push/*.ts`, `apps/web/src/components/push/*.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/lib/api.ts`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/components/settings/*.tsx`, `apps/mobile/src/lib/push/*.ts`, `work/T-1380-eval-a-gpt-6-luna.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **After the deploy, Julio's account shows on web and phone:**
  - his devices with kind and last push or failure;
  - and on the phone, "Last push received on this phone".

### Eval rules (model test, read first)
This is a model-quality test that replays a task already solved on `main`. The lead grades your result; it will never be merged.
- Work alone. Nobody will answer questions. When unsure, decide, and note the decision in the Report.
- Do the task exactly as specified above, then run `pnpm gate`.
- Write the Report below: the cause or what you built, with `file:line`, every change, and the real `pnpm gate` output. Then set `status: eval-done` in the front matter. **Never set `status: review`.**

---

## Report (written by the worker when done)

## Review (written by Claude)
