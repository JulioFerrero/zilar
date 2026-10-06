---
id: T-0417
title: "Mobile kit: Explore, the user page, the Profile tab and New AI loading/error states use StateMessage"
status: merged
milestone: M5
branch: task/T-0417-mobile-screen-states-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0417: four screens' states on StateMessage (mobile)

## Spec (written by Claude, do not edit)

### Why
These rows come from batch 24 of `docs/audit/ui-kit-leftovers.md`. The same migration was done in T-0398, T-0399 and T-0405.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?: { label, onPress, accessibilityLabel? }, size? })`;
  - block `loading` is a labelled spinner plus the title; block `error` is the alert role, a red icon, the title and an optional accent `sm` Button action (label inside `<Text>`); `empty` uses an Inbox icon.
- **`apps/mobile/src/app/explore.tsx`:**
  - lines 239-244: loading `View` (`ActivityIndicator color="#ededed"`, "Searching…");
  - lines 246-261: error `View` with an alert `{errorMessage}` and a raw `Pressable` Retry (`accessibilityLabel="Retry"`, `onPress={reload}`, `RefreshCw` icon).
- **`apps/mobile/src/app/u/[handle].tsx`:**
  - lines 211-216: loading ("Loading…");
  - lines 217-222: missing, `<Text …>{NO_USER_MESSAGE}</Text>`;
  - lines 223-232: error, `{error}` plus `<IconButton label="Retry loading the profile" onPress={load}>`.
- **`apps/mobile/src/app/(tabs)/profile.tsx`:**
  - lines 164-169: loading ("Loading…");
  - lines 170-184: error "Could not load your profile." plus a raw `Pressable` Retry (`accessibilityLabel="Retry"`, `onPress={load}`).
- **`apps/mobile/src/app/ais/new.tsx`:**
  - lines 165-175: loading ("Loading…" inside `AisScreenShell`);
  - lines 177-187: error `{loadError.message}` plus an outline `Button` Retry (`onPress={retryConnections}`).
- No test imports these four screens (checked with grep). The gate still runs every mobile test. If a test fails through a transitive import, stop and report BLOCKED with the file name.

### What to build
1. **Loading blocks:** replace each one with `<StateMessage kind="loading" title="<same text>" />`.
2. **Error blocks:** replace each one with `<StateMessage kind="error" title={<same text>} action={{ label: 'Retry', onPress: <same handler>, accessibilityLabel: <the old label when it differed from "Retry", e.g. 'Retry loading the profile'> }} />`.
3. **User page "missing" state:** `<StateMessage kind="empty" title={NO_USER_MESSAGE} />`.
4. Keep every condition and the shells (`AisScreenShell`, `ScrollView` padding). Drop imports (`ActivityIndicator`, `RefreshCw`, `Pressable`, `IconButton`, `ACCENT`, the `scheme` variable) only when they become unused, which lint will flag.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, and each screen around the lines above.

### Allowed files
`apps/mobile/src/app/explore.tsx`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`, `apps/mobile/src/app/ais/new.tsx`, `work/T-0417-mobile-screen-states-kit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The four screens' loading and error blocks (and the user page's missing state) are `StateMessage`s, with the same texts and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the loading and error blocks on the four screens (plus the user page's
missing state) with `StateMessage`, keeping every condition, the shells and the
handlers:

- `apps/mobile/src/app/explore.tsx`
  - loading → `<StateMessage kind="loading" title="Searching…" />`.
  - error → `<StateMessage kind="error" title={errorMessage} action={{ label: 'Retry', onPress: reload }} />` (the old label was `Retry`, so `accessibilityLabel` was omitted).
  - Dropped the now-unused `RefreshCw` (lucide) and `ActivityIndicator` (react-native) imports. `scheme`, `ICON`, `Pressable` and `IconButton` are still used elsewhere.
- `apps/mobile/src/app/u/[handle].tsx`
  - loading → `StateMessage kind="loading" title="Loading…"`.
  - missing → `StateMessage kind="empty" title={NO_USER_MESSAGE}`.
  - error → `StateMessage kind="error" title={error}` with `action={{ label: 'Retry', onPress: load, accessibilityLabel: 'Retry loading the profile' }}`.
  - Dropped the unused `RefreshCw` and `ActivityIndicator`; kept `IconButton`, `scheme` and `ICON` (still used by the back button).
- `apps/mobile/src/app/(tabs)/profile.tsx`
  - loading → `StateMessage kind="loading" title="Loading…"`.
  - error → `StateMessage kind="error" title="Could not load your profile." action={{ label: 'Retry', onPress: load }}`.
  - Dropped the unused `ActivityIndicator`, `Pressable`, `ACCENT`, `asColorScheme`, `useColorScheme` and the `scheme` variable.
- `apps/mobile/src/app/ais/new.tsx`
  - loading → `StateMessage kind="loading" title="Loading…"` inside `AisScreenShell`.
  - error → `StateMessage kind="error" title={loadError.message} action={{ label: 'Retry', onPress: retryConnections }}` inside `AisScreenShell`.
  - Dropped the unused `ActivityIndicator`. Left the earlier "AI management is not available on this server." block untouched, as the spec only lists the loading and error blocks.

### Commands run
- `pnpm install`: done, no changes.
- `pnpm gate` (run 1): `GATE FAIL` — `format` flagged `apps/mobile/src/app/u/[handle].tsx`. Fixed with `pnpm exec prettier --write "apps/mobile/src/app/u/[handle].tsx"`.
- `pnpm gate` (run 2): `GATE PASS`. Summary lines:
  ```text
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (11.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (6.5s)
  PASS  tests @zilar/mobile  (2.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file was run: no test imports these four screens (per the spec), so the narrowest run was the gate's mobile suite, which passed.

### Problems / deviations / open questions
None. Every changed file is inside the Allowed files.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean.
- The four screens use StateMessage with the same texts and handlers.
- The user page keeps "Retry loading the profile" as the accessibility label.
- The missing state is an empty StateMessage.
