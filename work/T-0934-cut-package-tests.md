---
id: T-0934
title: "Cut the package tests to the crucial ones (message pipeline, tunnel auth, the lead's merge and gate scope), passWithNoTests where a package keeps none, and AGENTS.md's test rule rewritten"
status: todo
milestone: M5
branch: task/T-0934-cut-package-tests
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0934: Cut the package tests

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10: tests only for crucial code (auth and keys, permissions and money, the message pipeline), with the existing tests cut to the max. No "tests first" rule any more.

The package tests today are:
- `client-core` 19 files;
- `chat-core` 24;
- `xmpp-core` 16 (5,700 lines);
- `protocol` 14;
- `runner-tunnel` 12;
- `devtools` 35 (11,000 lines);
- `api-contract` 5;
- `ui-tokens` 1.

### What to build
1. **Keep exactly these test files. Delete every other `*.test.ts` and `*.test.tsx` under `packages/*/src`:**
   - **`packages/client-core/src/store/`:**
     - `ledger.test.ts`
     - `incoming.test.ts`
     - `send.test.ts`
     - `history.test.ts`
     - `lifecycle.test.ts`
     - `polling.test.ts`
     - `actions.test.ts`
   - **`packages/chat-core/src/`:**
     - `messages.test.ts`
     - `edits.test.ts`
     - `reactions.test.ts`
     - `money.test.ts`
     - `store/ledger.test.ts`
   - **`packages/xmpp-core/src/`:**
     - `stanza.test.ts`
     - `connection-resilience.test.ts`
     - `stream-management.test.ts`
     - `mam.test.ts`
   - **`packages/protocol/src/`:**
     - `payload.test.ts`
     - `common.test.ts`
   - **`packages/runner-tunnel/src/`:**
     - `auth.test.ts`
     - `keys.test.ts`
   - **`packages/devtools/src/`:**
     - `lead/merge.test.ts`
     - `gate/gate.test.ts`
   - **`api-contract` and `ui-tokens`:** keep none.
2. **Packages with no tests left** (`api-contract`, `ui-tokens`, any other): their `test` script becomes `vitest run --passWithNoTests`, so `pnpm gate` and `lead batch check` still pass. Check how `packages/devtools/src/lead/batch.ts` reads the test script (`:827-830`) and that it still works.
3. **Test helpers:** delete helpers that no kept file imports. Keep `packages/xmpp-core/src/testing.ts`, because it is a published export that the app store tests use; delete only its test.
4. **`AGENTS.md`:** rewrite its test rules to say:
   > Tests: write a test only when the change touches crucial code (auth and keys, permissions and money, the message pipeline) or fixes a real bug there. No "tests first", no coverage target. UI code gets no tests; the lead's phone smoke and Julio's live checks cover it. Run only the tests near your change, plus `pnpm gate`.

   Remove any rule that contradicts this.
5. **No production file changes.**

### Read first
`AGENTS.md`, `packages/devtools/src/lead/batch.ts:470-530` and `:820-835`, `packages/devtools/src/gate/` (how the gate picks test packages), and each package's `package.json`.

### Allowed files
`packages/*/src/**/*.test.ts`, `packages/*/src/**/*.test.tsx`, `packages/*/package.json` (the `test` script only), `packages/*/src/test/**`, `AGENTS.md`, `work/T-0934-cut-package-tests.md`.

### Checks (wave mode)
```bash
pnpm -r --filter "./packages/*" exec vitest run --reporter=dot --passWithNoTests
pnpm --filter @zilar/devtools typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report gives:
  - the test files and lines before and after, per package;
  - the scripts changed;
  - the new `AGENTS.md` test section verbatim.

---

## Report (written by the worker when done)

## Review (written by Claude)
