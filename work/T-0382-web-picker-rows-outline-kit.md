---
id: T-0382
title: "Web kit: the add-member, add-AI and role picker rows in the Group, Channel and Topic panels use the kit outline Button"
status: merged
milestone: M5
branch: task/T-0382-web-picker-rows-outline-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0382: panel picker rows on the kit

## Spec (written by Claude, do not edit)

### Why
Five picker rows copy the same class, and that class is exactly the kit `outline` look (`border-border-strong bg-surface hover:bg-surface-raised`).

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - `outline` = `border-border-strong bg-surface text-foreground hover:bg-surface-raised` plus the kit focus ring;
  - the base classes include `inline-flex items-center justify-center` and a fixed height per size;
  - `cn` (tailwind-merge) lets a caller `className` override `h-*`, `justify-*`, `rounded-*`, `px-*` and `py-*`.
  All three files import `Button` from `./ui/button`.
- **The five rows** (the line is the `<button`). Each has `type="button"`, a `disabled` and an `onClick`, and each holds `Avatar`/name/badge or name/count children. Each uses the class `flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-2 py-1.5 text-left text-[14px]` plus `hover:bg-surface-raised disabled:opacity-50` (some through `cn`):

| File | Line | Row |
| --- | --- | --- |
| `apps/web/src/components/GroupPanel.tsx` | 434 | add an AI (`add(ai.id)`) |
| `apps/web/src/components/ChannelPanel.tsx` | 459 | add an AI (`add(ai.id)`) |
| `apps/web/src/components/TopicPanel.tsx` | 525 | add a member (`addMember(member.userId)`) |
| same | 685 | add an AI (`addAi(ai.id)`) |
| same | 1024 | toggle a role (`toggleRole(role.id)`) |

- **Tests:**
  - `apps/web/src/components/GroupPanel.test.tsx`;
  - `apps/web/src/components/Channels.test.tsx`;
  - `apps/web/src/components/InviteLinksSection.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx`.

  Keep every `key`, `disabled`, handler and the children, so accessible names stay the same.

### What to build
1. Replace each row with `<Button key=… type="button" variant="outline" disabled=… onClick=… className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal">`, with the same children.
2. Remove a `cn(...)` that only built this class. Keep the `cn` import if other code still uses it.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and each file around the lines above.

### Allowed files
`apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/Channels.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0382-web-picker-rows-outline-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel Channels InviteLinksSection ChatView
pnpm gate
```

### Acceptance
- No `border-border-strong bg-surface px-2 py-1.5` class string remains in the three files.
- No hand-rolled `<button` remains in `GroupPanel.tsx` or `ChannelPanel.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced the five picker rows with the kit outline `Button` (`variant="outline"`,
`className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"`),
keeping every `key`, `disabled`, handler and children unchanged:
- `apps/web/src/components/GroupPanel.tsx`: add-AI row (`add(ai.id)`); removed now-unused `cn` import.
- `apps/web/src/components/ChannelPanel.tsx`: add-AI row (`add(ai.id)`); no `cn` import existed.
- `apps/web/src/components/TopicPanel.tsx`: add-member (`addMember`), add-AI (`addAi`) and
  role-toggle (`toggleRole`) rows; removed now-unused `cn` import.

Checks:
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel Channels InviteLinksSection ChatView`: 4 files, 40 tests passed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests @zilar/web all PASS;
  scope: every changed file is inside the Allowed files; 4 changed files.
- Verified: no `border-border-strong bg-surface px-2 py-1.5` string and no hand-rolled
  `<button` remain in the three files.

Security checklist: no secrets/tokens touched; no deletes/updates, caps, permissions,
routes, or audit entries involved — not applicable.

## Review (written by Claude)

Approved (lead, 2026-10-06). The five picker rows are kit outline `Button` with the row-shape override (`h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal`); keys, disabled, handlers and children kept. Pre-review clean (0 findings).
