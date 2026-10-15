---
id: T-1472
title: "Mobile New AI follow-ups: the partial-save notice shows on the new chat, the inert highlight plumbing goes, and Zilar greys out when cloud is off (SegmentedControl per-option disabled)"
status: merged
milestone: M5
branch: task/T-1472-mobile-new-ai-followups
model: auto
effort: default
depends_on: [T-1445]
estimate: 0.2 day
---

# T-1472: Mobile New AI follow-ups

## Spec (written by Claude, do not edit)

### Why
These are the three follow-ups the pre-review of T-1445 left open (F1 to F3). The lead confirmed them on the code, 2026-10-15.

### Facts (the lead read them on main `ba7a331a8`, after T-1445 merged)
- **F1, the partial notice is hidden:**
  - `handleCreated` in `apps/mobile/src/app/(tabs)/ais.tsx:185-210` sets the AIs tab's `Toast` ("AI created. Some settings could not be saved."), then pushes `/chat/[id]` at once, so the notice sits behind the chat.
  - Web uses a global `toast()` (`apps/web/src/components/ais/new-ai/useNewAiFlow.ts:161-163`). Mobile has no global toast.
  - The chat screen reads its route params in `apps/mobile/src/components/chat/use-chat-screen.ts:23` (`{ id, notFound? }`, file 357 lines).
  - `apps/mobile/src/components/chat/chat-thread.tsx:46-55` owns a `Toast` with `showToast(text, tone)` (file 175 lines).
- **F2, inert highlight:**
  - `ais.tsx:55-56` reads a `highlight` param and passes `highlighted` to `AiRow` (`:288`; `apps/mobile/src/components/ais/ai-row.tsx:18-32`);
  - nothing sets that param any more (the old `/ais/new` screen is gone).
- **F3, Zilar is not greyed:**
  - `apps/mobile/src/components/ui/segmented-control.tsx` (96 lines): `SegmentedOption` is `{ value, label, icon? }` (`:9-14`), and every option is pressable (`:68-79`);
  - the Setup step passes `COMPUTER_OPTIONS` (`apps/mobile/src/components/ais/new-ai/setup-step.tsx:14`, `:36-43`);
  - the flow ignores `cloud` when it is off (`apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts:383`, in `setComputer`) and exposes `cloud`.
  - Web greys a disabled option (`apps/web/src/components/ui/segmented-control.tsx:104-135`: `opacity-50`, `aria-disabled`).

### What to build
1. **F1:**
   - `handleCreated` pushes `/chat/[id]` with `params: { id: ai.jid, notice: 'partial' }` when the save was partial, and stops setting the AIs-tab toast for that case;
   - `use-chat-screen.ts` reads an optional `notice` param and returns it;
   - `chat-thread.tsx` shows it once as a `notice` toast ("AI created. Some settings could not be saved."), then clears the param (`router.setParams({ notice: undefined })`), so going back and forward does not show it again.
2. **F2:** remove the `highlight` param read in `ais.tsx` and the `highlighted` prop and its styles from `ai-row.tsx`.
3. **F3:** `SegmentedOption` gains `disabled?: boolean`. A disabled option:
   - is not pressable;
   - draws at `opacity-50`;
   - has `accessibilityState` `disabled: true`.

   `setup-step.tsx` marks Zilar disabled when `flow.cloud` is false.
4. **Every file stays at 400 lines or fewer.**

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/app/(tabs)/ais.tsx`, `apps/mobile/src/components/ais/ai-row.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`, `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/ui/segmented-control.tsx`, `apps/mobile/src/components/ais/new-ai/setup-step.tsx`
- `work/T-1472-mobile-new-ai-followups.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- On the lead's emulator walk, Zilar shows greyed in Setup in mock (cloud off).

---

## Report (written by the worker when done)

### What I did
All three follow-ups from the T-1445 pre-review, on branch `task/T-1472-mobile-new-ai-followups`.

**F1 — the partial-save notice now shows on the new chat.**
- `apps/mobile/src/app/(tabs)/ais.tsx`: `handleCreated` pushes `/chat/[id]` with `params: { id: ai.jid, notice: 'partial' }` when the save was partial; it no longer sets the AIs-tab toast for that case. Since that was the only writer of the local `toast` state, I removed the now-unreachable `toast` state, the `<Toast>` render and the `Toast`/`ToastMessage` import (dead code otherwise).
- `apps/mobile/src/components/chat/use-chat-screen.ts`: reads an optional `notice` param (`useLocalSearchParams<{ id: string; notFound?: string; notice?: string }>`) and returns it as `notice`.
- `apps/mobile/src/components/chat/chat-thread.tsx`: a new effect shows it once as a `notice` toast (`"AI created. Some settings could not be saved."`) and then clears the param with `screen.router.setParams({ notice: undefined })`, so going back and forward does not show it again.

