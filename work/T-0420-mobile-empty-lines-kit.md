---
id: T-0420
title: "Mobile kit: the AI Tools/Routines/Activity empty and loading lines, and the Connections, Folders and Explore empty states use StateMessage"
status: merged
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

Status: **review** — done. `pnpm gate` is green and its scope line names no file outside the Allowed files.

### What I did
Applied the spec table; all eight places are now `StateMessage`s with the same texts and handlers:
- `apps/mobile/src/components/ais/tools-section.tsx` — loading → `kind="loading" size="inline" title="Loading…"`; empty → `kind="empty" size="inline" title={TOOLS_EMPTY_MESSAGE}`.
- `apps/mobile/src/components/ais/routines-section.tsx` — loading → inline loading; empty → `kind="empty" size="inline" title={ROUTINES_EMPTY_MESSAGE}`.
- `apps/mobile/src/components/ais/ai-activity.tsx` — empty → `kind="empty" size="inline" title={ACTIVITY_EMPTY_MESSAGE}`. The loading `ActivitySkeleton` at line 99 was left untouched.
- `apps/mobile/src/app/settings/connections.tsx` — the empty block → `StateMessage kind="empty" icon={KeyRound} title="No provider connections yet." action={{ label: 'Add a connection', accessibilityLabel: 'Add a connection', onPress: () => setShowForm(true) }}`; dropped the now-unused `ACCENT_FOREGROUND` import (`ICON`, `Plus` and `KeyRound` are still used elsewhere).
- `apps/mobile/src/app/settings/folders.tsx` — empty → `kind="empty" size="inline" title="No folders yet."`.
- `apps/mobile/src/app/explore.tsx` — `ListEmptyComponent={<StateMessage kind="empty" title={emptyLine} />}`.
- No import that is still used was dropped; `Text` remains used in every file.

### Deviation from the spec (one line, flagged)
- `apps/mobile/src/components/connections/connections-screen.test.tsx`: the spec says "Change no assertion", but its own table removes the Plus icon from the "Add a connection" button, and the T-0341 assertion `expect(html).toMatch(/<Plus[^>]*color="#0a0a0a"/)` checked exactly that removed icon. I removed only that one line; the surrounding text assertions ("No provider connections yet", "Add a connection", no `#fff`) are unchanged. Leaving it would have made `pnpm gate` red. If the lead wants the Plus kept instead, the table's `StateMessage` action (text-only button) must change — that is a decision I did not want to make on my own.

### Tests / mocks
Only mocks were added to the three component tests, no assertions changed there:
- `tools-section.test.tsx`: `nativewind` `useColorScheme`, `ActivityIndicator` in the `react-native` mock, and `CircleAlert`/`Inbox` in a new `lucide-react-native` mock (StateMessage's new imports).
- `routines-section.test.tsx`: same three additions.
- `ai-activity.test.tsx`: added `CircleAlert`/`Inbox` to its existing `lucide-react-native` mock.
- `connections-screen.test.tsx`: its mocks already had `CircleAlert`, `Inbox`, `KeyRound`, `DANGER`, `MUTED_FOREGROUND`, so no mocks were needed there.

### Files changed (11, all in Allowed files)
`tools-section.tsx`, `tools-section.test.tsx`, `routines-section.tsx`, `routines-section.test.tsx`, `ai-activity.tsx`, `ai-activity.test.tsx`, `connections.tsx`, `connections-screen.test.tsx`, `folders.tsx`, `explore.tsx`, this task file.

### Commands and real results
- `pnpm install` → Done, exit 0 (pre-existing `@types/react-dom` peer warning only).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot tools-section routines-section ai-activity connections-screen` → **Test Files 4 passed (4), Tests 63 passed (63)** (only the usual "incorrect casing" stderr noise from the string mocks).
- `pnpm gate` (repo root):
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (11.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (6.1s)
  PASS  tests @zilar/mobile  (2.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Open questions
- The one deviation above: is dropping the T-0341 Plus-colour assertion acceptable, or should the empty state keep its Plus (which would require changing the spec's `StateMessage` call)?

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean.
- The eight places are StateMessages with the same texts and handlers.
- The one removed assertion (the T-0341 Plus colour) checked the icon that my own spec takes out of the empty-state button, so the removal is right. The spec conflict was mine.
