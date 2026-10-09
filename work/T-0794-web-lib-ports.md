---
id: T-0794
title: "WU3: web lib platform ports on Effect — lib/attachments.ts, lib/voice.ts (MediaRecorder), lib/push.ts (service worker); same exported Promise API as Tier B edges, Effect inside"
status: merged
milestone: M5
branch: task/T-0794-web-lib-ports
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0794 (WU3): web lib platform ports on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU3, plan line 373), accepted by Julio on 2026-10-09. The plan flags it "Julio: voice and push flows": Julio checks those flows live before the next deploy. This task must not change behaviour.

### Verified facts (do not re-derive)
- **The files** (`apps/web/src/lib/`), with their lines and signals from `pnpm effect:map` on main `77f18b56` (H1 async, H3 timers, W4 try/catch):
  - `attachments.ts` (309, H1 H3 W4), tested in `attachments.test.ts`. Plan line 80: its `try { new URL(x) } catch` is a pure parse, so use `parseUrl` from `@zilar/chat-core` (T-0765);
  - `voice.ts` (370, H1 W4), tested in `voice.test.ts`. It wraps MediaRecorder;
  - `push.ts` (300, H1 W4), tested in `push.test.ts`. It wraps the service worker and PushManager.
- **About 12 non-test files import these modules,** including `Composer.tsx` and `store/realStore.ts`, which are converted later (WU18 and WS). So **keep every exported function's name, signature and Promise return type unchanged**: they are Tier B edges (`docs/EFFECT_GUIDE.md:12-32`). Write the body as an Effect and export `(...args) => runWeb(effect(...args))` or `Effect.runPromise`. You may also export the Effect versions (`fooEffect`) for later callers.
- **Errors:** an exported function must reject with the same error class and message as today, because callers and tests may check them.
- **The runtime** is `runWeb` in `apps/web/src/lib/effect/runtime.ts`. Browser APIs are wrapped with `Effect.tryPromise` and `Effect.try`, and event-based ones (`MediaRecorder` `ondataavailable`/`onstop`) with `Effect.callback`, which removes its listeners on interrupt.

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
Convert the three files with the pattern above, applied to lib modules. Each exported function keeps its signature; timers become `Effect.sleep` or Schedules.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/runtime.ts`, `apps/web/src/lib/topicsUi.ts` (a lib converted in T-0772), the three files and their tests, and each importer (`git grep -l "@/lib/attachments\|@/lib/voice\|@/lib/push" apps/web/src`).

### Allowed files
`apps/web/src/lib/attachments.ts`, `apps/web/src/lib/voice.ts`, `apps/web/src/lib/push.ts`, `work/T-0794-web-lib-ports.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib/attachments src/lib/voice src/lib/push
pnpm gate
```
Run `pnpm effect:map` and list each file's kind, then run the whole web suite once (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`) and paste its summary.

### Acceptance
- The three files are Effect files; their exported names, signatures, return types and error messages are unchanged.
- The tests pass unchanged, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted `attachments.ts`, `voice.ts` and `push.ts` to Effect. Every exported name, signature, return type, error class, error message and call order is unchanged; each Promise function is now a plain function returning `runWeb(<effect>)`. The three files now contain no `async`, `await`, `.then(`, JS `try`/`catch`, `setTimeout`, `setInterval` or `new Promise`.

Files changed: `apps/web/src/lib/attachments.ts`, `apps/web/src/lib/voice.ts`, `apps/web/src/lib/push.ts`, and this task file.

