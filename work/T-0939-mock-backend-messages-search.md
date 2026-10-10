---
id: T-0939
title: "Mock backend B: the full message seed and the /search route in @zilar/mock-backend (docs/audit/mock-plan.md task B)"
status: todo
milestone: M5
branch: task/T-0939-mock-backend-messages-search
model: auto
effort: default
depends_on: [T-0937]
estimate: 0.5 day
---

# T-0939: Mock backend B, messages and search

## Spec (written by Claude, do not edit)

### Why
Task B of `docs/audit/mock-plan.md` section 4 (read the plan and "Julio's answers" at its end). T-0937 (merged) built `packages/mock-backend` with a text-only subset of messages (`src/data/messages.ts`, 110 lines, 2–7 per chat).

The fake XMPP (task F2) serves history from this seed, so it needs the real demo content. It now lives in:
- web `apps/web/src/mock/messages.ts` (1,148 lines; `mockMessages` `:1114`, `mockLastMessage` `:1141`);
- the helpers it uses in `apps/web/src/mock/helpers.ts` (voice and waveform `:29`, image SVGs, the approval card `:75`);
- mobile's copy in `apps/mobile/src/mock/messages.ts` (258 lines).

Web search is `searchMessages` at `apps/web/src/mock/api.ts:4152`, routed at `:3054`; mobile's is `apps/mobile/src/mock/search.ts` (152 lines).

### What to build
1. **The seed's messages:** every thread in web `mock/messages.ts`, with the same content, as bare-JID-keyed records in the shape the fake XMPP will emit (`packages/xmpp-core/src/types.ts`: the message event and `HistoryPage`). That covers voice, images, approval cards, edits, reactions and replies where web has them. Split it into files under 400 lines each (for example `src/data/messages/<thread>.ts`) plus small builders in `src/data/builders.ts` for the voice and image helpers.
2. **`src/http/search.ts`:** the contract's message search (`packages/api-contract/src/search.ts`), answered from the seed, with the same rules as web's `searchMessages` (the query length 2–100, matching and snippets). Register it in `src/http.ts`.
3. **No app file changes, no tests** (Julio's rule). Prove it in the Report with a throwaway script: the message count per thread, one `search` query and its response decoded with the contract schema.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/**`, `apps/web/src/mock/messages.ts`, `apps/web/src/mock/helpers.ts`, `apps/web/src/mock/api.ts:3054-3066` and `:4152-4297`, `packages/xmpp-core/src/types.ts`, `packages/api-contract/src/search.ts`.

### Allowed files
`packages/mock-backend/**`, `work/T-0939-mock-backend-messages-search.md`.

T-0940 and T-0941 add other routes to the same package in parallel. Register your route in `src/http.ts` with a single line, to keep the merge simple.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the counts and the decoded search response.

---

## Report (written by the worker when done)

## Review (written by Claude)
