---
id: T-1257
title: "Delivered tick step 4: a phone woken by a push reports delivery — when the recipient's device fetches GET push preview for a message it may see, the server stores the delivered mark for that message (markDeliveredAndNotify, forked, never delays or fails the preview); server only"
status: merged
milestone: M5
branch: task/T-1257-push-preview-marks-delivered
model: auto
effort: default
depends_on: [T-1245]
estimate: 0.2 day
---

# T-1257: A push wake counts as delivered

## Spec (written by Claude, do not edit)

### Why
This is MP-F8 step 4.
- **Where delivery comes from today:** the apps report delivery only while their socket is connected (T-1238). A phone in the background gets a data-only FCM wake (`apps/mobile/src/lib/push/background.ts:1-9`) and calls the push preview route to build the notification.
- **The preview route proves arrival:** it is `apps/server/src/push/api-handlers.ts:152-209`. The device's user is the recipient, and the route already proved the message is in a chat they may see (`readCandidateByOriginId` plus `resolveCandidate`, then `verdict.message.chatJid`: the peer for a DM, `apps/server/src/push/candidates.ts:133`, and the room for a group, `:101`).
- **So:** in Telegram, a message counts as delivered when the phone gets it, so we mark delivered there.
- **No mobile change is needed:** the preview call already happens on every wake.

### What to build
1. **In the preview handler:** after the verdict is `ok` (`api-handlers.ts:194-200`), fork the delivery mark with `markDeliveredAndNotify` (`apps/server/src/chats/delivered-notice.ts:135-150`):
   - pass the push deps' `db`, `config`, `archive`, `adminClient` and `logger` (`apps/server/src/push/api.ts:53-58`), and `{ bare: verdict.message.chatJid, userId, originIds: [request.query.messageId] }`. Check that `bare` means the same as for `PUT /chats/:jid/delivered` (`apps/server/src/chats/deliveries.ts:320-356`) and cite it;
   - fork it with `Effect.runFork` and catch every error with a warn log of ids only, so the preview answer never waits on it and never fails because of it;
   - do this **only** when `verdict.status === 'ok'`. A muted, hidden or skipped verdict, and an unknown or forbidden message, mark nothing. (Lead ruling, 2026-10-12: the first version of this line contradicted itself, because a muted or hidden verdict is never `ok`.)
   - the test wake (`TEST_WAKE_CHAT_ID`) marks nothing.
2. Keep `api-handlers.ts` at most 400 lines (it is 355). If it doesn't fit, move a helper into `apps/server/src/push/preview-delivered.ts`.
3. **Tests** (the message pipeline), in `apps/server/src/push/api-preview.test.ts`, up to 2:
   - a preview of a DM message the caller may see stores the caller's delivered mark for that chat;
   - a preview of an unknown id (404) stores nothing.

