---
id: T-1528
title: "AI work in topics, step 5 (docs/audit/ai-work-plan.md T5), client-only: when a live group message starts or ends an AI task card, or brings an approval request, the shared store refreshes the chat list once (trailing 3 s window), so the topic activity from T-1514 updates without waiting for the 60 s poll"
status: merged
milestone: M5
branch: task/T-1528-live-ai-activity-refresh
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1528: The topic list follows AI activity live

## Spec (written by Claude, do not edit)

### Why
Since T-1514, `/api/chats` carries each topic's AI activity (working, waiting or done). The client only reloads the list on the 60 s poll, so the sidebar lags behind.

The plan (§6c) proposed a new server headline. The lead chose a smaller, client-only route that leaks nothing: every member already receives the live room messages the activity comes from.
- A **task card** is a group message with a `progress` payload, posted when a turn starts. Its final correction carries a terminal `state`: `done`, `failed` or `stopped` (`apps/server/src/agents/gateway/live.ts:98-131`, `:154-180`; `apps/server/src/agents/task-card.ts:136-150`).
- An **approval request** is a group message whose payload type is `approval.request` (rendered by `apps/web/src/components/message/AttachmentBody.tsx:246-250`).

A client only receives room messages for the rooms it may read, so a refresh reveals nothing new.

### Facts (the lead read them on main, 2026-10-15)
- **`packages/client-core/src/store/incoming.ts` (333 lines):**
  - `handleMessage(ctx: CoreCtx, message: ChatMessage)` (`:99`) is the live message path only; it is wired at `packages/client-core/src/store/lifecycle.ts:314`;
  - corrections return early through `k.isEditStanza(message)` (`:103-106`).
- **`ChatMessage`** (`packages/xmpp-core/src/types.ts`) has `kind: 'groupchat' | 'chat'`, `payload?: Payload` (with `type` and `data`) and `correction?`.
- **`CoreCtx`** (`packages/client-core/src/store/ctx.ts:125-131`) has `rt: Lifetime` (with `has(key)` and `forkKeyed(key, task)`, `packages/client-core/src/store/lifetime.ts:20-25`) and `fx` with `scheduleChatsRefresh()` (`ctx.ts:104`).
- **The existing burst helper:** `scheduleChatsRefreshBurst` (`packages/client-core/src/store/polling.ts:195-201`) refreshes at once, then ignores the next 2 s. Here we want the other way round: wait, then refresh once, so a turn's start and its first steps cost one fetch.
- **Both apps** use this store (`apps/web/src/store`, `apps/mobile/src/store` import `@zilar/client-core`).

### Steps
1. **New `packages/client-core/src/store/activity-refresh.ts`:**
   - `isAiActivityMessage(message: ChatMessage): boolean` is true when `message.kind === 'groupchat'` and either:
     - `payload.type === 'progress'` and it is a new card (no `correction`) or a correction whose `payload.data.state` is `done`, `failed` or `stopped`;
     - or `payload.type === 'approval.request'` (with no `correction`).
   - `scheduleActivityRefresh(ctx)`: if `ctx.rt.has('ai-activity-refresh')`, do nothing; otherwise `ctx.rt.forkKeyed('ai-activity-refresh', Effect.sleep(3000).pipe(Effect.andThen(Effect.sync(() => ctx.fx.scheduleChatsRefresh()))))`.
2. **`incoming.ts`:** at the very top of `handleMessage` (before the edit-stanza return), add `if (isAiActivityMessage(message)) scheduleActivityRefresh(ctx);`. The file must not grow by more than 3 lines.
3. **One test, `packages/client-core/src/store/activity-refresh.test.ts`,** for `isAiActivityMessage` (message pipeline):
   - a new progress card: true;
   - a progress correction with `state: 'done'`: true;
   - a mid-turn progress correction with no state: false;
   - an `approval.request` card: true;
   - a plain text message: false;
   - a DM progress card: false.

### Not in scope
- the server;
- the UI that shows the activity (steps 6 and 7);
- topic `doneAt` changes made by another person (the 60 s poll covers them).

