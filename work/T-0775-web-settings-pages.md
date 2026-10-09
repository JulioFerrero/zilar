---
id: T-0775
title: "WU7: web settings pages on Effect — routes AisPage, ConnectionsPage, IntegrationsPage use useAction/useQuery/fromApi (per-row actions per row); no async, try or timers in the components; same text and behaviour; a new AisPage test"
status: merged
milestone: M5
branch: task/T-0775-web-settings-pages
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0775 (WU7): the AI, connections and integrations pages on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU7), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on 2026-10-09:
  - `apps/web/src/routes/AisPage.tsx` (306, H1 W4), no test;
  - `apps/web/src/routes/ConnectionsPage.tsx` (374, H1 W4), tested in `ConnectionsPage.test.tsx`;
  - `apps/web/src/routes/IntegrationsPage.tsx` (524, H1 W4), tested in `IntegrationsPage.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/`. A finished example of the pattern, including per-row actions, is T-0767 (`git log -1 --format=%h -- apps/web/src/routes/BlockedPage.tsx`, then read `BlockedPage.tsx` and `RequestsPage.tsx`).
- **ConnectionsPage** saves and tests provider keys. Keys must never appear in an error text or a log (`AGENTS.md`); keep the existing redaction.

### The conversion pattern (same for every web UI task)
- **The goal:** after this task each listed file imports Effect for its async work, and contains no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` of its own. That is the rule of `docs/audit/effect-100-plan.md` §1.3 and §3.6.
- **Use the hooks from T-0762** (`apps/web/src/lib/effect/use-action.ts`, `use-query.ts`; read their header comment):
  - `useAction(fn)` for user actions (submit, delete, toggle). It returns `[state, run, controls]`, and its `ignore` mode replaces the `busy` guards;
  - `useQuery(make, deps)` for loads, with `refresh` for reloads;
  - `failureOf(state)` and `isWaiting(state)` for the UI.
- **Calling existing API functions:** use `fromApi(() => apiFn(...))` (`apps/web/src/lib/effect/api-effect.ts`). It gives typed `ApiFailure` errors, which have `code`, `status` and `message`.
- **Timers and polling:** use `Effect.sleep`, `Effect.repeat` with `Schedule.spaced` or `Schedule.fixed`, inside `useQuery` or an atom, so unmount interrupts them. Debounce with `Effect.sleep` inside `useQuery` keyed on the input.
- **Keep the concurrency per item.** When a list has a button on each row, each row gets its own `useAction` (a small row component), so different rows can run at the same time while a double click on one row is still ignored. One `useAction` for the whole page would drop a second row's click (the lead's T-0767 review).
- **Non-API failures** may show the component's fixed fallback sentence instead of raw error text (`AGENTS.md`: fixed sentences). Mention it in the Report.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the three pages with the pattern. Add `apps/web/src/routes/AisPage.test.tsx`, covering the load, the empty state and one action, with the API module mocked the way the other page tests do it.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/*`, `apps/web/src/routes/BlockedPage.tsx` (the model), the three pages and their tests.

