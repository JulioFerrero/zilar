---
id: T-1527
title: "Web lean leftovers: Approvals page drops the subtitle, the 'Waiting for you' headings and Refresh; the chat header shows a Globe icon instead of the word 'Public' and a Lock icon instead of the 'Private' pill; delete dead role-label.ts and share one formatUsd"
status: merged
milestone: M5
branch: task/T-1527-web-lean-leftovers
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1527: Web lean leftovers

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-15) is that **a status is an icon or a dot, never a word**, and that pages stay lean: no subtitles and no extra headings. The lead's reviews of T-1499 and T-1519 found these leftovers.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/ApprovalsPage.tsx` (219 lines):**
  - `SettingsShell` has the subtitle "Requests from your AIs that are waiting for you." (`:84`);
  - both pending branches render a heading row "Waiting for you" plus an outline "Refresh" button (`:89-100` and `:118-129`).
  - The empty state is "Nothing is waiting for you." (`StateMessage`).
- **`apps/web/src/components/ChatHeader.tsx` (373 lines):**
  - a public chat shows the word "Public" (`:153-155`);
  - a private topic shows a pill with a `Lock` icon and the word "Private" (`:156-160`).
- **`apps/web/src/components/panels/role-label.ts`** has no importers (`git grep role-label` finds none since T-1519).
- **`formatUsd`** is defined twice: `apps/web/src/components/ais/AiHealthRow.tsx:21` and `apps/web/src/components/ais/AiUsageSection.tsx:5`.

### Steps
1. **`ApprovalsPage.tsx`:**
   - remove the subtitle and both heading rows (the "Waiting for you" `h2` and the Refresh button);
   - keep the `section` with its `aria-label`, the list and the empty state;
   - if `refresh` is now unused, remove what only it needed.
2. **`ChatHeader.tsx`:**
   - replace the "Public" text with a `Globe` icon (`size-3.5`, muted, `role="img"`, `aria-label="Public"`);
   - replace the "Private" pill with a bare `Lock` icon (`size-3.5`, muted, `role="img"`, `aria-label="Private"`);
   - the file must not grow.
3. **Delete `apps/web/src/components/panels/role-label.ts`.**
4. **`formatUsd`:** move it to `apps/web/src/lib/format-usd.ts` and import it in both files. Same output: `$` and two decimals.

### Not in scope
- the phone;
- the server;
- the AI chat header's "AI · idle" line (AI work step 6).

### Tests
None (UI).

### Allowed files
- `apps/web/src/routes/ApprovalsPage.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/panels/role-label.ts` (delete)
- `apps/web/src/lib/format-usd.ts` (new)
- `apps/web/src/components/ais/AiHealthRow.tsx`
- `apps/web/src/components/ais/AiUsageSection.tsx`
- `work/T-1527-web-lean-leftovers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings/approvals?mock=1` shows the title and the list of approval rows, with no subtitle, no "Waiting for you" heading and no Refresh.
- Acme Announcements' header shows a globe icon instead of "Public".
- A private topic's header shows a lock icon with no word.
- No page errors.

---

## Report (written by the worker when done)

### What I did

- `apps/web/src/routes/ApprovalsPage.tsx`: dropped the `SettingsShell` subtitle and both "Waiting for you" heading rows (the `h2` and the outline Refresh `Button`) from the pending and empty branches. Kept the `section aria-label="Pending approvals"`, the list, the empty `StateMessage` and the Retry button. `refresh` is still needed (polling interval, tab-focus listener, Retry), so nothing else was removed; `Button` is still used by Retry.
- `apps/web/src/components/ChatHeader.tsx`: a public chat now renders a `Globe` icon instead of the word "Public"; a private topic renders a bare `Lock` icon instead of the pill. Both are `size-3.5`, muted (`text-muted-foreground`), `role="img"` with `aria-label="Public"`/`"Private"`. Added `Globe` to the lucide-react import; `Lock` was already imported. The file shrank from 373 to 371 lines (no growth).
- `apps/web/src/components/panels/role-label.ts`: deleted. `git grep "role-label\|roleLabel"` shows no importers anywhere in the repo.
- `apps/web/src/lib/format-usd.ts`: new module exporting `formatUsd` (same `$` + two decimals output).
- `apps/web/src/components/ais/AiHealthRow.tsx` and `apps/web/src/components/ais/AiUsageSection.tsx`: removed the two local `formatUsd` definitions and import the shared one from `@/lib/format-usd`; call sites unchanged.

### Checks run

- `pnpm install`: `Done in 12.4s`.
- Single tests: none. The change is UI-only (no crucial code path) and the task says "Tests: None (UI)"; gate reported `SKIP tests @zilar/web (no nearby test files)`.
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 7 changed files are the six Allowed source files plus this task file; no file outside scope.

### Notes for the lead

- Deviation, minor: the spec lists the icons as `size-3.5`, muted, `role="img"`, `aria-label`. Keeping `shrink-0` as well forced each icon onto multiple lines and the file grew by 6 lines, which the spec forbids ("the file must not grow"). I kept exactly the listed classes and both icons fit on one line; the file now shrank by 2 lines. If you want `shrink-0` back on the icons, say so and I will re-add it and accept the extra lines.
- I did not run the app or click through `/settings/approvals?mock=1`, Acme Announcements or a private topic; those acceptance checks are for your smoke/live pass.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit, for head `a897f6edd`.
- **Headless check (mock, dark, 1280 px):**
  - `/settings/approvals` shows the title and the approval row only: no subtitle, no "Waiting for you" heading, no Refresh;
  - Acme Announcements' header shows a globe icon (`aria-label` "Public") instead of the word;
  - "Hiring: frontend role" shows a bare lock icon (`aria-label` "Private") instead of the pill;
  - 0 page errors.
- **Code:** `role-label.ts` is deleted, and `formatUsd` lives once in `apps/web/src/lib/format-usd.ts`.