**F2 — the inert highlight plumbing is gone.**
- `ais.tsx`: removed the `useLocalSearchParams` read of `highlight`, the `highlightId` value and the `highlighted` prop passed to `AiRow` (plus the now-unused `useLocalSearchParams` import).
- `apps/mobile/src/components/ais/ai-row.tsx`: removed the `highlighted` prop and its conditional styles, collapsed the `cn(...)` call to a plain class string and dropped the now-unused `cn` import.

**F3 — Zilar greys out with cloud off.**
- `apps/mobile/src/components/ui/segmented-control.tsx`: `SegmentedOption` gains `disabled?: boolean`; a disabled option sets `disabled` on the `Pressable` (not pressable), adds `opacity-50`, and merges `disabled: true` into `accessibilityState`. The `onPress` guard also checks `disabled`.
- `apps/mobile/src/components/ais/new-ai/setup-step.tsx`: `computerOptions` maps `COMPUTER_OPTIONS`, marking the `cloud` ("Zilar") option `disabled: !flow.cloud`.

### Files changed
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/components/ais/ai-row.tsx`
- `apps/mobile/src/components/ais/new-ai/setup-step.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/ui/segmented-control.tsx`
- `work/T-1472-mobile-new-ai-followups.md` (status + this report)

### Commands and real results
- `pnpm install` — done in 12.1s, no errors (one pre-existing peer-dependency warning: `@types/react-dom 19.3.0` wants `@types/react ^19.3.0`, found 19.2.18).
- `pnpm exec prettier --write <the six changed source files>` — only `ais.tsx` needed reformatting (the `router.push` object and the collapsed `AiRow` line); the other five were unchanged.
- `pnpm gate` (from the repo root) — summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Pre-review fixes and emulator must-fix
PREREVIEW nits fixed: the toast shows only for `'partial'`, and the effect no longer depends on the whole `screen` object. The lead's emulator check then found the partial notice still never showed: `setParams({ notice: undefined })` dropped the toast state on the route re-render/remount. Switched to the proven `notFound` pattern with no `setParams`: `use-chat-screen.ts` now holds `const [partialNotice, setPartialNotice] = useState(params.notice === 'partial')` (both returned), and `chat-thread.tsx` mirrors the `jumpMissed` effect — `if (screen.partialNotice) { showToast('AI created. Some settings could not be saved.', 'notice'); screen.setPartialNotice(false); }`. Gate re-run after the change still ends `GATE PASS` (above).

### Tests
None written: the spec says "Tests: None (UI)". Per AGENTS.md I did not run a separate single test file; `pnpm gate` ran the nearest mobile tests (PASS, 1.6s).

### Deviations from the spec
- In `ais.tsx` I removed the local `toast` state and the `<Toast>` element, not just the partial-case `setToast`: `handleCreated` was their only writer, so keeping them would have left dead code (AGENTS.md "Don't leave dead code"). Behaviour change is only that the notice no longer renders behind the pushed chat.

### Open questions / notes
- Acceptance "Zilar shows greyed in Setup in mock (cloud off)" is a UI/emulator check the lead runs; I cannot verify it here. The code path is: `flow.cloud` false → the `cloud` option gets `disabled: true` → `Pressable disabled` + `opacity-50` + `accessibilityState.disabled`.
- Cloud can never be the selected computer while disabled because `setComputer` ignores `'cloud'` when `!cloud` (`use-new-ai-flow.ts:383`), so a disabled-but-selected style clash does not arise.

## Review (written by Claude)
Lead, 2026-10-15: approved. The final pre-review is CLEAN, nit 1 (a stale timing figure in the Report).
- **The emulator caught the first version:** the `setParams` clear dropped the notice, so it never showed. The fix uses local state, like `notFound`.
- **Re-checked:**
  - a deep link with `notice=partial` shows "AI created. Some settings could not be saved." on the chat;
  - Create still lands in the new chat;
  - the highlight code is gone.
- **Correction to the acceptance line:** mock reports cloud on (`routes.ts:40`), so Zilar is rightly enabled there. The disabled path (`opacity-50`, not pressable, `accessibilityState.disabled`) was read in the diff.
