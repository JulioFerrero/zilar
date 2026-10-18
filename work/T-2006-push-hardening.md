---
id: T-2006
title: "Push hardening: Web Push endpoints only on https push-service hosts (no private addresses), sends time out and store a fixed failure reason; the push component accepts publishes only from the server domain; push nodes come from crypto randomness; the per-node job queue is capped — with tests"
status: merged
milestone: M5
branch: task/T-2006-push-hardening
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2006: Push hardening

## Spec (written by Claude, do not edit)

### Why
The lead's private security review on 2026-10-18 (T-1987) found three problems in the push code:
- **Any endpoint URL is accepted.** A user can register an internal address as their push endpoint. The server then POSTs to internal HTTPS hosts and reports the status back, which works as a port and service scanner.
- **Publishes from anyone.** The XMPP push component accepts publish requests from any user, not only from ejabberd.
- **Predictable nodes.** Push nodes come from `Math.random`.

This is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18)
- **Endpoint check.** Both schemas accept any parseable URL:
  - `packages/api-contract/src/push.ts` (183 lines): `RegisterPushDevicePayload.endpoint` (`:99-103`);
  - `apps/server/src/push/subscriptions.ts` (32 lines): `WebPushSubscriptionSchema` (`:11-18`).
- **Sending.** `apps/server/src/push/sender.ts` (71 lines) calls `webpush.sendNotification(..., payload, { TTL: 24 * 3600, urgency: 'normal' })` with no timeout (`:46-58`).
- **The component.** `apps/server/src/push/notification.ts` (101 lines) checks only that `from` is present (`:34-37`).
- **Nodes.** `apps/server/src/push/protocol.ts` (51 lines) has `randomNode(random = Math.random)` (`:44-…`). `push/api-subscribe.ts` uses it (`:80`, `:160`).
- **Tests.** The `push/` folder has tests, including `component.test.ts`, `delivery.test.ts` and `api-subscribe.test.ts`.

### Steps
1. **Allowed endpoints.** Accept only an `https:` URL on port 443 whose host is a known Web Push service or a subdomain of one, matched exactly or as a suffix with a leading dot:
   - `fcm.googleapis.com`
   - `updates.push.services.mozilla.com`
   - `push.services.mozilla.com`
   - `*.notify.windows.com`
   - `web.push.apple.com`
   - `*.push.apple.com`

   Put this list in one shared function in `packages/api-contract/src/push.ts` and use it in both schemas. Anything else answers `400 invalid_request`.
2. **Timeout and fixed reasons.** Pass `timeout: 10000` to `webpush.sendNotification`. Store failures as fixed reasons: `rejected`, `timeout` or `unreachable`. Never store the raw HTTP status.
3. **Component sender.** Drop any publish IQ whose `from` is not exactly the server's XMPP domain (the ejabberd host). Answer it with a `forbidden` error IQ, or drop it the way the code drops other bad IQs.
4. **Random nodes.** Generate nodes with `crypto.randomBytes` in the same alphabet and length. Keep the `random` parameter for tests only if existing tests need it.
5. **Queue cap.** Find the per-node job queue that a publish feeds. Cap it at 50 pending jobs per node, and drop new ones over the cap with a single warning log.
6. **Tests** (nearest test files):
   - an endpoint on `10.0.0.7` is refused;
   - an `fcm.googleapis.com` endpoint is accepted;
   - a publish from a user JID is dropped;
   - a publish from the server domain is processed.
7. **Size.** Every file stays at or under 400 lines.

### Allowed files
- `packages/api-contract/src/push.ts`
- `apps/server/src/push/subscriptions.ts`
- `apps/server/src/push/sender.ts`
- `apps/server/src/push/notification.ts`
- `apps/server/src/push/protocol.ts`
- `apps/server/src/push/api-subscribe.ts`
- `apps/server/src/push/delivery.ts`
- `apps/server/src/push/component.ts`
- `apps/server/src/push/component.test.ts`
- `apps/server/src/push/api-subscribe.test.ts`
- `apps/server/src/push/delivery.test.ts`
- `work/T-2006-push-hardening.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- After the deploy, the lead checks that Julio's browser and phone pushes still arrive. He has a Web Push device (Helium) and FCM.

---

## Report (written by the worker when done)

### What I did

- **Allowed endpoints (step 1).** Added `isAllowedPushEndpoint` to
  `packages/api-contract/src/push.ts`: it accepts only `https:` on port 443
  (explicit or default) whose host is one of the listed services, matched
  exactly or as a subdomain for the `*.notify.windows.com` and
  `*.push.apple.com` entries. `RegisterPushDevicePayload` and the server's
  `WebPushSubscriptionSchema` both use it. The subscribe route answers a
  well-formed body with a refused endpoint with `400 invalid_request`; other
  invalid subscribe bodies keep the route's existing `400 invalid_subscription`.
- **Timeout and fixed reasons (step 2).** `sender.ts` passes `timeout: 10_000`
  to `webpush.sendNotification`. The publish delivery path (`delivery.ts`) now
  stores one of `rejected` (the push service or FCM answered), `timeout`
  (`Socket timeout`, `ETIMEDOUT`, `TimeoutError`) or `unreachable` (everything
  else) with `failedAt`; the raw status/code is no longer stored there.
- **Component sender (step 3).** `component.ts` reads
  `service.config.xmpp.domain` and only schedules a publish whose `from`
  matches it exactly. A publish from a user JID (or any other sender) is
  answered `result` and dropped, like the other malformed IQs, so it can never
  disable the pair with an error IQ.
- **Random nodes (step 4).** `protocol.ts#randomNode` now draws from
  `crypto.randomBytes`, rejecting bytes >= 248 to avoid modulo bias, in the
  same `p` + 32 base62 shape. The old `random` parameter was removed: no test
  used it.
