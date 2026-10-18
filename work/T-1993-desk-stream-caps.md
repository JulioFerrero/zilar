---
id: T-1993
title: "AI computer hardening: cap desk output on the server and in the desk agent (line and total), give runner/cloud execute a server-side deadline, give sandbox fetches an overall deadline tied to the run, and rate-limit tool.save test runs — with tests"
status: merged
milestone: M5
branch: task/T-1993-desk-stream-caps
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-1993: Caps and deadlines on desk output and sandbox fetches

## Spec (written by Claude, do not edit)

### Why
The lead's private security review of 2026-10-18 (T-1986) found three gaps:
- **Uncapped desk output.** The output of an AI computer, cloud or runner, is read with no cap on line length or total size, so a paired runner, or code running in a jail, can fill the server's memory.
- **Fetches with no overall deadline.** The tool sandbox's fetches have only an idle timeout. A host that sends one byte every few seconds keeps the socket open, and the socket outlives the worker.
- **No run limit on test runs.** The test run behind `tool.save` skips the run limiter that `tool.run` uses.

### Facts (read by the lead on 2026-10-18)
- **`apps/server/src/hands/cloud-hands.ts` (218 lines).** `socketLines` (`:88-102`) does `buffer += String(data)` with no length check. Both the cloud and the runner `execute` use it (`hands/runner-hands.ts`, 106 lines, `execute` at `:60`).
- **`apps/server/src/agents/gateway/desk-exec.ts` (275 lines).** `runExecute` (`:206-224`) does `output += chunk.data` for every chunk. It applies `TOOL_RESULT_MAX_CHARS` (8 KiB, `agents/tool-loop.ts:230`) only after the loop ends.
- **`packages/desk/src/agent/docker.ts` (264 lines).** `readDaemon` (`:76-93`) has the same uncapped `buffer += String(data)`.
- **`apps/server/src/sandbox/host-fetch.ts` (224 lines).**
  - `req.setTimeout(options.fetchTimeoutMs, ...)` is an idle timeout, reset on every byte (`:199-204`).
  - There is no overall deadline.
  - `fetchPinnedHttps` (`:218-224`) runs the effect as a promise.
- **`apps/server/src/sandbox/run-tool.ts` (339 lines).** The worker's fetch runs in a detached `void (async () => { ... })()` (`:180-…`), which is not tied to the worker's lifetime.
- **`apps/server/src/tools/tool-adapters.ts` (369 lines).** The `tool.save` test run calls `runToolVersion(...)` (`:183-192`) with no limiter. `tool.run` checks `state.runLimiter.allow(key)` first, with `key = aiId\ngroupId\ntopicId` (`:236-239`).
- **Tests.** These test files exist:
  - `hands/cloud-hands.test.ts`
  - `hands/runner-hands.test.ts`
  - `sandbox/host-fetch.test.ts`
  - `sandbox/run-tool.test.ts`
  - `packages/desk/src/agent/server.test.ts`

### Steps
1. **Cap the line buffers.** In `socketLines` and in `readDaemon`, when the pending buffer passes 1 MiB without a newline, destroy the socket or kill the process, then throw a fixed error (`desk output line too long`).
2. **Stop reading at the result cap.** In `runExecute`, stop adding to `output` once it is past `TOOL_RESULT_MAX_CHARS`: mark the result truncated, abort the stream, and don't read the rest.
3. **Add an execute deadline.** Give `execute` (cloud and runner) a server-side deadline of the desk's `commandTimeoutMs` plus 15 s. When it passes, abort, and the call ends as a timeout.
4. **Bound sandbox fetches.**
   - Wrap `fetchPinnedHttpsEffect` in an overall deadline of `fetchTimeoutMs` (for example `Effect.timeoutOrElse`, as `web-tools/guarded-fetch.ts` does).
   - Tie the worker's fetch to the run: when the run ends or the worker is terminated, destroy any open request.
