---
id: T-1131
title: "Size split: apps/server/src/sandbox/tool-worker.ts (616) — one failRun() replaces the repeated error finish literals, and the fetch bridge and VM helpers move to sandbox/tool-worker-*.ts; sandbox tests unedited"
status: todo
milestone: M5
branch: task/T-1131-split-tool-worker
model: auto
effort: default
depends_on: [T-1128]
estimate: 0.3 day
---

# T-1131: Split the sandbox tool worker

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, chose "finish the leftovers". `apps/server/src/sandbox/tool-worker.ts` has 616 lines; the plan is `docs/audit/size-plan.md` #49. This is the QuickJS sandbox that runs AI-built tools (`docs/TOOL_SANDBOX.md`), so the limits and the fetch guard must stay exactly as they are. The tests are `apps/server/src/sandbox/run-tool.test.ts`, `host-fetch.test.ts` and `ip-guard.test.ts`.

**What the lead read:**
- **Before `run`:** `WorkerParams` (`:11`), `WorkerFetchPayload` (`:18`), `WorkerErrorKind` (`:26`), `dumpVmError` (`:35`), `logToParent` (`:53`), `Deferred` (`:57`), `waitForFetchResponse` (`:61`) and `disposeQuietly` (`:113`).
- **`const run = Effect.gen(…)`** (`:116`) is one large generator.
  - `finish(message)` is defined at `:121-133`.
  - There are **16** `finish({ … durationMs: Date.now() - startedAt })` calls, at `:136`, `:396`, `:400`, `:409`, `:422`, `:436`, `:454`, `:457`, `:486`, `:496`, `:514`, `:518`, `:527`, `:560`, `:570` and `:579`. Most are `{ type: 'error', kind, message, fetchCount, durationMs: Date.now() - startedAt }`.

### What to build
1. **Inside `run`,** add `failRun(kind, message)`, which calls `finish({ type: 'error', kind, message, fetchCount, durationMs: Date.now() - startedAt })`, and replace every call that has **exactly** that shape.
   - Keep the calls with a different shape as they are: the `...interrupted` spreads (`:396`, `:454`, `:514`), the `:136` one (`fetchCount: 0, durationMs: 0`), and the result at `:579`.
   - `fetchCount` must be read at call time, as today; it is a `let` that changes.
2. **Move helpers out of `run`** into new files, **byte-for-byte**, taking as parameters the values they used from the closure:
   - `apps/server/src/sandbox/tool-worker-fetch.ts`: the types and `waitForFetchResponse`, plus the host-fetch bridge code inside `run` if it can move with only parameter passing;
   - `apps/server/src/sandbox/tool-worker-vm.ts`: `dumpVmError`, `logToParent`, `disposeQuietly` and the VM setup helpers, if they can move with only parameter passing.

   **Whatever needs more than parameter passing stays in `tool-worker.ts`. Do not restructure the generator's control flow.**
3. **No behaviour change:** the same limits (`limits.ts`), the same error kinds and messages, the same order of checks, and the same messages posted to the parent.
4. **Tests** (the sandbox runs AI-built code): run `run-tool.test.ts`, `host-fetch.test.ts` and `ip-guard.test.ts`. **Do not edit them.** Paste the results.
5. **Line counts:** every file stays at most 400 lines. If `tool-worker.ts` cannot get under 400 without restructuring the generator, stop at the smallest safe size and say so in the Report. **Do not force it.**

### Read first
`AGENTS.md`, `docs/TOOL_SANDBOX.md`, `apps/server/src/sandbox/tool-worker.ts`, `apps/server/src/sandbox/run-tool.ts` and `apps/server/src/sandbox/limits.ts`.

### Allowed files
`apps/server/src/sandbox/tool-worker.ts`, `apps/server/src/sandbox/tool-worker-fetch.ts`, `apps/server/src/sandbox/tool-worker-vm.ts`, `work/T-1131-split-tool-worker.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/sandbox/run-tool.test.ts src/sandbox/host-fetch.test.ts src/sandbox/ip-guard.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, with no test file edited.
- The Report lists every `finish` call before and after.

---

## Report (written by the worker when done)

## Review (written by Claude)
