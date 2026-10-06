---
id: T-0420
title: "Mobile kit: the AI Tools/Routines/Activity empty and loading lines, and the Connections, Folders and Explore empty states use StateMessage"
status: todo
milestone: M5
branch: task/T-0420-mobile-empty-lines-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0420: empty lines on StateMessage (mobile)

## Spec (written by Claude, do not edit)

### Why
This is part of batch 28 of `docs/audit/ui-kit-leftovers.md`. The Stickers and Machines rows are left for later, because T-0418 is editing those files.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind: 'empty' | 'loading' | 'error', title, hint?, icon?: LucideIcon, action?: { label, onPress, accessibilityLabel? }, size?: 'block' | 'inline' })`;
  - `empty` uses an Inbox icon unless `icon` is given;
  - the action is an accent `sm` Button with only a text label, no icon;
  - `inline` is a small icon or spinner plus the title, with no action.
- **The places:**

| File | Lines | Today | Becomes |
| --- | --- | --- | --- |
| `apps/mobile/src/components/ais/tools-section.tsx` | 81 | `<Text className="px-2 text-[13px] text-muted-foreground">Loading…</Text>` | `StateMessage kind="loading" size="inline" title="Loading…"` |
| `apps/mobile/src/components/ais/tools-section.tsx` | 96 | the same style, with `{TOOLS_EMPTY_MESSAGE}` | `StateMessage kind="empty" size="inline" title={TOOLS_EMPTY_MESSAGE}` |
| `apps/mobile/src/components/ais/routines-section.tsx` | 215 | Loading line | inline loading |
| `apps/mobile/src/components/ais/routines-section.tsx` | 230 | `{ROUTINES_EMPTY_MESSAGE}` line | inline empty |
| `apps/mobile/src/components/ais/ai-activity.tsx` | 114 | `{ACTIVITY_EMPTY_MESSAGE}` line | inline empty (the loading skeleton at line 99 stays) |
| `apps/mobile/src/app/settings/connections.tsx` | 192-206 | the empty block: `KeyRound` icon (32), "No provider connections yet.", and a default `sm` Button "Add a connection" (`accessibilityLabel="Add a connection"`, `onPress={() => setShowForm(true)}`, with a Plus icon) | `StateMessage kind="empty" icon={KeyRound} title="No provider connections yet." action={{ label: 'Add a connection', accessibilityLabel: 'Add a connection', onPress: () => setShowForm(true) }}` |
| `apps/mobile/src/app/settings/folders.tsx` | 86 | `<Text className="text-[15px] text-muted-foreground">No folders yet.</Text>` | `StateMessage kind="empty" size="inline" title="No folders yet."` |
| `apps/mobile/src/app/explore.tsx` | 285-287 | `ListEmptyComponent` with `<View className="items-center px-6 pt-12"><Text …>{emptyLine}</Text></View>` | `ListEmptyComponent={<StateMessage kind="empty" title={emptyLine} />}` |

- **Tests:**
  - `apps/mobile/src/components/ais/tools-section.test.tsx`;
  - `apps/mobile/src/components/ais/routines-section.test.tsx`;
  - `apps/mobile/src/components/ais/ai-activity.test.tsx`;
  - `apps/mobile/src/components/connections/connections-screen.test.tsx`.

  Some may assert these exact texts. Keep the texts. Add mocks only if needed (`CircleAlert`, `Inbox` and `KeyRound` in the lucide mock; `DANGER` and `MUTED_FOREGROUND` in the colors mock), as T-0399 did.

### What to build
1. Apply the table.
2. Drop imports only when they become unused. Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, each file around its lines, and the four tests.

### Allowed files
`apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/routines-section.tsx`, `apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/app/settings/folders.tsx`, `apps/mobile/src/app/explore.tsx`, `apps/mobile/src/components/ais/tools-section.test.tsx`, `apps/mobile/src/components/ais/routines-section.test.tsx`, `apps/mobile/src/components/ais/ai-activity.test.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`, `work/T-0420-mobile-empty-lines-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-section routines-section ai-activity connections-screen
pnpm gate
```

### Acceptance
- The eight places are `StateMessage`s with the same texts and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
