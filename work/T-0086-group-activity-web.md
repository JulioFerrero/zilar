---
id: T-0086
title: Web — an Activity section in the group panel for group owners and admins (the audit entries of the room)
status: merged
milestone: M4
branch: task/T-0086-group-activity-web
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0084]
estimate: 0.5 day
---

# T-0086: Group activity in the web panel

## Spec (written by Claude, do not edit)

### Goal

T-0084 added an Activity section to the AI panel (`AiActivity`), fed by `GET /api/audit?aiId=…`. The same endpoint answers `?groupId=…` for the group's **owner and admins** (anyone else gets an empty page, indistinguishable from an unknown group). Show it in the **group panel** for owners and admins: the approvals decided in that room and whatever the audit log gains later.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/components/ais/AiActivity.tsx` and `AiActivity.test.tsx` (the component to generalise), `AiPanel.tsx` (how it is mounted) and `work/T-0084-ai-activity-web.md` (spec, report, review)
- `apps/web/src/components/GroupPanel.tsx` and `GroupPanel.test.tsx` (`isManager`, sections, how tests fake the api), `apps/web/src/lib/api.ts` (`listAudit`, `PublicAuditEntry`) and its tests
- `apps/web/src/mock/api.ts` (the mock `/audit` route)
- `apps/server/src/audit/routes.ts` and `service.ts` (the wire contract; do not edit)

### Allowed files (under `apps/web/`)
- `src/components/ais/AiActivity.tsx` and `AiActivity.test.tsx` (generalise: see below), `src/components/GroupPanel.tsx`, `GroupPanel.test.tsx`
- `src/lib/api.ts`, `src/lib/api.test.ts` (`listAudit` accepts `{ groupId }` as an alternative to `{ aiId }`)
- `src/mock/api.ts`, `src/mock/api.test.ts` (serve `?groupId=` in mock mode with a couple of entries)
- `work/T-0086-group-activity-web.md` (path from the repo root)

**Not allowed:** anything else, `apps/server/**`, `packages/**`, mobile. No new dependencies.

### What to build
1. `listAudit` takes `{ aiId } | { groupId }` (exactly one; a type that makes both or neither a compile error), plus `limit` and `before`.
2. Generalise `AiActivity` into a component that takes a `scope` (`{ aiId }` or `{ groupId }`), keeping the current behavior, tests and the `AiActivity` export working for the AI panel (a thin wrapper is fine). Keep `describeAuditEntry` as it is; for entries in a group the words stay the same ("A request was approved"). Nothing but `detail.decision` may reach the DOM, as before.
3. In `GroupPanel`, when `isManager` (owner or admin) show an "Activity" section at the bottom with the group scope. Plain members do not see it and no request is made for them. A failure of the section never breaks the panel.
4. Mock mode returns a few entries for the mock groups.

### Tests
- `listAudit` with `groupId` (path and query), the type constraint is compile-time only (say so).
- The generalised component still passes every existing `AiActivity` test; add cases for the group scope.
- `GroupPanel`: a manager sees the section and one request is made; a member does not and no request is made; a failing section leaves the panel intact.

### Live check (the lead does it)
If you can, run the web dev server on a **free port other than 3000, 5173 and 8081** in mock mode (deep link with `?mock=1`) and screenshot the group panel, but **do not commit screenshots**; say what you did in the Report.

### Acceptance criteria
- [ ] Owners and admins see the room's activity; members see nothing and cause no request.
- [ ] The AI panel's Activity keeps working unchanged.
- [ ] Nothing from `detail` other than the decision reaches the DOM.
- [ ] No `any`, no `@ts-ignore`, no new dependencies, no `console.log`, no screenshots in the commit; lint passes (re-run it after your last edit).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Filters, export, retention, the server, mobile.

---

## Report (written by the worker when done)

