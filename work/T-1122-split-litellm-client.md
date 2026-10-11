---
id: T-1122
title: "Size split: apps/server/src/ai/litellm-client.ts (589) — public types to ai/litellm-types.ts and the wire schemas + parse helpers to ai/litellm-schemas.ts, moved unchanged and re-exported"
status: merged
milestone: M5
branch: task/T-1122-split-litellm-client
model: auto
effort: default
depends_on: [T-1118]
estimate: 0.1 day
---

# T-1122: Split `ai/litellm-client.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` #53. `apps/server/src/ai/litellm-client.ts` has 589 lines (read by the lead), and 16 files import it (`redactSecrets` among others).

**The parts:**
- **Public types, `:6-116`:** `DEFAULT_LITELLM_BASE_URL`, `LitellmApiError`, `LitellmClientConfig`, `FetchLike`, the input and output interfaces, and `LitellmAdminClient`.
- **Wire schemas, `:118-236`:** from `nonEmptyString` to `ModelListResponseSchema`.
- **Helpers, `:238-352`:** `modelAlreadyGone`, `keyAlreadyGone`, `redactSecrets` (exported), `errorDetail`, `isErrorBody`, `parseResponse`, `parseInput`, `keyId`, `toVirtualKey`, `toKeyInfo`.
- **The client:** `createLitellmAdminClient` (`:353`) and `createLitellmAdminClientFromConfig` (`:575`).

**This client handles the LiteLLM master key and virtual keys,** so it is a keys area.

### What to build
1. **A new `apps/server/src/ai/litellm-types.ts`** holds `:6-116`, **moved byte-for-byte**.
2. **A new `apps/server/src/ai/litellm-schemas.ts`** holds `:118-352` (schemas and helpers), moved byte-for-byte. Export the names `litellm-client.ts` needs.
3. **`litellm-client.ts`** keeps the two factories and imports the rest. It **re-exports every name it exported before** (`DEFAULT_LITELLM_BASE_URL`, `LitellmApiError`, all exported types, `redactSecrets`, and anything else exported today), so none of the 16 importers change.
4. **No cycles:** the new files never import `./litellm-client`.
5. **No behaviour change.** No secret handling or redaction changes.
6. **Line counts:** each file stays at most 400 lines. Paste `wc -l` in the Report.
7. **Tests:** find tests that import `litellm-client` (`grep -rln "litellm-client" apps/server/src | grep test`), run them, and paste the results.

### Read first
`AGENTS.md`, and `apps/server/src/ai/litellm-client.ts`.

