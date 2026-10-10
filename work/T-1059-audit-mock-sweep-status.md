---
id: T-1059
title: "Audit: what still uses the old mock code (web mock/api.ts fallback, mobile use-*-api mock switches, mobile mock store), with H2 and sweep slices"
status: merged
milestone: M5
branch: task/T-1059-audit-mock-sweep-status
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.25 day
---

# T-1059: Mock sweep status audit

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-plan.md` §4 splits the mock rebuild into building the shared backend (A to F2), the cutovers (G web, H mobile) and a deletion sweep (I to R2). Done so far: A, B, C1 (T-1044), D, E, F1 (T-1046), F2, G (T-0946), H1 (T-0949, the mobile store) and O (T-0947). C2 (T-1045) is in review.

What the lead read on main (2026-10-10):
- **web:** `apps/web/src/mock/backend.ts:17-23` `dispatch` tries `backend.http` and falls back to `mockRequest` in `apps/web/src/mock/api.ts` (4,297 lines) for anything the shared backend does not answer.
- **mobile:** several screens still pick an old per-domain mock through their `use-*-api.ts` switch. For example, `apps/mobile/src/components/chat/use-approvals-api.ts:55-64` uses `createMockApprovals()` from `apps/mobile/src/mock/approvals.ts`, whose `listAiApprovalRules` returns `[]` (`:119-121`), even though `packages/mock-backend/src/domains/approval-rules/` exists. That is plan task H's second half (each `use-*-api.ts` gets `backend.http` as its `fetchImpl`).
- `apps/mobile/src/store/chat-store.ts` (1,595 lines) still has `isMockMode` at `:1583`. Plan task Q deletes it once nothing reaches it.

The lead needs measured facts before speccing H2 and the sweep.

### What to build
Write `docs/audit/mock-sweep-status.md`. **Change no code.** Throwaway scripts are fine; do not commit them.

1. **Web fallback coverage.** List every path family `mockRequest` handles (`apps/web/src/mock/api.ts`, its route switch from `:2179`). For each one, say whether `createMockBackend().http` answers the same method and path today, and measure it with a throwaway script that calls both.
   - Mark three groups: "backend covers it, so the old route is dead"; "backend lacks it, so it still falls back"; "only T-1045 covers it".
   - Give the `api.ts` line ranges of the dead routes.
2. **Mobile mock switches.** For every `apps/mobile/src/**/use-*-api.ts`, and every other place that picks a mock with `ENV_MOCK`/`mockParamAllowed`/`isMockMode`, name the old mock it uses (file:line) and whether a shared backend domain exists for it.
   - Note behaviour gaps between the two (for example, approval rules).
   - Say what an adapter onto `backend.http` needs: the client factory and its `fetchImpl` parameter, file:line.
3. **The mobile mock store.** Is `isMockMode`, or the mock branch of `createChatStore` in `apps/mobile/src/store/chat-store.ts`, still reachable from any non-test code? `grep` every importer.
4. **The old mock files.** For each file in `apps/web/src/mock/`, `apps/mobile/src/mock/` and `apps/mobile/src/components/*/*-mock.ts`, list its importers today, and say whether it would be dead after the H2 adapters.
5. **Proposed slices,** each at most about 800 changed lines (deletions count), with exact files and line ranges, and an order:
   - first the H2 adapters (one small task per domain group);
   - then the deletions that become safe.

   Mark the slices that touch auth, keys or permissions code outside the mocks.

Keep `docs/audit/mock-sweep-status.md` under 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` (all of §4 and §5), `apps/web/src/mock/backend.ts`, `apps/mobile/src/mock/backend.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, and `packages/mock-backend/src/domains/index.ts`.

### Allowed files
`docs/audit/mock-sweep-status.md`, `work/T-1059-audit-mock-sweep-status.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/mock-sweep-status.md` exists. Each claim has file:line or script-output evidence, and every slice names exact files.
- No code changed.

---

## Report (written by the worker when done)

**What I did.** Read-only audit; wrote `docs/audit/mock-sweep-status.md` (283
lines) covering the five asks: (1) per-family web `mockRequest` coverage with a
throwaway probe, (2) every mobile mock switch and its backend domain, (3) the
mobile store's reachability, (4) old-mock-file importers, (5) proposed slices
and order. No code changed.

**Measurement.** I wrote a temporary vitest file
(`apps/web/src/mock/audit-probe.test.ts`) that called
`createMockBackend({ delayMs: 0 })` and `mockRequest(path, init, { delayMs: 0 })`
for ~150 method+path probes (one per route family) and printed
`backend=<status|undefined>` vs `web=<status|mock_not_implemented>`. A backend
result other than `undefined` means the shared backend serves that method+path.
I corrected two probe paths (`/stickers/:id/file`,
`/sticker-packs/import/telegram`) and re-ran; then deleted the file before gate.

**Files changed.**
- `docs/audit/mock-sweep-status.md` (new).
- `work/T-1059-audit-mock-sweep-status.md` (this report).

**Commands and real results.**
- `pnpm install` → done in 11.2s; one pre-existing peer warning
  (`@types/react-dom` vs `@types/react`), no error.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/audit-probe.test.ts`
  → `Test Files 1 passed (1) / Tests 1 passed (1)`; printed the probe table.
- `pnpm gate` → `GATE PASS`; `grep`-visible summary lines:
  `gate: 2 changed file(s) against main`, `PASS install (frozen)`,
  `PASS format`, `PASS lint`, `PASS typecheck`,
  `SKIP effect (no source files changed)`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.

**Main findings.**
- Web: nearly all `mockRequest` families are already answered by
  `createMockBackend().http` (task G is merged). Still falling back:
  `users/by-handle`, `contact-requests`, `blocks`, `handles/check`,
  `backgrounds`, `chat-folders`, `push`, `voice` and `PUT /me/handle`.
  `backgrounds`/`chat-folders` are only covered by T-1045 (not merged).
- Mobile: 12 `use-*-api.ts` hooks still pick old mocks. Backend domains exist
  for all but `integrations`; `profile` is only partly covered (`me` serves
  `GET/PATCH /me`, not handle/avatar). The approval-rules gap is real:
  `mock/approvals.ts:119-127` returns `[]`/404, the backend has real rules.
- The mobile store `apps/mobile/src/store/chat-store.ts` has **zero** importers
  (`createChatStore :358` and `isMockMode :1583` are unreferenced); it is already
  dead, so task Q is a pure removal.
- Slices: five small H2 adapter tasks (one domain group each; H2-5 integrations
  is blocked), then the web deletion slices W1–W10 and mobile M1–M7, each ≤ ~800
  changed lines.

**Deviations / notes.**
- The task text said T-1045 is "in review", but `work/T-1045-...md` reads
  `status: todo` here; either way it is not merged, which is what the doc needs.
- The plan's §1.1 citations `app/(tabs)/index.tsx:94` and
  `app/chat/[id].tsx:213-232` no longer import mocks; all direct mock use now
  sits in `components/` (recorded in the doc).
- `/media` is not a `mockRequest` route (it was served by the deleted web store),
  so it is not in the §1 table.

**Open question (not blocking).** Deletion slice W8 must also move
`apps/web/src/auth/AuthProvider.tsx:9` and
`apps/web/src/components/StickerPanel.tsx:14` off the deleted seed files — that
is a code change, not a pure deletion, so it needs its own Allowed files. Flagged
in the doc for the lead to scope.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The doc:** `docs/audit/mock-sweep-status.md` (283 lines) covers four things:
  - the web fallback coverage, measured by probing `createMockBackend().http` against `mockRequest`;
  - the 12 mobile `use-*-api.ts` mock switches, with their factories and `fetchImpl` lines;
  - the mobile mock store;
  - every old mock file's importers, followed by the H2 adapters and the deletion slices, in order.
- **What the lead checked on main with grep:**
  - `apps/mobile/src/store/chat-store.ts` has no importers;
  - mobile `mock/{contacts,pins,invite-links,chat-prefs}.ts` are imported only by `chat-store.ts`;
  - `mock/index.ts` (with `chats`, `channel`, `messages`, `topics` and `voice`) is still live through `mock/search.ts` ← `components/chat/chat-search-results.tsx`, so it waits for H2-4.
- **Out of date:** §1c was written before T-1045 merged. Backgrounds and chat-folders are now in the shared backend.
- **Next:** the lead specs Q (deleting the dead mobile store), H2-1 and H2-2, and W1.
- **Check:** the gate passed.
