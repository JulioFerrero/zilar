---
id: T-1814
title: "Phone Join preview rows look like the thread: text bubbles get the thread's 14px radius, and blocks/progress card rows are standalone (no bubble surface) — twin of web T-1807's fix"
status: merged
milestone: M5
branch: task/T-1814-phone-preview-bubbles
model: auto
effort: default
depends_on: [T-1812]
estimate: 20 min
---

# T-1814: Phone preview rows match the thread

## Spec (written by Claude, do not edit)

### Why
**Emulator, mock build of main on 2026-10-17:** "Dev team › Ideas" now shows its preview messages (T-1808, T-1812). Two differences from the thread:
- the text bubbles have **square corners**;
- the checklist card sits **inside a bubble surface**, so the surface is doubled.

The web preview had the same issue and fixed it in T-1807.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/topic-join-view.tsx`** (175 lines), the row at `:124-148`:
  - `<View className="px-3 py-2" style={bubbleStyle('incoming', true)}>` wraps the sender name, then either `<PayloadCard card={card} footer={…} />` or the body and the time.
- **The thread bubble** (`apps/mobile/src/components/chat/message-bubble.tsx`):
  - it uses `className={cn('rounded-[14px]', … 'px-3 py-2')}` with `bubbleStyle(...)` (`:230-234`);
  - `bubbleStyle` (`apps/mobile/src/lib/depth.ts:103`) only sets the 4 px tail corner, so without `rounded-[14px]` the other corners are square;
  - blocks and progress cards are standalone: `standaloneCard` (`:128-129`) draws the body without the bubble surface (`:208-215`).
- **`PayloadCard`** (`apps/mobile/src/components/chat/payload-card.tsx`) draws its own card box.

### Steps
1. **Text rows:** add `rounded-[14px]` to the bubble `View`, as the thread does.
2. **Card rows (blocks or progress):** no bubble surface.
   - Put the sender name above the card, with the same text classes, outside any surface. Then `<PayloadCard … />` (blocks keep the time as footer; progress has none, as in the thread).
   - Keep the avatar and the row layout.
3. **No tests** (UI). Keep the file at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/topic-join-view.tsx`
- `work/T-1814-phone-preview-bubbles.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In the mock build, the "Ideas" preview shows rounded text bubbles and a standalone checklist card, like the thread.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Text rows** (`apps/mobile/src/components/chat/topic-join-view.tsx`): the bubble `View` now has `rounded-[14px]` alongside `bubbleStyle('incoming', true)`, so only the 4 px tail corner differs from the thread's 14 px radius.
- **Card rows (blocks/progress)**: extracted the sender name into a `senderName` element (same `numberOfLines={1}`, `mb-0.5 text-[12px] font-semibold`, `senderColor` classes) and render it above the card outside any surface. `PayloadCard` follows in a `shrink` wrapper; blocks keep the time as footer, progress now gets no time — matching the thread. The avatar and the row layout (`max-w-[85%] flex-row items-end gap-2 self-start`) are unchanged.
- No tests added (UI change, per spec). File is 176 lines, under the 400-line limit.

### Checks run
- `pnpm install`: done, 17.9s, one pre-existing peer-dependency warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- First `pnpm gate`: FAIL on `format` (Prettier flagged `topic-join-view.tsx`); fixed with `pnpm exec prettier --write` on that file only.
- `pnpm gate` (final): **GATE PASS**:
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.6s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.5s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/mobile  (4.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  I did not run any single test file separately; the gate ran the mobile tests (4.5s) as part of its nearest-tests step.
- Changed files: `apps/mobile/src/components/chat/topic-join-view.tsx`, `work/T-1814-phone-preview-bubbles.md`. Nothing outside the Allowed files.

### Notes for the lead
- I have not seen the mock build; verification of the visual result is the phone smoke / Julio's live check. The code mirrors the thread's `message-bubble.tsx`: `rounded-[14px]` on text rows, and no bubble surface around `progress`/`blocks` cards.
- `time` is now only used by text rows and by the blocks-card footer; progress rows show no time, per the spec.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `fe07cd299`.
- **Emulator** (mock build of this branch, "Dev team › Ideas"):
  - text bubbles are rounded with the 4 px tail, as in the thread;
  - the Dev-1 checklist card is standalone under its sender name, with no bubble surface;
  - the Join key sits below.

