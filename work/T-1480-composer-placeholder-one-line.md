---
id: T-1480
title: "Composer placeholder stays on one line on web and mobile: a long chat or topic title wrapped 'Message <title>' to two lines (web grew the composer, mobile clipped the second line); a shared helper falls back to 'Message', and an empty composer is always one line tall"
status: merged
milestone: M5
branch: task/T-1480-composer-placeholder-one-line
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1480: One-line composer placeholder

## Spec (written by Claude, do not edit)

### Why
The lead's checks on 2026-10-15 (web mock at 390 px, and the Android emulator in mock) opened the Dev team topic "Checkout button hidden on Safari":
- **web:** the placeholder "Message Checkout button hidden on Safari" wraps to two lines, and the empty composer grows to two lines tall;
- **mobile:** the same placeholder wraps, and its second line ("on Safari") is cut off at the bottom of the field.

### Facts (the lead read them on main, 2026-10-15)
- **Web:**
  - `apps/web/src/components/Composer.tsx:83-84` builds `const placeholder = title === undefined ? 'Message' : \`Message ${title}\``.
  - The file is 393 lines, and line 1 already imports from `@zilar/chat-core`.
  - `apps/web/src/components/composer/ComposerControls.tsx:97-105` sizes the textarea from `scrollHeight`. Chrome counts the wrapped placeholder in an empty textarea's `scrollHeight`, so the empty composer grows.
- **Mobile:**
  - `apps/mobile/src/components/chat/composer.tsx:182` builds the same string.
  - `:248` passes `onInputHeightChange={setInputHeight}`, and `apps/mobile/src/components/chat/composer-input-row.tsx:130-132` reports the content size, which includes the wrapped placeholder.
  - `MIN_INPUT_HEIGHT` is exported at `composer-input-row.tsx:22`.
- **chat-core:** `packages/chat-core/src/text.ts` (16 lines) holds small text helpers and is re-exported from `packages/chat-core/src/index.ts:9`.

### What to build
1. **`packages/chat-core/src/text.ts`:** `export function composerPlaceholder(title: string | undefined): string`.
   - It returns `'Message'` when `title` is undefined, empty, or longer than 18 characters (a named constant).
   - Otherwise it returns `` `Message ${title}` ``.
   - One short comment: a longer title wraps the placeholder on a phone-width composer, and the header already shows the full title.
2. **Web, `Composer.tsx`:** use `composerPlaceholder(title)`, adding it to the existing chat-core import (the file must not grow).
3. **Web, `ComposerControls.tsx`:** in the sizing effect, when `value === ''`, set the height to `'auto'` and return. `rows={1}` makes that one line, so a placeholder never makes the empty composer taller.
4. **Mobile, `composer.tsx`:**
   - use `composerPlaceholder(title)`;
   - make the height callback keep `MIN_INPUT_HEIGHT` while the text is empty: `(height) => setInputHeight(text === '' ? MIN_INPUT_HEIGHT : height)`.
   - Import `MIN_INPUT_HEIGHT` from where the file already gets it.
5. Nothing else changes, and no file grows past 400 lines.

### Tests
None (a UI string and layout).

### Allowed files
- `packages/chat-core/src/text.ts`
- `apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `work/T-1480-composer-placeholder-one-line.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Web (lead, headless at 390 px):** the "Checkout button hidden on Safari" topic shows "Message" on one line, the empty composer is one line tall, and Marta's DM still shows "Message Marta".
- **Emulator (lead):** the same topic shows "Message" on one line, and typing a long text still grows the field.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

### What I did

1. **`packages/chat-core/src/text.ts`** — added `composerPlaceholder(title)`. It returns `'Message'` when `title` is `undefined`, empty, or longer than the named constant `MAX_PLACEHOLDER_TITLE_LENGTH = 18`; otherwise `` `Message ${title}` ``. One comment explains the fallback (a long title wraps the placeholder on a phone-width composer, and the header already shows the full title). For example, "Checkout button hidden on Safari" (32 chars) → `"Message"`, "Marta" → `"Message Marta"`.
2. **Web `apps/web/src/components/Composer.tsx`** — added `composerPlaceholder` to the existing `@zilar/chat-core` import on line 1; replaced the two-line placeholder build with `const placeholder = composerPlaceholder(chat?.title);`. `title` was only used there, so it was removed. File shrank 393 → 392 lines (under 400).
3. **Web `apps/web/src/components/composer/ComposerControls.tsx`** — in the sizing effect, after `element.style.height = 'auto'` it now returns early when `value === ''`, so a wrapped placeholder never grows the empty textarea; `rows={1}` keeps it one line tall. 288 → 291 lines.
4. **Mobile `apps/mobile/src/components/chat/composer.tsx`** — `const placeholder = composerPlaceholder(title);`; `onInputHeightChange` now keeps `MIN_INPUT_HEIGHT` while the text is empty: `(height) => setInputHeight(text === '' ? MIN_INPUT_HEIGHT : height)`; imported `composerPlaceholder` from `@zilar/chat-core` (existing type imports kept inline as `type`). `MIN_INPUT_HEIGHT` was already imported from `composer-input-row`. Still 292 lines.
5. Nothing else changed.

### Files changed

- `packages/chat-core/src/text.ts`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `work/T-1480-composer-placeholder-one-line.md`

### Commands and real results

- `pnpm install` — `Done in 10.8s using pnpm v10.32.1` (1 deprecated subdep, 1 peer warning on `apps/mobile`: `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18 — pre-existing, untouched).
- `pnpm gate` — **GATE PASS**, all five changed files inside the Allowed files. Summary lines:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.0s)
PASS  lint  (1.4s)
PASS  typecheck  (6.1s)
PASS  effect  (1.5s)
PASS  tests @zilar/chat-core  (3.0s)
PASS  tests @zilar/mobile  (1.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Single tests run

None. No test file covers `text.ts`, `Composer.tsx`, `ComposerControls.tsx` or the mobile `composer.tsx` (the spec says "Tests: None"), and `pnpm gate` reported `SKIP tests @zilar/web (no nearby test files)`. I did not run any other tests.

### Deviations from the spec

None.

### Problems / open questions

None. I could not verify the visual acceptance checks (web headless at 390 px, the emulator) — those are the lead's checks; I only verified the code paths and the gate.

### Security checklist

Not applicable: this change adds no route, no database access, no logging, and handles no secrets or user data beyond a UI placeholder string.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **Web, headless at 390 px:** the "Checkout button hidden on Safari" topic shows "Message" at 36 px. Typing grows the field to 80 px, and clearing returns it to 36 px. Marta keeps "Message Marta".
- **Emulator, mock APK `b80bb7ea8`:**
  - the cleared topic shows "Message" on one line, and the field shrinks back to one line;
  - long typed text still grows the field;
  - Marta's DM shows "Message Marta".