- **Queue cap (step 5).** `component.ts` tracks queued+running jobs per node
  and drops publishes over 50, logging one warning per saturation (not one per
  dropped publish). The counter is decremented in the job observer, and the
  saturation marker clears when the node drains, so a later burst warns again.
- **Tests (step 6).** `component.test.ts`: a publish from a user JID is
  dropped; the existing test covers a publish from the server domain being
  processed; a new test caps a node at 50 pending publishes and checks the
  single warning. `api-subscribe.test.ts`: `https://fcm.googleapis.com/...` is
  accepted and `https://10.0.0.7/push` is refused with
  `400 invalid_request`, storing nothing. `delivery.test.ts`: the FCM failure
  test now expects `rejected`, and a new Web Push timeout test expects
  `timeout`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/component.test.ts`:
  5 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/delivery.test.ts src/push/api-subscribe.test.ts`:
  17 passed.
- `pnpm --filter @zilar/server exec vitest run src/push --reporter=dot --maxWorkers=2`
  (the task's check, with the worker cap AGENTS.md requires): 13 files, 86 tests
  passed.
- `pnpm gate` from the repo root:

  ```
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.3s)
  PASS  effect  (2.3s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (44.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Files changed:** `packages/api-contract/src/push.ts` and
  `apps/server/src/push/{subscriptions,sender,component,protocol,api-subscribe,delivery}.ts`,
  plus `component.test.ts`, `api-subscribe.test.ts` and `delivery.test.ts`. No
  file outside the Allowed list was touched.
- **Deviation, fixed reasons outside the publish path:** `POST /api/push/test`
  (`push/api-test.ts`) still stores `pushFailureReason(error)` from
  `push/failure-reason.ts`, i.e. an FCM code or `http-<status>`. Those files are
  not in the Allowed list, so I left them unchanged; only publish-triggered
  sends store the new fixed reasons. If you want the test endpoint hardened in
  the same release, that needs one more allowed file (`api-test.ts`, and
  probably `failure-reason.ts`).
- **Queue semantics:** the cap counts the running job too (50 in flight per
  node). The warning is emitted once while the node stays saturated; a new
  burst after the queue drains logs again.
- **No changes** to endpoint handling for native (`fcm`/`apns`) devices: they
  carry tokens, not URLs.

### Round (review fixes)

- **Fixed should-fix 1 (legacy endpoints).** `sender.ts` now re-checks
  `isAllowedPushEndpoint` on every send, before `webpush.sendNotification`.
  A stored row outside the allowlist (including rows written before this
  deploy) makes no network request and is reported as `{ gone: true }`, so
  `deliverToDevice` removes it like an expired subscription. The guard sits in
  the real sender rather than `deliverToDevice` so it also covers
  `POST /api/push/test`, and because `group-notifier.test.ts` (outside the
  Allowed files) drives `deliverToDevice` with fake senders and
  `push.example.com` endpoints.
- **Tests added.** `delivery.test.ts`: a new `createWebPushSender endpoint
  guard` test proves a `https://169.254.169.254/...` endpoint resolves to
  `{ gone: true }` with no request; the Web Push fixtures now use an allowed
  FCM endpoint.
- **Not changed.** Nit 1 (the cap counts the running job) is outside the
  changed lines and disclosed in the previous round. Both follow-ups
  (`api-test.ts` raw reasons, stale comments in `store.ts`/`service.ts`)
  still need files outside the Allowed list.
- **Checks.** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/push/delivery.test.ts`: 11 passed. `pnpm --filter @zilar/server exec
  vitest run src/push --reporter=dot --maxWorkers=2`: 13 files, 87 tests
  passed. `pnpm gate`: GATE PASS (install, format, lint, typecheck, effect,
  server tests 15.1s; scope/migration/images/size clean).
- **Disagreements.** None.


## Review (written by Claude)

Approved after 1 auto round; the pre-review found 1 nit and 3 follow-ups.
- **What changed:**
  - Web Push endpoints must be https on port 443 at a known push-service host. Both schemas use one shared allowlist, and the sender never dials a stored endpoint that isn't on it.
  - Sends time out at 10 s and store fixed reasons.
  - The push component accepts publishes only from the server domain.
  - Nodes come from `crypto.randomBytes`.
  - The per-node queue is capped at 50.
- **Lead check, live database:** `push_subscriptions` holds 2 Web Push rows, both on `updates.push.services.mozilla.com`, which is allowed. So no live subscription is dropped by the new guard. Phone devices use FCM tokens.
- **Follow-ups (small):**
  - `POST /api/push/test` still stores raw reasons, and it reports a guard-skipped legacy row as sent;
  - the reason-format comments in `push/store.ts:139` and `push/service.ts:67` are stale.
