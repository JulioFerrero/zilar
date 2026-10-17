---
id: T-1820
title: "A failed card answer says so: web and phone BlockCards show one fixed line 'Could not send. Try again.' under the card after any failed answer (buttons, poll, choice, rating, checklist, form), cleared on the next success; the phone form drops its own copy"
status: merged
milestone: M5
branch: task/T-1820-card-answer-error
model: auto
effort: default
depends_on: [T-1815]
estimate: 25 min
---

# T-1820: A failed answer says so

## Spec (written by Claude, do not edit)

### Why
The T-1796 pre-review found that when the respond call fails, buttons, poll, choice, rating and checklist revert **silently** on both apps. Only the phone form shows "Could not send. Try again." A person who taps on a flaky connection sees the answer flash and vanish, with no reason.

### Facts (read by the lead on 2026-10-17)
- **Web:** `apps/web/src/components/message/blocks/BlockCard.tsx` (197 lines):
  - `answer` catches a failure at `:122` and restores the previous data;
  - the card body is the `div` at `:163`, the compact layout at `:152-158`, and the `footer` slot at `:157`.
- **Phone:** `apps/mobile/src/components/chat/blocks/block-card.tsx` (239 lines): `submit`'s `Effect.catch` at `:183-188` restores and calls `onSettled(false)`.
- **The phone form's own error:** `apps/mobile/src/components/chat/blocks/form-block.tsx:57` (`failed` state) and `:215-216` (the line).
- **Error colour:** `text-danger` on both apps (the phone form uses `text-[13px] font-semibold text-danger`).

### Steps
1. **Both `BlockCard`s:** keep a `failed` flag. Set it in the catch and clear it on the next successful answer and when the card data changes (the room correction). While it's set, draw one line under the card box, outside it: "Could not send. Try again." (web `text-[12px] text-danger`; phone `text-[13px] font-semibold text-danger`), with `role="alert"` on web and `accessibilityRole="alert"` on the phone.
2. **Phone `form-block.tsx`:** remove its own `failed` state and line, since `BlockCard` now shows it.
3. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/form-block.tsx`
- `work/T-1820-card-answer-error.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A failed answer on any interactive card shows one error line on both apps, and the next success clears it.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Web `apps/web/src/components/message/blocks/BlockCard.tsx`:** added a `failed` flag that is set in `answer`'s catch (the restore path) and cleared on a successful answer and when the card prop changes (the room correction). While it is set, one line `Could not send. Try again.` is drawn under the card box, outside it, as a `<p role="alert" className="mt-1 text-[12px] text-danger">`. Both the normal card and the compact lone-callout card render it.
- **Phone `apps/mobile/src/components/chat/blocks/block-card.tsx`:** same flag on the submission path (`submit`): set in `Effect.catch`, cleared in the success `Effect.tap` and when `data` changes (the React derived-state block). While set, one `Text` line `Could not send. Try again.` is drawn under the card box, outside it, with `accessibilityRole="alert"` and `text-[13px] font-semibold text-danger`, for both the stacked and compact-callout layouts.
- **Phone `apps/mobile/src/components/chat/blocks/form-block.tsx`:** removed the form's own `failed` state, its `setFailed` calls and its duplicate error line; `onSettled` now only records the success. The phone `BlockCard` shows the failure line for forms too.
- No tests added (UI only, per the spec). All three files stay under 400 lines (210, 254 and 211).

Files changed:
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/form-block.tsx`
- `work/T-1820-card-answer-error.md`

### Checks run

- `pnpm install`: `Done in 11.8s using pnpm v10.32.1` (no errors).
- `pnpm gate` (from the repo root): exited 0 and ended with `GATE PASS`. Summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (6.3s)
PASS  effect  (1.1s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test file was run: the spec says no tests (UI), and the gate found no nearby test files in either app.

### Notes for the lead

- I added `mt-1` for spacing between the card border and the error line; the rest of the classes are exactly the ones in the spec. The line is a sibling of the card box, not inside it.
- Verification is gate-only: I did not run either app, so the visual result is unverified beyond typecheck/lint/format.
- No deviations from the Spec.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `8d35075d8`.
- **Both `BlockCard`s:**
  - keep a `failed` flag: set on a failed answer, cleared on success and on new card data;
  - draw one fixed `role="alert"` line, "Could not send. Try again.", under the card box.
- **The phone form's** own copy is removed.
- **Pre-review nits, accepted:** an extra `mt-1`, and an unreachable line in the compact callout layout.

