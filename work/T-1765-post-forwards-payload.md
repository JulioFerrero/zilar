---
id: T-1765
title: "Blocks live bug: the production post port drops payload, so tool.run and tool routines post plain text instead of the card; forward it and add a regression test"
status: merged
milestone: M5
branch: task/T-1765-post-forwards-payload
model: auto
effort: default
depends_on: [T-1761]
estimate: 20 min
---

# T-1765: The post port forwards the card

## Spec (written by Claude, do not edit)

### Why
Julio's live test (2026-10-16, 22:21 UTC) in "ai test › General":
- Deepseek ran its saved tool `market-prices` v2. Its source returns `{ text, blocks: [{ kind: 'figure', rows }, { kind: 'callout', tone: 'info', text }] }`, which is valid against `packages/protocol/src/blocks-numbers.ts:92-103` and `:88-92`.
- The room got plain text (`market-prices BTC $81684.05 · …`), not a card.
- The server logged no `tool.run blocks invalid`, so `buildBlocksPayload` succeeded and the payload was lost after that.

### Facts (read by the lead on 2026-10-17)
- **The cause:** the production post port in `apps/server/src/startup/components.ts:84-95` (316 lines) destructures `({ aiId, groupId, topicId, text })` and calls `gateway.postToChat({ aiId, groupId, topicId?, text })`. It **drops `payload`**.
- **Its type** is `BuildToolAdaptersDeps['post']` (`apps/server/src/tools/adapter-support.ts:23-29`), which has `payload?: Payload` since T-1759.
- **The gateway already sends it:** `postToChat` accepts `payload?: Payload` (`apps/server/src/agents/gateway/contracts.ts:271-277`), and `postToChatEffect` passes `sendOptions(input)` to every send (`apps/server/src/agents/gateway/live.ts:283-323`).
- **Who uses the port:** `tool.run` (`apps/server/src/tools/tool-adapters.ts`, T-1761) and the routine scheduler (`apps/server/src/routines/wiring.ts:26,59` → `apps/server/src/routines/execute.ts`, T-1759), so tool routines lost their cards too.

### Steps
1. **Move the port** into a new `apps/server/src/startup/post-as-ai.ts`:
   ```ts
   export function postAsAi(
     getGateway: () => Pick<AgentGateway, 'postToChat'> | null,
   ): BuildToolAdaptersDeps['post']
   ```
   - It answers `false` while there's no gateway, as today.
   - Otherwise it forwards `aiId`, `groupId`, `topicId` when set, `text`, and **`payload` when set**.
   - Use the gateway type that `components.ts` already uses for `running.gateway`, or the `postToChat` signature from `contracts.ts`.
2. **In `components.ts`,** replace the inline arrow with `const post = postAsAi(() => running.gateway);`.
3. **One test** (the message pipeline), in a new `apps/server/src/startup/post-as-ai.test.ts`: with a fake gateway, `postAsAi` forwards a `blocks` payload unchanged and returns the gateway's answer; with no gateway, it returns `false`.

### Allowed files
- `apps/server/src/startup/components.ts`
- `apps/server/src/startup/post-as-ai.ts`
- `apps/server/src/startup/post-as-ai.test.ts`
- `work/T-1765-post-forwards-payload.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/startup/post-as-ai.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A `tool.run` or tool routine whose output has valid blocks posts a `blocks` card in the room.
- The test and the gate pass.

---

## Report (written by the worker when done)

### What I did

- Moved the production post port out of `components.ts` into a new
  `apps/server/src/startup/post-as-ai.ts`. `postAsAi(getGateway)` returns a
  `BuildToolAdaptersDeps['post']`; with no gateway it answers `false` (via
  `Effect.runPromise(Effect.succeed(false))`, same as before), otherwise it calls
  `gateway.postToChat` and now forwards `payload` (and `topicId` when set) on top
  of `aiId`, `groupId` and `text`. The old inline arrow destructured only
  `{ aiId, groupId, topicId, text }` and dropped `payload` — the live bug.
- In `components.ts`, replaced the inline arrow with
  `const post: BuildToolAdaptersDeps['post'] = postAsAi(() => running.gateway);`
  and added the `./post-as-ai` import. No other change.
- Added `apps/server/src/startup/post-as-ai.test.ts` (message pipeline): a fake
  gateway asserts `postAsAi` forwards a `blocks` payload unchanged and returns the
  gateway's answer (`true`), that `topicId`/`payload` are omitted when unset and
  the answer (`false`) is returned, and that with no gateway it returns `false`
  and posts nothing.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/startup/post-as-ai.test.ts`
  → `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` (repo root) → `GATE PASS`, summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`,
    `PASS  effect`, `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration`, `images`, `size` checks all passed
- First `pnpm gate` run failed `effect (H1)` on `return Promise.resolve(false);`
  in the new file (the effect ratchet forbids plain Promises). Fixed by using
  `Effect.runPromise(Effect.succeed(false))` as the original code did; the final
  gate above is green.

### Notes for the lead

- Type choice: `postAsAi` takes
  `getGateway: () => Pick<AgentGateway, 'postToChat'> | null`, which
  `() => running.gateway` (a wider `Pick`) satisfies; `AgentGateway` is imported
  from `../agents/gateway` as `components.ts` does.
- No migrations. No dependencies added. No files touched outside the Allowed
  files.
- Acceptance: the regression test pins the payload forwarding; the live card
  (`tool.run` / tool routine) depends on the room client rendering `blocks`, which
  is outside this task's scope, so this change is the server-side half only.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `bdc629456`.
- `postAsAi` forwards `payload` when set and answers `false` with no gateway.
- `components.ts` uses it for both the tool adapters and the routine scheduler.
- I ran the 3 tests in `post-as-ai.test.ts`: they pass.
- The web `blocks` renderer has been live since T-1755. The lead will check the card live after the deploy.
