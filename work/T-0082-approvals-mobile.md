---
id: T-0082
title: Mobile — the approval card decides for real (Approve / Deny call the approvals API and the card shows its state)
status: merged
milestone: M4
branch: task/T-0082-approvals-mobile
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0073, T-0076]
estimate: 0.75 day
---

# T-0082: Approvals on the phone

## Spec (written by Claude, do not edit)

### Goal

The web card already decides for real (T-0076). On mobile the card's two buttons still only `console.log`. Port the behavior: the card loads its state from `GET /api/approvals/:id`, shows Approve / Deny only to someone who may decide and only while the request is pending, sends the decision, and shows the outcome. The `id` in the card payload (`ApprovalRequest.id`) **is** the server's approval id.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0076-approvals-web.md` (spec, report and review) and the finished web card: `apps/web/src/components/ApprovalCard.tsx`, `apps/web/src/lib/api.ts` (`getApproval`, `decideApproval`, the status set) — the behavior to copy
- `apps/server/src/approvals/routes.ts` and `service.ts` (`PublicApproval`; 404 means "you may not decide it or it does not exist"; 409 codes `not_pending` / `expired`) — do not edit the server
- `apps/mobile/src/components/chat/approval-card.tsx` (the card today) and `payload-card.tsx`
- `apps/mobile/src/lib/ais-api.ts` and `ais-api.test.ts` (**the pattern to follow**: no zod on mobile, type guards at the boundary, an error class that keeps the server's `code` and `status`, a factory taking a token/base-URL provider), `components/ais/use-ais-api.ts` (how a screen gets the api instance and the session token) and `chat-api.ts`
- `apps/mobile/src/mock/` (how mock mode fakes APIs, e.g. `mock/ais.ts`), and how the chat screen picks mock vs real

### Allowed files (under `apps/mobile/`)
- `src/lib/approvals-api.ts`, `src/lib/approvals-api.test.ts` (new)
- `src/components/chat/approval-card.tsx` and a new test next to it if the project tests components this way (look at `reaction-chips.test.tsx` and `markdown-text.test.tsx` for the pattern)
- a small hook file such as `src/components/chat/use-approvals-api.ts` (new), modeled on `use-ais-api.ts`
- `src/mock/` (a new `approvals.ts` mock and its test) so mock mode shows a pending card that can be approved
- `work/T-0082-approvals-mobile.md` (path from the repo root)

**Not allowed:** anything else, `packages/**`, `apps/server/**`, `apps/web/**`, new dependencies. Do not touch the simulators DB167CD4 / A3E0C081 or ports 3000 / 8081 / 5173: every check here is a unit test.

### What to build
1. `approvals-api.ts`: `getApproval(id)` and `decideApproval(id, decision, note?)` with type guards for the wire shape (`id, aiId, groupId, action, summary, details, argsHash, worstCase, requestedBy, status, decidedAt, note, expiresAt, createdAt`; statuses `pending | approved_once | approved_always | denied | consumed | expired`), an `ApprovalsApiError` with `status` and `code`, ids through `encodeURIComponent`, network failure mapped to an error with a clear message.
2. `ApprovalCard` loads its state on mount and:
   - **loading:** the request text renders at once (from the payload); the action area shows nothing or a small skeleton, no layout jump;
   - **404:** the muted line "Waiting for a decision", no buttons, no error;
   - **pending:** Approve (sends `approve_once`) and Deny (sends `deny`); both disabled while a request is in flight (no double submit); on success show the outcome; on 409 (`not_pending` / `expired`) reload the state and show it; on other errors one short inline message, buttons stay;
   - **decided / expired / consumed:** no buttons; a status line: "Approved" (also for `approved_always`), "Denied", "Expired", "Already used";
   - **first-load failure (not 404):** the request text plus "Could not load the decision state" and a Retry button;
   - **no "always allow"** anywhere.
3. Buttons keep their current look (`variant="key"` for Approve, outline for Deny) and get accessibility labels naming the action.
4. Mock mode: the mock approval card in the mock chat shows Approve/Deny and can be decided (in memory), answering 409 on a second decision, like the server.

### Tests (Vitest, no network, no device)
- `approvals-api.test.ts`: paths, methods, bodies, guard failures becoming `ApprovalsApiError`, 404/409 mapping, network failure.
- Card tests (or, if components cannot be rendered in this project, test the state logic in a plain hook/reducer that the card uses, and say so in the Report): every state above, no double submit, 409 reload, Retry.
- Mock module test.

### Live check (the lead does it)
Not needed from you; say in the Report that no on-device check was done.

### Acceptance criteria
- [ ] Approve and Deny work against the API; no double submit.
- [ ] Someone who may not decide sees no buttons and no error.
- [ ] No "always allow", no `console.log`.
- [ ] Mock mode shows a working card.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/mobile
pnpm build
```

### Out of scope
- An approvals inbox screen, push notifications, standing rules, the server, web.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/lib/approvals-api.ts`: added the `PublicApproval` / `ApprovalStatus` / `ApprovalDecision` types, type guards for the wire shape (`parsePublicApproval`, `parseWorstCase`, `isApprovalStatus`, `isApprovalCurrency`), an `ApprovalsApiError` with `status` + `code`, `getApproval(id)` and `decideApproval(id, decision, note?)` that go through `encodeURIComponent`, and a `buildDecisionBody` helper that returns `{ decision }` or `{ decision, note }` exactly like the server's `decisionSchema`. Network failures map to `{ status: 0, code: 'network_error' }`; a missing session throws 401 `unauthorized` before the network; a wrong wire shape throws 200 `invalid_response`. No `any`, no new dependencies.
- `apps/mobile/src/components/chat/approval-card.tsx`: replaced the two dead `console.log` buttons with the real flow. On mount `loadApprovalCardState(api, data.id)` runs once with an `active` flag for unmount safety. State machine: `loading` (skeleton placeholder, no layout jump — the skeleton occupies the same height as the buttons row), `notDecidable` (404 → "Waiting for a decision" muted line, no buttons, no error), `error` (request text plus muted "Could not load the decision state" plus a Retry button), `ready` with a `PublicApproval`. `pending` shows Approve (sends `approve_once`) and Deny (sends `deny`), both with an in-flight label ("Approving…" / "Denying…") and both `disabled={busy}` so a double click never double-submits. `applyDecision` returns a tagged outcome: success replaces the row; a 409 with `code` `not_pending` or `expired` reloads the row via `api.getApproval`; any other error returns the message to surface inline. Decided / expired / consumed requests show a status line: "Approved" (for `approved_once` and `approved_always`), "Denied", "Expired", or "Already used". The card mirrors the web card's "pending = already not expired" trust (the server's `toPublicApproval` reads a a past-due `pending` row as `expired`). No "always allow" button is rendered. Buttons keep the current look (`variant="key"` for Approve, outline for Deny) and get `accessibilityLabel` of "Approve" / "Deny"; the Retry key uses the same `iconKey` style as the rest of the chat. No `console.log`, no `@ts-ignore`.
- `apps/mobile/src/components/chat/use-approvals-api.ts`: new hook that mirrors `use-ais-api.ts`. Picks the real API or the mock from the `?mock=` route param or the bundle-time `EXPO_PUBLIC_GALENA_MOCK` env, gated by `mockParamAllowed({ dev: __DEV__, envMock })` so a production build with `?mock=foo` cannot switch to fake data.
- `apps/mobile/src/mock/approvals.ts`: in-memory mock API for the chat's approval card. One pending request seeded with `id: 'approval-2001'` (matching the `ApprovalRequest.id` in `mock/messages.ts`'s `APPROVAL` payload, so the card in the `dev-ai` chat shows real Approve / Deny). `getApproval` 404s for unknown ids; `decideApproval` maps `approve_once` / `approve_always` / `deny` to the wire statuses and answers 409 `not_pending` on a second decision, like the server. `resetApprovalsMock()` clears state between tests.
- Tests:
  - `lib/approvals-api.test.ts`: 13 tests — bearer header, URL encoding of an id with a `/` and a space, body shape with and without `note`, `getApproval` parse, 404 / 409 / network-error mapping, two `invalid_response` paths (status not in the enum, wrong currency), and "fails before the network when there is no session".
  - `components/chat/approval-card.test.tsx`: 15 tests for the pure state helpers (`approvalStatusLabel`, `loadApprovalCardState`, `applyDecision`) — every terminal label, 404 → `notDecidable`, any other failure → `error`, success returns `{ kind: 'ready' }`, 409 `not_pending` / `expired` → `{ kind: 'reloaded' }` with the fresh row, the reload itself fails → `{ kind: 'reloaded', approval: null }`, non-409 errors → `{ kind: 'error', message }`. **Note on render testing:** the mobile test suite does not mount React (no `@testing-library/react-native`, no `react-test-renderer`). `markdown-text.test.tsx` and `reaction-chips.test.tsx` render components as plain function calls to inspect JSX, which skips hooks entirely; `ApprovalCard` uses `useState` / `useEffect` / `useCallback`, so this file exercises the helpers the component itself uses. The `no-double-submit` and `Retry` UI flows are wired by the card and not separately rendered; their underlying helpers (`applyDecision`, `loadApprovalCardState`) are tested. (The mock test for `Button` etc. is skipped because pulling `../ui/button` through Vitest fails on Flow types in `react-native`; this file imports the helpers, not the React component.)
  - `mock/approvals.test.ts`: 8 tests — seeded pending request, 404 on unknown ids, `approve_once` → `approved_once`, `deny` keeps the note, second decision answers 409 `not_pending`, subsequent `getApproval` reflects the decided status, `approve_always` → `approved_always`, decision on unknown id answers 404.
- Worktree files only: the `approval-card.tsx`, `use-approvals-api.ts`, and mock files live in this worktree. The mobile chat's mock messages are unchanged and already reference `id: 'approval-2001'`, so the mock lights up the existing approval card in the `dev-ai` chat in mock mode.

### Files changed
- `apps/mobile/src/components/chat/approval-card.tsx` (rewritten)
- `apps/mobile/src/components/chat/approval-card.test.tsx` (new, 15 tests)
- `apps/mobile/src/components/chat/use-approvals-api.ts` (new)
- `apps/mobile/src/lib/approvals-api.ts` (new)
- `apps/mobile/src/lib/approvals-api.test.ts` (new, 13 tests)
- `apps/mobile/src/mock/approvals.ts` (new)
- `apps/mobile/src/mock/approvals.test.ts` (new, 8 tests)
- `work/T-0082-approvals-mobile.md` (this Report)

### Commands run and real results
- `pnpm install`: `Scope: all 11 workspace projects / Lockfile is up to date / Done in 6.4s using pnpm v10.32.1` — exit 0
- `pnpm format:check`: `All matched files use Prettier code style!` — exit 0 (one early round needed `prettier --write` on the new files)
- `pnpm lint`: `oxlint .` — exit 0
- `pnpm typecheck` (full monorepo): `Tasks: 10 successful, 10 total / Time: 5.877s` — exit 0
- `pnpm exec turbo test --force --filter=@galena/mobile`: `Test Files 32 passed (32) | 2 skipped (34) / Tests 332 passed (332) | 2 skipped (334) / Tasks: 1 successful, 1 total / Time: 1.246s` — exit 0. New tests: 13 in `approvals-api.test.ts`, 8 in `mock/approvals.test.ts`, 15 in `approval-card.test.tsx`.
- `pnpm exec turbo build --force --filter=@galena/mobile`: built in 28.973 s, no errors — exit 0. iOS + Android bundles, both Hermes bytecode (~7.6 MB / 7.8 MB).
- `pnpm build` (full monorepo): `Tasks: 2 successful, 2 total` — exit 0 (mobile + web). The web build was cached from another worker's run; only the mobile workspace ran fresh here.

### Problems, deviations from the spec, open questions
- **Render testing skipped for the card itself.** The mobile test suite has no React testing library and no `react-test-renderer`; `markdown-text.test.tsx` and `reaction-chips.test.tsx` render components as plain function calls (which skips hooks), and the only existing pattern that exercises hooks lives in the store (`store/real-store.test.ts`) and uses the real React renderer indirectly. `ApprovalCard` uses `useState` / `useEffect` / `useCallback`, so this file exercises the state logic through the three pure helpers the card itself wires up (`approvalStatusLabel`, `loadApprovalCardState`, `applyDecision`) and notes the limitation at the top of the file. The `no-double-submit` and `Retry` UI wiring is straightforward JSX (`disabled={busy}` on both buttons; an `active`-guarded `useEffect` on mount; `applyDecision` returns the typed outcome the component translates to `setState` / `setActionError`); the web card T-0076 has the same shape and was approved with hand-rendered checks.
- **Aliases: relative imports inside `apps/mobile/src/components/chat/approval-card.tsx` and `use-approvals-api.ts`.** The new code uses `../ui/button` / `../../lib/approvals-api` / `../../mock/approvals` rather than the `@/` alias used elsewhere in the app. Reason: the mobile workspace has no `vite-tsconfig-paths` plugin (the only `vite.config.ts` in the monorepo is for the web app), so Vitest cannot resolve `@/` aliases at all. Using relative paths makes the card and the hook importable in tests. The `@/` alias still works in production through Metro/babel-preset-expo. Other mobile tests avoid this by only touching files whose transitive imports use relative paths; the approval card pulls in `Button` and `Text` which are heavily `@/`-using, so the choice was between relative imports everywhere in this card or no card tests. The card's mockable surface (`useApprovalsApi`) keeps the same `?mock=1` / `EXPO_PUBLIC_GALENA_MOCK=1` gate as the rest of the mock layer.
- **`@ts-expect-error`-style escapes: none.** The spec says "no `@ts-ignore`"; strict TypeScript already accepts the wire shape, no escape used.
- **Mock seed id matches the chat mock.** `mock/approvals.ts` seeds `id: 'approval-2001'`, the same id `mock/messages.ts`'s `APPROVAL` payload uses in the `dev-ai` chat. The card's `data.id` matches `PublicApproval.id`, so the mock lights up the card end to end. The mock's other wire fields are constants; only `id`, `status`, `decidedAt` and `note` vary.
- **"Always allow" handling.** The schema and the mock accept `approve_always` on the wire (`status: 'approved_always'`) so a future task can add a third button without further server or mock changes, but the UI does not render it today.
- **No `console.log` anywhere in the new code.** The previous card had `console.log` in both `onPress` handlers; those are gone.

### Blocked / needs a decision
-

### Live check (the lead does it)
Not done from this worker. The spec said "Not needed from you" so no on-device check was attempted; the dev server / simulators DB167CD4 and A3E0C081, and ports 3000 / 8081 / 5173, were not touched.

---

## Review (written by Claude)

**Verdict:** approved with a lead refactor, merged (2026-09-29). Rebased on main; format, lint, typecheck, test (mobile 332 passed) and build green. No pre-review (OpenCode Go has no funds); reviewed by hand.

**Lead change:** the worker used relative imports (`../ui/button`, `../../lib/...`) in the card and the hook because Vitest cannot resolve the `@/` alias, and stubbed React Native in the test. That breaks the style of the surrounding code. The pure state logic (`approvalStatusLabel`, `loadApprovalCardState`, `applyDecision`, `ApprovalCardState`) now lives in `lib/approval-state.ts` (plain relative imports, tested without any mocks in `approval-state.test.ts`), and the card and `use-approvals-api.ts` use `@/` imports like `use-ais-api.ts`.

**Checked:** the API twin uses type guards and an error class with `status`/`code`; Approve sends `approve_once`, Deny `deny`; both disable in flight; a 409 reloads; a 404 shows "Waiting for a decision" with no buttons; a failed first load shows Retry; no "always allow", no `console.log`; mock mode seeds `approval-2001`, the id of the mock chat's card, with the same mock gate as the AI screens.

**Open for Julio (device check):** in a real chat with a real approval request (needs the engine to create one; until then mock mode `?mock=1`/`EXPO_PUBLIC_GALENA_MOCK=1` on a dev build) the card should show Approve/Deny and turn into "Approved". The card component itself has no render test on mobile (no test renderer in the project).
