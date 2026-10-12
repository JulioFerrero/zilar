---
id: T-1152
title: "F2 (audit MP-2b, MP-8, MP-13): the XEP-0357 <enable/> is sent on EVERY new XMPP session (each transition to online), on mobile from the saved registration and on web from the stored device; web sign-out sends <disable/>"
status: merged
milestone: M5
branch: task/T-1152-push-pair-every-session
model: auto
effort: default
depends_on: [T-1150]
estimate: 0.4 day
---

# T-1152: Push pair on every session (F2)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-2 (second half), MP-8 and MP-13, and fix **F2**.
- **ejabberd binds a push pair to the c2s session that sent `<enable/>`.** A reconnect that makes a new session has no pair, so it can never trigger ejabberd's pending-path push.
- **The only senders today:**
  - mobile, once per signed-in session (`apps/mobile/src/store/chat-store-provider.tsx:146-157`, the `registered` flag; `apps/mobile/src/lib/push/native.ts`, `registerToken`);
  - web, only from the "Enable" button (`apps/web/src/lib/push/usePushEnable.ts:146-194`).
- **The stale pair:** after a reload, the web pair belongs to a dead session, and it pushes every DM even while the tab is focused (MP-8).
- **Web stores** `{ id, node }` in `localStorage` (`apps/web/src/lib/push/deviceStorage.ts`). The push JID comes from the push config (`usePushEnable.ts:236` uses `config.pushJid`).

### What to build
1. **Mobile:**
   - in `native.ts`, export `ensurePushPair({ setPushPair })`: it reads the saved registration (`zilar.push.registration`), sends `<enable/>` with its `jid` and `node`, and logs `console.warn` on failure, never the node;
   - in `chat-store-provider.tsx`, the first `online` keeps calling `registerNativePush` (POST and enable, as today). **Every later transition into `online`**, from a reconnect or a wake, calls `ensurePushPair`;
   - a failed enable is retried on the next `online`, which fixes MP-13.
2. **Web:**
   - **a new `apps/web/src/lib/push/sessionEnable.ts`:** on every transition into `online`, when `readStoredDevice()` returns a device and `Notification.permission === 'granted'`, send `setPushPair({ pushJid, node, enable: true })`. Get `pushJid` from the existing push-config API call used by `usePushEnable.ts` (find it and cite it in the Report), cached in the module;
   - **the hook:** subscribe to the store's status in `apps/web/src/store/ChatStoreProvider.tsx` (101 lines), or in `storeContext.ts` next to the other `fx` wiring, whichever is smaller. Describe it in the Report;
   - **sign-out:** before the store disconnects, send `setPushPair({ …, enable: false })` for the stored device, best effort with a 2 s timeout. Find the web sign-out path (`apps/web/src/store/effects/lifecycle.ts`, `signOutStore`) and keep it at most 400 lines;
   - the in-tab notifications (T-1145) stay as they are.
3. **No server change.**
4. **Tests** (the message pipeline), at most 2:
   - in `apps/mobile/src/lib/push/native.test.ts`: `ensurePushPair` sends `<enable/>` with the saved node; with no saved registration it does nothing;
   - in a new `apps/web/src/lib/push/sessionEnable.test.ts`: on online with a stored device and permission granted, it enables once per transition.

### Read first
`AGENTS.md`, `docs/audit/message-pipeline-audit.md` (sections 2 and 3E, F2), `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/native.test.ts`, `apps/mobile/src/store/chat-store-provider.tsx:130-170`, `apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/lib/push/deviceStorage.ts`, `apps/web/src/store/ChatStoreProvider.tsx` and `apps/web/src/store/effects/lifecycle.ts`.

