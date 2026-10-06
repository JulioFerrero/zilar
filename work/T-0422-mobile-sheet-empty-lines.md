---
id: T-0422
title: "Mobile kit: the topic info, invite links and group roles sheets' empty lines use StateMessage"
status: todo
milestone: M5
branch: task/T-0422-mobile-sheet-empty-lines
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0422: sheet empty lines on StateMessage (mobile)

## Spec (written by Claude, do not edit)

### Why
This is part of batch 28 of `docs/audit/ui-kit-leftovers.md`. T-0420 did the AI sections, Connections, Folders and Explore.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:** `StateMessage({ kind, title, size?: 'block' | 'inline', … })`. `inline` is a small Inbox icon plus the title (`text-[13px]` muted), in a row with `px-2 py-1.5`.
- **The lines, all plain `Text`:**

| File | Lines | Text |
| --- | --- | --- |
| `apps/mobile/src/components/chat/topic-sheets.tsx` | 254-256 | "No AIs here yet." (`py-1 text-[14px] text-muted-foreground`) |
| `apps/mobile/src/components/chat/topic-sheets.tsx` | 286-290 | "No roles here yet — only the people above can see this topic." |
| `apps/mobile/src/components/chat/invite-links-sheet.tsx` | 231-232 | "No invite links yet." |
| `apps/mobile/src/components/chat/group-roles-sheet.tsx` | 132-136 | "No roles yet. Roles grant private-topic access and approver rights." |

- **Imports:** none of these three files imports `StateMessage` yet.
- **Tests** (they render these sheets and may match the texts; keep them):
  - `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`;
  - `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-load.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`.

  The mocks a test may need for `StateMessage`: `CircleAlert` and `Inbox` in the lucide mock; `DANGER` and `MUTED_FOREGROUND` in the colors mock; `ActivityIndicator` in the react-native mock. See `apps/mobile/src/components/ais/tools-section.test.tsx` after T-0420.

### What to build
1. Replace each of the four `Text`s with `<StateMessage kind="empty" size="inline" title="<same text>" />`.
2. Keep the conditions, and add the import.
3. Add mocks only where tests need them. Change no assertion. Grep one level up for other tests that import these files; if one outside the Allowed files breaks, stop and report BLOCKED with the file name.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, each file around its lines, and the five tests.

### Allowed files
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `work/T-0422-mobile-sheet-empty-lines.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-sheets invite-links-sheet group-roles
pnpm gate
```

### Acceptance
- The four lines are inline empty `StateMessage`s with the same texts.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
