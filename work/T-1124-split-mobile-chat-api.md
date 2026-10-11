---
id: T-1124
title: "Size split: apps/mobile/src/lib/chat-api.ts (439) — the wire schemas and parse functions move unchanged to lib/chat-api-schemas.ts"
status: merged
milestone: M5
branch: task/T-1124-split-mobile-chat-api
model: auto
effort: default
depends_on: [T-1122]
estimate: 0.1 day
---

# T-1124: Split mobile `chat-api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` T102. `apps/mobile/src/lib/chat-api.ts` has 439 lines (read by the lead).

**The parts:**
- **Exported types, `:20-69`:** `Me`, `Contact`, `ChatEntry`, `GroupRole`, `GroupMember`, `GroupDetail`, `GroupAi`, `XmppToken`, `TokenProvider`, `ChatApi`, `ChatApiError`.
- **Private wire schemas, `:74-211`:** from `LenientNullStringSchema` to `ChatsListSchema`.
- **Parse functions, `:213-318`:** `parseMe`, `parseChatEntry`, `parseGroupDetail`, `parseChatsList`, `parseXmppToken`.
- **The rest:** the tagged errors (`:320-327`), `requestEffect` (`:329`) and `createChatApi` (`:366`).

### What to build
1. **A new `apps/mobile/src/lib/chat-api-schemas.ts`** holds `:74-318` (schemas and parse functions), **moved byte-for-byte**.
   - Export the parse functions that `chat-api.ts` uses.
   - It may import the types it needs from `./chat-api` as `import type` only, so there is no runtime cycle.
2. **`chat-api.ts`** keeps the types, errors, `requestEffect` and `createChatApi`, and imports the parse functions.
   - Every name it exports today stays exported from it.
   - The schemas were private, so nothing else changes.
3. **No behaviour change.** Every lenient decode stays exactly as it is.
4. **Line counts:** both files stay at most 400 lines. Paste `wc -l` in the Report.
5. **Tests:** run the mobile tests that import `chat-api` (`grep -rln "chat-api'" apps/mobile/src | grep test`), if there are any, and paste the results.

### Read first
`AGENTS.md`, and `apps/mobile/src/lib/chat-api.ts`.

### Allowed files
`apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/chat-api-schemas.ts`, `work/T-1124-split-mobile-chat-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Both files are at most 400 lines.

---

## Report (written by the worker when done)

**What I did.** Split `apps/mobile/src/lib/chat-api.ts` (439 lines) in two along the boundaries the spec names.

- New `apps/mobile/src/lib/chat-api-schemas.ts` holds the private wire schemas (`LenientNullStringSchema` … `ChatsListSchema`) and the parse functions (`parseMe`, `parseChatEntry`, `parseGroupDetail`, `parseChatsList`, `parseXmppToken`), moved byte-for-byte from the old file. It exports the four parse functions `chat-api.ts` calls; `parseChatEntry` is only used by `parseChatsList`, so it stays private. The schemas stay private (they were private before, so nothing else changed).
- The new file imports `Me`, `ChatEntry`, `GroupMember`, `GroupDetail`, `GroupAi`, `XmppToken` from `./chat-api` with `import type` only, so there is no runtime import cycle.
- `apps/mobile/src/lib/chat-api.ts` keeps the exported types, `ChatApiError`, the tagged errors, `requestEffect` and `createChatApi`, and imports the four parse functions from `./chat-api-schemas`. Every name it exported before is still exported from it; the only other imports of `./chat-api` in the repo are `import type` of those exported types.

**No behaviour change.** No decode, leniency, error mapping or request path changed; the moved block differs from the original only by the four added `export` keywords.

**Files changed**
- `apps/mobile/src/lib/chat-api.ts`
- `apps/mobile/src/lib/chat-api-schemas.ts` (new)
- `work/T-1124-split-mobile-chat-api.md` (this Report + status)

**Line counts** (`wc -l`)
```
191 apps/mobile/src/lib/chat-api.ts
252 apps/mobile/src/lib/chat-api-schemas.ts
```
Both are at most 400.

**Commands and results**
- `pnpm install`: Done in 20.3s (one pre-existing peer-dependency warning for `@types/react-dom`, unrelated).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts src/lib/auth.test.ts src/lib/session-token.test.ts src/store/real-store.send.test.ts src/store/real-store.ledger.test.ts src/store/real-store.incoming.test.ts src/store/real-store.sign-out.test.ts src/store/real-store.history.test.ts src/store/effects/send.test.ts`: 9 test files passed, 48 tests passed. (These are the mobile tests that import `chat-api` per `grep -rln "chat-api'" apps/mobile/src | grep test`, plus the three tests sitting next to the changed `src/lib` file.)
- `pnpm gate` (repo root), summary lines:
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.8s)
PASS  lint  (1.0s)
PASS  typecheck  (4.2s)
PASS  effect  (1.7s)
PASS  tests @zilar/mobile  (1.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Deviations from the spec**
1. Added `export` to the four parse functions in the new file, so `chat-api.ts` can import them. Their bodies are unchanged.
2. The spec's ranges (`:74-211`, `:213-318`) start one line past the schema's lead-in comment (lines 71-73) and end two lines into the tagged-errors comment (lines 317-319). I moved the logical blocks instead: lines 71-315 (schemas, their lead-in comment, and the parse functions) into `chat-api-schemas.ts`, and kept the errors comment (317-319) with the errors in `chat-api.ts`. Nothing else moved.
3. One stale comment in the kept types block said `parseChatEntry` "(below)"; it now lives in `chat-api-schemas.ts`, so I reworded it to "(in `chat-api-schemas`)". Comment only, no code change.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit (the comment at `chat-api.ts:30-31` still says "(below)").**
- **The split:** mobile `lib/chat-api.ts` goes from 439 to 191 lines. The wire schemas and parse functions move to `lib/chat-api-schemas.ts` (252), which imports only types from `./chat-api` (`import type`, so there is no runtime cycle). The export surface of `chat-api.ts` is unchanged.
- **The lead's line check:** the removed lines missing from the new file are the parse declarations (now `export`), import lines, and the T-0924 comment, which stays in `chat-api.ts`, reworded.
- **The gate passed.**
