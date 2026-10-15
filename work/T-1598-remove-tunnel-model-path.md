---
id: T-1598
title: "Remove the last LiteLLM traces in code: the runner tunnel's model-traffic channel (model.open, model listener, gatewayUrl → 127.0.0.1:4000), DEFAULT_MODEL_GATEWAY_URL and assertRunnerHubConfig in the server, the demo's LiteLLM check, the README section; delete the root log file"
status: merged
milestone: M5
branch: task/T-1598-remove-tunnel-model-path
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1598: Remove the runner tunnel's model path (LiteLLM leftovers)

## Spec (written by Claude, do not edit)

### Why
- **No LiteLLM any more:** the server calls model providers directly through Effect AI, and the design says "sandboxes never call models" (`docs/design/agent-system.md:46`). Julio: "we don't need LITELLM anymore … remove all" (2026-10-15).
- **The leftover:** the runner tunnel still carries a model-traffic channel that forwards a runner's local model listener to `http://127.0.0.1:4000`, LiteLLM's old port.
- **Nothing uses it in production:** the real runner turns it off (`apps/runner/src/connect.ts:98`, `enableModelListener: false`). Only tests, the demo and the server's default URL keep it alive.

### Facts (the lead read them on 2026-10-15, main `6b172791e`)
- **The protocol:** `packages/runner-tunnel/src/protocol.ts:127-130` defines `ModelOpenSchema` (`type: 'model.open'`). It is used at `:136` (in `runnerToServerSchemas`), `:170` and `:190`.
- **The runner side:**
  - `packages/runner-tunnel/src/runner/model-listener.ts` (the whole file: `startModelListener`);
  - `runner/lifecycle.ts:17` (import), `:31` (`enableModelListener`), `:40` (`modelServer`), `:63`, `:71`, `:121-127` (start), `:154-156` (close);
  - `runner/options.ts:34` (`enableModelListener`, default `true`) and `:68`;
  - `runner.ts:19` and `:22` (doc comments), `:36`, `:61-75` (`modelUrl`, `modelBindAddress`), `:82` (comment).
- **The server side:**
  - `server/options.ts:13` (`gatewayUrl` schema) and `:41-42`;
  - `server.ts:31` (`new URL(validated.gatewayUrl)`), `:64-65` (`gatewayHost`/`gatewayPort`), `:103`;
  - `server/conn.ts:43-44`;
  - `server/ready.ts:18-19` (the `'model.open'` case) and `:56-72` (`handleModelOpen`, which pipes to the gateway).
- **Tests and the demo:**
  - `test-harness.ts:155-200` (`FakeGateway`, `startFakeGateway`), `:218`, `:230`, `:232`, `:241`, `:256`, `:259`, `:266`;
  - `auth.test.ts:19`, `:43-58` (a fake gateway in setup), `:193-221` (two `model.open` tests);
  - `demo.ts:32`, `:97` (a model request through the tunnel), `:153-175` (the gated LiteLLM `/health/liveliness` check on `:4000`);
  - `apps/runner/src/connect.test.ts:9`, `:26`, `:30`, `:45`, `:50`, `:53`, `:64`, `:69`, `:73`, `:93`;
  - `apps/runner/src/e2e.test.ts:161`.
- **The server app:**
  - `apps/server/src/machines/hub.ts:12` (`DEFAULT_MODEL_GATEWAY_URL = 'http://127.0.0.1:4000'`), `:218` and `:254` (the `gatewayUrl` option), `:274-286` (resolve and check, pass to `TunnelServer.start`), `:373-386` (`assertRunnerHubConfig`, whose only check is the gateway URL);
  - `apps/server/src/leader/start.ts:19` and `:156`;
  - `apps/server/src/startup/components.ts:27` and `:50-54` (the `assertRunnerHubConfig` call).
- **Docs and files:**
  - `packages/runner-tunnel/README.md:53`, `:70` (model traffic), `:78-88` ("Demo and the gated LiteLLM check");
  - `packages/runner-tunnel/src/mux/socket-bridge.ts:9` (a comment mentioning gateway sockets);
  - `zilar-night-log-2026-09-28.entries`, an old lead log at the repo root.

### Steps
1. **Protocol:** remove `ModelOpenSchema` and every use. After this change, a runner that sends `model.open` gets the same treatment as any unknown message type.
2. **Runner side:** delete `runner/model-listener.ts`. Remove `enableModelListener`, `modelServer`, `modelUrl`, `modelBindAddress` and their comments. Then remove `enableModelListener: false` from `apps/runner/src/connect.ts:98`.
3. **Server side:**
   - remove `gatewayUrl` from the options (schema and type), and `gatewayHost`/`gatewayPort` from the connection state;
   - remove the `'model.open'` case and `handleModelOpen`;
   - `TunnelServer.start` no longer takes a gateway.