### Allowed files
`apps/server/src/ai/litellm-client.ts`, `apps/server/src/ai/litellm-types.ts`, `apps/server/src/ai/litellm-schemas.ts`, `work/T-1122-split-litellm-client.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Every file is at most 400 lines.
- `git diff main --stat` lists only these files.

---

## Report (written by the worker when done)

### What I did
Split `apps/server/src/ai/litellm-client.ts` (589 lines) into three files:
- `apps/server/src/ai/litellm-types.ts` (113 lines): `DEFAULT_LITELLM_BASE_URL`, `LitellmApiError` and the public types — old lines 6-116, moved byte-for-byte (`sed -n '6,116p' | diff` against `git show main:…` shows no difference). The two-line comment above `DEFAULT_LITELLM_BASE_URL` (old lines 4-5) was restored in the fix round; the file now matches old lines 4-116 exactly.
- `apps/server/src/ai/litellm-schemas.ts` (239 lines): the wire schemas and helpers — old lines 118-352. Added `export` to the names the client needs (`KeySchema`, `ModelsSchema`, `BudgetSchema`, `SpendSchema`, `LimitSchema`, `DurationSchema`, `AliasSchema`, `ModelNameSchema`, `ProviderModelSchema`, `ApiKeySchema`, `ModelIdSchema`, `GeneratedKeySchema`, `KeyInfoResponseSchema`, `UpdateResponseSchema`, `DeleteResponseSchema`, `NewModelResponseSchema`, `DeleteModelResponseSchema`, `ModelListResponseSchema`, `modelAlreadyGone`, `keyAlreadyGone`, `errorDetail`, `isErrorBody`, `parseResponse`, `parseInput`, `toVirtualKey`, `toKeyInfo`; `redactSecrets` was already exported. Internal-only `nonEmptyString`, `KeyInfoSchema` and `keyId` stay unexported. It imports `effect` and `LitellmApiError`/`VirtualKey`/`VirtualKeyInfo` from the types file.
- `apps/server/src/ai/litellm-client.ts` (285 lines): keeps the two factories. It imports what it needs from the two new files and re-exports every name it exported before: `export * from './litellm-types'` (covers `DEFAULT_LITELLM_BASE_URL`, `LitellmApiError`, `LitellmClientConfig`, `FetchLike`, `GenerateVirtualKeyInput`, `UpdateVirtualKeyInput`, `AddModelInput`, `VirtualKey`, `VirtualKeyInfo`, `ModelListing`, `LitellmAdminClient`), `export { redactSecrets };`, plus the two local factories. So none of the 16 importers change.

No cycles: neither new file imports `./litellm-client` (checked with grep). No behaviour or secret-handling change: `redactSecrets`, the error helpers and the schemas are the same code.

Comment audit (fix round): I compared every `//` and `/** */` comment line of `main`'s file against the three new files. The only lost comments were old lines 4-5 (the `DEFAULT_LITELLM_BASE_URL` note), now restored in `litellm-types.ts`. All other comments — the `LitellmApiError` note, the model-name rule, the `/model/new`, `/model/info`, `deleteModel` and `revokeKey` notes, the redaction notes, the parse notes and the client-side notes — are present in the schemas or client file.

Line counts (`wc -l`): `litellm-client.ts` 285, `litellm-types.ts` 113, `litellm-schemas.ts` 239 — all ≤ 400.

### Files changed
- `apps/server/src/ai/litellm-client.ts` (modified)
- `apps/server/src/ai/litellm-types.ts` (new)
- `apps/server/src/ai/litellm-schemas.ts` (new)
- `work/T-1122-split-litellm-client.md` (status)

### Commands run (real results)
- `pnpm install`: Done in 10s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts src/ais/usage.test.ts`: `Test Files 2 passed (2)`, `Tests 17 passed (17)` (the only `*.test.ts` importing `litellm-client` is `reply.test.ts`; `usage.test.ts` exercises key/spend code).
- `pnpm exec prettier --write apps/server/src/ai/litellm-schemas.ts`: only file the first gate run reported; the added `export ` prefixes pushed a few lines past `printWidth`.
- `pnpm gate`: final run, summary lines below.

### Gate summary
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (2.4s)
PASS  effect  (0.5s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations from the spec
- `litellm-client.ts` gained one line, an `// effect-plain:` marker (line 1). The client no longer imports `effect` (that moved to `litellm-schemas.ts`), so the Effect ratchet saw it regress from `effect` to `needs-effect` and failed the gate. The marker is the repo's established fix for size splits (e.g. `agents/tool-exec.ts`, `tools/adapters.ts`). The moved code itself is unchanged; only the marker line was added.
- The `export` keywords added to the schema/helper declarations are the unavoidable minimum for the split; nothing else in those blocks changed.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved after one fix round. The pre-review is clean, with no nits.**
- **The split:** `ai/litellm-client.ts` goes from 589 to 285 lines. The public types move to `ai/litellm-types.ts` (111), and the wire schemas and parse helpers to `ai/litellm-schemas.ts` (239). The client does `export * from './litellm-types'` and re-exports `redactSecrets`.
- **The lead's export check:** the runtime exports are the same as main's (`DEFAULT_LITELLM_BASE_URL`, `LitellmApiError`, `createLitellmAdminClient`, `createLitellmAdminClientFromConfig`, `redactSecrets`), read by importing the module with tsx.
- **The fix round** restored the lost two-line comment over `DEFAULT_LITELLM_BASE_URL`. A comment-line diff against main now shows no lost comments.
- **The gate passed.**