### Allowed files
- `packages/client-core/src/store/activity-refresh.ts` (new)
- `packages/client-core/src/store/activity-refresh.test.ts` (new)
- `packages/client-core/src/store/incoming.ts`
- `work/T-1528-live-ai-activity-refresh.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/activity-refresh.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A live task card start or end, or an approval request in a group room, triggers one chat-list refresh about 3 s later.
- Later events inside the window do not add fetches.
- DMs and plain messages trigger nothing.

---

## Report (written by the worker when done)

### What I did

Client-only, as specified. No server or UI changes, no new dependencies.

- **`packages/client-core/src/store/activity-refresh.ts` (new):**
  - `isAiActivityMessage(message)` returns true for a live `groupchat` message that is a new `progress` card (`payload.type === 'progress'`, no `correction`), a `progress` correction whose `payload.data.state` is `done`, `failed` or `stopped`, or an `approval.request` with no `correction`. Everything else (mid-turn corrections, DMs, plain text) is false.
  - `scheduleActivityRefresh(ctx)` dedupes on a `'ai-activity-refresh'` keyed store fiber, then after `ACTIVITY_REFRESH_DELAY_MS` (3000) calls `ctx.fx.scheduleChatsRefresh()` once. Later activity inside the window adds no fetch; the timer dies with `stop()`.
- **`packages/client-core/src/store/incoming.ts`:** at the very top of `handleMessage`, before the edit-stanza return, `if (isAiActivityMessage(message)) scheduleActivityRefresh(ctx);`, plus one import. The file grew by 2 lines (333 → 335).
- **`packages/client-core/src/store/activity-refresh.test.ts` (new):** six cases on `isAiActivityMessage` (new card, terminal correction, mid-turn correction, approval request, plain text, DM progress card).

### Checks run

Single test files while working:

- `pnpm --filter @zilar/client-core exec vitest run src/store/activity-refresh.test.ts --maxWorkers=2 --reporter=dot` → `Test Files 1 passed (1) / Tests 6 passed (6)`.
- `pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts src/store/activity-refresh.test.ts --maxWorkers=2 --reporter=dot` → `Test Files 2 passed (2) / Tests 32 passed (32)`.

`pnpm gate` (repo root):

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (1.3s)
PASS  typecheck  (2.9s)
PASS  effect  (0.7s)
PASS  tests @zilar/client-core  (5.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

One small deviation, in `activity-refresh.ts` only. The Spec's Fact says `CoreCtx` has `fx` with `scheduleChatsRefresh()` (`ctx.ts:104`), but `ctx.ts:104` is inside `StoreAppHooks`; `CoreCtx.fx` is typed `CoreHooks` (`ctx.ts:131`), which does not carry `scheduleChatsRefresh`. `incoming.ts`'s `handleMessage` takes `CoreCtx` (and its tests pass a `CoreCtx`), so I kept the Spec's exact call line and narrowed inside `scheduleActivityRefresh` with `ctx.fx as StoreAppHooks` (both apps build the store ctx with `StoreAppHooks` at runtime, so the method is present; the comment in the file says so). Widening `handleMessage`'s ctx instead would have forced changes to `test-ctx.ts`/the existing tests, which are outside the Allowed files. Behaviour matches the Spec; `pnpm gate` typecheck passes. I did not edit `ctx.ts` (not allowed) — tell me if you would rather see the hook typed differently.

No security-relevant change: this reads no secrets, writes nothing, and only triggers an existing `/api/chats` refresh for rooms the client already receives.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean (0 findings) for head `1c5ae9828`.
- **The lead read the diff:**
  - `isAiActivityMessage` is true for a group message whose progress card is new, or whose correction carries a terminal `state` (`done`, `failed`, `stopped`), and for a new `approval.request`. DMs, mid-turn corrections and plain messages are false;
  - `scheduleActivityRefresh` forks one keyed 3 s timer, then calls `scheduleChatsRefresh`; later events inside the window add nothing;
  - `incoming.ts` grew by 2 lines;
  - one test covers the six message cases.
- **Accepted:** the `ctx.fx as StoreAppHooks` cast; both apps pass the full hooks.
- **Not checked live:** that needs a real AI turn in a group topic, so it rides the next live check.
