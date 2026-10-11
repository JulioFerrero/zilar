---
id: T-1128
title: "Mobile dedup: the 18 inline Effect.runFork(Fiber.interrupt(x)) calls use interruptFiber from lib/effect/timers.ts (same behaviour)"
status: merged
milestone: M5
branch: task/T-1128-mobile-interrupt-fiber
model: auto
effort: default
depends_on: [T-1124]
estimate: 0.05 day
---

# T-1128: Mobile uses `interruptFiber`

## Spec (written by Claude, do not edit)

### Why
This is a BOARD follow-up from T-1050. `apps/mobile/src/lib/effect/timers.ts:10-14` has `interruptFiber(fiber)`, which runs `Effect.runFork(Fiber.interrupt(fiber))` when the fiber is defined. Eighteen mobile sites still write that call inline (read by the lead with `grep -rn "Effect.runFork(Fiber.interrupt" apps/mobile/src`):
- `apps/mobile/src/app/(tabs)/settings.tsx:154` and `:173`;
- `apps/mobile/src/app/(tabs)/_layout.tsx:53`;
- `apps/mobile/src/components/settings/use-profile-settings.ts:176`;
- `apps/mobile/src/components/stickers/use-stickers-panel.ts:67`;
- `apps/mobile/src/components/stickers/use-pack-editor.ts:114`;
- `apps/mobile/src/components/chat/sticker-panel.tsx:69`;
- `apps/mobile/src/components/chat/visibility-sheet.tsx:119`;
- `apps/mobile/src/components/chat/use-voice-transcribe.ts:91`;
- `apps/mobile/src/components/chat/message-search.ts:59`;
- `apps/mobile/src/components/chat/voice-recorder.tsx:102`;
- `apps/mobile/src/components/chat/visibility-fields.tsx:176`;
- `apps/mobile/src/components/chat/jump-scroll.ts:29`;
- `apps/mobile/src/components/chat/skeleton.tsx:27`;
- `apps/mobile/src/components/ais/ai-activity.tsx:225`;
- `apps/mobile/src/components/contacts/people-search.ts:66`;
- `apps/mobile/src/components/ais/ai-memory-section.tsx:298`;
- `apps/mobile/src/components/ais/routines-section.tsx:295`.

### What to build
1. **Replace each inline call** with `interruptFiber(x)` (import from `@/lib/effect/timers`, or the relative path the file already uses for lib imports).
   - Where the code casts (`handle as Fiber.Fiber<void>`), keep a cast only if TypeScript needs it.
   - Remove the `Fiber` or `Effect` imports that become unused.
2. **Do not change:**
   - `apps/mobile/src/components/chat/composer-media.ts:141` (`Fiber.interruptAll`);
   - `timers.ts` itself;
   - any `Effect.runSync(Fiber.interrupt…)` site.
3. **No behaviour change.** No tests (UI).
4. **Proof in the Report:** `grep -rn "Effect.runFork(Fiber.interrupt(" apps/mobile/src` shows only `lib/effect/timers.ts`.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/effect/timers.ts`, and the 18 files.

### Allowed files
`apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/components/settings/use-profile-settings.ts`, `apps/mobile/src/components/stickers/use-stickers-panel.ts`, `apps/mobile/src/components/stickers/use-pack-editor.ts`, `apps/mobile/src/components/chat/sticker-panel.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/use-voice-transcribe.ts`, `apps/mobile/src/components/chat/message-search.ts`, `apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/visibility-fields.tsx`, `apps/mobile/src/components/chat/jump-scroll.ts`, `apps/mobile/src/components/chat/skeleton.tsx`, `apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/components/contacts/people-search.ts`, `apps/mobile/src/components/ais/ai-memory-section.tsx`, `apps/mobile/src/components/ais/routines-section.tsx`, `work/T-1128-mobile-interrupt-fiber.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The grep proof is in the Report.

---

## Report (written by the worker when done)

### What I did
Replaced all 18 inline `Effect.runFork(Fiber.interrupt(x))` calls in `apps/mobile/src` with `interruptFiber(x)` from `@/lib/effect/timers` (or the relative `../../lib/effect/timers` where the file already imports from `lib` relatively). No behaviour change: `interruptFiber` runs the same `Effect.runFork(Fiber.interrupt(fiber))` when the fiber is defined.

Sites changed (18):
- `app/(tabs)/settings.tsx` (`load`, `count`)
- `app/(tabs)/_layout.tsx` (`fiber`)
- `components/settings/use-profile-settings.ts` (`fiber`)
- `components/stickers/use-stickers-panel.ts` (`fiber`)
- `components/stickers/use-pack-editor.ts` (`fiber`)
- `components/chat/sticker-panel.tsx` (`fiber`)
- `components/chat/visibility-sheet.tsx` (`pending`)
- `components/chat/use-voice-transcribe.ts` (`reading`)
- `components/chat/message-search.ts` (`handle`)
- `components/chat/voice-recorder.tsx` (`hide`)
- `components/chat/visibility-fields.tsx` (`pending`)
- `components/chat/jump-scroll.ts` (`handle`)
- `components/chat/skeleton.tsx` (`fiber`)
- `components/ais/ai-activity.tsx` (`fiber`)
- `components/contacts/people-search.ts` (`handle`)
- `components/ais/ai-memory-section.tsx` (`fiber`)
- `components/ais/routines-section.tsx` (`fiber`)

Import cleanup: removed the now-unused `Fiber` import from 14 files. Kept `Fiber` in four files where it is still referenced: `message-search.ts`, `jump-scroll.ts`, `people-search.ts` (the `handle as Fiber.Fiber<…>` cast is still needed because `handle` is typed `unknown` and `interruptFiber` takes `Fiber.Fiber<unknown, unknown> | undefined`), and `voice-recorder.tsx` (`TickerRef = useRef<Fiber.Fiber<…> | undefined>`).

Untouched as required: `timers.ts`; `components/chat/composer-media.ts` (`Fiber.interruptAll`); all `Effect.runSync(Fiber.interrupt…)` sites (`attachment-video.tsx`, `sticker-message.tsx`, `media-sheet.tsx`, `use-message-list-scroll.ts`, `lib/drafts.ts`); `gif-panel.tsx` and `voice-recorder-gesture.ts` (`lib/effect/timers` is not used there).

### Commands and real results
- `pnpm install` — done, 16 workspace projects, `Done in 10.2s`.
- `grep -rn "Effect.runFork(Fiber.interrupt(" apps/mobile/src` — proof, only:
  `apps/mobile/src/lib/effect/timers.ts:12:    Effect.runFork(Fiber.interrupt(fiber));`
- `pnpm gate` — summary:
  ```
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
No single test files were run: the change is UI wiring with no nearby tests (`pnpm gate` reports `no nearby test files` for `@zilar/mobile`), per the spec ("No tests (UI)").

### Files changed
The 17 source files listed under Allowed files plus this task file.

### Problems / deviations
None. No `any`, no `@ts-ignore`, no dependency changes.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** all 18 inline `Effect.runFork(Fiber.interrupt(x))` calls now use `interruptFiber(x)` from `lib/effect/timers.ts`. The lead's grep finds the pattern only in `timers.ts` itself.
- **The lead's diff check:** every changed line outside the task file is an import line or an `interruptFiber(...)` call. `composer-media.ts` (`interruptAll`) is untouched.
- **The gate passed.**
