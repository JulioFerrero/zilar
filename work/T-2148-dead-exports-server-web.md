---
id: T-2148
title: "Clean-up (server, web, packages, runner): delete exported functions, constants and types that nothing in the repo uses — and whatever only they used; no behaviour change"
status: merged
milestone: M5
branch: task/T-2148-dead-exports-server-web
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2148: Delete dead exports (server, web, packages, runner)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and a codebase that people and AIs can read without tripping over leftovers. The lead scanned every `.ts`/`.tsx` file under `apps/` and `packages/` at `db209d184`, tests and mocks included. Each name below appears exactly once in the whole repo: the declaration itself. No code, test or mock uses it. Most are left over from tonight's folds and the earlier test cuts.

| File | Line | Name |
| --- | ---: | --- |
| `apps/runner/src/cli.ts` | 323 | `__test_helpers` |
| `apps/runner/src/desk/policy.ts` | 45 | `PolicyFile` |
| `apps/server/src/agents/gateway/memory.ts` | 153 | `compactMemory` |
| `apps/server/src/agents/tool-guide.ts` | 10 | `TOOL_GUIDE_MAX_CHARS` |
| `apps/server/src/auth/deletion-request.ts` | 20 | `DELETION_FRESH_SESSION_MS` |
| `apps/server/src/chats/deliveries.ts` | 16 | `DELIVERED_IDS_MAX` |
| `apps/server/src/chats/deliveries.ts` | 17 | `DELIVERED_ID_MAX_LENGTH` |
| `apps/server/src/config/load.ts` | 183 | `ServerConfigLive` |
| `apps/server/src/connections/service.ts` | 209 | `decryptForGatewayUse` |
| `apps/server/src/drafts/events.ts` | 24 | `DraftEndEvent` |
| `apps/server/src/effect/sql.ts` | 131 | `SqlTest` |
| `apps/server/src/machines/service.ts` | 109 | `countActivePairingCodes` |
| `apps/web/src/lib/api/ais.ts` | 46 | `publicApprovalSchema` |
| `apps/web/src/lib/api/ais.ts` | 47 | `approvalRuleSchema` |
| `packages/chat-core/src/new-ai.ts` | 70 | `filterProviderChoices` |
| `packages/client-core/src/store/ledger-history-ingest.ts` | 224 | `LedgerBatch` |
| `packages/client-core/src/store/ledger-mutators.ts` | 161 | `LedgerMutators` |
| `packages/client-core/src/store/ledger-routine-bump.ts` | 65 | `RoutineBump` |
| `packages/devtools/src/lead/start-prereview.ts` | 11 | `PREREVIEW_MODEL` |
| `packages/protocol/src/common.ts` | 60 | `Jid` |
| `packages/ui-tokens/src/index.ts` | 36 | `PaletteKey` |
| `packages/xmpp-core/src/types-ack.ts` | 38 | `AckEventName` |

### Steps
For each row:
1. **Confirm it is unused.** Run `git grep -nw <name>` over the whole repo, not just `apps/` and `packages/`, so scripts, `.js`/`.mjs`, JSON, `app.json` and native code count too. If anything other than the declaration names it, skip the row and say where it is used.
2. **Delete the declaration** and its doc comment.
3. **Delete what it alone used.** That is a private helper, a constant, a type or an import that has no other user in that file once the declaration is gone. Re-check each with `git grep -nw`.
4. **Delete an emptied file.** If a file is left with no exports and no side effects, delete it and the import lines that point at it.

### Rules
- No behaviour change. Only delete; never rewrite a line that stays.
- Keep every name that still has a user.
- No new tests. If a test imports a deleted name, the scan was wrong: skip that row.

### Allowed files
- `apps/runner/src/cli.ts`
- `apps/runner/src/desk/policy.ts`
- `apps/server/src/agents/gateway/memory.ts`
- `apps/server/src/agents/tool-guide.ts`
- `apps/server/src/auth/deletion-request.ts`
- `apps/server/src/chats/deliveries.ts`
- `apps/server/src/config/load.ts`
- `apps/server/src/connections/service.ts`
- `apps/server/src/drafts/events.ts`
- `apps/server/src/effect/sql.ts`
- `apps/server/src/machines/service.ts`
- `apps/web/src/lib/api/ais.ts`
- `packages/chat-core/src/new-ai.ts`
- `packages/client-core/src/store/ledger-history-ingest.ts`
- `packages/client-core/src/store/ledger-mutators.ts`
- `packages/client-core/src/store/ledger-routine-bump.ts`
- `packages/devtools/src/lead/start-prereview.ts`
- `packages/protocol/src/common.ts`
- `packages/ui-tokens/src/index.ts`
- `packages/xmpp-core/src/types-ack.ts`
- `work/T-2148-dead-exports-server-web.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every row is deleted, or skipped with the user's file:line.
- The Report gives the product-line net from `git diff main --numstat`.

---

## Report (written by the worker when done)

### What I did

Deleted all 22 rows from the Spec, each after confirming with `git grep -nw` that no code, test, script or config referenced it. All rows were deleted; none skipped.

Cascading deletions (each re-checked with `git grep -nw`):
- `apps/server/src/connections/service.ts`: `decryptForGatewayUse` was the only user of `decryptForGatewayUseEffect`, so both went, along with the now-unused `SqlError` and `KeyCipher` imports.
- `apps/server/src/effect/sql.ts`: `SqlTest` was the only user of `freshMigratedPglite`, which was the only user of `snapshotOfMigratedDatabase` and `migratedSnapshot`; all four were removed.
- `apps/server/src/config/load.ts`: removed the now-unused `Layer` import.
- `apps/runner/src/cli.ts`: removed the now-unused `hubUrlFromServer` import.
- `apps/server/src/agents/gateway/memory.ts`: only the exported `compactMemory` wrapper went; `compactMemoryEffect` stays because `createMemoryRunner` still uses it.
- `apps/runner/src/desk/policy.ts`: `PolicyFileSchema` stays because `parsePolicy` still uses it.
- `packages/devtools/src/lead/start-prereview.ts`: removed the doc comment that belonged only to `PREREVIEW_MODEL`.

Notes on the unused scan: the names still appear in historical `work/*.md` and `docs/*.md` files, which are records rather than code users; AGENTS.md forbids editing other task files, and no `.ts`/`.tsx`/`.js`/`.mjs`/JSON/native file names any of them.

### Checks run

- `git grep -nw <each of the 22 names> -- . ':!*.md' ':!*.lock'` before editing: only the declaration itself matched for every row.
- Same grep after editing over `apps` and `packages`: `NO CODE REFERENCES`.
- `pnpm gate` from the repo root:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`
  - `PASS tests @zilar/chat-core`, `@zilar/client-core`, `@zilar/devtools`, `@zilar/protocol`, `@zilar/runner`, `@zilar/server`, `@zilar/web`, `@zilar/xmpp-core`
  - `SKIP tests @zilar/ui-tokens (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`, `migration: ...`, `images: ...`, `size: ...`, `comments: no task IDs in added comments`
  - `GATE PASS`
- Product-line net from `git diff main --numstat -- apps packages`: **3 added, 142 deleted, net −139 lines**. The three added lines are rewritten import lines (not new code).

### Notes for the lead

No deviations from the Spec; no behaviour change. One formatting follow-up was fixed inside the allowed files (a trailing blank line in `connections/service.ts`).

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −139: all 22 dead exported names deleted from the server, web, packages and runner, plus helpers and imports that only they used. Each name was confirmed unused with `git grep -nw`. The only added lines are narrowed import lines. The gate typechecked and tested every touched package.