5. **Rate-limit `tool.save` test runs.** Check `state.runLimiter.allow(key)`, with the same key as `tool.run`, before the test run. When the limit is reached, save the tool anyway, skip the test run, and say so in the summary ("saved; test run skipped: run limit reached").
6. **Tests.** This is the AI computer and tool path, and these tests guard memory and the event loop.
   - `socketLines` throws on a 2 MiB line with no newline.
   - `runExecute` stops at the cap when it gets an endless stream.
   - A slow-drip fetch ends by the deadline.
   - Put each test in the nearest existing test file.
7. **Keep files small.** Every file must stay at or under 400 lines.

### Allowed files
- `apps/server/src/hands/cloud-hands.ts`
- `apps/server/src/hands/runner-hands.ts`
- `apps/server/src/hands/cloud-hands.test.ts`
- `apps/server/src/hands/runner-hands.test.ts`
- `apps/server/src/agents/gateway/desk-exec.ts`
- `packages/desk/src/agent/docker.ts`
- `packages/desk/src/agent/server.test.ts`
- `apps/server/src/sandbox/host-fetch.ts`
- `apps/server/src/sandbox/host-fetch.test.ts`
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/sandbox/run-tool.test.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `work/T-1993-desk-stream-caps.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/hands src/sandbox --reporter=dot
pnpm --filter @zilar/desk exec vitest run src/agent --reporter=dot
pnpm gate
```

### Acceptance
- The new tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

**Caps in the server hands (`apps/server/src/hands/cloud-hands.ts`)**
- `socketLines` now fails when the pending buffer passes 1 MiB with no newline: it destroys the socket and throws `DeskError('output_too_large', 'desk output line too long')`.
- `runExecuteOverSocket` (used by both the cloud and runner execute paths) now carries a hard deadline of `MAX_COMMAND_TIMEOUT_MS + 15 s`: a timer aborts a combined signal, destroys the socket, and the call ends as `DeskError('timeout', 'the command timed out')`. The timer is cleared and the abort listener removed in `finally`.

**Result cap (`apps/server/src/agents/gateway/desk-exec.ts`)**
- `runExecute` appends at most `TOOL_RESULT_MAX_CHARS + 1` chars (one oversized chunk is sliced), then sets `truncated`, aborts an internal controller combined with the turn signal, and `break`s out of the stream so the rest is never read. The final output is still rendered with `\n(truncated)`.

**Desk agent daemon (`packages/desk/src/agent/docker.ts`)**
- `readDaemon` applies the same 1 MiB no-newline cap, `SIGKILL`s the `docker exec` child and throws the same fixed `desk output line too long` error.

**Sandbox fetches (`apps/server/src/sandbox/host-fetch.ts`, `run-tool.ts`)**
- `fetchPinnedHttpsEffect` is wrapped in `Effect.timeoutOrElse` with `Duration.millis(fetchTimeoutMs)`, failing with the existing `fetch timeout` text; the effect finalizer destroys the request on interruption. The idle `req.setTimeout` stays.
- `HostFetcher` takes an optional `AbortSignal`; `createDefaultFetcher`/`fetchPinnedHttps` forward it to `Effect.runPromise`.
- `runTool` creates one `AbortController` per run and aborts it in the run's callback finalizer (normal settle, wall-clock timeout, worker error/exit, or scope release). The worker's fetch passes that signal, and late results are dropped after an abort, so no request outlives the run.

**Rate limit on `tool.save` test runs (`apps/server/src/tools/tool-adapters.ts`)**
- Before the test run, `tool.save` now checks `state.runLimiter.allow(key)` with the same `aiId\ngroupId\ntopicId` key `tool.run` uses. If refused, the tool stays saved, no test run happens, and the summary is `saved <name> v<n>; test run skipped: run limit reached` (plus the unapproved-hosts hint when relevant).

