---
id: T-1138
title: "Native push 4/6: POST /push/subscriptions accepts { kind: 'fcm', token } beside the Web Push body, and the server wires an FcmSender from FCM_SERVICE_ACCOUNT_JSON into the push component (main.ts grows by at most 3 lines)"
status: merged
milestone: M5
branch: task/T-1138-push-native-subscribe
model: auto
effort: default
depends_on: [T-1135]
estimate: 0.3 day
---

# T-1138: Native subscribe and wiring

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: Android push through FCM. This is Task 4 of `docs/audit/native-push-plan.md` §7 (read §1.5 and §4.3). T-1132, T-1133 and T-1135 built the device kind, the sender and the delivery branch. This task opens the API to a phone and turns the sender on **when the FCM secret is set**. Without the secret nothing changes: the native sender stays undefined, and native devices drop as `send-failed` (T-1135).

**What the lead read:**
- **`packages/api-contract/src/push.ts`:** `RegisterPushDevicePayload` (`:67-78`, the browser `PushSubscription` JSON plus `userAgent`) is the payload of `subscribe` (`:94-97`).
- **`apps/server/src/push/api-subscribe.ts`:**
  - the body is decoded by hand (`:31-34`), and a bad body is 400 `invalid_subscription`;
  - the rate limit is at `:35-37`;
  - `saveDevice` is called with `kind: 'webpush'` (`:85`);
  - the room sync runs after the save (`:120`), and the route answers `{ id, node, jid }` (`:139`).
- **`apps/server/src/push/subscriptions.ts:28-30`:** `NativePushTokenSchema` (1 to 4096 characters).
- **`apps/server/src/push/config.ts:205`:** `readFcmConfig(config)` returns `{ serviceAccount, projectId }` or `null`.
- **The FCM modules:** `createFcmTokenProvider` is in `apps/server/src/push/fcm-token.ts`, and `createFcmSender` in `apps/server/src/push/fcm.ts`.
- **`apps/server/src/main.ts`** (713 lines, already over 400) builds the push component's `service` deps at `:489-508`. There is no `nativeSender` yet; `PushServiceDeps.nativeSender` is optional (`apps/server/src/push/service.ts`).

### What to build
1. **The contract:**
   - Add `RegisterNativePushDevicePayload = Schema.Struct({ kind: Schema.Literal('fcm'), token: <1..4096 string>, userAgent: <same optional field as the Web Push body> })`.
   - Make the `subscribe` payload `Schema.Union([RegisterPushDevicePayload, RegisterNativePushDevicePayload])`.
   - The Web Push body stays exactly as it is, with no `kind` field, so the web client is unchanged.
   - Only `'fcm'` is accepted for now; `apns` comes later.
2. **`api-subscribe.ts`:** decode the union.
   - **A native body** calls `saveDevice` with `{ kind: 'fcm', token, userAgent, … }` and the same `node` retry loop. The rate limit, the room sync and the response `{ id, node, jid }` are the same; the client then sends `<enable/>` over its own XMPP session, as the web does through `setPushPair` (`apps/web/src/store/effects/pins.ts:107`).
   - **A Web Push body:** today's path, unchanged.
   - **Anything else** (an unknown `kind`, an empty token) is 400 `invalid_subscription`.
   - **Logs:** ids only, never the token.
3. **The sender, with the setup in a new `apps/server/src/push/native-sender.ts`:**
   - `createNativeSender(push: PushConfig): FcmSender | undefined` returns `undefined` when `readFcmConfig` is `null`. Otherwise it returns `createFcmSender({ projectId, tokens: createFcmTokenProvider({ serviceAccount }) })`.
   - In `main.ts`, pass `...(nativeSender === undefined ? {} : { nativeSender })` into `service`, with `const nativeSender = createNativeSender(push)` next to `sender`.
   - **`main.ts` grows by at most 3 lines.**
   - Log once at startup: `push: native (FCM) sender on`, or `off`. No value.
4. **No change** to the list, delete or test routes.
5. **Tests** (the message pipeline and auth), in a new `apps/server/src/push/api-subscribe.test.ts`, following the `createApp` setup of `apps/server/src/files/routes.test.ts`, with at most 4 tests:
   - an fcm body with a token stores a `kind = 'fcm'` row and answers `{ id, node, jid }`;
   - an unknown `kind` gives 400 `invalid_subscription`;
   - the Web Push body still stores a webpush row;
   - signed out gives 401.

   If the push routes need push env in the test config, set it there; never use real keys.

   Also add one test to `apps/server/src/push/fcm.test.ts` or a new `apps/server/src/push/native-sender.test.ts`: `createNativeSender` returns `undefined` without the env, and a sender with a valid service-account JSON (from a locally generated key).

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §1.5 and §4.3, `packages/api-contract/src/push.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/config.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/fcm-token.ts`, `apps/server/src/main.ts:470-520` and `apps/server/src/files/routes.test.ts`.

