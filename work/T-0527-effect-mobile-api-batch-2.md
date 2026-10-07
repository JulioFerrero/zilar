---
id: T-0527
title: "Effect lane E, batch 2: mobile roles-api, gifs-api, ai-memory-api and connections-api onto Effect Schema + the T-0506 request pipeline; same exports, same errors, tests unchanged"
status: todo
milestone: M5
branch: task/T-0527-effect-mobile-api-batch-2
model: auto
effort: low
depends_on: [T-0506]
estimate: 0.5 day
---

# T-0527: mobile API clients batch 2 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, mobile included. T-0506 converted `apps/mobile/src/lib/pins-api.ts` as the recipe; `docs/EFFECT_GUIDE.md` section "Moving a mobile API client onto Effect" sums it up. T-0524 (batch 1) runs in parallel on other files.

### Verified facts (do not re-derive)
Mobile validates these boundaries by hand today (no zod). The files, with their exports, which **all stay the same**:
- **`apps/mobile/src/lib/roles-api.ts`** (193 lines): `RoleHolder`, `CustomGroupRole`, `RolesApi`, `RolesApiError`, **`parseCustomGroupRole(value): CustomGroupRole | null`** (line 62) and `createRolesApi`.
- **`apps/mobile/src/lib/gifs-api.ts`** (198 lines): `GifsApiError`, **`parseGifItem(value, apiUrl): GifItem | null`** (line 42), **`gifMediaUrl(mediaToken, apiUrl)`** (line 88), `GifPage`, `TokenProvider`, `GifsApi` and `createGifsApi`.
- **`apps/mobile/src/lib/ai-memory-api.ts`** (179 lines): `AiMemoryFact`, `AiMemory`, `AiMemoryApi`, `AiMemoryApiError` and `createAiMemoryApi`.
- **`apps/mobile/src/lib/connections-api.ts`** (197 lines): `ProviderConnection`, `CreateConnectionInput`, `ConnectionTestResult`, `ConnectionsApi`, `ConnectionsApiError`, **`buildCreateConnectionBody(input)`** (line 85, a request builder that stays as it is) and `createConnectionsApi`.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{roles,gifs,ai-memory,connections}-api.test.ts` and `apps/mobile/src/lib/roles.test.ts`;
  - `apps/mobile/src/store/real-store.roles.test.ts`;
  - `apps/mobile/src/components/chat/{group-roles-sheet,gif-panel,composer-gifs,emoji-sheet}.test.tsx`;
  - `apps/mobile/src/components/ais/{ai-memory-section,ai-memory-sheet}.test.tsx`;
  - `apps/mobile/src/components/connections/{connections-screen.test.tsx,errors.test.ts,save-connection.test.ts}`.
- **Connections carry provider API keys in requests.** Never log a request body, and keep error messages free of the key, exactly as today.

### What to build
1. **Convert the four files with the T-0506 recipe:**
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   `parseCustomGroupRole` and `parseGifItem` become thin wrappers over the schemas.
2. **Tests:** every existing test passes **unchanged**. You may add one new test file per client for a lenient-field or whole-list case the old tests miss.
3. **No new dependencies.**

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.effect.test.ts`, then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/roles-api.ts`, `apps/mobile/src/lib/gifs-api.ts`, `apps/mobile/src/lib/ai-memory-api.ts`, `apps/mobile/src/lib/connections-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/roles-api.effect.test.ts`, `apps/mobile/src/lib/gifs-api.effect.test.ts`, `apps/mobile/src/lib/ai-memory-api.effect.test.ts` and `apps/mobile/src/lib/connections-api.effect.test.ts`;
- `work/T-0527-effect-mobile-api-batch-2.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot roles gifs gif-panel composer-gifs emoji-sheet ai-memory connections
pnpm gate
```

### Acceptance
- The four clients decode with Effect Schema and run their requests as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