### Allowed files
`apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/native.test.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/web/src/lib/push/sessionEnable.ts`, `apps/web/src/lib/push/sessionEnable.test.ts`, `apps/web/src/store/ChatStoreProvider.tsx`, `apps/web/src/store/effects/storeContext.ts`, `apps/web/src/store/effects/lifecycle.ts`, `work/T-1152-push-pair-every-session.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/push/native.test.ts --reporter=dot
pnpm --filter @zilar/web exec vitest run src/lib/push/sessionEnable.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check:** enable push in phone Firefox, reload the page, background the browser, and have another account send a DM. One notification comes, and nothing comes while the tab is focused.

---

## Report (written by the worker when done)

Done. F2: the XEP-0357 `<enable/>` is re-sent on every new XMPP session, on
mobile from the saved registration and on web from the stored device; web
sign-out sends `<disable/>`. No server change.

### Mobile
- `apps/mobile/src/lib/push/native.ts`: new exported `ensurePushPair({ setPushPair })`
  reads `zilar.push.registration` from SecureStore and sends `<enable/>` with
  its `jid` and `node`. No registration (missing or malformed) means no call.
  A failure reaches only `console.warn` — never the node — and the next online
  retries (MP-13 fix; the registration survives because `registerTokenOnce`
  saves it even when the first enable fails).
- `apps/mobile/src/store/chat-store-provider.tsx`: the status subscriber now
  tracks transitions. The first `online` keeps calling `registerNativePush`
  (POST + enable, as before); every later transition into `online` (reconnect
  or wake) calls `ensurePushPair({ setPushPair })`.

### Web
- New `apps/web/src/lib/push/sessionEnable.ts`: `startSessionEnable(store)`
  subscribes and calls `enableSessionPush` on each transition into `online`,
  which sends `setPushPair({ pushJid, node, enable: true })` only when
  `readStoredDevice()` returns a device and `Notification.permission` is
  `'granted'`. The push JID comes from `getPushConfig()` from `@/lib/api`
  (re-exported from `apps/web/src/lib/api/stickers.ts`; the same call the
  Enable button uses in `usePushEnable.ts:162` and whose `config.pushJid`
  `disableOnThisDevice` uses at `usePushEnable.ts:236`), cached in a
  module-level `cachedPushJid`. Also exports `disableSessionPush`: `<disable/>`
  for the stored device with a 2 s timeout (`Duration.millis`), best effort.
  The hook is subscribed in `apps/web/src/store/ChatStoreProvider.tsx` (a new
  `useEffect` returning `startSessionEnable(value)`; skipped for the
  test-passed `store` prop and mock mode) — chosen over `storeContext.ts`
  because the narrow fake-store type keeps the unit test dependency-free.
- `apps/web/src/store/effects/lifecycle.ts` (`signOutStore`): before the store
  disconnects (`resetUserState`), runs `disableSessionPush` with the store's
  `setPushPair`, wrapped in `Effect.promise(...).pipe(Effect.ignore)` so a
  missing device, a failed config read or a failed/timed-out disable
  (ran as an Effect inside, timeout via `Effect.timeoutOrElse` 2000 ms) never
  blocks sign-out. File stays at 178 lines; in-tab notifications untouched.

### Tests (2 spec tests, both ran green)
- `apps/mobile/src/lib/push/native.test.ts`: new `ensurePushPair` test —
  sends `setPushPair({ pushJid, node, enable: true })` with the saved node;
  with no saved registration it sends nothing.
- New `apps/web/src/lib/push/sessionEnable.test.ts`: `startSessionEnable` on a
  fake store — two online entries after offline gaps enabled exactly twice
  (repeat online statuses do not re-enable; one enable per transition).

### Commands (real results)
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/push/native.test.ts`: 5 passed (4 existing + 1 new).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot
  src/lib/push/sessionEnable.test.ts`: 1 passed.
- `pnpm gate` (from repo root):
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS effect`, `PASS tests @zilar/mobile`, `PASS tests @zilar/web`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.
  8 changed files against main, all inside Allowed files.
- Every touched file is ≤ 400 lines (native.ts 249, provider 203,
  sessionEnable.ts ~190, web provider ~116, lifecycle 178, tests small).

### Problems / deviations
- `pnpm gate`'s effect ratchet requires new/changed web sources with promise
  plumbing (`async`, `try/catch`, `setTimeout`) to use Effect. First pass
  failed on `sessionEnable.ts`; the module is now Effect-based
  (`Effect.fnUntraced`, `Effect.tryPromise`, `Effect.timeoutOrElse` with
  `Duration.millis`, `Effect.runFork` for the fire-and-forget transition).
  Follow-up type fixes used the repo's existing idiom
  (`attachments.ts:127` `Effect.timeoutOrElse` + `Duration`). Mobile needed
  no change (native Push APIs are exempt).
