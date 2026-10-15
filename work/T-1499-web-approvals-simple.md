---
id: T-1499
title: "Web approvals, simpler (approved Approvals canvas): the chat card shows 'AI asks', the summary, Deny/Approve and a quiet Always allow; decided is one line with an icon; the Approvals page is one list of rows with icon keys; no money, action name, details or timer"
status: merged
milestone: M5
branch: task/T-1499-web-approvals-simple
model: auto
effort: default
depends_on: [T-1498]
estimate: 0.5 day
---

# T-1499: Web approvals, simpler

## Spec (written by Claude, do not edit)

### Why
Julio approved a simpler Approvals design on 2026-10-15. He rejected the first one ("too many things … make it simpler and more clear") and then the money ("i dont like the money part").

Read `docs/design/mockups/approvals/README.md`, then the boards:
- `Main.dc.html`: the card in the chat;
- `WebInbox.dc.html`: the Approvals page.

Copy their sizes and order. This is D24 only (`docs/design/ui-style.md`). Machines is a later task.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/ApprovalCard.tsx`** (257 lines). It is rendered for an `approval.request` card inside a message (`apps/web/src/components/message/AttachmentBody.tsx:244-255`).
  - **Today it shows:**
    - the action name with a shield (`:110-113`);
    - the summary (`:114`), the details (`:115-117`);
    - "Worst case" money (`:118-122`), "Approvers" (`:123-127`);
    - the status as a word (`statusLabel`, `:14-28`, `:154-158`);
    - Approve, Deny and "Always allow here", with its two-step confirm (`:160-236`).
  - **Polling and decision logic** (`:38-106`) and the error mapping (`:241-257`) stay as they are.
- **The Approvals page,** `apps/web/src/routes/ApprovalsPage.tsx` (239 lines), renders one `ApprovalRow` per pending approval through `PendingApproval` (`:174-239`).
- **`apps/web/src/components/approvals/ApprovalRow.tsx`** (82 lines) shows the action name, a "pending" word badge, the summary, details, cost, "expires …", and Approve and Deny text buttons.
- **`PublicApproval`** gets `aiName` (`''` when unknown) and `groupName` (`null` for a DM) from T-1498.
- **Kit:**
  - `IconButton` (`apps/web/src/components/ui/icon-button.tsx`, 36 px, 10 px radius) always draws `key-icon` and has no primary look;
  - `Button` (primary and outline);
  - `Avatar` (`apps/web/src/components/Avatar.tsx:15`, seeded by name).

### What to build
1. **Kit:** `IconButton` gains `variant?: 'default' | 'primary'`. `primary` draws `key-primary` instead of `key-icon`. Add one case to `apps/web/src/components/ui/icon-button.fixture.tsx`.
2. **`ApprovalCard`** follows `Main.dc.html`:
   - **Pending:**
     - the label `"<aiName> asks"` (13 px, muted; just "Asks" when `aiName` is `''`), then the summary (16 px, semibold);
     - one row: "Always allow" as quiet text on the left (only when today's `showAlways` is true), then Deny (outline) and Approve (primary) on the right, 36 px tall;
     - the "Always allow" two-step confirm stays, with today's sentence and Confirm / Cancel;
     - errors show as today.
   - **Remove from the card:** the shield and action-name line, `details`, the worst-case money, the approvers line and every status word.
   - **Decided:** one compact line with an icon and the summary in muted text:
     - green check for `approved_once`, `approved_always` and `consumed`;
     - red cross for `denied`;
     - grey clock for `expired`.
     - Each icon has an `aria-label` (Approved, Denied, Expired).
   - **`notDecidable`:** the summary plus a grey clock icon (aria-label "Waiting for a decision").
   - **Loading and error** stay as today.
3. **Approvals page** follows `WebInbox.dc.html`:
   - **The list:** all pending approvals in one rounded list (`bg-surface`, border, 12 px radius, dividers).
   - **Each row:**
     - an `Avatar` (32 px, seeded by `aiName`);
     - the summary, one line, ellipsized;
     - under it in muted text, `aiName · groupName`, or only `aiName` when `groupName` is null;
     - a Deny `IconButton` (X icon, aria-label "Deny: <summary>") and an Approve `IconButton variant="primary"` (check icon, aria-label "Approve: <summary>").
     - A row error shows under that row.
   - **Remove** the action name, the "pending" badge, details, cost and "expires …".
   - The empty state stays.
4. **Leave** `worstCaseText` and `formatRelative` alone if other code uses them; otherwise delete what is now unused.
5. **Every file stays at most 400 lines.** No new tests (UI).

### Allowed files
- `apps/web/src/components/ui/icon-button.tsx`
- `apps/web/src/components/ui/icon-button.fixture.tsx`
- `apps/web/src/components/ApprovalCard.tsx`
- `apps/web/src/components/approvals/ApprovalRow.tsx`
- `apps/web/src/components/approvals/formatRelative.ts`
- `apps/web/src/routes/ApprovalsPage.tsx`
- `work/T-1499-web-approvals-simple.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead, headless web `?mock=1` at 1280 and 390 px:**
  - the Dev-1 approval card in the chat matches `Main.dc.html`: "Dev-1 asks", the summary, then Always allow, Deny and Approve, with no money and no action name;
  - Approve turns it into one line with a green check;
  - Settings › Approvals matches `WebInbox.dc.html`.
