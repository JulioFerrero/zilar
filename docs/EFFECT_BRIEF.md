# Effect conversion brief (wave workers)

This page is the short version for conversion workers. Read it, your task file and `AGENTS.md`, then the files the task names. Open `docs/EFFECT_GUIDE.md` only for the section your task cites. Effect is **4.0.2**: check every API in `node_modules/effect/dist/*.d.ts`, never from memory of v3.

## The goal of every conversion task

- **What changes:** each listed file imports Effect for its async work. After the task it has no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout`, `setInterval`, raw storage or `JSON.parse` of its own. `pnpm effect:map` then shows the file as `effect`.
- **What stays the same:** behaviour, text, timing and the order of side effects, unless the task says otherwise. List every difference in the Report.
- **Exports stay the same:** names, signatures and Promise return types. A caller outside your task still awaits them (a Tier B edge, `EFFECT_GUIDE.md:12-32`). Write the body as an Effect and export `(...a) => Effect.runPromise(fooEffect(...a))` (`runWeb` on web). Exporting `fooEffect` as well is welcome.
- **Errors stay the same:** the same class and message reach the same caller, and a test that checks them passes unchanged.

## Building blocks (proven in merged tasks)

| Old code | Effect | Example in the repo |
| --- | --- | --- |
| `await promise` | `Effect.tryPromise({ try: (signal) => …, catch: (e) => new MyError(...) })`, or `Effect.promise` when a rejection is a defect (DB) | `voice-transcription/pipeline.ts` |
| callback or event API (`onload`, `on('data')`, MediaRecorder) | `Effect.callback((resume) => { …; return Effect.sync(removeListeners) })` | `web-tools/guarded-fetch.ts` |
| `setTimeout` | `Effect.sleep` in a forked fiber; `Fiber.interrupt` where `clearTimeout` was | `packages/xmpp-core/src/timers.ts`, `drafts/hub.ts` |
| `setInterval` or polling | `Effect.repeat(e, Schedule.spaced(d))`, which runs once at once, then spaces | `apps/web/src/lib/useApprovalPolling.ts` |
| `void x().catch(log)` | `Effect.runFork(e.pipe(Effect.catchCause(logIt)))` with the same log text and fields | `drafts/hub.ts` |
| a pending Promise settled later | `Deferred.make`, then `Deferred.doneUnsafe` in the handler | `packages/xmpp-core/src/client.ts` (T-0777) |
| `try { new URL(x) } catch` | `parseUrl` / `safeDecode` from `@zilar/chat-core` | `packages/chat-core/src/url.ts` |
| a resource closed by hand | `Effect.acquireRelease` inside `Effect.scoped` | `sandbox/run-tool.ts` |
| a timeout | `Effect.timeoutOrElse({ duration, orElse })`, which keeps only your typed error | `voice-transcription/pipeline.ts` |
| a per-key serial chain | a `Semaphore` of 1 per key, or a `Queue` with one consumer fiber | |

## Web UI (React)

- **Hooks:** `useAction(fn, { mode })` for user actions and `useQuery(make, deps)` for loads (`apps/web/src/lib/effect/`; read their header comments). Wrap API calls in `fromApi(() => apiFn(...))`, which gives `ApiFailure` with `code`, `status` and `message`.
- **One action per row:** a list with a button on each row gives each row its own `useAction` in a small row component.
- **Keep the tree:** dialogs are not portalled (`components/ui/dialog.tsx` is `fixed inset-0`), so they stay where they are.
- **Store errors:** a chat-store action that rejects with a plain `Error` keeps showing its `message`. Only non-`Error` causes get the component's fixed fallback.
- **The click stays synchronous:** browser calls that need the user's click (`installEvent.prompt()`, `audio.play()`) run inside the click handler; only the wait for their result is an Effect.
- **Models:** `routes/BlockedPage.tsx`, `routes/StickersPage.tsx` and `components/NewGroupDialog.tsx`.

## Server

- **Logging:** `Effect.log*` goes to pino (`effect/logger.ts`). Log objects as objects so redaction works; never put secrets or message bodies in text.
- **DB failures** stay defects with the original error (`Effect.promise`), never wrapped.
- **Loops:** a loop survives a throw only with `Effect.catchDefect` inside the repeat. Every loop fiber is interrupted on shutdown.

## Effect 4 traps

- `Effect.async` does not exist; use `Effect.callback`. Its `resume` takes an Effect.
- `Effect.catch` typechecks in 4.0.2 (T-0792 used it), as do `catchTag`, `catchTags`, `catchCause` and `catchDefect`. `catchAllCause` does not exist. To log a loop's failure without logging normal interruption, use `catchDefect`.
- `Effect.timeout` adds `TimeoutError`; prefer `timeoutOrElse`.
- `Schema.Number` accepts `NaN`; use `Schema.Finite`. Use `Schema.optional`, not `optionalKey` (`exactOptionalPropertyTypes`).
- `Effect.fnUntraced(function* (...) {...})` with an `Effect.fn.Return<A, E>` annotation is the shape for reusable functions.

## Tests in a wave

- **Run only your own tests:** your files' test files and the nearest folder, with `--reporter=dot`. Run them 3 times if the code has timers or concurrency.
- **Do not run** the whole suite or `pnpm gate`: the lead runs one combined check for the whole wave and sends you every failure.
- **Never use `git stash`:** the stash list is shared by every worktree of the repo, so a pop can take another worker's changes (this happened on 2026-10-09). For a "before" run, use `git diff > <scratch file>` and `git checkout -- <files>`, then `git apply` it back, or compare with the base in a separate checkout.
- **Scratch files go in your own subfolder:** use `<scratchpad>/<your task id>/`, never a shared file name. Parallel workers share the scratchpad, and on 2026-10-10 one worker's script ran in another worker's tree. Every git command names your worktree explicitly (`cd <your worktree> && ...` or `git -C <your worktree>`).
- **Before you commit:** run `pnpm exec prettier --write <your files>`, `pnpm exec oxlint <your files>` (it must be clean; the React rules forbid, for example, reading `ref.current` during render) and the package typecheck (`pnpm --filter <pkg> typecheck`).
- **Which tests to write (Julio, 2026-10-10):** only for crucial code: auth and keys, permissions and money, and the message pipeline. Also write one when you fix a real bug there. There is no "tests first" rule and no coverage target, and UI code gets no tests.
- **Existing tests:** do not edit them unless the task allows it. When your change breaks a test that is not crucial, delete it and list it in the Report.

## The Report

Fill in, as short bullets:
- each file's Effect kind (the ratchet's classification);
- the test counts before and after;
- every behaviour difference (or "none");
- anything you were unsure about.

Then set `status: review` and commit.
