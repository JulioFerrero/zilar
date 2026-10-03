---
id: T-0168
title: A failed voice or attachment send shows "Not sent" with Retry, never a clock forever
status: planned
milestone: M5
branch: task/T-0168-send-failure-state
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0166]
estimate: 0.5 day
---

# T-0168: A failed voice or attachment send shows "Not sent" with Retry

## Spec (written by Claude, do not edit)

### Why
On the live install a voice message stayed on the clock forever. The cause was a server image without ffmpeg (fixed separately), but the app made it worse: `sendVoice` in `apps/web/src/store/realStore.ts` swallows every error (`catch {}` with the comment "stays sending") and `MessageStatus` has no failure value (`packages/chat-core/src/types.ts`: `'sending' | 'sent' | 'read'`). Any upload, conversion or network failure, for voice or for attachments, looks like "still sending" and the person cannot tell, retry or remove it.

### What to build
1. **Status.** Add `'failed'` to `MessageStatus`. A failed message keeps its local blob/file so it can be retried. `advanceStatus` must never move `failed` to `sending` by accident, only an explicit retry may.
2. **Voice and attachment sends** (`sendVoice`, `sendAttachment` and their stickers/GIF siblings only if they share the same catch pattern): when conversion, upload or the final send throws, set the message to `failed` and remember the reason in a small field (a fixed, user-safe string chosen from the error class: too large, unsupported file, server unavailable, upload refused, network). Never put raw error text or URLs into the UI or logs.
3. **UI.** A failed own message shows a red "Not sent" label with the reason, a **Retry** button and a **Delete** button (removes the local bubble). Retry re-runs the same pipeline from the retained blob and moves the bubble back to `sending`; success moves it to `sent` as today. Keyboard reachable, with accessible names.
4. **Timeout.** A send that neither succeeds nor fails within 60 seconds is marked `failed` with the reason "Timed out", so a hung request cannot sit on the clock either (cancel the pipeline with an AbortController where the ports allow it, otherwise ignore its late result).
5. **Mobile and shared types.** Adding the union member must not break the mobile app's typecheck: where mobile switches on `MessageStatus`, treat `failed` like `sending` plus a plain "Not sent" text, nothing more (a full mobile UI is a later task).
6. Tests (Vitest, Testing Library): conversion failure, upload failure and final-send failure each end in `failed` with the right reason; Retry succeeds and ends in `sent`; Delete removes the bubble; timeout; no raw error text appears; `advanceStatus` rules.

### Read first
`AGENTS.md`, `packages/chat-core/src/types.ts`, `apps/web/src/store/realStore.ts` (`sendVoice`, `sendAttachment`, `updateMessageStatus`, `advanceStatus`), `apps/web/src/lib/voice.ts`, the message bubble components that show the clock, `apps/mobile` usages of `MessageStatus`.

### Allowed files
`packages/chat-core/src/types.ts` and its tests, `apps/web/src/store/**`, the web message bubble and status components and their tests, the minimal `apps/mobile` lines needed to keep the typecheck green, `work/T-0168-send-failure-state.md`. No server changes, no new dependencies.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/web test --maxWorkers=2 src/store src/components src/lib/voice
pnpm --filter @zilar/chat-core test --maxWorkers=2
```

### Acceptance
- A voice message whose conversion fails ends as "Not sent: server unavailable" (or the matching reason), with Retry and Delete; Retry after the cause is fixed sends it.
- No send path in voice or attachments can stay on the clock for more than 60 seconds.
- Mobile typecheck passes.

### Out of scope
Text message retry and offline queueing, a full mobile failure UI, automatic retries.

---

## Report (written by the worker when done)

## Review (written by Claude)
