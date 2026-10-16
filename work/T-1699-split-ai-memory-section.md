---
id: T-1699
title: "Size split of the phone components/ais/ai-memory-section.tsx (387 lines): move its non-UI part (the three failure messages, AiMemoryStatus, the state and actions types, removeFact, requestForgetFact(Effect), clearAiMemory(Effect)) into a new components/ais/ai-memory-logic.ts — a pure move"
status: merged
milestone: M5
branch: task/T-1699-split-ai-memory-section
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1699: Split the memory logic out of the phone AI memory section

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src/components/ais/ai-memory-section.tsx` is 387 of 400 lines, so the AI memory UI (active AI work) can't change. Its top part is plain logic with no JSX.

### Facts (the lead read them on 2026-10-16)
- **`ai-memory-section.tsx`:**
  - imports `:1-11` (`Effect`; `AiMemoryApiError`, `type AiMemory`, `type AiMemoryApi` from `@/lib/ai-memory-api`; `interruptFiber`; UI imports);
  - `const LINE_PREFIX :15` (stays, the component uses it);
  - **the block to move**, from the comment `/** Fixed user-facing line when the memory fails to load. */` (`:17`) to the end of `export const clearAiMemory = … :90-95`:
    - `MEMORY_LOAD_FAILED_MESSAGE :18`, `MEMORY_FORGET_FAILED_MESSAGE :21` and `MEMORY_CLEAR_FAILED_MESSAGE :24`;
    - `type AiMemoryStatus :26`, `interface AiMemorySectionState :28` and `interface AiMemorySectionActions :38`;
    - `function removeFact :49`, `const requestForgetFactEffect :58`, `const requestForgetFact :74`, `const clearAiMemoryEffect :82` and `const clearAiMemory :90`;
  - then `export function AiMemorySectionContent :97` and `export function AiMemorySection :253`.
- **Importers:** only `AiMemorySection` is imported elsewhere (`apps/mobile/src/app/ais/[id].tsx:20` and `apps/mobile/src/components/ais/ai-memory-sheet.tsx:4`). Nothing imports the block's names.
- **The folder `apps/mobile/src/components/ais/`** has no `ai-memory-logic.ts`.

### Steps
1. **Create `apps/mobile/src/components/ais/ai-memory-logic.ts`** with the block moved **word for word**, comments included, keeping every `export`. Bring only the imports it needs (`Effect`, `AiMemoryApiError` and the `AiMemory`/`AiMemoryApi` types).
2. **`ai-memory-section.tsx`:** import what the components use from `./ai-memory-logic`, delete the block, and drop the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/mobile/src/components/ais/ai-memory-logic.ts`
- `apps/mobile/src/components/ais/ai-memory-section.tsx`
- `work/T-1699-split-ai-memory-section.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`ai-memory-section.tsx` is about 310 lines,** and `ai-memory-logic.ts` holds the block unchanged.
- **The mobile typecheck passes.**

---

## Report (written by the worker when done)

### What I did

A pure move, no behaviour change:

- Created `apps/mobile/src/components/ais/ai-memory-logic.ts` (79 lines) with the non-UI block moved **word for word**, comments and `export`s included: the three failure messages, `AiMemoryStatus`, `AiMemorySectionState`, `AiMemorySectionActions`, `removeFact`, `requestForgetFactEffect`, `requestForgetFact`, `clearAiMemoryEffect` and `clearAiMemory`. Its only imports are `Effect` and `AiMemoryApiError` + the `AiMemory`/`AiMemoryApi` types.
- `apps/mobile/src/components/ais/ai-memory-section.tsx` (323 lines, was 387): imports what the components use from `./ai-memory-logic` (messages, the types, `removeFact`, `requestForgetFactEffect`, `clearAiMemoryEffect`), keeps `type AiMemory`/`type AiMemoryApi` from `@/lib/ai-memory-api`, and drops the now-unused `AiMemoryApiError` import. `LINE_PREFIX` and both components are unchanged.

Files changed:
- `apps/mobile/src/components/ais/ai-memory-logic.ts` (new)
- `apps/mobile/src/components/ais/ai-memory-section.tsx`
- `work/T-1699-split-ai-memory-section.md`

### Checks run

- `pnpm install`: done at start, no errors.
- `pnpm gate`: **GATE PASS**. Summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (14.2s)
  PASS  format  (9.8s)
  PASS  lint  (10.3s)
  PASS  typecheck  (24.5s)
  PASS  effect  (6.1s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I ran no separate test files: nothing imports the moved names (checked with grep), and the gate reports no nearby test files for `@zilar/mobile`.

### Notes for the lead

- Acceptance said `ai-memory-section.tsx` "about 310 lines"; it is **323**. The moved code was 76 lines, and the new `./ai-memory-logic` import block adds 12 lines, hence 323 rather than ~310. Still far under the 400-line cap, which was the point of the split.
- No deviations from the spec, no new dependencies, no new tests.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean; 1 nit, accepted: the file is 323 lines, not about 310.
- **The lead's check:** the removed lines equal `ai-memory-logic.ts` exactly.
- **Result:** `ai-memory-section.tsx` drops from 387 to 323 lines.
