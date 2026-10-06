---
id: T-0416
title: "Mobile kit: Import from Telegram, the pack Move up/down keys and the sign-in Resend / different-email links use the kit Button"
status: merged
milestone: M5
branch: task/T-0416-mobile-stickers-auth-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0416: Stickers and sign-in buttons on the kit (mobile)

## Spec (written by Claude, do not edit)

### Why
These are rows from batches 13 and 16 of `docs/audit/ui-kit-leftovers.md`. The "Remove favorite" star overlay on a sticker tile (`stickers.tsx:543`) is a tile overlay and stays raw.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `outline`, `ghost` and `link`; sizes `default`, `sm` and `icon`;
  - `cn` merges `className`, and `disabled` dims the button;
  - labels MUST be inside `<Text>`;
  - `stickers.tsx:17` and `apps/mobile/src/auth/AuthFlow.tsx:8` already import `Button`.
- **`apps/mobile/src/app/settings/stickers.tsx`:**
  - lines 324-336: `Pressable` with label "Import from Telegram", `disabled={busy}`, and an `onPress` that bumps `importNonce` and opens the sheet; class `h-11 flex-row items-center justify-center gap-2 rounded-xl border border-border-strong …`; children `<Download size={16} …/>` and `<Text className="text-[15px] text-foreground">Import from Telegram</Text>`;
  - lines 363-381: two `Pressable`s with labels `` `Move ${pack.title} up` `` and `` `Move ${pack.title} down` ``, `disabled={busy || index === 0}` and `disabled={busy || index === packs.length - 1}`, `hitSlop={4}`, `onPress={() => movePack(pack.id, ±1)}`, class `h-9 w-9 items-center justify-center rounded-lg …`, with `ChevronUp`/`ChevronDown` icons `size={20}`.
- **`apps/mobile/src/auth/AuthFlow.tsx`:**
  - lines 191-198: `Pressable` "Resend code", `disabled={busy}`, `onPress={() => void requestCode()}`, child `<Text className="text-[14px] text-accent">Resend code</Text>`;
  - lines 201-209: `Pressable` "Use a different email", an `onPress` that sets the step to 'email' and clears the error, child `<Text className="text-[14px] text-muted-foreground">Use a different email</Text>`.
- **Tests:**
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx`;
  - `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`: it reaches `stickers.tsx` through `sticker-pack.tsx` (the T-0399 lesson). Mocks only;
  - `apps/mobile/src/auth/AuthFlow.test.tsx`.

### What to build
1. **Import from Telegram:** `<Button variant="outline" className="h-11 rounded-xl" accessibilityLabel="Import from Telegram" disabled={busy} onPress=…>` with the same icon and `<Text>`.
2. **Move up/down:** `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" hitSlop={4} accessibilityLabel=… disabled=… onPress=…>` with the same icons.
3. **Resend code:** `<Button variant="ghost" size="sm" className="px-0" accessibilityLabel="Resend code" disabled={busy} onPress=…>` with the same `<Text>`.
4. **Use a different email:** `<Button variant="link" size="sm" className="px-0" accessibilityLabel="Use a different email" onPress=…>` with the same `<Text>`.
5. Drop `Pressable` from an import only when it becomes unused. Change no assertion. Add mocks only if needed.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, both files around their lines, and the three tests.

### Allowed files
`apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`, `apps/mobile/src/auth/AuthFlow.test.tsx`, `work/T-0416-mobile-stickers-auth-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen AuthFlow
pnpm gate
```

### Acceptance
- The five controls are kit Buttons, with their labels inside `<Text>`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the five raw `Pressable` controls with the kit `Button`:

1. `stickers.tsx` — "Import from Telegram" is now `<Button variant="outline" className="h-11 rounded-xl" accessibilityLabel="Import from Telegram" disabled={busy} onPress=…>` with the same `Download` icon and `<Text>` label.
2. `stickers.tsx` — the pack "Move up" / "Move down" controls are now `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" hitSlop={4} …>` with the same `ChevronUp`/`ChevronDown` icons; `disabled` conditions unchanged.
3. `AuthFlow.tsx` — "Resend code" is now `<Button variant="ghost" size="sm" className="px-0" accessibilityLabel="Resend code" disabled={busy} …>` with the same `<Text>`.
4. `AuthFlow.tsx` — "Use a different email" is now `<Button variant="link" size="sm" className="px-0" accessibilityLabel="Use a different email" …>` with the same `<Text>`.
5. `AuthFlow.tsx` — `Pressable` became unused there, so it was dropped from the `react-native` import. In `stickers.tsx` `Pressable` is still used by the favorite star overlay (`stickers.tsx:543`), so its import stayed.

No assertion was changed and no new mocks were added; the existing test mocks already cover the `Button` (Pressable + TextClassContext).

### Files changed
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`
- `work/T-0416-mobile-stickers-auth-buttons-kit.md` (status)

### Commands and results
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/stickers/stickers-screen.test.tsx src/components/stickers/sticker-pack-screen.test.tsx src/auth/AuthFlow.test.tsx` → `Test Files 3 passed (3)`, `Tests 30 passed (30)`.
- `pnpm gate` (from repo root) →
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (19.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (11.0s)
  PASS  tests @zilar/mobile  (2.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
None. The test run prints React "incorrect casing" warnings for the mocked string components; these are pre-existing and were present before this change.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review had one nit, accepted: disabled opacity is now the kit 50% instead of 40/60%. The five controls are kit Buttons with their labels inside `<Text>`. The favorite-star overlay stays raw, as the spec says.
