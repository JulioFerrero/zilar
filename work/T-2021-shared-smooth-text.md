---
id: T-2021
title: "Share W1-i: one streaming-text reveal for web and phone — the phone's SmoothTextReveal class moves to chat-core, the hook to client-core, web keeps a small visibility/reduced-motion adapter — with tests"
status: merged
milestone: M5
branch: task/T-2021-shared-smooth-text
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2021: Shared smooth streaming text (share plan W1-i)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. The share plan (`docs/audit/share-plan.md` §2.17 and slice **W1-i**) found the same streaming-text reveal written twice. The net saving is about 210 lines. Tests are required for the streamed-reply logic.

### Facts (from `docs/audit/share-plan.md` §2.17, checked by the lead on 2026-10-18 at `754a53c34`)
- **The two copies.** `apps/web/src/lib/useSmoothText.ts` (186 lines) and `apps/mobile/src/lib/use-smooth-text.ts` (254 lines). Both already import `commonPrefixLength` and `safeCut` from `packages/chat-core/src/smooth-text.ts` (17 lines).
- **The same in both:**
  - the constants (web:37-43, mobile:41-47);
  - the speed formula (web:122-125, mobile:193);
  - the frame step (web:128-148, mobile:198-218);
  - resuming at the common prefix (web:105-110, mobile:149-154);
  - snapping when the reader comes back (web:168-181, mobile:159-172).
- **The phone's structure.** It already has a plain class, `SmoothTextReveal` (mobile:76-226), with a thin hook (mobile:235-254).
- **Platform-specific:**
  - web: page visibility and `matchMedia` (web:21-49);
  - phone: the caller passes `AppState` and Reanimated's reduce-motion flag (`apps/mobile/src/components/chat/use-bubble-reveal.ts:26-31`).
- **Drift:** web reads reduced motion once (web:79), while the phone updates it (mobile:116-134). Keep the phone's behaviour.

### Steps
1. **chat-core.** Move `SmoothTextReveal`, `FrameScheduler` and `ActiveSource` into `packages/chat-core/src/smooth-text.ts`. The class stays pure TS: it uses a guarded `globalThis.requestAnimationFrame` and imports no React.
2. **client-core.** Create `packages/client-core/src/use-smooth-text.ts` with the hook, using plain `react` only. Add one export line at the end of `packages/client-core/src/index.ts`.
3. **Adapters with the same exported names**, so importers don't change:
   - `apps/web/src/lib/useSmoothText.ts`: about 25 lines for visibility and a reduced-motion flag that updates;
   - `apps/mobile/src/lib/use-smooth-text.ts`: about 20 lines.
4. **Tests** in `packages/chat-core/src/smooth-text.test.ts` (add to it if it exists):
   - a grown stream resumes at the common prefix;
   - coming back after hiding snaps to the full text;
   - reduced motion shows the text at once.
5. **Keep every file at or under 400 lines.**

### Allowed files
- `packages/chat-core/src/smooth-text.ts`
- `packages/chat-core/src/smooth-text.test.ts`
- `packages/client-core/src/use-smooth-text.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/useSmoothText.ts`
- `apps/mobile/src/lib/use-smooth-text.ts`
- `work/T-2021-shared-smooth-text.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/smooth-text.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- In the web mock and a phone mock build, the lead checks that an AI reply streams in smoothly.

---

## Report (written by the worker when done)

### What I did

- **chat-core** (`packages/chat-core/src/smooth-text.ts`): moved `SmoothTextReveal`, `FrameScheduler`, `ActiveSource`, `SmoothTextOptions` and the three constants into the shared module, beside `commonPrefixLength`/`safeCut`. The class stays pure TS with no React import; `requestAnimationFrame`/`cancelAnimationFrame` are read through a guarded `globalThis` shape because chat-core's tsconfig has no DOM lib.
- **client-core** (`packages/client-core/src/use-smooth-text.ts`): added the plain-React hook (reducer re-render, `setOptions`/`setTarget` layout effects, dispose on unmount) and exported it from `packages/client-core/src/index.ts`.
- **web adapter** (`apps/web/src/lib/useSmoothText.ts`): keeps the same exports (`useSmoothText`, `SmoothTextOptions`, `VisibilitySource`, `FrameScheduler`, `SMOOTH_CATCH_UP_MS`, `SMOOTH_MIN_CHARS_PER_SECOND`, `safeCut`). It passes page visibility as the reveal's `ActiveSource` and now keeps reduced motion current through `useSyncExternalStore` on the media query (the phone behaviour the spec asks to keep) instead of reading it once.
- **mobile adapter** (`apps/mobile/src/lib/use-smooth-text.ts`): re-exports the shared hook and chat-core types/constants, so `useBubbleReveal` and `message-bubble-decor` keep importing the same names (`ActiveSource`, `useSmoothText`).
- **tests** (`packages/chat-core/src/smooth-text.test.ts`, new): a restarted target resumes at the common prefix and finishes; returning to the foreground snaps to the full text; reduced motion shows the text at once; plus frame-by-frame growth and the `commonPrefixLength`/`safeCut` helpers.

Files changed: the seven files listed under Allowed files (six source/test files plus this report).

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/smooth-text.test.ts` → 1 file passed, 6 tests passed.
- `pnpm gate` (repo root) → GATE PASS. Summary lines:
  - `PASS  install (frozen)  (2.9s)`
  - `PASS  format  (1.2s)`
  - `PASS  lint  (2.2s)`
  - `PASS  typecheck  (10.7s)`
  - `PASS  effect  (3.1s)`
  - `PASS  tests @zilar/chat-core  (3.9s)`
  - `SKIP tests @zilar/client-core (no nearby test files)`
  - `PASS  tests @zilar/mobile  (3.4s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Two earlier gate runs failed and were fixed: Prettier on `smooth-text.ts`, then oxlint's `react(set-state-in-effect)` in the web reduced-motion code, replaced by `useSyncExternalStore`.

### Notes for the lead

- Deviations from the estimated line counts: the web adapter is 84 lines rather than ~25 because it now subscribes to the media query and keeps the old exports; the mobile adapter is 18 lines. All changed files are under 400 lines.
- The reveal subscribes to its `ActiveSource` once, when the hook creates it; a changed `visibility` object identity after mount does not resubscribe (the previous mobile hook behaved the same way).
- No new dependencies, no secrets, no files outside scope. Web/phone visual streaming still needs the lead's mock-build check from the Acceptance section; I only ran the unit tests and the gate.


## Review (written by Claude)

Approved: a clean pre-review with 2 nits about adapter re-exports. The typecheck shows no importer depends on them.
- **What moved.** `SmoothTextReveal` and its types are now in `chat-core`, the hook in `client-core`. The web and phone files are thin adapters.
- **Size.** Net −400/+559, of which 134 lines are new tests. App code shrinks by about 230 lines.
- **Lead web-mock check.** In Dev-1 the mock AI does not reply, so streaming can't be exercised there. The new tests cover the reveal logic: resume at the common prefix, snap on return, and reduced motion.
- **Live check.** The next live AI reply on web and on the phone.
