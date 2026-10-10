---
id: T-1051
title: "Audit: what is left of the size-plan dedups F1-F7 on main, with small task slices"
status: merged
milestone: M5
branch: task/T-1051-audit-dedup-status
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1051: Dedup status audit

## Spec (written by Claude, do not edit)

### Why
`docs/audit/size-plan.md` §4.1 lists the shared-code tasks F1-F8, written before the simplify and size-split waves. Some are already partly done. F1 is an example: `apps/server/src/effect/sql.ts:111` `runSql` is used at about 522 call sites, and only 9 direct `sqlRuntimeFor(...).runPromise` calls remain (`app.ts:597`, `pins/access.ts:48`, `blocks/service.ts:138`, `pins/service.ts:129`, `auth/sql-adapter.ts:155`, `roles/service.ts:84`, `db/migrate.ts:9`, `voice-transcription/pipeline.ts:157`, `test-support.ts:304`). F6a and F8a/b are done or running (T-1043, T-1049, T-1050). The lead needs measured facts before writing more specs.

### What to build
Write `docs/audit/dedup-status.md`. **Change no code.** For each of F1-F7 (`size-plan.md` §4.1, lines 276-282):

1. **What is left on main today,** with real `grep`/`wc` evidence and file:line. Examples:
   - how many `withErrorEnvelope(` / `requestIdOf(` calls remain (F2);
   - how many schema-error envelope wrappers remain in `*/api.ts` (F3);
   - how many hand-written rate limiters exist next to `apps/server/src/effect/rate-limit-middleware.ts` (F4);
   - which modules still do their own group-membership or role checks instead of a shared one (F5);
   - which F6 items remain after T-1043: the crypto envelope copies `push/crypto.ts:44-59`, `connections/crypto.ts:48-63` and `setup/crypto.ts:49-64`, `bareJid`, the secret scrub, the schema-issue walker, `truncateChars`;
   - how much of `apps/web/src/lib/api.ts` is still hand-written (F7).
2. **Whether the copies are identical** (`diff`) or differ in behaviour, and how. Where a merge would change behaviour, say exactly what would change.
3. **Proposed task slices,** each at most about 400 changed lines, with exact files.
   - Mark the slices that touch auth, keys, permissions, rate limits or money as "security: move unchanged or lead decision".
   - Skip the files the lead has deferred: `apps/server/src/main.ts`, `apps/server/src/app.ts`, `apps/server/src/agents/gateway/*`, `apps/server/src/sandbox/tool-worker.ts`, `packages/runner-tunnel/**`, and the stores (`apps/*/src/store/**`).
4. **A recommended order.**

Keep `docs/audit/dedup-status.md` under 400 lines.

### Read first
`AGENTS.md`, `docs/audit/size-plan.md` §1 and §4.1, `docs/audit/simplify-plan.md` (§2.1-§2.8 are the same items), and `apps/server/src/effect/`.

### Allowed files
`docs/audit/dedup-status.md`, `work/T-1051-audit-dedup-status.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/dedup-status.md` exists and covers F1-F7, with grep/diff evidence and file:line for each claim.
- Every proposed slice names exact files and an estimated line count.
- No code changed.

---

## Report (written by the worker when done)

**Status: review.** Wrote `docs/audit/dedup-status.md` (285 lines). No code
changed. It covers F1–F7 of `size-plan.md` §4.1 with grep/wc evidence and
`file:line` for every claim, whether the copies are identical or drift, slices of
≤~400 changed lines with exact files and a security flag, and a recommended
order. F8 is out of scope per the task.

**Files changed (both under Allowed files):**
- `docs/audit/dedup-status.md` (new)
- `work/T-1051-audit-dedup-status.md` (status + this Report)

**Key findings (all measured in this worktree):**
- **F1 done:** `runSql` (`effect/sql.ts:111`) used **522×**; only the 9 direct
  `sqlRuntimeFor(...).runPromise` sites remain (`blocks/service.ts:138`,
  `pins/access.ts:48`, `pins/service.ts:129`, `auth/sql-adapter.ts:155`,
  `roles/service.ts:84`, `voice-transcription/pipeline.ts:157`, `app.ts:597`
  deferred, `db/migrate.ts:9` bootstrap, `test-support.ts:304`).
