---
id: T-1659
title: "Phone: Android back cancels an armed reply or edit before it closes the chat (web Escape parity, parity audit gap 14) — one small use-back-cancel hook used by ReplyBar, EditBar and the existing SelectionBar"
status: merged
milestone: M5
branch: task/T-1659-back-cancels-reply
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1659: Back cancels a reply or edit on the phone

## Spec (written by Claude, do not edit)

### Why
On web, Escape cancels an armed reply or edit. On the phone, Android back closes the whole chat, and the armed reply is lost along with the screen (`docs/audit/parity-2026-10-16.md`, gap 14). Select mode already does the right thing: `SelectionBar` listens for back while it's shown.

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/components/chat/selection-bar.tsx`** (53 lines) has the pattern to copy (`:25-31`): `useEffect(() => { const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onCancel(); return true; }); return () => subscription.remove(); }, [onCancel]);`. `BackHandler` is imported from `react-native` (`:3`).
- **`apps/mobile/src/components/chat/composer-input-row.tsx`** (194 lines): `export function ReplyBar({ reply, onCancel })` (`:45`). It's mounted only while a reply is armed (`apps/mobile/src/components/chat/composer.tsx:240-241`).
- **`apps/mobile/src/components/chat/edit-bar.tsx`** (35 lines): `export function EditBar({ text, onCancel })` (`:12`). It's mounted only while editing (`composer.tsx:239`).
- **React Native calls the newest `hardwareBackPress` listener first;** returning `true` stops the router's own back.

### Steps
1. **Add `apps/mobile/src/components/chat/use-back-cancel.ts`:**
   - `export function useBackCancel(onCancel: () => void): void`, the effect above in one place, with a short doc comment ("Android back runs `onCancel` instead of leaving the screen while the caller is mounted");
   - keep `onCancel` current through a ref so the listener isn't re-added on every render.
2. **Use it** in `ReplyBar` (`composer-input-row.tsx`), in `EditBar` (`edit-bar.tsx`), and in `SelectionBar`, replacing its inline effect and dropping the now-unused `useEffect` and `BackHandler` imports.
3. **No visual change, no new copy, no tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/use-back-cancel.ts`
- `apps/mobile/src/components/chat/composer-input-row.tsx`
- `apps/mobile/src/components/chat/edit-bar.tsx`
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `work/T-1659-back-cancels-reply.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **With a reply or an edit armed, Android back cancels it,** and a second back leaves the chat.
- **Select mode behaves as before.**

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/use-back-cancel.ts` with
  `useBackCancel(onCancel: () => void): void`. It subscribes to
  `BackHandler`'s `hardwareBackPress`, calls `onCancel()` and returns `true`
  so the router's own back is stopped while the caller is mounted. The current
  `onCancel` is read through a ref (updated in an effect), so the listener is
  subscribed once and not re-added on every render.
- `edit-bar.tsx`: `EditBar` now calls `useBackCancel(onCancel)`; doc comment
  notes Android back cancels the edit.
- `composer-input-row.tsx`: `ReplyBar` now calls `useBackCancel(onCancel)`.
- `selection-bar.tsx`: replaced the inline `useEffect` + `BackHandler`
  listener with `useBackCancel(onCancel)` and dropped the now-unused
  `useEffect` and `BackHandler` imports. Select mode behaviour is unchanged
  (same effect, same `return true`).
- No visual change, no new copy, no tests (UI change, per the spec).

### Checks run

- `pnpm install` (frozen): passed.
- No unit tests exist near these files
  (`apps/mobile/src/components/chat/{composer-input-row,edit-bar,selection-bar}*.test.*`
  matches nothing), so no single test file was run.
- `pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.9s)
PASS  lint  (1.4s)
PASS  typecheck  (4.5s)
PASS  effect  (1.1s)
PASS  tests @zilar/mobile  (1.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- `ReplyBar` and `EditBar` are the only mounts; each is mounted only while
  its mode is armed (`composer.tsx:239-241`), so at most one hook listener is
  active at a time. `SelectionBar` replaces the composer, so it cannot overlap
  with them.
- No test was added: this is UI behaviour covered by the phone smoke per
  AGENTS.md.
- No deviations from the spec.

## Review (written by Claude)

**Approved and merged.** This is parity gap 14.

- **Pre-review:** clean, 0 nits.
- **The change:**
  - `useBackCancel` (23 lines) holds the `hardwareBackPress` listener, with the callback in a ref so it subscribes once;
  - `ReplyBar` and `EditBar` use it, and `SelectionBar` swaps its inline effect for it.
- **No visual change.** The emulator check of the back press rides on the next phone smoke (with T-1660).

