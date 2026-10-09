---
id: T-0807
title: "WU5: web onboarding routes on Effect — HandlePage, InvitePage (tests first), SetupPage, JoinPage"
status: merged
milestone: M5
branch: task/T-0807-web-onboarding
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0807: WU5: web onboarding routes on Effect — HandlePage, InvitePage (tests first), SetupPage, JoinPage

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row WU5 (line 375); WU4 (auth, T-0795) is merged. The plan flags "Julio: first-run setup and invite join": Julio checks them live before the next deploy.

### Verified facts (do not re-derive)
- **The files:**
  - `apps/web/src/routes/HandlePage.tsx` (193, H1 H3 W4): a `setTimeout` debounce at line 46; tested in `HandlePage.test.tsx`;
  - `apps/web/src/routes/InvitePage.tsx` (56, H1 W4): a `.then` at line 18; **no test**;
  - `apps/web/src/routes/SetupPage.tsx` (231, H1 W4): a `.then` at line 38; tested in `SetupPage.test.tsx`;
  - `apps/web/src/routes/JoinPage.tsx` (249, H1 W4): an async default prop at line 28; tested in `JoinPage.test.tsx`.
- **The web pattern** is in `docs/EFFECT_BRIEF.md` (Web UI), with the hooks in `apps/web/src/lib/effect/`. The models are `apps/web/src/routes/BlockedPage.tsx` and `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery`).

### What to build
1. Write `apps/web/src/routes/InvitePage.test.tsx` first, against the current code, and commit it ("T-0807: tests before").
2. Convert the four files. The HandlePage debounce becomes `Effect.sleep` inside a `useQuery` keyed on the input, with the same delay.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/web/src/lib/effect/use-action.ts`, `use-query.ts`, `apps/web/src/components/NewGroupDialog.tsx`, the four files and their tests.

### Allowed files
`apps/web/src/routes/HandlePage.tsx`, `apps/web/src/routes/InvitePage.tsx`, `apps/web/src/routes/InvitePage.test.tsx`, `apps/web/src/routes/SetupPage.tsx`, `apps/web/src/routes/JoinPage.tsx`, `work/T-0807-web-onboarding.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/routes/HandlePage src/routes/InvitePage src/routes/SetupPage src/routes/JoinPage
pnpm --filter @zilar/web typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- **Commits:** `T-0807: tests before` (new `InvitePage.test.tsx`, 5 tests, green on the old code), then the conversion commit.
- **effect:map:** HandlePage `effect`, InvitePage `effect`, SetupPage `effect`, JoinPage `effect` (JoinPage still lists signal H1 for the default prop `openGroupChat = () => Promise.resolve(undefined)`, which must stay a Promise-returning default; the kind is `effect`).
- **Tests:** the four route test files: 20 passed before, 25 passed after (5 new in InvitePage.test.tsx). Run 3 times, 25/25 each time. Existing tests unchanged. `pnpm --filter @zilar/web typecheck`: clean.
- **Behaviour differences:**
  - HandlePage: the availability line is blank (idle) while a new check is pending or after the input is emptied. Before, the last result stayed on screen, showing e.g. "@newtext is available" for the old answer. Same as NewGroupDialog.
  - HandlePage: Continue stays disabled after a successful claim (as before), now derived from the action state.
  - JoinPage: the "already a member" Open button drops a second click while the first open runs (mode `ignore`); before, each click navigated.
  - JoinPage: a "full"/"invalid" result from the join call is derived from the last join failure instead of set state; it holds until the next join call, same as before for the user.
  - SetupPage: Retry re-runs the same query with `refresh()`; the page shows "Checking server setup…" while it runs, as before.
  - Everything else (texts, order of side effects, delay of 300 ms, error mapping) is the same.
- **Unsure:** the retry path in SetupPage (statusFailed to checking to result) has no existing test; I rely on `useAtomRefresh` marking the result waiting at once. The first-run setup and invite join are the flows the plan says Julio checks live.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. InvitePage tests (5) were committed first; the four routes are Effect files. Accepted: a stale availability line clears while re-checking, and a double Open is dropped. Julio checks setup and the invite join live.
