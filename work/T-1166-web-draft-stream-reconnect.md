---
id: T-1166
title: "AI-2 + AI-12: the web AI draft stream reopens with jittered backoff after an HTTP error (deploy 502, 401) instead of dying until reload; an AI 'progress' message no longer ends the shown draft turn"
status: merged
milestone: M5
branch: task/T-1166-web-draft-stream-reconnect
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1166: The web draft stream survives deploys

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md` AI-2 (P1) and AI-12 (P2), both confirmed.
- **AI-2:**
  - **What happens:** web opens a plain `EventSource` with no `error` handler (`apps/web/src/lib/drafts.ts:73-99`). By the spec, an `EventSource` that gets a non-200 response stops for good. Every deploy answers 502 for a while (main auto-deploys on every merge), so after a deploy web shows no AI "writing…" text until reload. The final messages still arrive.
  - **Comment and interface:** the comment at `:68-72` claims "EventSource reconnects on its own", which is wrong for HTTP errors. The `DraftEventSource` interface (`:41-44`) has only `addEventListener('draft' | 'end')` and `close()`.
  - **Mobile already does this right:** `apps/mobile/src/lib/drafts.ts:218-236` (`scheduleRetry`, full jitter, capped).
- **AI-12:** any DM message from the AI ends the shown draft turn (`packages/client-core/src/store/incoming.ts:136-142`). That includes the AI's progress message (`apps/server/src/agents/gateway/live.ts:88`, payload `type: 'progress'`). Later rounds' drafts are then ignored (`packages/client-core/src/store/polling.ts:202-204`, `finishedTurns`), and the answer appears all at once.

### What to build
1. **`apps/web/src/lib/drafts.ts`:**
   - extend `DraftEventSource` with `'error'` in `addEventListener` and a `readyState: number`;
   - in `subscribeToDrafts`, on `error` with `readyState === 2` (CLOSED), close it and open a new source after a full-jitter backoff: start at 1 s, cap at 30 s, the same formula as mobile's `scheduleRetry`;
   - reset the attempt counter when a `draft` or `end` event arrives;
   - the returned close function cancels a pending retry and closes the current source;
   - fix the comment.
2. **`packages/client-core/src/store/incoming.ts:140`:** don't finish the draft turn when `message.payload?.type === 'progress'`. Leave the rest of the message handling unchanged.
3. **No new tests** (streaming UI; the audit has no test for it).

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (AI-2, AI-12), `apps/web/src/lib/drafts.ts`, `apps/mobile/src/lib/drafts.ts:150-250`, `packages/client-core/src/store/incoming.ts:120-170` and `packages/client-core/src/store/polling.ts:190-230`.

### Allowed files
`apps/web/src/lib/drafts.ts`, `packages/client-core/src/store/incoming.ts`, `work/T-1166-web-draft-stream-reconnect.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the live web after the next deploy:** an AI reply streams without a page reload.

---

## Report (written by the worker when done)

### What I did
- **`apps/web/src/lib/drafts.ts` (AI-2):** `DraftEventSource` now exposes `readonly readyState: number` and accepts `'error'` in `addEventListener`. `subscribeToDrafts` registers an `error` listener that, when `readyState === 2` (CLOSED, i.e. the browser gave up after a non-2xx response such as a deploy's 502 or a 401), closes the source and reopens it after a full-jitter backoff (base 1 s, cap 30 s, `base/2 + base/2 * random()`, same formula as mobile's `scheduleRetry`). The attempt counter resets to 0 whenever a `draft` or `end` frame arrives (a healthy stream). The returned close function sets a `closed` flag, cancels a pending retry timer and closes the current source. The old comment claiming `EventSource` "reconnects on its own, so there is no retry loop" was corrected to say it only self-reconnects after a dropped connection, not after an HTTP error. Added `DRAFT_RECONNECT_BASE_MS = 1_000` and `DRAFT_RECONNECT_MAX_MS = 30_000` (same names as mobile). A failed `createSource` still means "behave as without drafts" — no retry loop, matching the previous behavior.
- **`packages/client-core/src/store/incoming.ts` (AI-12):** added `finishesDraft = fromAi && message.payload?.type !== 'progress'` and used it for finishing the draft turn and for removing the draft / remembering the finished message. A progress message (the AI's tool-round status) no longer ends the turn, so later rounds' drafts keep streaming. The rest of the message handling is unchanged.

### Files changed
- `apps/web/src/lib/drafts.ts`
- `packages/client-core/src/store/incoming.ts`
- `work/T-1166-web-draft-stream-reconnect.md`

### Commands and results
- `pnpm install`: Done (peer-dependency warning about `@types/react-dom` vs `@types/react`, pre-existing, unrelated).
- Single tests: none run separately; no test files are near the web change (UI) and the spec says no new tests. The gate ran the nearest client-core tests.
- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.5s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (2.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
- None. I also added an injectable `random` parameter (defaulting to `Math.random`) as the third argument of `subscribeToDrafts`, mirroring mobile's options; it is unused by callers.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **The web draft stream:**
  - `DraftEventSource` has `readyState` and `error`;
  - a CLOSED source is closed and reopened with full-jitter backoff (1 s, doubling to 30 s, as mobile does);
  - a frame resets the backoff;
  - close cancels a pending retry.
- **`incoming.ts`:** a `progress` payload from the AI no longer finishes or removes the draft.
- **Still to do:** the live check after the next deploy, on whether the AI reply streams without a reload.
