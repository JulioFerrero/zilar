---
id: T-0934
title: "Cut the package tests to the crucial ones (message pipeline, tunnel auth, the lead's merge and gate scope), passWithNoTests where a package keeps none, and AGENTS.md's test rule rewritten"
status: merged
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

**Status:** review. Implemented exactly per spec. No production file changes.

### What I did

1. Deleted 104 test files, keeping only the 22 in the spec's keep list (7 `client-core`, 5
   `chat-core`, 4 `xmpp-core`, 2 `protocol`, 2 `runner-tunnel`, 2 `devtools`). Deletions done
   with `git rm` on the explicit list (no glob wildcards).
2. Changed the `test` script in `packages/api-contract/package.json` and
   `packages/ui-tokens/package.json` from `vitest run` to `vitest run --passWithNoTests`.
   No other package lost all its tests, so no other script changed.
3. Rewrote the `AGENTS.md` test rules (new `## Tests` section, verbatim below) and removed the
   contradicting "Write tests with Vitest for the logic you add" bullet from Coding rules.
4. Test helpers: none were orphaned, so none deleted. `packages/client-core/src/store/test-ctx.ts`
   is still imported by the kept `incoming.test.ts`, `history.test.ts` and `actions.test.ts`;
   `packages/runner-tunnel/src/test-harness.ts` is still imported by the kept `auth.test.ts`
   (and by production `demo.ts`). `packages/xmpp-core/src/testing.ts` is kept (published export);
   only its `testing.test.ts` was deleted.

### Test files and lines, before and after, per package

| package | files before | lines before | files after | lines after |
| --- | --- | --- | --- | --- |
| client-core | 19 | 3981 | 7 | 1838 |
| chat-core | 24 | 2249 | 5 | 704 |
| xmpp-core | 16 | 5729 | 4 | 2267 |
| protocol | 14 | 1484 | 2 | 445 |
| runner-tunnel | 12 | 1366 | 2 | 248 |
| devtools | 35 | 11009 | 2 | 945 |
| api-contract | 5 | 299 | 0 | 0 |
| ui-tokens | 1 | 105 | 0 | 0 |

### Scripts changed

- `packages/api-contract/package.json`: `"test": "vitest run"` → `"test": "vitest run --passWithNoTests"`
- `packages/ui-tokens/package.json`: `"test": "vitest run"` → `"test": "vitest run --passWithNoTests"`

`testArgsOf` in `packages/devtools/src/lead/batch.ts:828` parses this fine: it reads the flags
after `vitest run`, so `--passWithNoTests` is forwarded and a package with no tests exits 0.

### New `AGENTS.md` test section (verbatim)

> ## Tests
>
> Tests: write a test only when the change touches crucial code (auth and keys, permissions and money, the message pipeline) or fixes a real bug there. No "tests first", no coverage target. UI code gets no tests; the lead's phone smoke and Julio's live checks cover it. Run only the tests near your change, plus `pnpm gate`.
>
> Tests must not call real external services or use real API keys.

### Commands run and real results

- `pnpm install`: done in 30.1s (peer-dependency warnings only).
- Kept tests, one package at a time with `pnpm --filter <package> test --maxWorkers=2 --reporter=dot <files>`:
  - client-core: 7 files, 72 tests passed.
  - chat-core: 5 files, 62 tests passed.
  - xmpp-core: 4 files, 121 tests passed.
  - protocol: 2 files, 46 tests passed.
  - runner-tunnel: 2 files, 18 tests passed.
  - devtools: 2 files, 50 tests passed.
- Wave check `pnpm -r --filter "./packages/*" exec vitest run --reporter=dot --passWithNoTests`:
  all kept tests passed; api-contract and ui-tokens printed `No test files found, exiting with code 0`.
- `pnpm --filter @zilar/devtools typecheck`: passed (no output).
- `pnpm gate` (from repo root) summary lines:

```
gate: 108 changed file(s) against main
PASS  install (frozen)  (3.5s)
PASS  format  (1.5s)
PASS  lint  (1.5s)
PASS  typecheck  (8.3s)
SKIP effect (no source files changed)
SKIP tests @zilar/api-contract (no nearby test files)
SKIP tests @zilar/chat-core (no nearby test files)
SKIP tests @zilar/client-core (no nearby test files)
SKIP tests @zilar/devtools (no nearby test files)
SKIP tests @zilar/protocol (no nearby test files)
SKIP tests @zilar/runner-tunnel (no nearby test files)
SKIP tests @zilar/ui-tokens (no nearby test files)
SKIP tests @zilar/xmpp-core (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The gate's test steps are all SKIP because the diff contains only deleted test files and
`package.json`/`AGENTS.md`/task edits, so there is no nearby test to select; the wave check above
covers the kept tests. `scope` confirms every changed file is inside the Allowed files.

### Deviations and notes

- None from the spec. `AGENTS.md`'s "Never change `AGENTS.md`" safety rule is overridden by this
  task, which lists `AGENTS.md` in Allowed files and requires the rewrite.

### Blocked / needs a decision

- None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The cut:** 19,779 lines deleted across 108 files, keeping the spec's list.
- **Scripts:** `api-contract` and `ui-tokens` run `vitest run --passWithNoTests`.
- **AGENTS.md:** the test rule is rewritten as specified.
- **Check:** the worker's `pnpm gate` passed. The change deletes only tests and changes two test scripts, so the lead merged on the gate result instead of the full combined check (which runs the 9 GB web suite).
