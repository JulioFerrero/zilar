---
id: T-0790
title: "WU26: ChatList, MessageBubble, App on Effect (fire-and-forget calls and the try/catch sites)"
status: merged
milestone: M5
branch: task/T-0790-web-list-bubble-app
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0790: WU26: ChatList, MessageBubble, App on Effect (fire-and-forget calls and the try/catch sites)

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, W4 try/catch):
  - `apps/web/src/components/ChatList.tsx` (444, W4), tested in `ChatList.test.tsx`;
  - `apps/web/src/components/MessageBubble.tsx` (841, W4), tested in `MessageBubble.forward.test.tsx` and others (`ls apps/web/src/components/MessageBubble*`);
  - `apps/web/src/App.tsx` (27, W4), tested in `App.test.tsx`.
  - All three have only W4 (try/catch). Read each one: a pure total parse uses `parseUrl` or `safeDecode` from `@zilar/chat-core` (T-0765); a fire-and-forget store or API call becomes an Effect run with `runWeb` or `useAction`.
- **The hooks** are in `apps/web/src/lib/effect/`. The finished models are `apps/web/src/routes/BlockedPage.tsx` (per-row actions, T-0767), `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery` and typed validation errors, T-0773), and `apps/web/src/routes/StickersPage.tsx` (a page-level dialog with per-row actions, T-0783).
- **The full web suite passes on main** (1813 tests). Your change must keep it green, including other components' tests that render your files. Run the whole web suite once before you finish (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`).

### The conversion pattern (same for every web UI task)
- **The goal:** after this task each listed file imports Effect for its async work, and contains no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` of its own. That is the rule of `docs/audit/effect-100-plan.md` §1.3 and §3.6.
- **Use the hooks from T-0762** (`apps/web/src/lib/effect/use-action.ts`, `use-query.ts`; read their header comment):
  - `useAction(fn)` for user actions (submit, delete, toggle). It returns `[state, run, controls]`, and its `ignore` mode replaces the `busy` guards;
  - `useQuery(make, deps)` for loads, with `refresh` for reloads;
  - `failureOf(state)` and `isWaiting(state)` for the UI.
- **Calling existing API functions:** use `fromApi(() => apiFn(...))` (`apps/web/src/lib/effect/api-effect.ts`). It gives typed `ApiFailure` errors, which have `code`, `status` and `message`.
- **Timers and polling:** use `Effect.sleep`, `Effect.repeat` with `Schedule.spaced` or `Schedule.fixed`, inside `useQuery` or an atom, so unmount interrupts them. Debounce with `Effect.sleep` inside `useQuery` keyed on the input.
- **Keep the concurrency per item.** When a list has a button on each row, each row gets its own `useAction` (a small row component), so different rows can run at the same time while a double click on one row is still ignored. One `useAction` for the whole page would drop a second row's click (the lead's T-0767 review).
- **Keep the rendered structure.** Dialogs (`components/ui/dialog.tsx` is a non-portalled `fixed inset-0` overlay), lists and sections stay where they are in the tree. Moving a dialog into a row can clip it or stack it under other content (the lead's T-0783 review).
- **Non-API failures** may show the component's fixed fallback sentence instead of raw error text (`AGENTS.md`: fixed sentences). Mention it in the Report. **Exception:** a chat-store action that rejects with a plain `Error` carries a user-facing sentence the store wrote, so keep showing its `message`, as GroupPanel does since T-0781. Only non-`Error` causes get the fallback.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the listed files with the pattern.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/ChatList.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/App.tsx`, `work/T-0790-web-list-bubble-app.md`, `apps/web/src/components/ChatList.test.tsx` (added in fix round 1 for the install-prompt test).

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/ChatList src/components/MessageBubble src/App
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### Sites found
The three files have no literal `try`/`catch`. The effect map's W4 signal matches `.catch(`, so each file had only `.catch` sites (6 in total). Their timers and `async` code: none.

