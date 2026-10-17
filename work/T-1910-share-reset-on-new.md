---
id: T-1910
title: "Share screen: a new share arriving while /share is open clears the previous chat pick and error line, so it starts fresh"
status: merged
milestone: M5
branch: task/T-1910-share-reset-on-new
model: auto
effort: default
depends_on: [T-1908]
estimate: 15 min
---

# T-1910: A new share starts with a clean screen

## Spec (written by Claude, do not edit)

### Why
**The lead's emulator check of T-1908 (2026-10-17):**
1. A first share failed ("Could not read that file. Try again.", with Ana picked).
2. Then a second share (a photo from Google Photos) arrived while `/share` was still open.
3. The screen showed the new file, but kept Ana ticked and the old red error under the list.

A new share must start fresh.

### Facts (read by the lead on 2026-10-17)
In `apps/mobile/src/app/share.tsx` (187 lines):
- `ShareToChat` keeps `selected` (`:70`), `sending` (`:71`) and `failure` (`:72`) in state;
- the draft is `parsed = useMemo(() => (hasShareIntent ? toShareDraft(shareIntent) : undefined), [hasShareIntent, shareIntent])` (`:74-77`).

### Steps
1. When `shareIntent` changes to a new value, reset `selected` to `undefined` and `failure` to `undefined`. Do this with the "adjust state during render" pattern the app already uses: keep the last `shareIntent` in state, and when `!Object.is(last, shareIntent)`, set it and clear both. Alternatively, use a `useEffect` on `[shareIntent]`. Leave `sending` alone, since an in-flight send finishes and re-enables Send itself.
2. **No tests** (UI). The file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/app/share.tsx`
- `work/T-1910-share-reset-on-new.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A second share while `/share` is open** shows no chat ticked and no error line.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- In `apps/mobile/src/app/share.tsx` (`ShareToChat`), added the "adjust state during render" reset: a `lastShareIntent` state seeded with the current `shareIntent`; when `!Object.is(lastShareIntent, shareIntent)` we store the new intent and clear `selected` and `failure`. `sending` is untouched, as the spec says. Pattern and comment style follow `apps/mobile/src/lib/use-delayed.ts`.
- No tests added (UI change; spec says no tests).
- File is 198 lines, under the 400-line cap.

### Checks run
- `pnpm install` from the repo root: `Done in 14.4s using pnpm v10.32.1`.
- `pnpm gate` from the repo root: `GATE PASS`. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (4.9s)`
  - `PASS  effect  (1.0s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
- No single test files were run: the change is UI-only and the gate found no nearby test files for `@zilar/mobile`.
- Not tested on a device/emulator by me; the acceptance case (a second share arrives while `/share` is open) is for the lead's phone smoke.

### Notes for the lead
- The reset key is the `shareIntent` object identity from `useShareIntentContext`; a new share produces a new intent object, so the tick and error clear on the same render that shows the new draft.
- Deviation from spec: none.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `8c5999d39`.
- **The fix:** an adjust-during-render on `shareIntent` clears `selected` and `failure`.
- **Emulator** (mock): "first share" with Ana ticked, then a second SEND intent, shows "second share" with nothing ticked and Send disabled.
- **The nit is accepted:** a share that arrives during an in-flight send may be reset when the old send succeeds. That is rare.