- **F2 mostly done:** `handler` (`effect/http-core.ts:208`) used 155×. Left: 7
  `withErrorEnvelope(` sites (pins ×3, auth ×1, setup ×2, machines ×1), ~26
  `requestIdOf(` sites, 327 `throw new HttpError(`.
- **F3 done:** no hand-written wrapper left; 19 `schemaErrorLayer(` + 7
  `schemaErrorLayerFor(` one-line provides remain (cosmetic).
- **F4 half done:** factory used 12× + `makeRateLimit` 1×; 6 hand-written layers
  and 31 inline `if (!x.allow(...))` checks (22 modules) remain, 43
  `createRateLimiter(` instances.
- **F5 not started:** no `groups/access.ts`; 65 `group_members` reads (~40 SQL
  sites), `requireGroupManager` copied in `roles/access.ts:31` and
  `invite-links/queries.ts:26`.
- **F6 partly done:** T-1043 removed the `errorName`/`isUniqueViolation` copies
  (one `errorName` left in the deferred `agents/gateway/contracts.ts:253`). Left:
  crypto envelope ×3 (`push/crypto.ts:43-91` = `connections/crypto.ts:47-95` =
  `setup/crypto.ts:48-96`, byte-identical), `bareJid` ×5 + `ownBareJid` ×2,
  scrub, `firstIssueMessage` ×4, `truncateChars` ×4 (plus the code-point variant
  in `push/payload.ts:87`), `readCapped` ×4 (byte-identical).
- **F7 split done, derivation not:** `lib/api.ts` is now a 284-line barrel and
  `lib/api/api/*.ts` holds 1,785 hand-written lines; the derived
  `makeZilarClient` exists and is not yet used by those modules.

**Commands run (real results):**
- `pnpm install` → done in 12.8s.
- Read-only `grep`/`wc`/`sed` measurements (no code touched); numbers in the doc.
- `pnpm gate` from the repo root → **GATE PASS**, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.1s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Tests:** none written or run — the spec says change no code, and the change is
a docs file only (`pnpm gate` still ran format/lint/typecheck).

**Deviations / notes:** F6's spec line lists F6a as done (T-1043); the audit
confirms that and reports only what is left. F6b (crypto) and F5/F4/F7 slices
touch keys, permissions, rate limits and money-adjacent code, so each carries a
"security: move unchanged or lead decision" flag rather than a plain move.
Deferred paths (`main.ts`, `app.ts`, `agents/gateway/*`, `sandbox/tool-worker.ts`,
`runner-tunnel`, stores) are named but excluded from every slice.

**Open questions:** none blocking. The only decisions are the security flags on
S6 (crypto keys), S7–S9 (rate limits), S10–S11 (permissions) and S15 (setup
keys), which the slices already mark for the lead.

## Review (written by Claude)

**Lead, 2026-10-10: approved, with one correction made by the lead in main. The pre-review is clean, with 3 nits.**
- **The doc:** `docs/audit/dedup-status.md` (288 lines) covers F1 to F7 with file:line evidence, 15 slices and an order.
- **What the lead checked by diff on main:**
  - `readCapped` is the same 33-line body in all four files;
  - `truncateChars` is the same in `web-tools/guarded-fetch.ts`, `tools/adapter-support.ts` and `routines/outcomes.ts`.
- **The correction:** the doc called the four `firstIssueMessage` copies identical, and they are not.
  - `xmpp/admin/errors.ts` matches `auth/api.ts`;
  - `routines/schemas.ts` differs only in a `{ }` block around `case 'AnyOf'`;
  - `audit/schema.ts` has two extra cases (`InvalidType` → the default leaf hook, `MissingKey` → `'Missing key'`), so its messages differ.

  The lead fixed §6.4 in main.
- **Next:** the lead will write specs from this doc. Each slice marked security needs a lead decision first.
- **Check:** the gate passed.
