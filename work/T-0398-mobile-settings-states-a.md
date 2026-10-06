---
id: T-0398
title: "Mobile kit: the Requests, Blocked and Connections settings screens' loading and error states use StateMessage"
status: todo
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

## Review (written by Claude)
