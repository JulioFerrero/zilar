---
id: T-0422
title: "Mobile kit: the topic info, invite links and group roles sheets' empty lines use StateMessage"
status: merged
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
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx` (mocks only; lead, 2026-10-06), `work/T-0422-mobile-sheet-empty-lines.md`.

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

**Status: review** — the one out-of-scope break was resolved after the lead added
`apps/mobile/src/components/chat/topic-actions-sheet.test.tsx` (mocks only) to the Allowed
files (see Resolution). The final gate ends with GATE PASS.

### What I did
Replaced the four empty lines with `<StateMessage kind="empty" size="inline" title="…" />`
and added the import to each file. Conditions and texts are unchanged; no assertion changed.
- `apps/mobile/src/components/chat/topic-sheets.tsx`: "No AIs here yet." (was 254–256) and
  "No roles here yet — only the people above can see this topic." (was 286–290).
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`: "No invite links yet." (was 231–232).
- `apps/mobile/src/components/chat/group-roles-sheet.tsx`: "No roles yet. Roles grant
  private-topic access and approver rights." (was 132–136).

### Test mocks updated (all inside the Allowed files)
`StateMessage` reads `Inbox`/`CircleAlert` at module load and `ActivityIndicator` at render,
so the tests that load these modules needed the mocks:
- `topic-sheets-roles.test.tsx`: lucide `CircleAlert`+`Inbox`; RN `ActivityIndicator`; colors `DANGER`.
- `group-roles-sheet.test.tsx`: lucide `CircleAlert`+`Inbox`; RN `ActivityIndicator`.
- `group-roles-load.test.tsx`, `group-roles-mounted.test.tsx`: lucide `CircleAlert`+`Inbox`.
- `invite-links-sheet.test.tsx`: added the missing lucide mock (`CircleAlert`+`Inbox`) and
  RN `ActivityIndicator`; without it the real `lucide-react-native` was loaded and failed with
  `SyntaxError: Unexpected token 'typeof'`.
- `topic-actions-sheet.test.tsx` (added to Allowed files by the lead, mocks only): lucide
  `CircleAlert`+`Inbox`.

### Commands and real results
- `pnpm install`: OK, `Done in 12.6s`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-sheets invite-links-sheet group-roles`:
  `Test Files 5 passed (5)`, `Tests 33 passed (33)`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-actions-sheet`:
  `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` (final, after the Resolution):
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (19.7s)
PASS  lint  (0.9s)
PASS  typecheck  (6.1s)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Resolution
Before the fix, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx` imported
`./topic-sheets`, which now imports `StateMessage`; its lucide mock exported only `Check` and
`Lock`, so loading `topic-sheets` threw `No "Inbox" export is defined on the "lucide-react-native"
mock`. The lead added that test file to the Allowed files (mocks only). I added
`CircleAlert: 'CircleAlert'` and `Inbox: 'Inbox'` to its lucide mock (lines 47–53). No assertion
changed, and no colors or react-native additions were needed. Gate now ends with GATE PASS and
lists no file outside the Allowed files.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean.
- The four lines are inline empty StateMessages with the same texts.
- The test changes are mocks only.
- `topic-actions-sheet.test.tsx` was allowed after a valid block: it imports `topic-sheets.tsx`, a transitive importer the spec missed.
