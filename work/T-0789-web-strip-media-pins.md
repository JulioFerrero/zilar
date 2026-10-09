---
id: T-0789
title: "WU25: TaskStrip, ChatMediaPanel, PinnedBanner, PinsPanel, MessageSearchResults on Effect"
status: merged
milestone: M5
branch: task/T-0789-web-strip-media-pins
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0789: WU25: TaskStrip, ChatMediaPanel, PinnedBanner, PinsPanel, MessageSearchResults on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, W4 try/catch):
  - `apps/web/src/components/TaskStrip.tsx` (425, H1 W4), tested in `TaskStrip.test.tsx`;
  - `apps/web/src/components/ChatMediaPanel.tsx` (379, H1 W4), tested in `ChatMediaPanel.test.tsx`;
  - `apps/web/src/components/PinnedBanner.tsx` (157, H1 W4), no test;
  - `apps/web/src/components/PinsPanel.tsx` (168, H1 W4), no test;
  - `apps/web/src/components/MessageSearchResults.tsx` (183, H1), no test.
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
Convert the listed files with the pattern. For the listed files without a test, **write the tests first, against the current code, and commit them ("T-0789: tests before")**; then convert, and the same tests must pass unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/ChatMediaPanel.tsx`, `apps/web/src/components/PinnedBanner.tsx`, `apps/web/src/components/PinnedBanner.test.tsx`, `apps/web/src/components/PinsPanel.tsx`, `apps/web/src/components/PinsPanel.test.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/MessageSearchResults.test.tsx`, `work/T-0789-web-strip-media-pins.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/TaskStrip src/components/ChatMediaPanel src/components/PinnedBanner src/components/PinsPanel src/components/MessageSearchResults
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Commits:** `f6398bde` "T-0789: tests before" (three new test files, 28 tests, run green against the unconverted code), then the conversion commit "T-0789: convert ...".

**Tests**
- Before conversion (`f6398bde`): PinnedBanner.test.tsx 11, PinsPanel.test.tsx 10, MessageSearchResults.test.tsx 7, all green on the old code. The five spec paths: 43 passed.
- After conversion: the five spec paths give 44 passed. The one extra test is "keeps the failure message when the store drops the pin before the request fails" in PinsPanel.test.tsx. I added it after converting, to cover the unpin settle path (see below). It also passes on the new code.
- TaskStrip.test.tsx (7 tests) and ChatMediaPanel.test.tsx (8 tests) are unchanged and pass. No existing test was edited.
- Whole web suite: `Test Files 173 passed (173)`, `Tests 1842 passed (1842)`.

**Effect map** (`pnpm effect:map`, `dist/effect-map/data.json`): all five files are kind `effect`, with no signals:
- TaskStrip.tsx: effect
- ChatMediaPanel.tsx: effect
- PinnedBanner.tsx: effect
- PinsPanel.tsx: effect
- MessageSearchResults.tsx: effect

**What changed**
- `PinnedBanner.tsx`: one `useAction` for the jump. Scrolling uses the existing `scrollToMessage` helper (same selector).
- `PinsPanel.tsx`: a `PinRowItem` per pin with its own jump and unpin actions. The store removes a pin as soon as its unpin starts. The row therefore stays mounted (rendering nothing) until the unpin settles, tracked by the parent's `unpinning` list. Without that, a failed unpin would be dropped with the row. This is the same reason BlockedRow stays mounted.
- `MessageSearchResults.tsx`: a `SearchHit` row with its own open action, plus one more open action for the Enter path (window event and Enter in the list).
- `TaskStrip.tsx`: three `useAction`s (status, owner, link). Each save puts its rollback and the fixed "Could not save. Try again." in `tapError`. `httpsUrl` uses `Schema.decodeUnknownOption(Schema.URLFromString)` instead of `new URL` inside try/catch. `linkText` no longer needs a try (its href is already a valid https URL).
- `ChatMediaPanel.tsx`: `MediaBody`, keyed by chat and tab, holds the first page (`useQuery`), Load more (`useAction`) and Retry. A tab switch remounts it, which interrupts the old tab's load. Each row (FileRow, LinkRow, MediaThumb) has its own show-in-chat action.
- Helpers used: `fromApi`, `useAction`, `useQuery`, `failureOf`, `isWaiting`, and `Effect.tap`, `tapError`, `sync`, `ensuring`. Checked against `apps/web/node_modules/effect/dist/*.d.ts`.
- User-facing text is byte-identical. Every failure shows a fixed sentence: "Message not found", "Could not unpin. Try again.", "Could not save. Try again.", "Couldn't search messages". No raw error text reaches the UI.

**Behaviour differences**
1. TaskStrip, same kind: a second status (or owner, or link) change while the first save is in flight replaces it. The first save's rollback and error are then skipped. Before, both ran independently. Different kinds still run in parallel.
2. Per row or per button, a second click while that action is in flight is ignored (`mode: 'ignore'`): PinnedBanner jump, PinsPanel jump and unpin, ChatMediaPanel show-in-chat, MessageSearchResults hit. Before, both calls ran.
3. PinsPanel: "Unpinning…" is now per row, so several rows can unpin at once. Before, one shared id allowed only one.
4. Edge: a failure is dropped if its row unmounts before the request settles. Examples: a show-in-chat failing after the panel closed, or a hit failing after the results list unmounted (then `onNotFound` is not called). Before, the callback ran regardless.
5. Otherwise the same: first-page arguments (`loadChatMedia(chatId, tab, undefined)`), the Retry behaviour (clears load-more and the jump error, reloads page one), and the Load more error screen.

**Gate** (`pnpm gate`, run from the worktree root, final run):
```
PASS  install (frozen)  (4.7s)
PASS  format  (3.2s)
PASS  lint  (1.9s)
PASS  typecheck  (1.8s)
PASS  effect  (1.8s)
PASS  tests @zilar/web  (6.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```
Prettier `--check` passes on all eight changed source and test files.

**Open questions**
- Is the replace-on-same-kind behaviour in TaskStrip (difference 1) acceptable? The alternative would be per-change queueing, which needs a new pattern.
- `Schema.URLFromString` gives the same accept/reject result as `new URL` for the cases the tests cover. I did not prove it for every input string.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **Tests first:** 28 tests were committed against the old code.
- **The files:** all five are Effect files.
- **`Schema.URLFromString` matches the old parse:** the lead checked effect 4.0.2, where it is `URL.canParse` then `new URL`, the same as the old `new URL` in try/catch.
- **Behaviour changes accepted:** in TaskStrip, a same-kind change replaces an in-flight save (the newest value wins); per-row unpin; double clicks ignored.
- **Results:** the whole web suite (1842) passes; the gate passed.
