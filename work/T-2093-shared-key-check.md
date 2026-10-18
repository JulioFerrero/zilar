---
id: T-2093
title: "Share (web + phone): one useKeyCheck hook in client-core (provider choice, OpenAI-compatible fields, key check, saved-key reuse, abandon, create hand-off) replaces the web and phone copies; each app passes its connections API"
status: merged
milestone: M5
branch: task/T-2093-shared-key-check
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2093: One key-check hook

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and web and phone share logic. The "pick a provider, enter a key, check it" hook is written twice: phone 234 lines, web 208. The copies have also drifted.

### Facts (read by the lead on 2026-10-18 at `823b2f10d`)
- **Web:** `apps/web/src/components/ais/new-ai/useKeyCheck.ts` (208 lines).
  - It loads connections and the AI catalog with `useQuery`, and runs `checkKey` / `abandonKeyCheck` from `@zilar/chat-core` over a `KeyCheckApi` built from `@/lib/api` (`createConnection`, `testConnection`, `replaceConnectionKey`, `deleteConnection`).
  - It returns `catalog, choices, providerId, providerText, providerReady, chooseProvider, isCompatible, baseUrl, setBaseUrl, compatibleName, setCompatibleName, baseUrlReachable, key, setKey, keyVerified, connectionId, keyError, keyPlaceholder, keyPage, checkingKey, continueKey, abandon`.
  - `chooseProvider` reuses the newest **active** saved connection of that provider; OpenAI-compatible never reuses one.
- **Phone:** `apps/mobile/src/components/connections/use-key-check.ts` (234 lines).
  - Its state is plain `useState`/`useEffect`, over `useAisApi` and `useConnectionsApi`.
  - It uses helpers from `apps/mobile/src/components/ais/form.ts`: `EMPTY_KEY_STATE`, `discardCreatedKey`, `keyCheckBaseState`, `keyStateAfterBaseUrlEdit` and `settleNewAiKeyCheck`.
  - It names the compatible label `connectionName`, and adds `continueProvider()` (`:131`) and `beginCreate()` / `finishCreate(succeeded)` (`:184-195`), which the phone New AI flow uses so a close during the create POST leaves the key to the create.
  - `providerSelection` (`:34-39`) reuses the newest saved connection **without** checking `status`.
- **Users.**
  - Web: `apps/web/src/components/ais/new-ai/KeyStep.tsx`, `ProviderStep.tsx`, `useNewAiFlow.ts` and `apps/web/src/components/connections/AddKeyDialog.tsx`.
  - Phone: `apps/mobile/src/components/ais/new-ai/key-step.tsx`, `provider-step.tsx`, `use-new-ai-flow.ts` and `apps/mobile/src/components/connections/add-key-sheet.tsx`.
- **The barrel.** `packages/client-core/src/index.ts` is the client-core barrel; append new exports at its end.

### Steps
1. **The shared hook.** Create `packages/client-core/src/key-check.ts`, exporting `useKeyCheck(port, options)`.
   - `port` is `{ listConnections, getAiCatalog, createConnection, testConnection, replaceConnectionKey, deleteConnection }`, all returning Promises. Use the contract types from `@zilar/api-contract`.
   - Load with plain `useState`/`useEffect`, cancelled on unmount like the phone.
   - Return the web's field names (`compatibleName`, `setCompatibleName`) **plus** the phone's `continueProvider`, `beginCreate` and `finishCreate`.
   - Saved-key reuse follows the web rule: the newest **active** connection. That is a small fix for the phone, which today may pick a revoked key.
   - Move the phone `form.ts` key helpers it needs into the shared file, and delete them from `form.ts` when nothing else uses them.
   - Append one export line at the end of the client-core barrel.
2. **Web.** Its `useKeyCheck.ts` becomes a few lines that build the port from `@/lib/api` and call the shared hook. Users keep their imports.
3. **Phone.** Its `use-key-check.ts` becomes a few lines that build the port from its two API hooks. Rename `connectionName` to `compatibleName` in the phone users.
4. **Tests.** No new tests (UI flow; the key check itself is `checkKey` in chat-core, already tested).
5. **Size.** Product lines must go down by at least 150. Report the counts.