4. **The server app:** remove `DEFAULT_MODEL_GATEWAY_URL`, the hub's `gatewayUrl` option and its check, and `assertRunnerHubConfig` with its call in `startup/components.ts` (nothing else is left for it to check). Also remove the matching lines in `leader/start.ts`.
5. **Tests and the demo:**
   - remove `FakeGateway`/`startFakeGateway` and `enableModelListener` from `test-harness.ts`;
   - drop the gateway from the setups in `auth.test.ts`, `connect.test.ts` and `e2e.test.ts`;
   - delete the two `model.open` tests (`auth.test.ts:193-221`);
   - in `demo.ts`, remove the model request and the gated LiteLLM check.
   - **Every other test stays and must pass unchanged** (the tunnel handles machine keys).
6. **Docs:**
   - in `packages/runner-tunnel/README.md`, remove the model-traffic lines and the "Demo and the gated LiteLLM check" section, and fix the `TunnelServer.start` example;
   - fix the `socket-bridge.ts:9` comment.
7. **Delete** `zilar-night-log-2026-09-28.entries` (`git rm`).
8. **Afterwards,** `git grep -n -i -E "litellm|:4000|model\.open|gatewayUrl|enableModelListener|DEFAULT_MODEL_GATEWAY_URL"` outside `work/`, `docs/` and `apps/server/drizzle/` must find nothing. Paste the result in the Report.

### Tests
Existing tests only, minus the two `model.open` tests. No new tests.

### Allowed files
- `packages/runner-tunnel/src/protocol.ts`
- `packages/runner-tunnel/src/runner/model-listener.ts` (delete)
- `packages/runner-tunnel/src/runner/lifecycle.ts`
- `packages/runner-tunnel/src/runner/options.ts`
- `packages/runner-tunnel/src/runner.ts`
- `packages/runner-tunnel/src/server.ts`
- `packages/runner-tunnel/src/server/options.ts`
- `packages/runner-tunnel/src/server/conn.ts`
- `packages/runner-tunnel/src/server/ready.ts`
- `packages/runner-tunnel/src/mux/socket-bridge.ts`
- `packages/runner-tunnel/src/test-harness.ts`
- `packages/runner-tunnel/src/auth.test.ts`
- `packages/runner-tunnel/src/demo.ts`
- `packages/runner-tunnel/README.md`
- `apps/runner/src/connect.ts`
- `apps/runner/src/connect.test.ts`
- `apps/runner/src/e2e.test.ts`
- `apps/server/src/machines/hub.ts`
- `apps/server/src/leader/start.ts`
- `apps/server/src/startup/components.ts`
- `zilar-night-log-2026-09-28.entries` (delete)
- `work/T-1598-remove-tunnel-model-path.md`

### Checks
```bash
pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot
pnpm --filter @zilar/runner exec vitest run src/connect.test.ts src/e2e.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The step 8 search finds nothing.**
- **The Report lists the test count** for the runner-tunnel package before and after (only the two `model.open` tests gone).
- **No other behaviour changes:** desk streams, preview, heartbeat, handshake and auth are untouched.

---

## Report (written by the worker when done)

### What I did

Removed the last LiteLLM traces — the runner tunnel's model-traffic channel — in full:

- **Protocol** (`packages/runner-tunnel/src/protocol.ts`): deleted `ModelOpenSchema`, its entry in
  `runnerToServerSchemas`, and its members in the `ControlMessage` and `ControlSchema` unions. A runner
  that sends `model.open` now gets the same treatment as any unknown message type (close 4401).
- **Runner side**: deleted `runner/model-listener.ts` (`startModelListener`); removed `enableModelListener`,
  `modelServer`, `modelUrl`, `modelBindAddress` and their comments from `runner/lifecycle.ts`,
  `runner/options.ts` and `runner.ts` (the `node:net` `Server` import in `lifecycle.ts` went with them).
  Removed `enableModelListener: false` from `apps/runner/src/connect.ts`.
- **Server side**: removed `gatewayUrl` from `server/options.ts` (schema + type, and the now-unused
  `stringUrl` import) and `gatewayHost`/`gatewayPort` from `ServerRuntime` in `server/conn.ts`; removed
  the `model.open` case and `handleModelOpen` from `server/ready.ts` (its now-unused `node:net`,
  `StreamMux`, `attachSocketToStream` and `CLOSE_MALFORMED` imports too); `TunnelServer.start` no longer
  takes or resolves a gateway in `server.ts`.
- **Server app**: removed `DEFAULT_MODEL_GATEWAY_URL`, the hub's `gatewayUrl` option, its `http://` check
  and `assertRunnerHubConfig` from `apps/server/src/machines/hub.ts`; removed the matching import and the
  `gatewayUrl` argument in `apps/server/src/leader/start.ts`; removed the import and the
  `assertRunnerHubConfig` call in `apps/server/src/startup/components.ts`.
  Deviation (see notes): with both gateway checks gone, `HubConfigError` and the private `scrubScheme`
  helper became dead code — the only two callers were the removed checks — so I removed them too
  (both live in `hub.ts`, an Allowed file; `git grep` confirmed nothing else referenced either).