- No console errors.

---

## Report (written by the worker when done)

### What I did

Files changed (all inside Allowed files):

- **`apps/web/src/components/ui/icon-button.tsx`** — added `variant?: 'default' | 'primary'`. `primary` uses the `key-primary` utility, `default` keeps `key-icon`. Also emits `data-variant`.
- **`apps/web/src/components/ui/icon-button.fixture.tsx`** — one new `Primary` case (appended; the other cases are untouched).
- **`apps/web/src/components/ApprovalCard.tsx`** — follows `Main.dc.html`:
  - pending: the muted 13 px label `"<aiName> asks"` ("Asks" when `aiName` is `''`) over the summary (16 px semibold), then one row: "Always allow" as quiet text on the left when `showAlways`, and Deny (outline) / Approve (primary) on the right, 36 px (`size="lg"`). The two-step "Always allow" confirm keeps today's sentence and Confirm / Cancel (also 36 px). The decision errors are unchanged.
  - decided: one compact line, icon first then the summary in muted text. Green check for `approved_once`/`approved_always`/`consumed`, red cross for `denied`, grey clock for `expired`, each with `role="img"` and an `aria-label` (Approved / Denied / Expired).
  - `notDecidable`: the summary plus a grey clock (`aria-label="Waiting for a decision"`).
  - loading and error blocks unchanged.
  - removed: the shield + action-name line, `details`, the worst-case money, the approvers line and every status word.
  - the polling and decision logic (including the stale-decision and always-refusal handling) is untouched.
- **`apps/web/src/components/approvals/ApprovalRow.tsx`** — one list row: `Avatar` (32 px, seeded by `aiName`), the summary truncated to one line, `aiName · groupName` (or only `aiName` when `groupName` is `null`) in muted text, and Deny (`X`) / Approve (`Check`, `variant="primary"`) `IconButton`s with `aria-label` `"Deny: <summary>"` / `"Approve: <summary>"`. The row error shows under the row. Removed the action name, the "pending" badge, details, cost and the expiry prop.
- **`apps/web/src/components/approvals/formatRelative.ts`** — **deleted**. Its only exports (`expiryParts`, `expiresInText`, `worstCaseText`) had no other callers once the card and the row stopped using them (spec item 4).
- **`apps/web/src/routes/ApprovalsPage.tsx`** — the pending approvals are now one rounded list (`bg-surface`, `border-divider`, 12 px radius, `divide-y` dividers). Dropped `now`, the per-minute countdown tick, `COUNTDOWN_TICK_MS` and the `expiresInText` call because nothing shows the expiry anymore. The 30 s background refresh, the tab-focus refresh, the notice, the empty state, the skeleton and the list error are unchanged.

### Checks run

- No standalone test run: the change is UI only and the package has no nearby tests (the gate reports `SKIP tests @zilar/web (no nearby test files)`).
- `pnpm gate` (first run): **GATE FAIL** — `format` failed on `ApprovalCard.tsx` and `ApprovalsPage.tsx`. Fixed with `pnpm exec prettier --write` on those two files only.
- `pnpm gate` (second run): **GATE PASS**, and it listed no files outside the Allowed files. Summary lines:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (0.7s)
PASS  lint  (1.4s)
PASS  typecheck  (3.3s)
PASS  effect  (0.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

(The 7 changed files are the 5 Allowed source files, the deleted `formatRelative.ts`, and this task file. `formatRelative.ts` is item 4 of the spec: it is now unused and was deleted.)

### Notes for the lead

- **Deviations:** the mockup (`README.md` / `WebInbox.dc.html`) wraps each row's summary in a link that "opens the chat at the request". The task's "What to build" item 3 does not list that behaviour and `PublicApproval` carries no chat/message id to navigate to, so I left it out. Say the word if you want it and I will add a task for it.
- I kept the "Waiting for you" heading and the Refresh button on the Approvals page: the spec's Remove list only names the row's action name, badge, details, cost and expiry, and it says the empty state stays (which includes that heading/Refresh). The mock has neither, so if you want the page to match the canvas exactly, that heading/Refresh should go in a follow-up.
- The decided line uses `request.summary` (from the message card) rather than the polled `approval.summary`; they are the same text.
- I did not run the app in a browser (no browser is available here); the two acceptance checks at 1280/390 px are yours to run.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 nits, for head `535c60c6c`. The nits are no busy label on the icon keys and the `DecidedIcon` fallthrough; both are left as they are.
- **Headless check (mock, dark, 1280 and 390 px):**
  - the Approvals page is one row: avatar, summary, "Dev-1", and the ✕ and ✓ keys;
  - no horizontal scroll and 0 page errors.
- **Dev team › General card:** "Dev-1 asks", the summary, a quiet "Always allow", Deny and Approve. No money, action name, details or timer.
- **Follow-ups:**
  - the row link that opens the chat at the request needs a chat id on `PublicApproval`;
  - drop the page's "Waiting for you" heading and Refresh to match the canvas.
  - Both go with the Machines/approvals web follow-up.