- `attachments.ts`: `safeHttpUrl`, `mediaSrc`, `trustedMediaHosts` and `isTrustedMediaUrl` use `parseUrl` from `@zilar/chat-core` instead of `try { new URL }`. `objectUrlFor` is `Effect.runSync(Effect.try(...).pipe(Effect.orElseSucceed(...)))` (the `topicsUi.ts` pattern). `readImageSize` is `runWeb(readImageSizeEffect(...))`: `Effect.acquireUseRelease` creates and always revokes the object URL, `Effect.callback` waits for the image `onload`/`onerror`, and `Effect.timeoutOrElse` replaces the `setTimeout` (a timeout gives `undefined`, detaches the handlers and then revokes). `uploadAttachment` is `uploadAttachmentEffect` with `Effect.fail(new AttachmentError(...))` and `Effect.tryPromise` for the PUT.
- `voice.ts`: `VoiceRecorder.start` runs `VoiceRecorder.startEffect` (`getUserMedia` through `tryPromise` mapped by `voiceErrorFromGetUserMedia`; the explicit-mime recorder, then the plain one, via `Effect.firstSuccessOf`; the tracks are stopped on the final failure). `stop()` is an `Effect.callback` that registers `onstop` and calls `recorder.stop()` synchronously, as before, and keeps the cached `#stopPromise`. `cancel()` uses `Effect.runSync(Effect.try(...))`. `convertVoice` and `uploadVoice` are Effects; `errorCode` reads the JSON body with `tryPromise` and a total `errorCodeOf`. `computeWaveform` is an `acquireUseRelease` around the `AudioContext`, closed on every outcome, with the flat fallback on any failure.
- `push.ts`: `realPushBrowser().register`, `ensureServiceWorker`, `currentSubscription`, `subscribeBrowser`, `unsubscribeBrowser`, `updateAppBadge`, `dismissChatNotifications` and `useInstallPrompt().promptInstall` run through `runWeb`. `isStandaloneDisplay` uses `Effect.runSync(Effect.try(...))`. The plain `Error`s (`notification permission X`, `no service worker registration`, `the browser subscription has no keys`) are now `Effect.fail(new Error(...))`, so the rejection is the same class and message.
- Rejections of the injected or browser promises (`requestUploadSlot`, `getRegistration`, `unsubscribe`, `response.blob()`, ...) are lifted with `Effect.promise`, so they are defects and `runPromise` rejects with the original object (checked: `rejects.toBe(boom)`).
- Added exports (Effect versions for later callers): `readImageSizeEffect`, `uploadAttachmentEffect`, `VoiceRecorder.startEffect`, `convertVoiceEffect`, `uploadVoiceEffect`, `computeWaveformEffect`, and the type `ImageSize`. Nothing existing was removed or renamed.

### Tests
- Before (main): `pnpm --filter @zilar/web test --reporter=dot src/lib/attachments src/lib/voice src/lib/push`: 3 files, 55 tests passed.
- After: same command: 3 files, 55 tests passed. No existing test was edited.
- Whole web suite (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`): 172 files passed, 1845 tests passed.
- Extra proof (not committed, written in the session scratch directory outside the repo): 23 characterization tests for the paths the existing tests do not cover (`VoiceRecorder` start/stop/cancel with a fake `MediaRecorder` including that `recorder.stop()` runs synchronously inside `stop()`, the second-recorder fallback, tracks stopped, a throwing `stop`; `convertVoice` error bodies `null`, non-JSON, `{"error":null}`, numeric code; `computeWaveform` success, decode failure, constructor failure, failing `close`; `readImageSize` timeout with detach and revoke; push subscribe, reuse, missing keys, unsubscribe rejection, `register` mapping, best-effort dismissal, badge `this` binding and sync throw). The same 23 tests pass on the original code (checked with `git stash`) and on the converted code, so they show no difference.
- `pnpm effect:map`: `attachments.ts` effect, `voice.ts` effect, `push.ts` effect; all three have no remaining signals and are not Tier B.

### Behaviour differences
None for any real browser or caller. Two theoretical ones, both only on a broken browser object: (1) `readImageSize` when `URL.revokeObjectURL` itself throws: the old code threw inside an event handler and the promise never settled; now it rejects with that error. (2) The `register` in `realPushBrowser` used to throw synchronously if `serviceWorker.register` threw; it now returns a rejected promise (every caller awaits it inside an async function or `Effect.promise`).
Timing: `runWeb` starts the effect synchronously (checked), so `recorder.start`, `recorder.stop()`, the size checks and the first call into `requestUploadSlot`/`fetch` happen in the same order; the settled promise can take a few more microtasks than an `async` function.

### Gate
```
gate: 3 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/web
scope: every changed file is inside the Allowed files
GATE PASS
```

### Unsure
Nothing blocking; the vitest warning "vi.fn() mock did not use 'function' or 'class'" in `voice.test.ts` comes from the existing test's mock constructor and is unchanged.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the Report.
- **The files:** all three are Effect files with the same exported API, plus `*Effect` exports for later callers.
- **`recorder.stop()`** still runs synchronously inside `stop()`.
- **Extra checks:** 23 characterization tests passed on both the old and the new code (not committed).
- **Results:** 55 tests and the whole web suite (1845) pass; the gate passed.
- **Live check:** Julio checks voice and push on live before the next deploy.
