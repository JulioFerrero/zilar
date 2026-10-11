---
id: T-1123
title: "Size split: apps/server/src/effect/edge.ts (434) — route matching, request id, CORS and body helpers move unchanged to effect/edge-request.ts and are re-exported"
status: merged
milestone: M5
branch: task/T-1123-split-edge
model: auto
effort: default
depends_on: [T-1118]
estimate: 0.1 day
---

# T-1123: Split `effect/edge.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` T106. `apps/server/src/effect/edge.ts` has 434 lines (read by the lead).

**The interfaces, which stay:** `EdgeAuth` (`:37`), `EdgeHealth` (`:41`), `CreateEdgeInput` (`:46`), `EdgeRoute` (`:54`) and `ZilarEdge` (`:59`).

**The helpers, to move:**
- `CompiledRoute` (`:73`), `splitPattern` (`:79`), `splitPathname` (`:83`), `decodeSegment` (`:87`), `matchesRoute` (`:95`);
- `resolveRequestId` (`:111`, exported), `UNSAFE_METHODS` (`:123`, exported), `allowedOrigins` (`:125`, exported), `logPath` (`:138`, exported), `durationSince` (`:151`, exported);
- `errorBody` (`:155`), `internalErrorBody` (`:166`), `appendVary` (`:176`), `applyCors` (`:197`), `withRequestIdHeader` (`:228`), `mergePath` (`:235`), `forwardEdgeRequest` (`:239`).

**What stays:** `createEdge` (`:248`) to the end.

**This is the front door for every request** (CORS, origins, request ids).

### What to build
1. **A new `apps/server/src/effect/edge-request.ts`** holds `:73-247`, **moved byte-for-byte** with the imports it needs. Export what `edge.ts` uses.
2. **`edge.ts`** keeps the interfaces and `createEdge`, imports the helpers, and **re-exports** `resolveRequestId`, `UNSAFE_METHODS`, `allowedOrigins`, `logPath` and `durationSince`, so no importer changes. `edge-request.ts` must not import `./edge` (no cycle); if a moved helper needs one of the interfaces, move only that interface's import, not the interface.
3. **No behaviour change**, especially in CORS and the origin checks.
4. **Line counts:** both files stay at most 400 lines. Paste `wc -l` in the Report.
5. **Tests:** run the tests that import `effect/edge` (`grep -rln "effect/edge'" apps/server/src | grep test`) and paste the results. Run `apps/server/src/auth/auth.test.ts` too, since it checks origins.

### Read first
`AGENTS.md`, and `apps/server/src/effect/edge.ts`.

### Allowed files
`apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge-request.ts`, `work/T-1123-split-edge.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth/auth.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Both files are at most 400 lines.

---

## Report (written by the worker when done)

### What I did
Split `apps/server/src/effect/edge.ts`: the request-level helpers moved unchanged
into a new `apps/server/src/effect/edge-request.ts`; `edge.ts` keeps the five
interfaces (`EdgeAuth`, `EdgeHealth`, `CreateEdgeInput`, `EdgeRoute`,
`ZilarEdge`) and `createEdge`, imports the helpers, and re-exports the public ones.

- Moved (byte-for-byte, bodies unchanged): `CompiledRoute`, `splitPattern`,
  `splitPathname`, `decodeSegment`, `matchesRoute`, `resolveRequestId`,
  `UNSAFE_METHODS`, `allowedOrigins`, `logPath`, `durationSince`, `errorBody`,
  `internalErrorBody`, `appendVary`, `applyCors`, `withRequestIdHeader`,
  `mergePath`, `forwardEdgeRequest`. I added `export` only where `edge.ts` uses
  the symbol; `decodeSegment` and `appendVary` stay private.
- Also moved the four constants `REQUEST_ID_RESPONSE_HEADER`, `REQUEST_ID_LIMIT`,
  `REQUEST_ID_PATTERN`, `CORS_ALLOW_METHODS`: only the moved helpers referenced
  them, and `edge-request.ts` must not import `./edge` (no cycle), so they had to
  live with the helpers. This is a small deviation from the literal `:73-247`
  range (the constants are on `:31-35`) but required for the split to compile.
- `edge.ts` re-exports the five public helpers unchanged:
  `export { allowedOrigins, durationSince, logPath, resolveRequestId, UNSAFE_METHODS };`
  so `app.ts` and any other importer keep working. `createEdge` and the interfaces
  were not touched. No behaviour change (route matching, request id, origin guard
  and CORS code is identical).

### Files changed
- `apps/server/src/effect/edge.ts` — now 272 lines (was 434).
- `apps/server/src/effect/edge-request.ts` — new, 196 lines.
- `work/T-1123-split-edge.md` — status + this report.

I verified the moved bodies are identical to the original: after removing the
added `export` keywords and blank lines, the only difference vs the old `:73-247`
is that prettier wraps the `forwardEdgeRequest` signature across lines (it
exceeds 100 cols once `export ` is added); its body is unchanged.

### Commands and real results
- `pnpm install` — done, 1172 packages added (one peer-dependency warning about
  `@types/react-dom` in `apps/mobile`, pre-existing and unrelated).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts`
  — the only test importing `effect/edge`: `Test Files 1 passed (1)`, `Tests 5 passed (5)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts`
  — `Test Files 1 passed (1)`, `Tests 36 passed (36)`.
- `pnpm gate` (repo root, run twice; the first failed only on `format` because the
  re-export list was written multi-line):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.5s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (2.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `wc -l apps/server/src/effect/edge.ts apps/server/src/effect/edge-request.ts`
  → `272` and `196` (both ≤ 400).

### Problems / deviations
- The constants move noted above (needed to avoid a cycle).
- Prettier re-wrapped the `forwardEdgeRequest` signature (formatting only).
- I added a short header comment to `edge-request.ts` matching the style of
  `http-core.ts` / `error-utils.ts`; the moved code itself is unchanged.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The split:** `effect/edge.ts` goes from 434 to 272 lines. Route matching, request id, CORS and body helpers move to `effect/edge-request.ts` (196). `edge.ts` re-exports `resolveRequestId`, `UNSAFE_METHODS`, `allowedOrigins`, `logPath` and `durationSince`, and `edge-request.ts` does not import `./edge`.
- **The lead's line check:** the removed lines missing from the new file are only the declarations that gained `export` and one import line. CORS and origin code moved unchanged.
- **Tests:** the lead ran `auth/auth.test.ts` (origin checks) on the branch, all green. The gate passed.