**Tests**
- `apps/server/src/hands/cloud-hands.test.ts`: `socketLines` throws on a 2 MiB line with no newline; `createDeskRunner` stops at the result cap on an endless stream, marks it truncated and aborts the stream.
- `apps/server/src/sandbox/host-fetch.test.ts`: a slow-drip TLS response (one byte every 20 ms, idle timeout never fires) ends at the overall deadline with `fetch timeout`.

### Checks run

- `pnpm install --silent` — ok (no output).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands/cloud-hands.test.ts` — 1 file, 4 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/host-fetch.test.ts` — 1 file, 28 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts` — 1 file, 51 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/server.test.ts` — 1 file, 13 tests passed.
- `pnpm gate` — first run failed `typecheck` on my new test (`DeskToolCallValid` needs `id`, TS2741); I added `id: 'call-1'`, re-ran the test file, then the gate. Final run:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/desk  (1.8s)
  PASS  tests @zilar/server  (54.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deadline constant:** the Hands `execute` signature carries no `commandTimeoutMs`, so the shared deadline uses `MAX_COMMAND_TIMEOUT_MS + 15 s` — the value this server always provisions (`desk-exec.ts` sets `commandTimeoutMs: MAX_COMMAND_TIMEOUT_MS`). A caller that ever provisions a shorter timeout would still get the max-based deadline. Say if you want the deadline passed per call instead.
- **`readDaemon` cap:** the desk agent tests use a fake `DockerLayer` for most cases; the cap itself is now exercised by a test that puts a fake `docker` executable on `PATH` (see Round).
- **No tests added for the execute deadline or the `tool.save` limiter:** the spec's test list named three tests and I added exactly those. Both paths typecheck and the gate's suite passes, but they are not directly asserted.
- Files changed are all inside Allowed files; no new files, no new dependencies.
- I ran the individual test files above instead of the task's directory-wide `vitest run src/hands src/sandbox` checks, following AGENTS.md's shared-machine rule; `pnpm gate` then ran the nearest tests once.

### Round (fix round 1)

**Findings fixed**
- **Finding 1 (should-fix):** the 1 MiB cap now applies to every drained daemon line and to the no-newline tail, in both `socketLines` (`apps/server/src/hands/cloud-hands.ts`) and `readDaemon` (`packages/desk/src/agent/docker.ts`). A newline-terminated frame over 1 MiB now destroys the socket / `SIGKILL`s the child and throws `desk output line too long`; it is no longer drained, parsed and yielded.
- **Finding 2 (nit):** left untouched, because it is a nit and none of the lines it names were changed by this fix.

**Tests added**
- `apps/server/src/hands/cloud-hands.test.ts`: a writer sends 1 MiB of `x` followed by 100 `y` plus `\n` (one newline-terminated frame over 1 MiB); `socketLines` rejects with `desk output line too long`.
- `packages/desk/src/agent/server.test.ts`: a fake `docker` executable on `PATH` emits the same shape; the real `createDockerLayer().run` (i.e. `readDaemon`) rejects with `desk output line too long`.

**Commands and results**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands/cloud-hands.test.ts` — 1 file, 5 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/server.test.ts` — 1 file, 14 tests passed.
- `pnpm gate` — `GATE PASS`:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (2.5s)
  PASS  lint  (2.3s)
  PASS  typecheck  (7.2s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/desk  (3.5s)
  PASS  tests @zilar/server  (54.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Status stays `review`.


## Review (written by Claude)

Approved after one auto round. The pre-review of `c09c5b78` found three nits, all cosmetic or about test coverage.
- **Output caps.** Desk output is capped by line and in total, on the server and in the desk agent.
- **Command deadline.** Runner and cloud execute get a server-side deadline of the maximum command timeout plus 15 s.
- **Sandbox fetches.** They get an overall deadline, tied to the run.
- **Tool saves.** `tool.save` test runs share the `tool.run` limiter, and a run over the limit is skipped with a fixed summary.