### Allowed files
`apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/AisPage.test.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `work/T-0775-web-settings-pages.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/routes/AisPage src/routes/ConnectionsPage src/routes/IntegrationsPage
pnpm gate
```
Run `pnpm effect:map` and list the three kinds in the Report.

### Acceptance
- The three files import Effect, with no async, timers or try/catch of their own.
- The text and behaviour are the same, the old tests pass unchanged, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What changed (Allowed files only)**
- `apps/web/src/routes/AisPage.tsx`: the list loads through `useQuery(() => fromApi(() => listAis()), [])`; provider names through a second `useQuery` keyed on the loaded list (`providerNamesOf`, which never fails); each row is an `AiRow` with its own delete `useAction`; `removedIds` replaces the `setAis` filter. Wording of the server errors comes from `describeAiError`, fed an `ApiError` rebuilt from the `ApiFailure`, so the mapping is the same one used before.
- `apps/web/src/routes/ConnectionsPage.tsx`: list via `useQuery`; each row is a `ConnectionRow` with its own Test and Remove `useAction`; the add form is `AddConnectionForm` with its own save `useAction`. The "Paste your API key" check is a typed `KeyMissing` failure. The form calls `refresh()` of the list after a save, as the old `reload()` did.
- `apps/web/src/routes/IntegrationsPage.tsx`: page load via `useQuery`; the parts reloaded by a card go into a `patched` state (replaces `setData`). Each card has one `useAction` (Email: save; Telegram and Voice: save or remove as a tagged input), so busy, error and saved are derived from one state, as before. Validation is typed (`SenderMissing`, `TokenMissing`, `EndpointMissing`).
- `apps/web/src/routes/AisPage.test.tsx` (new): 3 tests, load (with the Loading state and the provider name), empty state (no provider call), and one action (delete after the confirm). `@/lib/api` is mocked as in `BlockedPage.test.tsx`.
- Not touched: all existing tests, including `apps/web/src/components/ais/AisPage.test.tsx`.

**Tests**
- Before: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/ConnectionsPage src/routes/IntegrationsPage src/components/ais/AisPage`: 3 files, 31 passed (ConnectionsPage 11, IntegrationsPage 10, components/ais/AisPage 10).
- After: the same run plus `src/routes/AisPage`: 4 files, 34 passed (the 31 unchanged, plus 3 new).
- `pnpm exec prettier --write` on the 4 files: AisPage.test.tsx and IntegrationsPage.tsx reformatted, nothing else.

**Effect kinds (`pnpm effect:map`, data.json)**
- `apps/web/src/routes/AisPage.tsx`: effect (lines 293)
- `apps/web/src/routes/ConnectionsPage.tsx`: effect (lines 380)
- `apps/web/src/routes/IntegrationsPage.tsx`: effect (lines 549)
- The "before" kinds were the spec's H1 W4 signals; I did not re-measure them before the change.
- `grep` for `async|await|.then(|try|catch|setTimeout|setInterval` in the three pages: no code hits (two hits are the user text "try again").

**Behaviour differences**
- Non-API failures (a rejected `fetch` that is not an `ApiError`) now show the fixed fallback sentence instead of the raw `Error.message`: AIs "Could not load your AIs" / "Could not delete the AI"; connections "Could not load connections" / "Could not test the key" / "Could not remove the connection" / "Could not save the connection"; integrations "Something went wrong. Try again.". Server `ApiError` messages are unchanged.
- The 404 / owner-note check: the old code showed a message only when `error instanceof ApiError && error.status !== 404`. The new check is `failure.code !== 'unknown_error' && failure.status !== 404`. `toApiFailure` maps exactly the non-`ApiError` values to `unknown_error`, so the two agree. An `ApiError` with status 0 (`network_error`, "Could not reach the server.") still shows its message and Retry, as before. This assumes no server `ApiError` uses the code `unknown_error`.
- Provider names still load after the AIs list (same as the old fire-and-forget), but now as a separate query; the list is not held back.
- Removing a row or an integration no longer re-fetches the list (the page removes the row locally, as before).
- Within one row or one card, a second click is ignored while the first call runs (the buttons were already disabled while busy, except the Connections row buttons, which were never disabled; the second click is now ignored).

**Commands and results**
- `pnpm install`: done.
- `pnpm --filter @zilar/web test ... ` (the three pages plus the new test): 4 files, 34 passed.
- `pnpm effect:map`: 842 files, coverage 50.5%; the three pages are `effect`.
- `pnpm gate` from the worktree root (cwd checked): exit 0, `GATE PASS`. Summary lines: `gate: 5 changed file(s) against main`; `PASS install (frozen)`; `PASS format`; `PASS lint`; `PASS typecheck`; `PASS effect`; `PASS tests @zilar/web`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

**Open questions**
- `AisPage` builds an `ApiError` from the `ApiFailure` only to reuse `describeAiError`, which checks `instanceof ApiError`. Changing `describeAiError` would be cleaner but it is outside the Allowed files.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, resumed once after it stopped mid-task. The lead reviewed the Report and the diff.
- **The pages:** all three are Effect files, with per-row or per-card actions.
- **The 404 condition** matches the old one exactly: a non-`ApiError` maps to `unknown_error`.
- **Behaviour changes accepted:** non-API failures show the fixed fallback; removing a row is local, with no re-fetch; a busy row ignores a second click.
- **Results:** tests go from 31 to 34 (a new `AisPage` test), and the gate passed.
