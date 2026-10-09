---
id: T-0795
title: "WU4: web auth on Effect — auth/AuthProvider.tsx, components/auth/AuthFlow.tsx, routes/LoginPage.tsx, routes/NamePage.tsx; LoginPage gets tests first; sign-in behaviour identical"
status: todo
milestone: M5
branch: task/T-0795-web-auth
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0795 (WU4): web auth on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU4, plan line 374), accepted by Julio on 2026-10-09. The plan flags it "Julio: login risk": Julio signs in live before the next deploy. This task must not change behaviour.

### Verified facts (do not re-derive)
- **The files** (`apps/web/src/`), with their lines and signals from `pnpm effect:map` on main `77f18b56`:
  - `auth/AuthProvider.tsx` (119, H1 W4), tested in `AuthProvider.test.tsx`; async at line 45, try at line 70 (plan line 739);
  - `components/auth/AuthFlow.tsx` (217, H1 H3), tested in `AuthFlow.test.tsx`; a timer at line 65, async at line 71 (plan line 798);
  - `routes/LoginPage.tsx` (52, H1 W4), **no test**;
  - `routes/NamePage.tsx` (73, H1 W4), tested in `NamePage.test.tsx`.
- **The context value** that `AuthProvider` exposes (its type and functions) is used across the app. Keep its shape and every function's Promise signature unchanged (Tier B edges); only the internals become Effects.
- **The OTP flow:** read `AuthFlow.tsx` for the request-code and verify steps and the resend timer. Keep the timer duration, the text and the order of calls byte for byte.

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
1. **Write `apps/web/src/routes/LoginPage.test.tsx` first,** against the current code, covering what the page renders and what it does on success and failure. Commit it as "T-0795: tests before".
2. **Convert the four files** with the pattern. The resend timer becomes an `Effect.sleep` or `Schedule` fiber that is interrupted on unmount, exactly as `apps/web/src/components/AddMachineDialog.tsx` does since T-0776.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/components/AddMachineDialog.tsx`, the four files and their tests, and `apps/web/src/lib/api.ts` (the auth calls they use).

### Allowed files
`apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/routes/LoginPage.tsx`, `apps/web/src/routes/LoginPage.test.tsx`, `apps/web/src/routes/NamePage.tsx`, `work/T-0795-web-auth.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/auth src/components/auth src/routes/LoginPage src/routes/NamePage
pnpm gate
```
Run `pnpm effect:map` and list each file's kind, then run the whole web suite once (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`) and paste its summary.

### Acceptance
- The four files are Effect files; the context shape and the text are unchanged.
- The old tests pass unchanged, the new LoginPage tests pass before and after, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