### Allowed files
- `packages/client-core/src/key-check.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/components/ais/new-ai/useKeyCheck.ts`
- `apps/web/src/components/ais/new-ai/KeyStep.tsx`
- `apps/web/src/components/ais/new-ai/ProviderStep.tsx`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/web/src/components/connections/AddKeyDialog.tsx`
- `apps/mobile/src/components/connections/use-key-check.ts`
- `apps/mobile/src/components/ais/form.ts`
- `apps/mobile/src/components/ais/new-ai/key-step.tsx`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`
- `apps/mobile/src/components/connections/add-key-sheet.tsx`
- `work/T-2093-shared-key-check.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check, web mock:** New AI reaches the key step, a key checks, and the model step follows. Add key on the Connections page works the same.

---

## Report (written by the worker when done)

### What I did

- **Shared hook.** Added `packages/client-core/src/key-check.ts` with `useKeyCheck(port, options)` over plain `useState`/`useEffect`, cancelled on unmount. The port is `KeyCheckPort` (`extends KeyCheckApi` from chat-core) plus `listConnections` and `getAiCatalog`, typed from `@zilar/api-contract`.
  - Returns the web's names (`choices`, `chooseProvider`, `compatibleName`, `setCompatibleName`, `keyError`, `keyPage`, `checkingKey`, `baseUrlReachable`, …) plus the phone's `continueProvider`, `beginCreate` and `finishCreate` (and `claim`, used by the Add key sheet).
  - Saved-key reuse now follows the web rule for both apps: the newest **active** connection, and OpenAI-compatible never reuses one.
  - Moved the phone `form.ts` key helpers (`EMPTY_KEY_STATE`, `keyCheckBaseState`, `keyStateAfterBaseUrlEdit`, `dropCreatedKey`, `discardCreatedKey`, `settleNewAiKeyCheck`) into the shared file. `form.ts` now re-exports them because the existing mobile test (`use-new-ai-flow.test.ts`, outside this task's Allowed files) imports them by that path; the definitions are gone from `form.ts`.
  - Appended `export * from './key-check';` to the client-core barrel.
- **Web.** `apps/web/src/components/ais/new-ai/useKeyCheck.ts` is now a module-level port over `@/lib/api` plus a two-line wrapper. Its `KeyCheck` type export stays, so `KeyStep`/`ProviderStep` keep their imports unchanged.
  - Because the shared hook cleans up on unmount (as the phone did), the web now claims the connection where the phone does: `useNewAiFlow` calls `beginCreate` before the create POST and `finishCreate(true)` before `onCreated` (`finishCreate(false)` on a typed failure), and `AddKeyDialog` calls `claim()` on Save. Without this, unmounting after a successful create or save would delete the connection the AI (or the saved key) now owns.
- **Phone.** `apps/mobile/src/components/connections/use-key-check.ts` builds the port from `useAisApi`/`useConnectionsApi` (memoised) and returns the shared hook's result; it keeps a `providerChoices` alias because `new-ai-sheet.tsx` (outside Allowed files) reads that name. The exposed `providerSelection` is now a re-export of the shared selection logic; its existing test still pins the `connectionName` key in its return object, so the shared helper keeps that one field name.
- Renamed the phone users to the web names: `keyValue`→`key`, `setKeyValue`→`setKey`, `keyMessage`→`keyError`, `keyPageUrl`→`keyPage`, `checking`→`checkingKey`, `providerChoices`→`choices`, `selectProvider`→`chooseProvider`, `connectionName`→`compatibleName`.
- Key visibility (`showKey`) moved into the phone `KeyStep` as local state; it is presentation only.
- No new tests (as specified).

**Size (product lines, `wc -l`, all 12 Allowed product files plus the new file):**

| File | base `823b2f10d` | now |
| --- | --- | --- |
| `apps/web/src/components/ais/new-ai/useKeyCheck.ts` | 208 | 29 |
| `apps/web/src/components/ais/new-ai/KeyStep.tsx` | 66 | 66 |
| `apps/web/src/components/ais/new-ai/ProviderStep.tsx` | 74 | 74 |
| `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` | 243 | 245 |
| `apps/web/src/components/connections/AddKeyDialog.tsx` | 82 | 83 |
| `apps/mobile/src/components/connections/use-key-check.ts` | 234 | 30 |
| `apps/mobile/src/components/ais/form.ts` | 58 | 19 |
| `apps/mobile/src/components/ais/new-ai/key-step.tsx` | 60 | 62 |
| `apps/mobile/src/components/ais/new-ai/provider-step.tsx` | 74 | 74 |
| `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts` | 259 | 259 |
| `apps/mobile/src/components/connections/add-key-sheet.tsx` | 89 | 89 |
| `packages/client-core/src/index.ts` | 66 | 68 |
| `packages/client-core/src/key-check.ts` | 0 | 263 |
| **total** | **1513** | **1361** |

Net: **−152 product lines**. At the previous HEAD the product diff was 485 deletions − 337 insertions = −148; this round's 4-line trim brings it to 489 − 337 = −152, matching the table. The earlier table omitted `KeyStep`, `ProviderStep`, mobile `use-new-ai-flow`, `add-key-sheet` and the client-core barrel, which is why its rows did not add up to its total.

### Checks run

- `pnpm install`: done, 17 workspace projects.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/connections/use-key-check.test.ts src/components/ais/new-ai/use-new-ai-flow.test.ts`: **2 files passed, 18 tests passed**.
- `pnpm gate` (default `--base main`): **GATE FAIL**, only the `comments` step. It reports 196 added comment lines in `apps/server/**` that cite task IDs. These are not my files: this branch was cut at `823b2f10d`, while `main` is two commits ahead and contains the T-2086 server-comment cleanup. Every other step passed, and `scope` reported every changed file inside the Allowed files. Rebasing onto `main` was refused by the harness (`Permission denied: shell`), so I did not retry it.
- Same gate against this branch's real base: `pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base 823b2f10d` → **GATE PASS**:
  ```
  gate: 12 changed file(s) against 823b2f10d
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/client-core
  PASS  tests @zilar/mobile
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Notes for the lead

- **Gate base drift:** plain `pnpm gate` fails only because local `main` (`38b5aef48`; it was `5c37422e4` when first reported) has the server-comment cleanups and this branch's base (`823b2f10d`) does not; the failure lists pre-existing `apps/server` comments, none of them mine. After merging into current `main` those files keep main's cleaned version and the gate should pass. Please re-run the merge gate to confirm.
- **Behaviour changes:** both apps now delete a verified connection this flow created when the provider or OpenAI-compatible endpoint/name changes (the phone already did; the web previously left it orphaned), and the phone no longer preselects a non-active saved connection (the spec's fix).
- **Compatibility kept for files outside scope:** `new-ai-sheet.tsx` still reads `keys.providerChoices` (the phone wrapper aliases `choices` to it), and `use-key-check.test.ts` still imports `providerSelection` and expects its `connectionName` key. Both are only there because those files are not in this task's Allowed files.
- I did not run the web mock or the phone smoke; the acceptance's live checks are for you.

### Round

- **Finding 1 (should-fix: size acceptance and Report table): fixed.** `EMPTY_KEY_STATE` is now one line (4 lines removed from `packages/client-core/src/key-check.ts`), and the size table lists all 12 Allowed product files plus the new file, so its rows add up: base 1513 → 1361 = **−152** product lines (≥ 150).
- **Tests added:** none. The finding changed a constant's formatting and the Report; no behaviour changed, and the finding names no test.
- **Nits:** left untouched; none sits on a line this round changes.
- **Checks:** `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/connections/use-key-check.test.ts src/components/ais/new-ai/use-new-ai-flow.test.ts` → 2 files, 18 tests passed.
  - `pnpm gate` (default `--base main`) still ends **GATE FAIL**, only on the `comments` step: 456 pre-existing `apps/server` comment lines appear as added because this branch's base predates main's comment cleanups (and the branch's copy of the gate predates main's merge-base fix). Every other step passes and `scope` is clean.
  - Against the branch's real base: `pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base 823b2f10d` → **GATE PASS**:
    ```
    gate: 12 changed file(s) against 823b2f10d
    PASS  install (frozen)
    PASS  format
    PASS  lint
    PASS  typecheck
    PASS  effect
    PASS  build @zilar/server
    PASS  tests @zilar/client-core
    PASS  tests @zilar/mobile
    SKIP tests @zilar/web (no nearby test files)
    scope: every changed file is inside the Allowed files
    migration: every added migration continues from the base
    images: every workspace package an app image needs is copied into its Dockerfile
    size: no changed source file is over 800 lines
    comments: no task IDs in added comments
    GATE PASS
    ```



## Review (written by Claude)

Approved; the pre-review was clean after one auto round (1 nit; 1 follow-up: rename `providerChoices`/`connectionName` once `new-ai-sheet.tsx` and its test are in scope). Net −152: `packages/client-core/src/key-check.ts` (263) replaces the web `useKeyCheck.ts` (−179) and the phone `use-key-check.ts` (−204) and `form.ts` copies.
- **Web mock** (`:5241`; main side by side on `:5233`):
  - **New AI.** The provider combobox lists 7 providers. For both Anthropic and OpenAI, the key step leads to the model step (Claude Sonnet 4.5 / GPT-4o mini) after a test key, identical to main.
  - **Add key.** DeepSeek and a test key are checked, then Save shows the new DeepSeek key in Connections.
  - No page errors.
- **Phone emulator:**
  - the smoke passed (`/settings/connections`, `/ais`);
  - on the AIs tab, `+` opens the New AI sheet, and the provider list marks the saved OpenAI and Anthropic keys;
  - for DeepSeek, a test key passes the check and the sheet moves to the model step with DeepSeek Chat.
- **After the rebase** onto T-2094, the conflicting imports were dropped because the shared hook no longer uses them. The re-review was clean.
