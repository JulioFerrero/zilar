---
id: T-1419
title: "UX task D: the task card UI on web and mobile (one line collapsed: title, spinner or state icon, elapsed; expands to the step checklist and summary) and clients apply a correction's payload to the card"
status: merged
milestone: M5
branch: task/T-1419-task-card-ui
model: auto
effort: default
depends_on: [T-1414]
estimate: 0.8 day
---

# T-1419: Task card UI (web + mobile)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs work in the background without spamming the chat. There's one task card per task, **collapsed by default**, edited in place (`docs/design/agent-system.md` §4.3; `docs/audit/agent-ux-plan.md` §2.2 and Task D).

T-1414 (merged) made the server send one card per turn and update it with **corrections that carry the full payload**: `title`, `steps`, `state`, `summary`, `started_at` and `elapsed_ms` (`packages/protocol/src/progress.ts`). **Clients don't apply that payload yet,** so a card stays frozen on its first stage. This task fixes that and draws the new card.

**The Stop button is not in this task** (it comes with the Stop route, Task E).

### Facts (the lead checked them on main, 2026-10-14)
- **The protocol:** `ProgressSchema` in `packages/protocol/src/progress.ts` (T-1414). `stage` is still required; new optional fields: `title`, `steps[] {id, label, state: planned|doing|done|failed}`, `started_at`, `elapsed_ms`, `summary`, `state: working|done|failed|stopped` and `can_stop`.
- **The xmpp-core correction stanza** now carries the `<agent>` payload (`packages/xmpp-core/src/stanza/build-outgoing.ts`, `payload-element.ts`). Check how an incoming stanza exposes its payload/card (`ChatMessage` in `packages/xmpp-core/src/types.ts`) and whether the parser keeps it on a correction.
- **Edits:** `packages/client-core/src/store/ledger-edits.ts` (295 lines). `editUpdateFor` at `:25-55` turns a correction into `{ kind: 'correction', targetId, text, mentions? }` and ignores a correction without a body; `applyEditUpdate` is at `:57-67`.
  
  Find where the edit text is merged into the rendered message (`applyEdit` and `refreshEdits`), and add the card the same way: **a correction with a progress payload replaces the target's `card`**.
  
  Check whether mobile uses the same client-core ledger. `apps/mobile/src/store/effects/chat-rows.ts:14-20` says edits go through `ingestEdit`. If mobile has its own path, fix it there too.
- **Web:**
  - `apps/web/src/components/ProgressCard.tsx` (40 lines: spinner, `stage`, `detail` and a `percent` bar);
  - rendered from `apps/web/src/components/message/AttachmentBody.tsx:247`.
- **Mobile:**
  - `apps/mobile/src/components/chat/progress-card.tsx` (28 lines);
  - rendered from `apps/mobile/src/components/chat/payload-card.tsx:26`.
- **The mock:** `packages/mock-backend/src/domains/messages/builders.ts` (`progressCard`, extended in T-1414). The web mock topic "Dev team › General" shows a "Writing release notes" card.
- Julio's rule: **icons, not emoji**. Web uses `lucide-react`; check which icon set mobile uses in nearby files.

### What to build
1. **Apply the card on corrections** (client-core and mobile if separate):
   - when a correction carries a progress payload, the target message's `card` becomes that payload;
   - **ordering:** an older correction never overwrites a newer one; use the same `order` the text edits use;
   - a correction with a payload but an empty body still updates the card.