| File | Site | Now |
|---|---|---|
| `App.tsx` | `ensureServiceWorker(browser).catch(() => undefined)` in the mount effect | `void runWeb(Effect.promise(() => ensureServiceWorker(browser)).pipe(Effect.ignore))` |
| `ChatList.tsx` | `promptInstall().catch(() => setInstallFailed(true))` and the `installFailed` state | `useAction` with a typed `InstallFailed` error; `installFailed = !isWaiting(state) && failureOf(state) !== undefined` |
| `MessageBubble.tsx` | `pinMessage(...).catch(() => {})` (2 sites) and `unpinMessage(...).catch(() => {})` (2 sites) | a module helper `runDetached(call)` = `void runWeb(Effect.promise(call).pipe(Effect.ignore))`, one call per site |

Effect kind (`pnpm effect:map`): all three files went from `needs-effect` (W4) to `effect`. The total moved from effect 250 to 253 and needs-effect 186 to 183.

### Files changed
- `apps/web/src/App.tsx`
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `work/T-0790-web-list-bubble-app.md` (status and this Report)
- `apps/web/src/components/ChatList.test.tsx` (fix round 1: one new test; no existing test edited)

No rendering, props, exports, labels or user-facing text changed. No new file was added.

### Behaviour differences
1. **ChatList install (`useAction`):** a second "Install app" click while a prompt is still waiting is dropped before `prompt()` runs (`isWaiting(installState)` guard in the click). The old code called `prompt()` again. A rejection of any kind (typed or defect) still shows "Install failed — try again", since the old `.catch` caught all of them.
2. **ChatList install timing (fixed in round 1):** the click handler calls `promptInstall()` itself, so `installEvent.prompt()` runs synchronously inside the click, as before. `promptInstall` is an `async` function, and its body runs up to the first `await` at once. Only the wait for the result goes into the action (`runInstall(promptInstall())`, with `Effect.tryPromise` wrapping that promise into `InstallFailed`). This is the open question below.
3. **MessageBubble pin/unpin:** the store call now runs inside an Effect (`Effect.promise`). A synchronous throw from `pinMessage` would have escaped the click handler before; now it is a defect and is ignored. The store functions are `async`, so this should not happen in practice.
4. **App service worker:** a failed registration is still ignored. The registration now runs inside `webRuntime`.

### Checks run (real results)
- `pnpm install`: done.
- Baseline before the change, `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ChatList src/components/MessageBubble src/App`: 4 files, 41 tests passed.
- The same command after the change: 4 files, 41 tests passed.
- `pnpm --filter @zilar/web typecheck`: passed (tsc on both tsconfig files, no output).
- `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot` (whole web suite, after the change): Test Files 170 passed (170), Tests 1813 passed (1813). I did not run the whole suite before the change; the spec states 1813 on main.
- `pnpm exec prettier --write` on the three files: unchanged.
- `pnpm gate` from the worktree root: exit 0.
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/web  (7.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Fix round 1 (coordinator review, item 2)
- `ChatList.tsx`: the install action now takes the promise the click created (`useAction<Promise<void>, void, InstallFailed>`); the click checks `isWaiting(installState)` and then calls `runInstall(promptInstall())`.
- `ChatList.test.tsx` (added to the Allowed files for this round): new test "starts the install prompt inside the click, before any await". It dispatches a fake `beforeinstallprompt` event whose `prompt` is a `vi.fn`, clicks Open menu then "Install app", and asserts the spy was called once with no await in between.
- Results: `pnpm --filter @zilar/web test ... src/components/ChatList` 2 files, 36 tests passed; whole web suite 170 files, 1814 tests passed (1813 before plus the new test); `pnpm --filter @zilar/web typecheck` no errors.

### Coverage gap
No existing test covers pin or unpin, or the service-worker registration failure. Those paths are checked by typecheck, lint, the effect map and reading the code only.

### Open question
Only a real browser can confirm that Chrome accepts the synchronous `prompt()` call from this click (the test uses a spy, not the browser's activation check). The code now makes that call exactly where the old code did.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **The files:** all three are Effect files. The six `.catch` sites became `runWeb` with `Effect.ignore` or a `useAction`.
- **Fix round 1:** `installEvent.prompt()` runs synchronously inside the click again, so the user activation is kept; only the wait for its result is an Effect. A test checks the synchronous call.
- **Results:** the whole web suite passes (1814); the gate passed.
