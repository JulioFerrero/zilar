---
id: T-2167
title: "One activity (audit list) hook in client-core for web and phone: first page, load more with id de-dupe, refresh, failures; each app keeps only its markup and texts; no behaviour change"
status: merged
milestone: M5
branch: task/T-2167-activity-hook
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2167: One activity hook for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The big-cut plan (`docs/audit/big-cut-plan.md`, "UI twins") moves per-screen logic into client-core. Read at `2044ba9fe`, both Activity sections run the same paged audit list. Both build their API with `makeAuditApi` (`packages/client-core/src/settings-api.ts:81-100`; `AUDIT_PAGE_LIMIT` = 20):

- **Phone** `apps/mobile/src/components/ais/ai-activity.tsx`:
  - `loadActivityEffect` and `appendActivityEffect` sit at lines 33–70. The append de-dupes by id because the cursor is inclusive on retries (comment at line 48).
  - The state lives in `AiActivity` at lines 174–262:
    - status, entries, next, message, loadingMore;
    - a synchronous `loadingMoreRef` guard (comment at line 185);
    - a fiber interrupted on unmount, scope change or reload (comment at line 189);
    - `refresh`, which clears to loading and reloads.
  - It uses fixed texts.
- **Web** `apps/web/src/components/ais/AiActivity.tsx`:
  - `ActivitySection` at lines 44–106 holds:
    - a `useQuery` first page, keyed by scope;
    - a `useAction` load-more with the same id de-dupe;
    - `auditFailureText` (lines 34–38), which shows the server message when `status !== 0`, else the fixed text;
    - `reload`, which keeps the rows while it reloads.
  - `PAGE_LIMIT` at line 16 is also 20.

### Steps
1. **Add the hook.** Create `packages/client-core/src/audit-activity.ts` with `useAuditActivity(api: AuditApi, scope: AuditScope, options: { clearOnRefresh: boolean })`:
   - `clearOnRefresh` is `true` on the phone, `false` on web.
   - It returns `{ status, entries, next, loadingMore, failure, refresh, loadMore }`.
   - `failure` is `undefined | { kind: 'load' | 'more'; error: unknown }`.
   - It keeps:
     - the id de-dupe;
     - the synchronous double-tap guard;
     - interruption on unmount, scope change and refresh;
     - load-more errors keep the rows.
   - Move the three comments named above with the code.
2. **Phone.**
   - Use the hook and delete lines 33–70 and the state code.
   - Keep `AiActivityContent`, `AiActivityHeader`, the exported text constants, `showHeader`, the props and all markup.
   - Map `failure` to the same fixed texts as today.
3. **Web.**
   - Use the hook with `makeAuditApi(callApi)` (already built as `listAudit` in `apps/web/src/lib/api/settings.ts:30`; export the whole API there if needed).
   - Keep `auditFailureText`'s rule for the shown text, `AiActivity`, `ActivitySection`'s props and all markup.
   - Delete `PAGE_LIMIT` and the moved state code.
4. Export the hook from `packages/client-core/src/index.ts`.

### Rules
- No behaviour change: the same texts, buttons, refresh behaviour per app and page size.
- Keep every "why" comment, once.
- No new tests.

