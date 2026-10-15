---
id: T-1513
title: "Phone approvals, simpler (approved Approvals canvas, phone twin of T-1499): the chat card shows '<AI> asks', the summary, Deny/Approve and a quiet 'Always allow'; a decided request is one line with an icon; the Approvals screen is one list of rows with ✕/✓ icon keys; no money"
status: merged
milestone: M5
branch: task/T-1513-mobile-approvals-simple
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1513: Phone approvals, simpler

## Spec (written by Claude, do not edit)

### Why
Julio approved the Approvals design on 2026-10-15. Read `docs/design/mockups/approvals/README.md`, then `PhoneCard.dc.html` and `PhoneInbox.dc.html`. Web shipped in T-1499 (`apps/web/src/components/ApprovalCard.tsx`, `apps/web/src/components/approvals/ApprovalRow.tsx`); this is the phone twin. Parity across web, Android and iOS is a standing rule.

**The rules:**
- **No money anywhere.**
- **The card hides** the tool's action name, the details, the approvers line and the expiry timer.
- **"Always allow"** keeps today's two-step confirm and is shown only when the request is eligible.
- **A status is an icon, never a word.**
- **Phone keys** are 44 px tall and share the width; "Always allow" sits centred under them. The rows use 40 px icon keys, and the summary wraps to two lines.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/lib/approvals-api.ts` (153 lines):** `PublicApproval` (`:30-45`) and `toPublicApproval` (`:83-101`) map the contract row, but drop the new `aiName` and `groupName` (T-1498) and `alwaysEligible`. All three are on the wire: see `packages/api-contract/src/approvals.ts` and `apps/server/src/approvals/api-reads.ts`.
- **`apps/mobile/src/components/chat/approval-card.tsx` (169 lines):**
  - it shows `data.action` as the title, then the summary, `data.details` and "Max cost: …" (`:99-108`);
  - pending: Approve (`variant="key"`) and Deny (`outline`), `size="sm"` (`:138-161`);
  - decided: `approvalStatusLabel(approval)` as a word (`:132-134`);
  - there is no "Always allow" here today;
  - `loadApprovalCardState` gives `approval` (the polled `PublicApproval`).
- **`apps/mobile/src/components/approvals/approval-row.tsx` (85 lines):** `PendingApprovalRow` shows:
  - a shield icon and `approval.action`;
  - a "pending" word badge;
  - `aiName · summary`, the details, the cost, "expires …";
  - three word buttons (`SCREEN_DECISIONS`: Approve once, Always, Deny, `apps/mobile/src/components/approvals/rows.ts:98-105`).
  
  It is used by `apps/mobile/src/components/approvals/pending-tab.tsx:71-78`, which passes `aiName`.
- **The kit:**
  - `IconButton` (`apps/mobile/src/components/ui/icon-button.tsx`, 40 px with 12);
  - `Button` (`variant="key"` is primary);
  - `EntityAvatar` (`apps/mobile/src/components/chat/entity-avatar.tsx:28`, `person`, `size`, `ai`);
  - icons from `lucide-react-native`.

### What to build
1. **`approvals-api.ts`:** `PublicApproval` gains `aiName: string`, `groupName: string | null` and `alwaysEligible: boolean`, mapped in `toPublicApproval` with the defaults `''`, `null` and `false` when absent.
2. **`approval-card.tsx`:**
   - **The text:**
     - a small muted label "<aiName> asks", once the polled approval has a non-empty `aiName`; otherwise "Approval";
     - then the summary as the title (16 px semibold).
     - Remove the action title, the details and the cost (and `formatMoney` if unused).
   - **Pending:**
     - Deny (`outline`) and Approve (`key`) side by side, each `flex-1` and 44 px tall;
     - under them, centred, a quiet "Always allow" text button, shown only when `approval.alwaysEligible`. The first tap turns it into "Tap again to always allow"; the second tap decides `approve_always`. The busy labels stay.
   - **Decided:** one row, a green `Check` (approved) or a red `X` (denied or expired: the statuses that are not approved), 14 px, then the summary in muted text. No status word.
3. **`approval-row.tsx`:** a row (`flex-row items-center gap-3`, in a rounded list) with:
   - a 40 px `EntityAvatar` (`person={{ id: approval.aiId, name: aiName }}`, `ai`);
   - the summary (15 px, `numberOfLines={2}`) and, under it, "<aiName> · <groupName>" muted (or just the AI name);
   - two 40 px `IconButton`s: Deny (`X`, label "Deny: <summary>") and Approve (`Check`, primary look, label "Approve: <summary>"), calling `onDecide` with `deny` and `approve_once`;
   - the inline error under the row as today.
   - Remove the shield, the action, the "pending" badge, the details, the cost and the expiry.
   - Use `approval.aiName` when it is non-empty, otherwise the `aiName` prop.
4. **`pending-tab.tsx`:** wrap the rows in one rounded list (`overflow-hidden rounded-xl border border-divider bg-surface`, rows divided by a hairline), if it is not already one.

### Not in scope
- web;
- the rules section and always-allowed rows;
- machines;
- the server.

### Tests
None new. Keep `apps/mobile/src/components/approvals/rows.test.ts` passing.

### Allowed files
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/components/chat/approval-card.tsx`
- `apps/mobile/src/components/approvals/approval-row.tsx`
- `apps/mobile/src/components/approvals/pending-tab.tsx`
- `apps/mobile/src/components/approvals/format-relative.ts`
- `work/T-1513-mobile-approvals-simple.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The phone card:** "<AI> asks", the summary, Deny/Approve sharing the width, and "Always allow" under them only when eligible. A decided card is one line with an icon.
- **The Approvals screen:** one list of rows with avatar, summary, AI and group, and ✕/✓ icon keys.
- No money, action names, timers or status words.

---

## Report (written by the worker when done)

### What I did

The phone twin of T-1499, per the approved `PhoneCard.dc.html` / `PhoneInbox.dc.html`.

1. **`apps/mobile/src/lib/approvals-api.ts`** — `PublicApproval` gains `aiName: string`, `groupName: string | null` and `alwaysEligible: boolean`; `toPublicApproval` maps them with the defaults `''`, `null`, `false` (`?? ''` / `?? null` / `?? false`). The comment above the mapper now says the AI/group fields are shown.
2. **`apps/mobile/src/components/chat/approval-card.tsx`**
   - Title area is now a small muted label (`"<aiName> asks"`, else `"Approval"`) over the `data.summary` at 16 px semibold. Removed the `data.action` title, `data.details`, the `Max cost:` line and the `formatMoney` / `approvalStatusLabel` imports.
   - Pending: Deny (`outline`) and Approve (`key`) side by side, each `flex-1` `h-11` (44 px); under them a centred quiet `ghost` "Always allow", rendered only when `approval.alwaysEligible`. First tap arms ("Tap again to always allow"), second tap decides `approve_always`; busy labels kept (Denying… / Approving… / Allowing…). `inFlight` gained an `'always'` value.
   - Decided: a single row, a green `Check` (statuses that are not denied/expired, incl. `consumed`) or a red `X` (`denied`, `expired`), 14 px, then `data.summary` in muted 14 px. No status word.
3. **`apps/mobile/src/components/approvals/approval-row.tsx`** — the card is now a bare row (`flex-col`, hairline bottom divider unless it is the list's last row): a 40 px `EntityAvatar` (`person={{ id: approval.aiId, name }}`, `ai`), the summary at 15 px with `numberOfLines={2}`, and `"<aiName> · <groupName>"` muted below (just the AI name when there is no group). Name is `approval.aiName` when non-empty, else the `aiName` prop. Two 40 px icon keys: Deny (`IconButton`, `X`) and Approve (primary key look, `Check`), calling `onDecide` with `deny` / `approve_once`; inline error under the row as before. Removed the shield, the action, the "pending" badge, the details, the cost and the expiry.
4. **`apps/mobile/src/components/approvals/pending-tab.tsx`** — the rows are now one rounded list (`overflow-hidden rounded-xl border border-divider bg-surface`), rows divided by the row's own bottom hairline (the last row drops it).
5. **`apps/mobile/src/components/approvals/format-relative.ts`** — **deleted**. Its only exports (`expiresInText`, `worstCaseText`) had no callers once the row stopped showing the cost and the timer; same call as the web twin in T-1499.

### Checks run

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/approvals/rows.test.ts` — 1 file passed, 3 tests passed.
- `pnpm gate` (from the repo root), second run after one Prettier fix on `approval-card.tsx`:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (3.4s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The 6 changed files are exactly the allowed set: `approvals-api.ts`, `chat/approval-card.tsx`, `approvals/approval-row.tsx`, `approvals/pending-tab.tsx`, `approvals/format-relative.ts` (deleted) and this task file. No UI tests added (UI gets none).

### Notes for the lead

- **Deviation: the Approve key is not `IconButton`.** The mobile `IconButton` only has the dark icon-key look (no `variant` prop, unlike web's), and it is outside the Allowed files, so the Approve key is a local `PrimaryIconKey` in `approval-row.tsx` that applies `primaryKey` + its pressed shadow at the same 40 px / 12 radius, mirroring the primary icon keys elsewhere in the app (`voice-recording-row.tsx`, `group-topic-list.tsx`). The Deny key is the real `IconButton`. If you would rather add a `variant="primary"` to `IconButton` itself, that is a separate task (I stayed in scope).
- **Dead exports left untouched because their files are outside the Allowed set:** `SCREEN_DECISIONS` (`approvals/rows.ts`) and `approvalStatusLabel` (`lib/approval-state.ts`) now have no callers. Both are exported, so lint is clean; say the word and a follow-up can drop them.
- **`PendingTab` still accepts a `now: Date` prop** (the screen passes it and the screen is not in the Allowed files), but it is no longer destructured or used, with a one-line comment saying so. A follow-up could drop it from both the tab and `settings/approvals.tsx`.
- **Avatar is 40 px** as the spec's item 3 states; the inbox mockup draws a 36 px orb, so this is one deliberate deviation toward the written spec rather than the canvas. Easy to change to 36 if you prefer the canvas.
- `PublicApproval` still carries `worstCase`, `details` and `expiresAt` (wire data); nothing renders them.
- I did not run the phone smoke or any live check — this is UI-only and untested beyond the gate.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit and 2 follow-ups, for head `0ec10261f`.
- **Phone smoke (mock build, emulator):**
  - `/settings/approvals` and the Dev team General chat both pass;
  - the Approvals screen shows one row: the AI's picture, the summary in two lines, "Dev-1", and the 40 px ✕ and ✓ keys. No money, action name, timer or status word.
- **The card, in code:**
  - "<aiName> asks" (or "Approval"), the summary, and Deny/Approve sharing the width;
  - "Always allow" with the two-step "Tap again" only when `alwaysEligible`;
  - a decided card is a green `Check` or a red `X` plus the summary.
  - The smoke's chat screenshot opens at the bottom, so the card was not in view.
- **Follow-ups:** drop the unused `SCREEN_DECISIONS`, `approvalStatusLabel` and the `now` prop in the next approvals touch.
