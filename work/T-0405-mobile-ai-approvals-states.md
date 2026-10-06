---
id: T-0405
title: "Mobile kit: the AIs tab, AI detail and Approvals screens' loading and error states use StateMessage"
status: merged
milestone: M5
branch: task/T-0405-mobile-ai-approvals-states
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0405: AI and Approvals states on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0398 and T-0399 (merged), on the AI screens and Approvals.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?: { label, onPress, accessibilityLabel? }, size?: 'block' | 'inline' })`;
  - the block `loading` is a labelled spinner plus the title;
  - the block `error` has the alert role, a red icon, the title, an optional hint and an optional accent `Button size="sm"` action;
  - `inline` is a small spinner or icon plus the title, with no action.
- **`apps/mobile/src/app/(tabs)/ais.tsx`:**
  - lines 167-172: loading `View` with `ActivityIndicator` and "Loading…";
  - lines 174-187: error `View` with an alert `Text` `{errorInfo.message}`, an optional muted line "AI management is not available on this server." when `errorInfo.unavailable`, and an outline Retry `Button` (with a `RefreshCw` icon) calling `reload`.
- **`apps/mobile/src/app/ais/[id].tsx`:**
  - lines 243-247: loading block ("Loading…");
  - lines 248-255: error block with `{loadError}` and an outline Retry calling `retry`.
- **`apps/mobile/src/app/settings/approvals.tsx`:**
  - `ApprovalsBody`, lines 322-327: loading block ("Loading…");
  - lines 329-337: error block with `{errorMessage}` and an outline Retry calling `() => void load(true)`;
  - `RulesSection` (line 428), lines 447-451: inline `<Text role="status" …>Loading…</Text>`. Its error block (lines 452-461) stays as it is, because inline `StateMessage` has no action.
- No test imports these three screens directly (checked with grep). The gate still runs every mobile test. If a test fails through a transitive import (as in T-0346, T-0384 and T-0399), stop and report it as BLOCKED with the file name.

### What to build
1. **AIs tab:**
   - `<StateMessage kind="loading" title="Loading…" />`;
   - `<StateMessage kind="error" title={errorInfo.message} hint={errorInfo.unavailable ? 'AI management is not available on this server.' : undefined} action={{ label: 'Retry', onPress: reload }} />`.
2. **AI detail:** `<StateMessage kind="loading" title="Loading…" />` and `<StateMessage kind="error" title={loadError} action={{ label: 'Retry', onPress: retry }} />`.
3. **Approvals body:** the same, with `onPress: () => void load(true)`.
4. **RulesSection:** `<StateMessage kind="loading" size="inline" title="Loading…" />`.
5. Keep the conditions. Drop imports (`ActivityIndicator`, `RefreshCw`, `ACCENT`) only if they become unused.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, and each screen around the lines above.

### Allowed files
`apps/mobile/src/app/(tabs)/ais.tsx`, `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/app/settings/approvals.tsx`, `work/T-0405-mobile-ai-approvals-states.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The four places use `StateMessage` with the same texts and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the four hand-rolled loading/error blocks with `StateMessage`, keeping the same conditions, texts and handlers:

- `apps/mobile/src/app/(tabs)/ais.tsx`: loading block -> `<StateMessage kind="loading" title="Loading…" />`; error block -> `<StateMessage kind="error" title={errorInfo.message} hint={errorInfo.unavailable ? 'AI management is not available on this server.' : undefined} action={{ label: 'Retry', onPress: reload }} />`.
- `apps/mobile/src/app/ais/[id].tsx`: loading -> `<StateMessage kind="loading" title="Loading…" />`; error -> `<StateMessage kind="error" title={loadError} action={{ label: 'Retry', onPress: retry }} />`.
- `apps/mobile/src/app/settings/approvals.tsx`: `ApprovalsBody` loading/error use `StateMessage` with `action={{ label: 'Retry', onPress: () => void load(true) }}`; `RulesSection` uses `<StateMessage kind="loading" size="inline" … />`. Its error block is unchanged as specified.
- Removed imports that became unused: `ActivityIndicator` and `RefreshCw` in `ais.tsx`; `ActivityIndicator`, `ACCENT`, `asColorScheme`, `useColorScheme` and the `scheme` const in `ais/[id].tsx`; `ActivityIndicator` in `approvals.tsx`. `ACCENT`/`ICON` are still used elsewhere in `ais.tsx`, and `ACCENT` is still used in `approvals.tsx` (empty state), so those stayed.

### Files changed
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/settings/approvals.tsx`
- `work/T-0405-mobile-ai-approvals-states.md` (status + this Report)

### Commands and results
- `pnpm install`: done, exit 0 (1 warning about an unmet peer `@types/react@^19.3.0` vs 19.2.18, pre-existing).
- Single test files: none — no test imports these three screens (as noted in the spec), so there was no focused file to run.
- `pnpm gate` (final, from repo root) summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (14.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (8.2s)
  PASS  tests @zilar/mobile  (2.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Two earlier gate runs failed and were fixed before the pass: `FAIL format` (Prettier wanted the inline `RulesSection` ternary on one line) and `FAIL lint` (`scheme` in `ais/[id].tsx` became unused once `ACCENT` was dropped), both corrected within scope.

### Problems / deviations
- None affecting the acceptance criteria. The only extra removals beyond the spec's named imports (`useColorScheme`, `asColorScheme`, `scheme`) were required by lint because removing `ACCENT` left them unused.

### Open questions
- None.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. All four places now use StateMessage with the same texts and handlers. The "not available on this server" line is now the hint. RulesSection loading is inline, and its error block stays as it was.
