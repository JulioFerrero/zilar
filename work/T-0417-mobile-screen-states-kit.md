---
id: T-0417
title: "Mobile kit: Explore, the user page, the Profile tab and New AI loading/error states use StateMessage"
status: todo
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

## Review (written by Claude)
