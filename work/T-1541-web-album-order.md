---
id: T-1541
title: "Web several files: send the album's photos together, then the other files, so a mixed pick (photo, PDF, photo) makes one album instead of two albums of one; the caption and reply ride the first message sent"
status: merged
milestone: M5
branch: task/T-1541-web-album-order
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1541: Web album photos send together

## Spec (written by Claude, do not edit)

### Why
T-1512 lets web send a mixed pick. Albums group only **consecutive** messages with the same album id, sender and day (`packages/chat-core/src/messages.ts:31-36`). Web sends in pick order, so a pick of photo, PDF, photo puts the PDF between the two photos. They then render as two albums of one, with the PDF in the middle.

The phone twin (T-1536) got the same fix in its review.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/composer/useComposerAttachments.ts` (371 lines), `sendPending` (`:311-335`):**
  - iterates `staged` in pick order;
  - gives images the album marker (`count` images, `imageIndex`) when `count >= 2` and not "Send as files";
  - puts the caption and reply on `index === 0`.

### Steps
1. In `sendPending`, when the album applies (`albumId !== undefined`), send the staged images first, in pick order, as the album, then every other staged file in pick order.
2. Otherwise ("Send as files", or fewer than 2 images) keep today's pick order.
3. The caption and reply ride the **first message sent**.
4. Update the comment above `sendPending` to say so. The file stays under 400 lines.

### Tests
None (UI wiring).

### Allowed files
- `apps/web/src/components/composer/useComposerAttachments.ts`
- `work/T-1541-web-album-order.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Reading the code: with photo, PDF and photo staged, the two photos send first with album indexes 0 and 1 (count 2), then the PDF. The caption is on the first photo.
- "Send as files" keeps pick order with no album marker.

---

## Report (written by the worker when done)

### What I did
- In `sendPending` (`apps/web/src/components/composer/useComposerAttachments.ts`), added an
  `ordered` list: when an album applies (`albumId !== undefined`) the staged images go
  first in pick order, then the other files in pick order; otherwise (fewer than 2 images
  or "Send as files") the original pick order is kept.
- The caption and reply still attach to `index === 0`, which is now the first message
  actually sent (the first photo when the album applies).
- Rewrote the comment above `sendPending` to describe the reordering and the caption/reply
  placement. File is 380 lines (under 400).

### Files changed
- `apps/web/src/components/composer/useComposerAttachments.ts`
- `work/T-1541-web-album-order.md`

### Checks run
- `pnpm install` — done, no errors.
- `pnpm gate` (from repo root):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (4.6s)
  PASS  lint  (2.3s)
  PASS  typecheck  (17.2s)
  PASS  effect  (2.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No unit tests written: the task says "None (UI wiring)" and AGENTS.md says UI code gets
  no tests. No single-file test runs were needed.

### Acceptance check (by reading the code)
- Pick `photo, PDF, photo` → `albumId` set, `ordered` = `[photo, photo, PDF]`; photos get
  album indexes 0 and 1 with `count` 2; the PDF carries no album; caption/reply on the
  first photo. Confirmed.
- "Send as files" → `count` 0, `albumId` undefined, `ordered === staged`, so pick order is
  kept with no album marker. Confirmed.

### Notes for the lead
- No deviations from the spec. No open questions.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The diff** (read by the lead):
  - when the album applies, `ordered` puts the staged images first, then the other files, each in pick order;
  - the caption and reply stay on `index === 0` of `ordered`, the first message sent;
  - "Send as files" and fewer than 2 images keep pick order.
  
  So photo, PDF and photo now make one album of 2, then the PDF.
- **The phone** gets the same fix in T-1536's fix round.