### What I did
- Generalised `listAudit` in `apps/web/src/lib/api.ts` to a discriminated union: the input is now `{ aiId } | { groupId }` (plus the existing `limit` and `before`). Passing both or neither fails to compile. The runtime check uses `'aiId' in input && input.aiId !== undefined` so either key sets the matching query param; the server's 400 contract (`Provide exactly one of groupId or aiId`) is preserved by the existing schema path.
- Generalised `AiActivity` in `apps/web/src/components/ais/AiActivity.tsx` into a generic `ActivitySection({ scope })` that takes the new `AuditScope` union, and kept the `AiActivity({ aiId })` export as a thin wrapper so the AI panel and its tests keep working unchanged. `describeAuditEntry`, `formatRelativeAudit`, `ActivityList`, `ActivityRow` and `ActivitySkeleton` are untouched, so `detail` only ever contributes `decision` to the DOM and the words stay the same for group entries ("A request was approved"). The first-load `useEffect` keys on a stable `scopeKey` (`"ai:<id>"` or `"group:<id>"`) and reads the latest scope through a ref so a fresh `{ aiId }` / `{ groupId }` literal on every render does not loop the fetch.
- Mounted the section at the bottom of `GroupPanel` (`apps/web/src/components/GroupPanel.tsx`) — `isManager && <ActivitySection scope={{ groupId: info.id }} />`. The existing `isManager` check (owner or admin) is the only guard; plain members get nothing and no request fires. The section catches its own errors, so a 404 or 500 on `/audit` shows an inline error but the panel stays interactive.
- Served `?groupId=…` in `apps/web/src/mock/api.ts`. The mock audit handler now reads both keys, answers 400 when neither or both are present, and filters by `groupId` when `aiId` is absent. Seeded three group-scoped entries (a `g-devteam` approve, a `g-devteam` deny, a `g-qa` approve-always) so the mock panel renders real rows.

### Files changed
- `apps/web/src/lib/api.ts` — new `AuditScope` union, `ListAuditInput` as `AuditScope & { limit?, before? }`, `listAudit` rewritten to read either key.
- `apps/web/src/lib/api.test.ts` — new test for `listAudit({ groupId })` hitting `/api/audit?groupId=…` (the type constraint is compile-time only, noted in the test).
- `apps/web/src/components/ais/AiActivity.tsx` — extracted `ActivitySection`, added `serialiseScope`, refactored the load effect to key on `scopeKey` and read scope through a ref, kept `AiActivity({ aiId })` as a wrapper.
- `apps/web/src/components/ais/AiActivity.test.tsx` — four new group-scope tests (plain words render, empty state, error+retry, hostile detail does not leak).
- `apps/web/src/components/GroupPanel.tsx` — one import + `{isManager && <ActivitySection scope={{ groupId: info.id }} />}` at the bottom of the body.
- `apps/web/src/components/GroupPanel.test.tsx` — added `stubAudit` helper (and `'no-stub'` opt-out for the member test); new `room activity (T-0086)` describe with four tests (owner sees section + one request with `groupId`, admin sees section + one request, member sees nothing + no request, failing audit leaves the rest of the panel intact). One pre-existing test ("shows an inline error when an add fails") now stubs `/audit` so the manager's section does not throw before the click.
- `apps/web/src/mock/api.ts` — mock audit handler accepts `?groupId=` (400 on both or neither); seeded three group-scoped entries.
- `apps/web/src/mock/api.test.ts` — new tests for `?groupId=` (seeded group returns entries, unknown group returns empty page), and a 400 test for both keys.
- `work/T-0086-group-activity-web.md` — this report, `status: review`.