2. **The card, web and mobile**, matching each other.
   - **Collapsed** (the default) is one line: an icon, the `title` (or `stage` if there's no title), and the elapsed time.
     - The icon is a spinner while `state` is working or absent; a check when done; an alert when failed; a square when stopped.
     - The elapsed time ticks while working, from `started_at`, once per second, and is shown frozen when it's over (from `elapsed_ms`).
   - **Tap or click to expand:**
     - the step checklist: one row per step with a state icon (planned = empty circle, doing = spinner, done = check, failed = x), then the label;
     - then `summary` when it's set.
   - **Remove the `percent` bar** (the progress is the checklist now). Keep showing `stage` and `detail` when `steps` is absent, so an old server still renders.
   - Respect reduced motion (the web already does, via `useMediaQuery`).
3. **Mock:** make the "Dev team › General" card a real example: a title, 3 steps (done, doing, planned) and `started_at` a minute ago. Add one finished card somewhere else in the mock (state done, a summary, 4 steps, one of them failed), so both looks can be checked.

### Tests
None (UI). If the client-core ledger has edit tests, add one case: a correction with a progress payload replaces the card, and an older one doesn't win.

### Read first
`AGENTS.md`, `docs/audit/agent-ux-plan.md` §2.2 and Task D, `packages/protocol/src/progress.ts`, and the files above.

### Allowed files
`packages/client-core/src/store/**`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/stanza/**`, `apps/web/src/components/ProgressCard.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/mobile/src/components/chat/progress-card.tsx`, `apps/mobile/src/components/chat/payload-card.tsx`, `apps/mobile/src/store/**`, `packages/mock-backend/src/domains/messages/**`, `work/T-1419-task-card-ui.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- **Web `?mock=1`:** the General card is one line with a ticking time, and expands to 3 steps. The finished card shows a check and its summary.

---

## Report (written by the worker when done)

### What I did

**1. Clients apply the card on corrections (`packages/client-core/src/store`).**
`@zilar/chat-core`'s edit reducer is not in the Allowed files and its `CorrectionEntry`
holds only text/mentions, so the card is carried in client-core beside the edit state:

- `ledger-types.ts`: new `CardEdit` (`order`, `author`, `payload`) and a seventh
  `LedgerMaps` map, `cards: Map<string, CardEdit>`.
- `ledger-edits.ts`: `cardEditFor` reads a correction whose payload is `progress`
  (a body-less correction counts); `rememberCard` stores it under `aliasRoot(targetId)`
  and refuses an older `order` or a different author, exactly like a text correction.
  `withEdits` now applies the text edit (`applyTextEdits`) and then overlays the card
  (`cardFor`, gated on `isSameAuthor` against `authorFor(message.id)`).
  `refreshEdits` no longer returns early when only a card changed, and `ingestEdit`
  refreshes on a card-only correction.
- `ledger-ids.ts`: `migrateCardEntries` keeps the newest card when two ids merge;
  `forgetMessages` drops the card entry. `ledger.ts` creates and clears the map in
  `reset()`. Mobile uses the same client-core ledger (`apps/mobile/src/store/effects/*`),
  so no separate mobile path was needed.

**2. The card (web `apps/web/src/components/ProgressCard.tsx`, mobile
`apps/mobile/src/components/chat/progress-card.tsx`), matching each other.**
Collapsed is one line: state icon (spinner while `working`/absent, check `done`,
`CircleAlert` `failed`, square `stopped`), `title ?? stage`, and the elapsed. Tap/click
expands to the step checklist (planned circle / doing spinner / done check / failed x)
and then `summary`. The `percent` bar is removed. Without `steps` the old
`stage`+`detail` shape still renders. Elapsed ticks from `started_at` while working
(an Effect-fiber timer, no `setInterval`, per the repo ratchet) and is frozen from
`elapsed_ms` when over. Icons are lucide (`lucide-react` / `lucide-react-native`), no
emoji. Web keeps the reduced-motion spinner (`useMediaQuery`); mobile passes
`animating={!reduceMotion}` via `react-native-reanimated`.

**3. Mock (`packages/mock-backend/src/domains/messages/threads`).**
`dev-team.ts` `dev-28` ("Writing release notes" in Dev team › General) is now a real
card: title, 3 steps (done, doing, planned) and `started_at` a minute before load.
`dev-ai.ts` gets a finished card (`dai-8`: `state: 'done'`, `elapsed_ms`, a summary and
4 steps, one failed). The builder needed no change.

### Files changed

- `packages/client-core/src/store/ledger-types.ts`, `ledger.ts`, `ledger-edits.ts`,
  `ledger-ids.ts`, `ledger.test.ts`
- `apps/web/src/components/ProgressCard.tsx`
- `apps/mobile/src/components/chat/progress-card.tsx`
- `packages/mock-backend/src/domains/messages/threads/dev-team.ts`, `threads/dev-ai.ts`
- `work/T-1419-task-card-ui.md`

All inside the task's Allowed files (confirmed by the gate's `scope` line).

### Tests

Added one case to `packages/client-core/src/store/ledger.test.ts`: a correction with a
progress payload replaces the target's card (body-less), an older correction does not
win, and a correction from another author is ignored.

Commands run:

- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts`
  — `Test Files 1 passed (1) / Tests 16 passed (16)` (ran twice, same result).
- `pnpm gate` (final) — `GATE PASS`:
  ```
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.6s)
  PASS  lint  (0.6s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/client-core  (5.8s)
  PASS  tests @zilar/mobile  (1.1s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```
  (Two earlier gate runs failed: lint `react(set-state-in-effect)` and then the effect
  ratchet on `setInterval`; both fixed by moving the tick to an Effect fiber.)

### Problems / deviations

- **Authorization on card corrections.** The spec did not mention it, but a correction
  must come from the target's author or a hostile group member could rewrite an AI's
  card. `rememberCard` and `cardFor` both check `isSameAuthor`, mirroring
  `chat-core`'s text-correction rule. When the target is not loaded yet the check is
  deferred to render time.
- **`started_at` in the mock** is `now - 60s` at module load (the mock's existing
  `approvalCard` already dates against `Date.now()`), so the General card ticks from
  about a minute when the page loads.
- **Not live-checked.** I verified the card logic by code and by the gate; I did not
  open web `?mock=1` in a browser, so the acceptance screenshot check is for the lead's
  smoke.

### Open questions

None.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 3.
- Web ?mock=1 (headless): the Dev team General card is one line (spinner, 'Writing release notes', ticking 1m 3s); a click expands it to 3 steps (done, doing, planned).
- Phone smoke PASS (/, /chat/dev-team@rooms.zilar.test): the same collapsed card; the long title truncates in the narrow bubble, which is acceptable.