### Allowed files
`packages/api-contract/src/push.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/api-subscribe.test.ts`, `apps/server/src/push/native-sender.ts`, `apps/server/src/push/native-sender.test.ts`, `apps/server/src/push/fcm.test.ts`, `apps/server/src/main.ts`, `work/T-1138-push-native-subscribe.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/api-subscribe.test.ts src/push/delivery.test.ts src/push/store.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `main.ts` grows by at most 3 lines.
- Without `FCM_SERVICE_ACCOUNT_JSON`, the server starts and logs `native (FCM) sender off`.

---

## Report (written by the worker when done)

status: review

### What I did

1. **Contract (`packages/api-contract/src/push.ts`).** Added
   `RegisterNativePushDevicePayload = { kind: 'fcm', token: 1..4096, userAgent? }`.
   The `subscribe` payload is now `Schema.Union([RegisterPushDevicePayload,
   RegisterNativePushDevicePayload])`, exported as `SubscribePushDevicePayload`.
   The Web Push body is byte-for-byte unchanged (no `kind`).
2. **Subscribe handler (`apps/server/src/push/api-subscribe.ts`).** Decodes the
   union. A body with `kind` calls `saveDevice` with `{ kind: 'fcm', token,
   userAgent }`; a body without `kind` keeps today's sealed Web Push path. The
   rate limit, node retry loop, room sync and `{ id, node, jid }` response are
   shared by both branches. An unknown `kind` or an empty token matches neither
   member and is 400 `invalid_subscription`. Nothing logs the token (the only
   logs here carry a user id and a node count).
3. **Native sender (`apps/server/src/push/native-sender.ts`, new).**
   `createNativeSender(push, logger)` returns `undefined` when `readFcmConfig`
   is `null` (log `push: native (FCM) sender off`), otherwise an
   `createFcmSender({ projectId, tokens: createFcmTokenProvider({ serviceAccount }) })`
   (log `push: native (FCM) sender on`). No value is logged; the service account
   only flows into the token provider.
4. **Wiring (`apps/server/src/main.ts`).** `const nativeSender =
   createNativeSender(push, logger)` next to `sender`, and
   `...(nativeSender === undefined ? {} : { nativeSender })` in `service`.
   Exactly 3 added lines.
5. **Tests.** New `apps/server/src/push/api-subscribe.test.ts` (4 tests) and
   `apps/server/src/push/native-sender.test.ts` (2 tests, RSA key generated
   in-process). No list/delete/test route changes.

### Files changed

- `packages/api-contract/src/push.ts`
- `apps/server/src/push/api-subscribe.ts`
- `apps/server/src/push/native-sender.ts` (new)
- `apps/server/src/push/api-subscribe.test.ts` (new)
- `apps/server/src/push/native-sender.test.ts` (new)
- `apps/server/src/main.ts` (+3 lines)
- `work/T-1138-push-native-subscribe.md` (this Report, status)

### Commands and results

- `pnpm install` — done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/push/api-subscribe.test.ts src/push/native-sender.test.ts` — 6 passed (2
  files).
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2
  src/push/api-subscribe.test.ts src/push/delivery.test.ts
  src/push/store.test.ts --reporter=dot` (the Checks line, plus the AGENTS worker
  cap) — 15 passed (3 files).
- `pnpm gate` — first run `GATE FAIL` on `@zilar/server:typecheck`
  (`TS4104` in my new test: a readonly SQL result returned as a mutable array);
  scope was already "every changed file is inside the Allowed files". Fixed the
  test. Final run: paste of the summary below.

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (2.6s)
PASS  effect  (0.7s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/server  (7.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations from the spec

- `createNativeSender` takes the server `logger` as a second argument, not only
  `push`. The on/off startup log has to live outside `main.ts` for `main.ts` to
  grow by at most 3 lines (import + `const` + spread); the factory is the only
  new place that can log it, and it needs the logger to do so. The first
  argument and the return type are exactly as specified.
- The contract exports the union as `SubscribePushDevicePayload`; the spec named
  the shape `Schema.Union([...])` without a name. The named export is the same
  union and lets the handler import one symbol.
- The two POST success tests assert **200**, not 201: the push group answers
  `200` for `subscribe` (verified by running). The rest of the response shape
  is as specified.
- The Checks vitest line is run with `--maxWorkers=2`, per the AGENTS rule for
  the shared machine.

### Open questions / blocked

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits, both accepted.**
- **The contract:** `SubscribePushDevicePayload` is the union of the unchanged Web Push body and `{ kind: 'fcm', token, userAgent? }`.
- **`api-subscribe.ts`:** the native body saves an `fcm` row through the same node-retry loop, rate limit, room sync and `{ id, node, jid }` answer. The Web Push body is unchanged; its decoded output never carries `kind`.
- **`push/native-sender.ts`:** `createNativeSender` returns `undefined` and logs "off" when `readFcmConfig` is null, otherwise an `FcmSender`. `main.ts` grows by 3 lines.
- **Accepted nits:**
  - a body with both shapes is stored as Web Push;
  - the "on" test doesn't pin `projectId`.
- **Tests:** the lead ran api-subscribe, native-sender, delivery and store on the branch: 17 green.
- **Live:** FCM stays off until `FCM_SERVICE_ACCOUNT_JSON` is set in Coolify.
