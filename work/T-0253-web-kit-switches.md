---
id: T-0253
title: "Web kit migration 1: every hand-rolled on/off control uses the kit Switch; Notifications sections use Card and SectionLabel"
status: merged
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

Status: done. `pnpm gate` ends with **GATE PASS** and lists no file outside the Allowed files.

### What I changed
1. **Kit `Switch`** (`ui/switch.tsx`): added `hideLabel?: boolean`. When true the `<label>` is not rendered and the button gets `aria-label={label}`; otherwise the accessible name still comes from the visible `<label htmlFor>`.
2. **Fixture + kit test**: added a `HiddenLabel` fixture case (with `hideLabel` passed through `Toggle`) and a `kit.test.tsx` case asserting the hidden-label switch still exposes its name via `getByRole('switch', { name })` and that no visible label text is rendered.
3. **`FolderEditorDialog.tsx`**: deleted the private `Switch` function and its now-unused styling; imported the kit `Switch` and switched the three call sites (`Groups`/type rows, `Muted chats`, `Read chats`) to `hideLabel` + `onCheckedChange`. Tests unchanged and passing (`Groups`, `Personal chats` still resolve by role/name).
4. **`GroupPanel.tsx`**: replaced the inline `role="switch"` button with the kit `Switch` (`hideLabel`, `disabled={switchBusy}`); the row keeps its own "Members can create topics" text. `TopicPanel.test.tsx`'s `getByRole('switch', { name: 'Members can create topics' })` still passes.
5. **`NotificationsPage.tsx`**: "Message previews" now uses the kit `Switch` labelled "Show the first lines of new messages in notifications"; every section `<h2>` is now `SectionLabel`, and each section's bordered rows live in one `Card` with `divide-y divide-divider`. Behaviour, texts and `aria-label`s are unchanged.
6. **`NotificationsPage.test.tsx`**: previews assertion moved from `getByRole('checkbox')` to `getByRole('switch', { name: 'Show the first lines of new messages in notifications' })`.

### Files changed
`apps/web/src/components/ui/switch.tsx`, `apps/web/src/components/ui/switch.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/routes/NotificationsPage.test.tsx`, `work/T-0253-web-kit-switches.md`. No test file was changed for `FolderEditorDialog` or `GroupPanel` (they stayed green unchanged). `pnpm-lock.yaml` untouched.

### Commands and real results
- `pnpm install` — done, workspace linked (v10.32.1).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit FolderEditorDialog GroupPanel NotificationsPage fixtures` — **5 files passed, 123 tests passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot TopicPanel` (extra: that file asserts the GroupPanel topic switch) — **1 file passed, 26 tests passed**.
- `pnpm gate` — first run **GATE FAIL** on `format` (`apps/web/src/routes/NotificationsPage.tsx`), scope otherwise clean. Ran `pnpm exec prettier --write apps/web/src/routes/NotificationsPage.tsx`, then re-ran gate:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (12.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.6s)
  PASS  tests @zilar/web  (22.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `grep -rn 'role="switch"' apps/web/src` — one hit only: `apps/web/src/components/ui/switch.tsx:27`.

### Deviations / notes
- In the Notifications "Devices" section I kept the `<ul>`/`<li>` list and put `divide-y divide-divider` on the `ul` inside the `Card`, instead of turning each device into a direct `Card` child. This preserves list semantics while still giving one card with split rows. Visual result is the same (`--divider` and `--border` are the same value).
- `TopicPanel.test.tsx` is not in the Allowed files and was not edited; I ran it only to confirm the GroupPanel migration did not break it.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (1 nit: an unused `id` when `hideLabel` is set, harmless).
- Only `components/ui/switch.tsx` still has `role="switch"`.
- I checked in the browser: in mock mode, the Notifications page shows the uppercase section labels, a card per section, and the kit switch for message previews.
