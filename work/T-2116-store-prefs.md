---
id: T-2116
title: "Store phase 2, T1: the optimistic chat-pref row — one shared copy in packages/client-core/src/store, both apps call it"
status: merged
milestone: M5
branch: task/T-2116-store-prefs
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2116: Store phase 2, T1

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and web and phone share code. T-2112 read both stores and wrote the plan: `docs/audit/store-phase2-plan.md`.

### What to do
Do **task T1** exactly as the plan describes it, in section "2. Tasks", heading "### T1". The section gives the core function to add, the web and phone lines that shrink or go (`file:line`), and the tests that cover them.

Read the inventory section for your area (section 1) first. The lead accepted the plan's section 5 decisions:
- apply the returned detail when the route answers `GroupDetail`, and reload when it answers `void`;
- the role and invite wrappers stay.

Rules:
1. **Behaviour stays the same** on web and phone, except where the plan names a fix.
2. **Out of scope:** the message hot path (send, ledger, incoming). Do not touch it.
3. **Line numbers.** The plan's line numbers were read at `c0af99b3b`, and later merges may have moved them. Re-read each place before you edit it.
4. **Tests.** No new tests. Run the tests the plan names (`--reporter=dot`), then `pnpm gate`.
5. **Report** the line counts: web, phone, core and net.

### Allowed files
- `packages/client-core/src/store/prefs.ts`
- `apps/web/src/store/effects/prefs.ts`
- `apps/mobile/src/lib/chat-prefs.ts`
- `apps/mobile/src/store/effects/events.ts`
- `work/T-2116-store-prefs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 12 lower.
- **Lead check:** web mock: mute and pin a chat; the row changes at once. Phone emulator: the chat list loads.

---

## Report (written by the worker when done)

### What I did

- Added `optimisticPrefRow` to `packages/client-core/src/store/prefs.ts` (plus the `PrefPatch` and `OptimisticPrefRow` types): the shared partial-patch merge, with an optional `extend(row, previous)` hook for extra columns and the same chat-jid matching as `withPrefRow`.
- Web: `apps/web/src/store/effects/prefs.ts` now delegates its optimistic row to core; its `extend` adds `backgroundPreset`, `backgroundImageId` and `backgroundDim` through a small `patchedOrSaved` helper, keeping the exact previous behaviour (including clearing a field with `null`).
- Phone: deleted the duplicate optimistic row from `apps/mobile/src/lib/chat-prefs.ts` and pointed `apps/mobile/src/store/effects/events.ts` at the shared core function (`optimisticRow: optimisticPrefRow`).
- The shared function uses the web rule for every standard field (`patch.x !== undefined`). This also fixes a phone-only glitch: unmuting sends `mutedUntil: null`, and the old phone row used `??`, so the row stayed muted for one round trip. The plan's section 1.2 says the shared rule should be web's.
- Line counts (`git diff --numstat`, product files only):
  - web: +15 / −28 = **−13**
  - phone: +4 / −32 = **−28**
  - core: +28 / −0 = **+28**
  - **net: −13** (acceptance asks for at least 12 lower)
- No tests added, as the task says.

### Checks run

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/history.test.ts` → 1 file passed, 1 test passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts` → 1 file passed, 12 tests passed.
- `pnpm gate` (final run):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.8s)
  PASS  effect  (0.7s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/client-core  (7.0s)
  PASS  tests @zilar/mobile  (2.3s)
  PASS  tests @zilar/web  (3.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes for the lead

- I did not run a browser mock or the phone emulator (lead checks), so the optimistic mute/pin repaint and the phone list load are unverified by me beyond the passing tests and typecheck.
- Two gate runs failed first on formatting and then on `exactOptionalPropertyTypes` for `PutChatPrefInput`; both are fixed (the patch type now spells out `| undefined`).
- No deviations outside the plan, no new dependencies, no files outside the Allowed list.


## Review (written by Claude)

Approved; the pre-review was clean (1 nit: re-pinning keeps the old `pinnedAt`, as web already did). Net −13; one shared optimistic pref row in `packages/client-core/src/store/prefs.ts`.
- **Behaviour fix on the phone:** an explicit `mutedUntil: null` was ignored before, so unmute stayed muted for one round trip. It now applies at once.
- **Web mock** (`:5247`, main side by side on `:5233`; identical on both, no page errors):
  - Pin on Marta turns the menu to "Unpin".
  - Mute → Forever turns it to "Unmute".
  - Unmute brings back "Mute…".
- **Phone emulator:**
  - the smoke passed (`/`, `/chat/marta@zilar.test`);
  - long-press Marta → Mute → Forever shows the muted icon on the row and "Muted · Change" in the menu;
  - Unmute removes the icon within 1 s.