### Commands run and real results
- `pnpm install`: `Done in 6.6s using pnpm v10.32.1` — 1010 packages, lockfile up to date.
- `pnpm format:check` (first run): `[warn] apps/web/src/components/ais/AiActivity.test.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/lib/api.ts`. Ran `pnpm format` then `pnpm format:check`: `All matched files use Prettier code style!`.
- `pnpm lint` (first run): `apps/web/src/components/ais/AiActivity.tsx:108:43: error react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'scope'`. Restructured the load effect to use a `useRef<AuditScope>` updated in a sibling effect; `pnpm lint` then `oxlint .` exits 0.
- `pnpm typecheck`: first run failed with `TS2312: An interface can only extend an object type or intersection of object types with statically known members` (because `AuditScope` is a union and `interface extends` cannot intersect a union). Switched `ListAuditInput` from `interface extends AuditScope` to `type = AuditScope & {…}` and rewrote the function body so the union narrows with `'aiId' in input`. Subsequent runs: `Tasks: 10 successful, 10 total`.
- `pnpm exec turbo test --force --filter=@galena/web`: first run failed on `GroupPanel > shows an inline error when an add fails, keeping the AI out` because the panel's new `/audit` fetch hit an unstubbed `fetch` and surfaced "Could not reach the server" as a second alert. Stubbed `/audit` in that test. Final run: `Test Files 54 passed (54) / Tests 574 passed (574) / Duration ~38s`. The new tests (4 group-scope component cases, 1 group-scope api test, 4 group-scope mock api tests, 4 group-scope GroupPanel tests) all pass; the existing 561 tests are still green.
- `pnpm build`: `Tasks: 2 successful, 2 total` — `@galena/web` and `@galena/mobile` build cleanly; the chunk-size warning is unrelated to this task.
- Live check (skipped): the spec marks this as optional and `curl` requires lead approval. The web dev server was not started in this session, so no screenshot was taken and none was committed.

### Problems, deviations from the spec, open questions
- The `AuditScope` union uses `{ aiId?: undefined }` / `{ groupId?: undefined }` rather than `?: never`. TypeScript's narrowing inside `listAudit` then needs an explicit `!== undefined` guard to satisfy `URLSearchParams.set` (a `?: never` key would not produce `undefined`, but in practice the wider shape makes the runtime check more readable and the type error from the compiler forced me into the same shape anyway). Both variants still reject `{ aiId: …, groupId: … }` and `{}` at compile time, which is the contract the spec asks for.
- The pre-existing `addGroupAi` failure test now stubs fetch. The new `ActivitySection` fires a `/audit` request for any owner / admin who opens the panel, so the test would otherwise fail on a stray fetch rejection before the click that the test actually cares about. The test's assertion is unchanged.
- The mock audit handler's "both or neither" guard uses `(aiId === null) === (groupId === null)` instead of the original `aiId === null`. It returns the same 400 `invalid_request` for either branch, matching the server's contract from `apps/server/src/audit/routes.ts`.
- The `AiActivity` export is now a one-line wrapper (`<ActivitySection scope={{ aiId }} />`). All existing `AiActivity` tests and the AI panel keep working unchanged; the only call site (`AiPanel.tsx`) was not touched.
- No new dependencies, no `any`, no `@ts-ignore`, no `console.log`. Lint and format are clean. Lint was re-run after the last edit and is still clean.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** approved and merged (lead, 2026-09-29). Rebased on main; format, lint, typecheck, test (web 574) and build green. No pre-review (OpenCode Go has no funds); reviewed by hand.

**Checked:** `AiActivity` became a thin wrapper over a shared `ActivitySection` that takes a scope (`{ aiId }` or `{ groupId }`, a union that makes both or neither a compile error); the AI panel is untouched and its tests still pass; the group panel mounts the section only when `isManager` (owner or admin), so members make no request; the section keeps its own loading, error and load-more handling, so its failure cannot break the panel. `detail` handling is unchanged (only the decision is read). No lint disables, no screenshots, no `console.log`. The effect uses a ref for the latest scope and re-runs on a string key, which avoids a loop from the fresh scope literal.

**Not visually checked** (mock mode would show it with a deep link `?mock=1`).
