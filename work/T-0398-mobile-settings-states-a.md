---
id: T-0398
title: "Mobile kit: the Requests, Blocked and Connections settings screens' loading and error states use StateMessage"
status: merged
milestone: M5
branch: task/T-0398-mobile-settings-states-a
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0398: settings states on the kit (Requests, Blocked, Connections)

## Spec (written by Claude, do not edit)

### Why
The mobile settings screens copy the same loading block (spinner and line) and error block (alert text and Retry). T-0386 and T-0393 added the kit `StateMessage` for this.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?: { label, onPress, accessibilityLabel? }, size? })`;
  - `loading` is an `ActivityIndicator` labelled with the title, followed by the title text;
  - `error` puts `accessibilityRole="alert"` on its root, with a red `CircleAlert` and the title;
  - the action is a kit `Button size="sm"` (accent) with the label inside `<Text>` and the optional `accessibilityLabel`.
- **The blocks.** Each one is a loading `View` (`items-center gap-3 pt-16`, an `ActivityIndicator` and a muted `Text`) and an error `View` (`items-center gap-3 pt-12`, `<Text accessibilityRole="alert" className="… text-danger">{error}</Text>` and a Retry button with a `RefreshCw` icon):

| File | Loading line | Loading text | Error line | Retry label | Retry today |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/app/settings/requests.tsx` | 132 | "Loading requests…" | 139 | "Retry loading requests" | kit `Button variant="outline" size="sm"` |
| `apps/mobile/src/app/settings/blocked.tsx` | 114 | "Loading blocked people…" | 121 | "Retry loading blocked people" | raw `Pressable` |
| `apps/mobile/src/app/settings/connections.tsx` | 185 | "Loading connections…" | 192 | "Retry loading connections" | read it |

- **Tests:**
  - `apps/mobile/src/components/contacts/requests-screen.test.tsx`;
  - `apps/mobile/src/components/contacts/blocked-screen.test.tsx`;
  - `apps/mobile/src/components/connections/connections-screen.test.tsx`.

  They may match the texts and the retry labels. Keep both.

### What to build
1. In each screen, replace the loading `View` with `<StateMessage kind="loading" title="<same text>" />`.
2. Replace the error `View` with `<StateMessage kind="error" title={error} action={{ label: 'Retry', accessibilityLabel: '<same label>', onPress: <same handler> }} />`.
3. Keep the `status === …` conditions. Drop imports that become unused (`ActivityIndicator`, `RefreshCw`, `Pressable`) only where nothing else uses them.
4. The Retry turns from outline into the kit accent `sm` Button. That is intended: the kit's action style is the same on every screen.
5. Add mocks only where tests need them (`CircleAlert`/`Inbox` in lucide mocks, `useColorScheme`, and so on). Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, each screen around the lines above, and the three tests.

### Allowed files
`apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/components/contacts/requests-screen.test.tsx`, `apps/mobile/src/components/contacts/blocked-screen.test.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`, `work/T-0398-mobile-settings-states-a.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot requests-screen blocked-screen connections-screen
pnpm gate
```

### Acceptance
- The three screens' loading and error blocks are `StateMessage`s with the same texts and retry labels.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the hand-rolled loading and error blocks on the three settings screens with the kit `StateMessage`:

- `apps/mobile/src/app/settings/requests.tsx`
  - loading: `<StateMessage kind="loading" title="Loading requests…" />`
  - error: `kind="error"`, `title={error}`, action `{ label: 'Retry', accessibilityLabel: 'Retry loading requests', onPress: reload }`
  - dropped now-unused `ActivityIndicator` and `RefreshCw`; added the `StateMessage` import. `Button`, `View`, `Text`, `ICON`/`scheme` are still used elsewhere.
- `apps/mobile/src/app/settings/blocked.tsx`
  - loading: `<StateMessage kind="loading" title="Loading blocked people…" />`
  - error: `kind="error"`, `title={error}`, action `{ label: 'Retry', accessibilityLabel: 'Retry loading blocked people', onPress: reload }`
  - dropped now-unused `ActivityIndicator`, `Pressable` and `RefreshCw` (the raw `Pressable` retry was their only use); added the `StateMessage` import. `Button` is still used by the rows.
- `apps/mobile/src/app/settings/connections.tsx`
  - loading: `<StateMessage kind="loading" title="Loading connections…" />`
  - error: `kind="error"`, `title={errorInfo.message}`, action `{ label: 'Retry', accessibilityLabel: 'Retry loading connections', onPress: reload }`
  - dropped now-unused `ActivityIndicator`, `RefreshCw` and the `ACCENT` color import; added the `StateMessage` import. `Pressable`, `View`, `Text`, `Button` are still used elsewhere.

As specified, Retry now uses the kit accent `sm` button (via `StateMessage`'s action) on all three screens instead of outline / raw `Pressable`. The `status === …` conditions and all texts and accessibility labels are unchanged.

### Test mocks
The three tests render the screens through `react-native`/lucide stubs, so `StateMessage` needs its own imports present:

- all three: added `CircleAlert` and `Inbox` to the lucide mock (used by `StateMessage`'s error/empty icons), added `DANGER` to the `@/lib/colors` mock, and removed the now-unused `RefreshCw` lucide entry the screens no longer import;
- `blocked-screen.test.tsx`: also added `MUTED_FOREGROUND` to the colors mock (`StateMessage` reads it while loading; without it the loading render would throw).

No assertion was changed.

### Commands and real results
- `pnpm install`: succeeded, "Done in 27.3s" (pre-existing peer warning `@types/react-dom 19.3.0` wants `@types/react ^19.3.0`, found `19.2.18`; unrelated to this task).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot requests-screen blocked-screen connections-screen`: **3 test files passed, 28 tests passed** (1.14s). The `<Text /> is using incorrect casing` lines are the usual warnings from the string stubs, not failures.
- `pnpm gate` (1st run): `GATE FAIL` — `FAIL format`, Prettier flagged `connections.tsx` and `requests.tsx`. I fixed only those two files with `pnpm exec prettier --write apps/mobile/src/app/settings/{requests,connections}.tsx` (it collapsed the now-short lucide import and the loading ternary); no logic changed.
- `pnpm gate` (2nd run): **GATE PASS**, summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (30.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (12.1s)
  PASS  tests @zilar/mobile  (3.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed
Screens: `apps/mobile/src/app/settings/requests.tsx`, `blocked.tsx`, `connections.tsx`.
Tests: `apps/mobile/src/components/contacts/requests-screen.test.tsx`, `apps/mobile/src/components/contacts/blocked-screen.test.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`.
Task file: `work/T-0398-mobile-settings-states-a.md` (status + this report).

### Problems / deviations
None. No blocked/decision items.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. All three screens now use StateMessage, with the same texts and retry labels. The test changes are mocks only. Retry is now the kit accent `sm` button, as the spec asked.
