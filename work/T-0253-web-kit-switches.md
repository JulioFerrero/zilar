---
id: T-0253
title: "Web kit migration 1: every hand-rolled on/off control uses the kit Switch; Notifications sections use Card and SectionLabel"
status: todo
milestone: M5
branch: task/T-0253-web-kit-switches
model: auto
effort: low
depends_on: [T-0243, T-0246]
estimate: 0.3 day
---

# T-0253: web toggles on the kit Switch

## Spec (written by Claude, do not edit)

### Why
This is the first kit migration task (audit `docs/audit/ui-kit-audit.md` section 5, step 4). The kit has `Switch`, `Card` and `SectionLabel` (T-0243, T-0246), but three screens still hand-roll their switches, each with a different look.

### Verified facts (do not re-derive)
- The kit `Switch`, in `apps/web/src/components/ui/switch.tsx` lines 4-40:
  - props `checked`, `onCheckedChange`, `label`, `disabled`;
  - renders a `role="switch"` button plus a visible `<label htmlFor>`;
  - the fixture is `apps/web/src/components/ui/switch.fixture.tsx`, and the kit tests are in `apps/web/src/components/ui/kit.test.tsx`.
- `Card` and `SectionLabel` are in `apps/web/src/components/ui/card.tsx`; `SectionLabel` is at line 24.
- Hand-rolled switches:
  - `apps/web/src/components/FolderEditorDialog.tsx` lines 352-383: a private `function Switch({ checked, label, onChange })` with no visible label (aria-label only). Tests click `getByRole('switch', { name: 'Groups' })` (`FolderEditorDialog.test.tsx` lines 51 and 74).
  - `apps/web/src/components/GroupPanel.tsx` lines 590-610: "Members can create topics", an inline `role="switch"` button inside a `<label>` that shows its own text. It uses `disabled={switchBusy}`.
  - `apps/web/src/routes/NotificationsPage.tsx` lines 467-482: "Message previews" uses `<input type="checkbox">` as an on/off control. Its test uses `getByRole('checkbox')` (`NotificationsPage.test.tsx` lines 269-271).
- Notifications sections are `<section>` elements with an `<h2 className="text-[16px] font-semibold">` (lines 371, 385, 405, 432, 468, 486) and bordered `rounded-xl border-border bg-surface` rows.
- Not in scope: the checkboxes in multi-select lists (`FolderEditorDialog.tsx` line 449, `GroupPanel.tsx` line 885, `NewTopicDialog.tsx`, `NewGroupDialog.tsx`). These are selections, not on/off settings.

### What to build
1. **Kit Switch:** add `hideLabel?: boolean`. When true, no visible label is rendered and the button gets `aria-label={label}`. Add a `HiddenLabel` fixture case and a kit test for it.
2. **FolderEditorDialog:** delete the private `Switch` and use the kit `Switch` with `hideLabel`. The existing tests stay unchanged and pass.
3. **GroupPanel:** the topic switch becomes the kit `Switch` with `hideLabel` (the row keeps its own text) and `disabled={switchBusy}`. Its test asserts the switch by role and name.
4. **NotificationsPage:**
   - "Message previews" becomes a kit `Switch` with the label "Show the first lines of new messages in notifications". Update its test from `checkbox` to `switch`.
   - Each section heading becomes `SectionLabel`, and each section's bordered rows sit in one `Card` (rows split by `divide-y divide-divider`).
   - Behaviour and texts stay the same; only the look changes.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/switch.tsx`, `apps/web/src/components/ui/card.tsx`, `docs/audit/ui-kit-audit.md` (sections 2a and 5).

### Allowed files
`apps/web/src/components/ui/switch.tsx`, `apps/web/src/components/ui/switch.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/routes/NotificationsPage.test.tsx`, `work/T-0253-web-kit-switches.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit FolderEditorDialog GroupPanel NotificationsPage fixtures
pnpm gate
```

### Acceptance
- No `role="switch"` remains outside `components/ui/switch.tsx` in `apps/web/src` (`grep -rn 'role="switch"' apps/web/src` shows only the kit and tests).
- The three screens toggle as before, with the same labels.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The multi-select checkboxes, the Notifications device rows' buttons, and the other settings pages (later migration tasks).

---

## Report (written by the worker when done)

## Review (written by Claude)
