---
id: T-1919
title: "A cancelled or expired approval says which request was not carried out: 'Not carried out: <approval summary>' instead of two identical 'The request was not carried out.' lines when two approvals expire together"
status: merged
milestone: M5
branch: task/T-1919-cancel-notice-names-request
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1919: The cancelled notice names the request

## Spec (written by Claude, do not edit)

### Why
**Julio's screenshot (2026-10-17)** shows two identical "The request was not carried out." messages in "cards test" at 19:30 Madrid. The live DB shows two different approvals:
- `tool.approve_hosts` "Allow "btc-price" to use the web";
- `routine.schedule` "Bitcoin above $90,000 · every 15 minutes".

Both were created at 16:57 UTC, unanswered, and expired at 17:27 UTC (status `denied`). Each pending action was cancelled and posted the same fixed sentence, which reads like a duplicate bug.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/actions/announce.ts:41-57`:**
  - `FAILED_NOTICE` and `CANCELLED_NOTICE = 'The request was not carried out.'`;
  - `summaryForOutcome(status, adapterSummary)` returns `CANCELLED_NOTICE` for `'cancelled'`, whatever the summary.
- **`apps/server/src/actions/queries.ts:17-56`:** `cancelPending(deps, row, reason, at)` marks the pending action `cancelled`, audits it, then `safeAnnounce(... outcome: { status: 'cancelled', summary: null })`. Its callers are `queries.ts:229,234,261` and `recovery.ts:136` (the expiry path).
- **`PendingActionRow`** (`apps/server/src/db/rows-agents.ts:80-95`) has `approvalId`. The approval's display text is `approvals.summary` (`ApprovalRow.summary`, same file), already shown to the chat on the approval card as `Approval needed: <summary>` (`announce.ts`, `approvalCardBody`).
- **`safeAnnounce`** (`apps/server/src/actions/support.ts:47-85`) maps the outcome through `summaryForOutcome` before posting.

### Steps
1. **`announce.ts`:** `summaryForOutcome('cancelled', s)` returns `` `Not carried out: ${s}` `` when `s` is a non-empty string, and `CANCELLED_NOTICE` otherwise. `executed` and `failed` don't change. Update the comment: for `cancelled`, the second argument is the approval's own summary, never adapter text.
2. **`queries.ts` `cancelPending`:** after the UPDATE succeeds, read `SELECT summary FROM approvals WHERE id = ${row.approvalId} LIMIT 1`. This is best effort: on error or no row, use `null`. Pass it as `summary`, trimmed to at most 200 characters.
3. **Test** (permissions/approvals), new `apps/server/src/actions/announce.test.ts`:
   - `summaryForOutcome('cancelled', 'Allow x')` is `Not carried out: Allow x`;
   - `summaryForOutcome('cancelled', null)` is `CANCELLED_NOTICE`;
   - `summaryForOutcome('failed', 'adapter text')` is still `FAILED_NOTICE`, so adapter text never reaches the chat.
4. **Size:** files stay at most 400 lines (`queries.ts` is 344).

### Allowed files
- `apps/server/src/actions/announce.ts`
- `apps/server/src/actions/announce.test.ts`
- `apps/server/src/actions/queries.ts`
- `work/T-1919-cancel-notice-names-request.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/actions/announce.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Two approvals expiring together** post "Not carried out: Allow "btc-price" to use the web" and "Not carried out: Bitcoin above $90,000 · every 15 minutes".
- **Failed actions** still post only the fixed `FAILED_NOTICE`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/actions/announce.ts`: `summaryForOutcome('cancelled', s)` now returns `Not carried out: <s>` when `s` has non-whitespace content, and `CANCELLED_NOTICE` otherwise. `executed` and `failed` are unchanged. Comment now says the second argument for `cancelled` is the approval's own summary, never adapter text.
- `apps/server/src/actions/queries.ts`: `cancelPending` reads `SELECT summary FROM approvals WHERE id = <row.approvalId> LIMIT 1` after the UPDATE succeeds, via a small best-effort `approvalSummary` helper. It trims the text, caps it at 200 characters (`CANCELLED_SUMMARY_MAX`), returns `null` on a missing row or a failed read (logging the error class name and approval id only), and passes the result as the announcer's `summary`.
- `apps/server/src/actions/announce.test.ts` (new): covers `cancelled` with a summary, `cancelled` with `null` and whitespace, and `failed` with adapter text.
- `queries.ts` is now 377 lines, under the 400-line cap; `announce.ts` is 103 lines and the test 22.

### Checks run
- `pnpm install --frozen-lockfile`: Done, 11.6s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/announce.test.ts`: 1 file passed, 3 tests passed (1.61s).
- `pnpm gate`: 4 changed files against main. `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server (6.2s)`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: ... copied into its Dockerfile`, `size: every changed source file is within 400 lines`, `GATE PASS`.

### Notes for the lead
- I did not run a live expiry against the real database. The unit test covers the notice mapping, and the gate's server tests cover the existing approval/expiry paths; the acceptance case (two approvals expiring together) relies on `cancelPending` now passing the approval's summary, which I verified by reading the code path `recovery.ts:136` → `cancelPending` → `safeAnnounce` → `summaryForOutcome`.
- The 200-character cap is applied before the `Not carried out: ` prefix, so the posted sentence can be up to 217 characters.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `418bc8de4`.
- **The change:**
  - a `cancelled` outcome posts `Not carried out: <approval summary>`, read best-effort from `approvals.summary` and capped at 200 characters;
  - it falls back to the fixed `CANCELLED_NOTICE`;
  - `failed` still posts only `FAILED_NOTICE`, so adapter text never reaches the chat.
- **Tests:** three cases in the new `announce.test.ts`.
- **The nit is accepted:** the parameter keeps the name `adapterSummary`, and a comment explains it.