### Read first
`AGENTS.md`, `work/T-1229-delivered-server.md`, `work/T-1245-delivered-live-notice.md`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/chats/delivered-notice.ts`, `apps/server/src/chats/deliveries.ts` and `apps/server/src/push/api-preview.test.ts`.

### Allowed files
`apps/server/src/push/api-handlers.ts`, `apps/server/src/push/preview-delivered.ts`, `apps/server/src/push/api-preview.test.ts`, `work/T-1257-push-preview-marks-delivered.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/api-preview.test.ts src/chats/deliveries.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **Live (needs Julio's phone):** with the app in the background, a message to Julio turns grey double tick for the sender as soon as the push arrives.

---

## Report (written by the worker when done)

**Status: review.** Done.

### What I built

1. **`apps/server/src/push/preview-delivered.ts` (new).** `forkPreviewDelivered(deps, { chatJid, userId, messageId })` wraps `markDeliveredAndNotify` in `Effect.tryPromise` and `Effect.runFork`s it, with an `Effect.catch` that logs a warn of ids only (`{ userId, chatJid, err: errorClassName }`). Nothing waits on the mark and nothing fails the preview because of it.
2. **`apps/server/src/push/api-handlers.ts` (the preview handler).** Right after the `verdict.status === 'ok'` guard and before the payload build, it calls `forkPreviewDelivered(deps, { chatJid: verdict.message.chatJid, userId, messageId: request.query.messageId })`, skipping `TEST_WAKE_CHAT_ID`. `bare` is exactly the value `PUT /chats/:jid/delivered` stores (cited in the helper's header): `verdict.message.chatJid` is the DM peer (`candidates.ts:133`) or the room JID (`candidates.ts:101`), and `deliveryScopeForChat` (`chats/deliveries.ts:258-274`) reads that same `bare`. The file is 369 lines (≤ 400).
3. **`apps/server/src/push/api-preview.test.ts`.** Two new message-pipeline tests.

### Tests

- a DM preview stores the caller's delivered mark for that chat: the archive fake seeds both the recipient's copy (what `readCandidateByOriginId` reads) and the author's copy under the same origin id (what the mark's scope reads); the test waits for the forked write and asserts `chat_deliveries` = `{ chatJid: <peer>, deliveredId: <author's timestamp> }`.
- an unknown id (404) stores nothing.

### Commands and results

- `pnpm install` — OK (`Done in 12.1s using pnpm v10.32.1`; unrelated peer warning `@types/react-dom` vs `@types/react`).
- `pnpm --filter @zilar/server exec vitest run src/push/api-preview.test.ts src/chats/deliveries.test.ts --maxWorkers=2 --reporter=dot` — 2 files, **11 passed**.
- `pnpm gate` (repo root) — **GATE PASS**:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (18.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- One mid-run correction worth knowing: the first `pnpm gate` failed on format (`api-preview.test.ts`) and then on typecheck (`exactOptionalPropertyTypes`: the helper must not pass `adminClient: undefined` to `markDeliveredAndNotify`'s optional field, and `PushApiDependencies`' optional `archive` needed a matching optional shape). Fixed with `prettier --write` on the test file and an optional-shaped `PreviewDeliveredDeps` plus a conditional spread for `adminClient`; format, lint, typecheck and the server tests then passed.

### Muted/hidden: interpretation (deviation, please confirm)

The spec says: do this "even when the payload is a muted or hidden 404 (the message still arrived), but **only** after `verdict.status === 'ok'`." Those two clauses conflict: `resolveCandidate` returns `{ status: 'muted' }` / `{ status: 'hidden' }` (`candidates.ts:71-73,95`), and the handler answers 404 on any non-`ok` verdict *before* the payload. I followed the binding clause — **only an `ok` verdict marks** — and put the fork right after the `ok` guard and before the payload build, so it also runs when previews are off (the body is the generic "New message") and before the `payload === undefined` 404. Muted, hidden, skip and unknown mark nothing. This also matches the plan's privacy note (`docs/plan/delivered-tick.md:136-142`: a confirmation must never be sent for a muted message, "or a muted message would leak its arrival to the sender"). If the lead did want muted/hidden to mark, it is a one-line move of the fork above the `verdict.status !== 'ok'` guard, but that would contradict the privacy note, so I did not do it. Flagging it explicitly rather than guessing.

The test wake marks nothing: the mobile task never fetches a preview for a test wake (`apps/mobile/src/lib/push/background.ts:117-120`), and the handler skips `TEST_WAKE_CHAT_ID` anyway.

### Security checklist

- Secrets/tokens: none; the new warn log carries ids only (`userId`, `chatJid`), never text, and the mark carries the origin id only.
- Write scoped: `putChatDelivery` is keyed `(user_id, chat_jid)`; the mark runs only after the same access proof the preview already made (`readCandidateByOriginId` + `resolveCandidate`).
- Atomic: the forward-only `ON CONFLICT … WHERE` is `putChatDelivery`'s, unchanged.
- Effect after permission: the mark is forked only after `verdict.status === 'ok'`; nothing runs for unknown, invisible, muted or hidden.
- 404 parity: unchanged; no route added, and the preview stays in the 401 sweep.
- Audit: none touched.

### Deviations and notes

- The muted/hidden interpretation above is the only substantive deviation.
- The helper lives in the Allowed `preview-delivered.ts` rather than inline, to keep `api-handlers.ts` well under 400 (spec §2 allows it).

### Open questions

- Confirm the muted/hidden interpretation above. It is not blocking the happy path (DM message the caller may see) or the Checks.

### Acceptance

- The Checks pass. The live check (a backgrounded phone turns the sender's bubble grey double-tick as soon as the push arrives) needs Julio's phone; I did not run it.

## Round 1 (fix round)

**Status: blocked.** PREREVIEW.md has exactly one finding (should-fix, no must-fix, no nits). It needs the lead's ruling on the Spec, which I cannot make from the Allowed files, so I made no code change.

- **Finding 1 (should-fix) — muted/hidden Spec contradiction: lead to rule; no code change made.** The finding itself concludes the Spec's two clauses ("mark even when the payload is a muted or hidden 404" and "only after `verdict.status === 'ok'`") are jointly unsatisfiable, confirms the worker's `ok`-only reading, and recommends the **lead** amend the Spec sentence; it states "no code change needed". I checked it against the code rather than the Report: `resolveCandidate` returns `muted`/`hidden`/`skip` (`apps/server/src/push/candidates.ts:71-73,95,125-127`) and the handler answers 404 on every non-`ok` verdict (`apps/server/src/push/api-handlers.ts:189-191`) *before* the fork (`:198-204`), so a muted/hidden message can never reach the `ok`-gated mark. The plan's privacy note (`docs/plan/delivered-tick.md:136-142`) requires exactly that ("a muted message would leak its arrival to the sender"), so moving the fork above the guard would be a privacy regression. I did not do it.
- **Why blocked and not a commit.** The only remaining action is the lead amending the Spec's muted/hidden sentence. The Spec is the lead's ("Spec, written by Claude. Don't change it", AGENTS.md) and is not mine to edit, so this is a decision I cannot make. Per the fix-round instruction I set `status: blocked` instead of forcing a code change.
- **Tests added: none.** No behaviour changed this round, so there is no new behaviour to test and the finding names no test.
- **Checks.** No code changed, so nothing new to gate. I ran `pnpm gate` once from the repo root anyway to confirm the branch is green: **GATE PASS** (`gate: 4 changed file(s) against main`; install, format, lint, typecheck, effect, tests @zilar/server all PASS; scope clean). Single tests were not re-run this round (the code is untouched); PREREVIEW reports `api-preview.test.ts`: 6 passed.
- **Disagreements:** none. I agree with the finding and with the worker's `ok`-only reading.

Blocked / needs a decision: the lead confirms the `ok`-only reading (as PREREVIEW recommends) and amends the Spec's muted/hidden sentence. The shipped code is sound and mergeable; no code change is required either way.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round, plus the lead's spec ruling (mark only on an `ok` verdict).**
- **The change:** the preview handler forks `forkPreviewDelivered` (in the new `preview-delivered.ts`) after the `ok` verdict.
  - It never delays or fails the answer.
  - The test wake is excluded.
  - Unknown, forbidden, muted, hidden and skipped messages all 404 earlier, so they mark nothing.
- **The `bare` check:** the worker showed `bare` matches the PUT route (`candidates.ts:117,133`, `access.ts:106`).
- **Lead's checks after rebasing onto main:**
  - push `api-preview` + chats `deliveries` tests: 11 passed;
  - server tsc: 0 errors;
  - `api-handlers.ts` is 369 lines.
- **Live check, needs Julio's phone:** with the app in the background, a message to Julio turns grey double tick for the sender when the push arrives.