- **Tests and demo**: removed `FakeGateway`/`startFakeGateway` and the `enableModelListener` option from
  `test-harness.ts` (plus `gateway` from `TunnelPair`, `startTunnelPair` and `closeTunnelPair`); dropped
  the fake gateway from the setups in `auth.test.ts`, `connect.test.ts` and `e2e.test.ts`; deleted the two
  `model.open` tests (`auth.test.ts`); removed the model request and the gated LiteLLM
  `/health/liveliness` block from `demo.ts`, and fixed its banner line.
- **Docs**: in `packages/runner-tunnel/README.md` removed the model-traffic mentions (intro, layout, usage
  comment, security note), removed the "Demo and the gated LiteLLM check" section, and fixed the
  `TunnelServer.start` example; fixed the "gateway sockets" comment in `mux/socket-bridge.ts`.
- **File**: `git rm zilar-night-log-2026-09-28.entries`.

### Checks run

- `pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot` (before changes): **4 files, 25 tests passed**.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot` (after): **4 files, 23 tests passed**
  (the two `model.open` tests removed; nothing else changed).
- `pnpm --filter @zilar/runner test --maxWorkers=2 --reporter=dot src/connect.test.ts src/e2e.test.ts`:
  **2 files, 14 tests passed**.
- `pnpm gate` (from repo root), final run:

  ```
  gate: 22 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/runner  (3.7s)
  PASS  tests @zilar/runner-tunnel  (1.4s)
  PASS  tests @zilar/server  (3.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  (One earlier gate run failed only on `format` for `demo.ts` — an import block Prettier wanted on one
  line; `pnpm exec prettier --write packages/runner-tunnel/src/demo.ts` and re-running gave the PASS above.)

- **Step 8 search**:
  `git grep -n -i -E "litellm|:4000|model\.open|gatewayUrl|enableModelListener|DEFAULT_MODEL_GATEWAY_URL" -- . ':(exclude)work' ':(exclude)docs' ':(exclude)apps/server/drizzle'`
  → **no output, exit code 1** (no matches).

### Notes for the lead

- **Deviation from the spec (dead code, same file):** the spec's step 4 lists removing
  `DEFAULT_MODEL_GATEWAY_URL`, the hub `gatewayUrl` option/check and `assertRunnerHubConfig`. Removing the
  last two left `HubConfigError` and the private `scrubScheme` unused in `machines/hub.ts` (nothing else in
  the repo referenced them — verified with `git grep`). Per AGENTS "don't leave dead code" and to keep lint
  green I removed both. They are in an Allowed file (`apps/server/src/machines/hub.ts`).
- **README demo section:** the spec says remove the section named "Demo and the gated LiteLLM check", so the
  whole section is gone, including the paragraph describing the ordinary demo run. `src/demo.ts` is still
  listed in the Layout, and the demo still runs (`pnpm --filter @zilar/runner-tunnel demo`). Say the word if
  you want a LiteLLM-free demo paragraph back.
- **No behaviour change kept as such:** desk streams, preview, heartbeat, handshake and auth are untouched.
  An unknown `model.open` now closes with 4401 (unknown type) instead of being handled — intended per the spec.
- The `docs/` references to `assertRunnerHubConfig` (`docs/SERVER_CONFIG.md:161`) and the desk-runner plan's
  model-listener note are out of scope and were left alone.

## Review (written by Claude)

**Approved and merged.** Julio, 2026-10-15: "we don't need LITELLM anymore … remove all".

- **Pre-review:** clean, 0 nits, 2 follow-ups.
- **The lead's checks on the branch:**
  - the step-8 search (`litellm|:4000|model\.open|gatewayUrl|enableModelListener|DEFAULT_MODEL_GATEWAY_URL` outside `work/`, `docs/` and `apps/server/drizzle/`) finds nothing;
  - `zilar-night-log-2026-09-28.entries` is gone;
  - 22 files changed (+222/−477);
  - runner-tunnel tests went from 25 to 23 (only the two `model.open` tests gone), and the runner's connect and e2e tests pass.
- **Also cleaned by the lead on 2026-10-15** (outside this diff):
  - **Coolify:** `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY` deleted from `zilar-chat` (production and preview, 4 entries). Re-listing them returns nothing; GitHub has no LiteLLM secrets or variables.
  - **VPS:** no LiteLLM containers, images, volumes, databases, roles or columns (checked with control queries).
  - **This Mac:** the old `zilar-dev-litellm-1` container (it was still running), its 1.67 GB image, and the `litellm` database and role in the dev Postgres are removed.
  - **Docs, in this commit:** `docs/FEATURES.md` (spending-limit, keys and infra rows), `docs/INSTALL_DOCKER.md` (intro), `docs/LEAD_PLAYBOOK.md` §12, and `docs/PROJECT_PLAN.md` (a "superseded" note plus the architecture rows).
- **Follow-ups, both going to T-1600:** regenerate `docs/SERVER_CONFIG.md` from the current config schema (it still documents LiteLLM, Hono and `assertRunnerHubConfig`), and fix the stale comment at `apps/server/src/config/server-schema.ts:136-139`.
- **Left on purpose:** migrations `0005`/`0006` (already applied; `0059` dropped the tables), old task files, audit notes, and the playbook's dated snapshot.