- `pnpm exec prettier --write` ran twice for gate format failures.
- The lead's phone check (push in phone Firefox, reload, background, one DM
  notification; nothing while focused) was not run here — no device in this
  session. The unit behavior backing it (re-enable each online, disable on
  sign-out) is tested.
- No dependencies added. No secrets touched.

### Round (fix round: PREREVIEW should-fix 1)
- Fixed finding 1 (should-fix): the stored web device (`zilar:pushDevice`)
  is now cleared on the sign-out/user-change paths, so a second account on a
  shared browser cannot re-enable the first user's node.
  - `apps/web/src/lib/push/sessionEnable.ts`: `disableSessionPush` takes an
    injectable `clearDevice` (default `writeStoredDevice(null)`) and clears
    the handle in an `Effect.ensuring` after the `<disable/>` attempt, so it
    clears even on a failed or timed-out disable — mirroring mobile's
    `unregisterNativePush`, which always clears `PUSH_REGISTRATION_KEY` in a
    `finally`. Covers the normal sign-out path (best-effort offline sign-out
    included: read still misses, as before, but the handle is gone).
  - `apps/web/src/store/effects/lifecycle.ts`: `resetUserState` also clears
    the stored device directly. This covers the account-switch path the
    finding cites (`switchUser` → `resetUserState` with no disable at all,
    `chatActions.ts:199` — read-only, outside Allowed files, left untouched).
- Findings 2 and 3 are nits per the pre-review verdict: left as they are, no
  lines touched.
- Tests: extended the existing `sessionEnable.test.ts` (still 1 file, 2
  tests — no third test added per the spec cap) with a `disableSessionPush`
  test: sends `<disable/>` with the stored node once and clears the device.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot
  src/lib/push/sessionEnable.test.ts`: 2 passed.
- `pnpm gate` (from repo root): `PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile`,
  `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed
  files`, `GATE PASS`.
- Single tests run this round: `pnpm --filter @zilar/web test --maxWorkers=2
  --reporter=dot src/lib/push/sessionEnable.test.ts` (2 passed). Mobile's
  `native.test.ts` untouched this round; gate re-ran it green.

### Round (fix round 2: PREREVIEW should-fix 1, nit 2)
- Fixed finding 1 (should-fix): `disableSessionPush` now runs the whole body
  — the `readPushJid` config read included — inside the single 2 s
  `timeoutOrElse`, so a stalled push-config response can no longer hold
  `signOutStore` past `timeoutMs`. The `<disable/>` send keeps its own
  warn-and-ignore; only the bound moved outward.
- Fixed finding 2 (nit, same lines): the `ensuring(clearDevice)` now wraps
  the bounded body, so the docstring's "always cleared" holds even when the
  JID read misses — no early return skips it anymore.
- Finding 3 is a follow-up needing files outside Allowed files: left
  untouched, no lines touched.
- Tests: extended the existing `sessionEnable.test.ts` disable test (still 2
  tests, within the spec cap) with the finding's scenario — a never-resolving
  `getConfig` with `timeoutMs: 50` (fresh module via `vi.resetModules` so the
  cached JID cannot hide the stall): `setPushPair` is never called and the
  device is still cleared.
- Single test: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot
  src/lib/push/sessionEnable.test.ts`: 2 passed.
- `pnpm gate` (from repo root): `PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile`,
  `PASS tests @zilar/web`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.
  9 changed files against main (8 prior + sessionEnable.test.ts extended),
  all inside Allowed files.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Clean after 2 auto rounds; 2 nits and 1 follow-up.**
- **Mobile:** `ensurePushPair` re-sends `<enable/>` with the saved node on every later transition into `online`. The first online still registers, and a failed enable is retried on the next online (MP-13).
- **Web:** `sessionEnable.ts` sends `<enable/>` on every online when a stored device exists and permission is granted (push JID from `getPushConfig`). Sign-out sends `<disable/>` (2 s bound) and always clears the stored device.
- **Tests:** the lead ran them in the branch: mobile 5 of 5, web 2 of 2.
- **Follow-up, for the lead:**
  - `switchUser` (web account switch without sign-out) sends no `<disable/>`;
  - server-side, a web-push endpoint should have one owner, as native tokens do (T-1141). Otherwise user A's pushes can reach a browser now used by B.
- **Still to do:** the live check (Firefox enable, reload, background, DM gives one notification, nothing while focused).
