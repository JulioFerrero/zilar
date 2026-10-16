---
id: T-1690
title: "Size split of the phone use-profile-settings.ts (390 lines): move the debounced handle-availability effect into a new components/settings/use-handle-check.ts hook — a pure move, no behaviour change"
status: merged
milestone: M5
branch: task/T-1690-split-profile-settings
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1690: Split the handle check out of the phone profile settings hook

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src/components/settings/use-profile-settings.ts` is 390 of 400 lines, so the phone profile screen can't change (it still lacks the export row, parity gap 5). The debounced handle check is one self-contained effect.

### Facts (the lead read them on 2026-10-16)
- **`use-profile-settings.ts`:**
  - `interruptFiber` from `@/lib/effect/timers` (`:8`);
  - `handleAvailabilityFor`, `isHandleRateLimited` and `type HandleAvailability` from `@/components/settings/profile-logic` (`:14-19`);
  - `const HANDLE_CHECK_DEBOUNCE_MS = 300;` (`:30`);
  - `export function useProfileSettings() :74`;
  - `const [availability, setAvailability] = useState<HandleAvailability>({ state: 'idle' })` (`:85`);
  - `const trimmed = handle.trim(); const current = …; const ownHandle = …;` (`:176-178`), which later code still uses (`handleChanged = trimmed !== current` at `:337`).
- **The block to move** is the `useEffect(() => { if (trimmed === '' || ownHandle) return; … Effect.runFork(check); return () => interruptFiber(fiber); }, [api, trimmed, ownHandle]);` at `:179-219`, with the comment above it (`:172-175`).
  - `setAvailability` is also called at `:141` and `:257`, outside the block.
  - `api` is the value from `useProfileApi` (its `checkHandle` method).
- **The folder `apps/mobile/src/components/settings/`** has no `use-handle-check.ts`.

### Steps
1. **Create `apps/mobile/src/components/settings/use-handle-check.ts`** exporting `useHandleCheck({ api, trimmed, ownHandle, setAvailability })`. It holds the comment and the effect moved **word for word**, plus `HANDLE_CHECK_DEBOUNCE_MS` and the imports the effect needs. Type `api` with whatever `useProfileApi` returns (or just its `checkHandle`).
2. **`use-profile-settings.ts`:** keep `trimmed`, `current` and `ownHandle`; call `useHandleCheck({ api, trimmed, ownHandle, setAvailability })` where the effect was; drop the imports and the constant it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/mobile/src/components/settings/use-handle-check.ts`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `work/T-1690-split-profile-settings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`use-profile-settings.ts` is about 345 lines,** and the effect is unchanged in the new hook.
- **The mobile typecheck passes.**

---

## Report (written by the worker when done)

### What I did
Moved the debounced handle-availability effect out of `use-profile-settings.ts` into a
new `use-handle-check.ts` hook.

- New `apps/mobile/src/components/settings/use-handle-check.ts` (71 lines) exports
  `useHandleCheck({ api, trimmed, ownHandle, setAvailability })`. It holds
  `HANDLE_CHECK_DEBOUNCE_MS`, the moved comment (word for word) and the effect body
  (word for word), plus the imports it needs (`Effect`, `useEffect`, `interruptFiber`,
  `ProfileApi`, `handleAvailabilityFor`, `isHandleRateLimited`, `HandleAvailability`).
  `api` is typed `ProfileApi`.
- `use-profile-settings.ts`: kept `trimmed`, `current` and `ownHandle`; the effect call
  site is now `useHandleCheck({ api, trimmed, ownHandle, setAvailability })`; dropped the
  `interruptFiber` import, the `useEffect` import, `HANDLE_CHECK_DEBOUNCE_MS` and the
  now-unused `handleAvailabilityFor` / `isHandleRateLimited` imports (kept
  `friendlyClaimError` and `type HandleAvailability`, still used). File is now 341 lines
  (was 390).
- No behaviour change. No new tests (UI code; the move is a pure extraction).

### Checks run
- `pnpm install`: done, "Done in 20s", 17 workspace projects.
- `pnpm gate` (repo root): ended with `GATE PASS`. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (2.6s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (5.1s)`
  - `PASS  effect  (1.4s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
- No single test file was run: no test in `apps/mobile` imports this hook or
  `use-profile-settings.ts` (grepped `*.test.ts*`), so gate skipped mobile tests.

### Notes for the lead
- Deviation from "word for word" (one line, forced by lint): the moved effect's
  dependency array gained `setAvailability` —
  `[api, trimmed, ownHandle, setAvailability]` instead of `[api, trimmed, ownHandle]`.
  `oxlint react-hooks(exhaustive-deps)` flags the missing dep once the setter is a prop,
  and a `useState` setter identity is stable, so this does not change behaviour.
- Replacement of the four-line comment: the original comment (about the effect) moved
  into the new hook verbatim. In `use-profile-settings.ts` the surviving `trimmed` /
  `current` / `ownHandle` now carry a one-line comment
  ("The trimmed handle and the two flags the debounced check and the Save share.")
  instead of the moved one, so the derivations are not left unexplained.
- First `pnpm gate` run failed on `format` (both new/changed files needed Prettier); I
  fixed with `pnpm exec prettier --write` on the two files, then the gate passed. The
  second run failed on `lint` (the missing dep above), fixed in code. No checks were
  disabled or bypassed.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the effect body is unchanged in `use-handle-check.ts`; the comment became a doc comment.
- **Accepted:** `setAvailability` joined the effect's deps (lint). It's a stable React state setter, so the effect re-runs exactly as before.
- **Result:** `use-profile-settings.ts` drops from 390 to 341 lines, which leaves room for the phone export row (parity gap 5) once its design is settled.