### Allowed files
- `packages/client-core/src/audit-activity.ts`
- `packages/client-core/src/index.ts`
- `apps/mobile/src/components/ais/ai-activity.tsx`
- `apps/web/src/components/ais/AiActivity.tsx`
- `apps/web/src/lib/api/settings.ts`
- `work/T-2167-activity-hook.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`, counting the new file.
- **Lead check:**
  - Web mock: the AI edit page Activity (refresh, load more) and the group Activity page.
  - Phone emulator: Edit Dev-1 → Activity, and group info → Activity.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/audit-activity.ts` with `useAuditActivity(api, scope, { clearOnRefresh })`: first page, load more with id de-dupe, a synchronous double-tap guard, a first-page fiber interrupted on unmount, scope change and refresh, and `failure: { kind: 'load' | 'more'; error }`. Load-more errors keep the rows. The three "why" comments moved with the code (inclusive cursor, double tap, interrupted load).
- Phone (`apps/mobile/src/components/ais/ai-activity.tsx`): deleted `loadActivityEffect`, `appendActivityEffect`, the local state and the effects; `AiActivity` now calls the hook with `clearOnRefresh: true` and maps `failure` to the existing `ACTIVITY_LOAD_FAILED_MESSAGE` / `ACTIVITY_MORE_FAILED_MESSAGE`. `AiActivityContent`, `AiActivityHeader`, the exported texts, `showHeader`, props and markup are unchanged.
- Web (`apps/web/src/components/ais/AiActivity.tsx`): deleted `PAGE_LIMIT`, the local state and the `useQuery`/`useAction` code; `ActivitySection` calls the hook with `clearOnRefresh: false` and still applies `auditFailureText` (server message when `status !== 0`, fixed sentence otherwise) via `toApiFailure`. `AiActivity`, the section's props and all markup are unchanged.
- `apps/web/src/lib/api/settings.ts`: exports the whole audit API as `auditApi` instead of only `listAudit`; the only consumer (`AiActivity.tsx`) was updated.
- Exported the hook and its types from `packages/client-core/src/index.ts`.
- Fix round: the hook is now 142 lines (was 172). One `ActivityState` type plus `& { refresh; loadMore }` on the return; no local lister (both pages call `api.listAudit` with `AUDIT_PAGE_LIMIT`); the effect is keyed on one `scopeKey` string (the scope itself is read through `scopeRef` in a layout effect, because a rebuilt scope object in the deps would reload every render and lint forbids reading a ref during render); `Effect.match` with plain `setState` in both handlers; load-more merges into `current.entries` inside the updater. Every comment is still present once.
- No new tests.

### Checks run

First `pnpm gate`: `FAIL format` on `apps/web/src/components/ais/AiActivity.tsx` and `packages/client-core/src/audit-activity.ts`; after `pnpm exec prettier --write` on those two files, the next run stopped at `FAIL lint` with `react-hooks(exhaustive-deps)` for `scope`; I replaced the object dependency with the ai/group id values and reran.

Fix round: `pnpm gate` first stopped at `FAIL format` on `packages/client-core/src/index.ts` (fixed with Prettier), then at `FAIL lint` with `react(refs)` for the in-render ref write (moved to `useLayoutEffect`). Final `pnpm gate` (repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (2.1s)
PASS  effect  (0.5s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/client-core  (3.2s)
SKIP tests @zilar/mobile (no nearby test files)
PASS  tests @zilar/web  (3.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No single test file was run: the change has no nearby test file (UI and a shared hook), and the spec says no new tests.

Net product lines from `git diff main...HEAD --numstat -- apps packages` (the `main` tip moved during the round, so the two-dot form now includes other workers' merged files): +191 / −228 = **−37** (mobile 18/135, web 29/92, `settings.ts` 1/1, `index.ts` 1/0, new hook 142/0).

### Notes for the lead

- `listAudit` is no longer exported from `apps/web/src/lib/api/settings.ts`; its only caller now imports `auditApi`. Nothing else imported it.
- Behaviour kept: phone refresh clears to the skeleton (`clearOnRefresh: true`), web refresh keeps the rows (`clearOnRefresh: false`); both use the shared 20-row page size from `makeAuditApi`.
- The interrupted fiber is the first-page load, as before; a load-more in flight is not interrupted on refresh, matching the previous code.
- Fix-round commits: items 1–5 are one commit each; item 6 is a comment audit with no code change. Two small follow-ups fix Prettier on `index.ts` and the ref-access lint error from item 3.
- Lead checks: web mock AI edit page Activity (refresh, load more) and group Activity page; phone emulator Edit Dev-1 → Activity and group info → Activity.

## Review (written by Claude)

Approved; the pre-review was clean after one lead fix round.

**Fix round.** The first version netted −2, with a 172-line hook. The worker:
- folded the two state types into one;
- paged through `listAudit`;
- keyed the load on one scope string;
- used plain `Effect.match`;
- merged pages inside the state updater, which also fixes the pre-review's stale-snapshot race.

Net is now −37. The double-tap guard, late-answer and inclusive-cursor comments moved with the code.

**Web mock:** the AI panel Activity (first page, refresh) is identical to main, with no page errors. "Load more" can't be shown, because the mock has 4 entries.

**Phone emulator:**
- The smoke passed.
- Edit Dev-1 → Activity shows 4 rows, and refresh reloads them.
- Dev team group info → Activity shows 2 rows with no section header.
