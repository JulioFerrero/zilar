---
id: T-1517
title: "Phone My AIs with health (approved AI health canvas, twin of T-1510): a shared chat-core aiHealth helper; each row shows the health dot on the picture, the reason line with a fix link, today's spend with a limit bar; no status words"
status: merged
milestone: M5
branch: task/T-1517-mobile-ai-health
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1517: Phone My AIs with health

## Spec (written by Claude, do not edit)

### Why
Julio approved the AI health design on 2026-10-15. Read `docs/design/mockups/ai-health/README.md` and `Phone.dc.html`. Web shipped as T-1510; its rules are in `apps/web/src/components/ais/AiHealthRow.tsx`, the reference for the states and texts. This is the phone twin.

To keep web and phone in step, the health rules move into one pure helper in `packages/chat-core`. The phone uses it here; web will switch to it in a later touch.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/(tabs)/ais.tsx` (328 lines):**
  - `AisScreenShell` with the subtitle "Your AIs, their model and their spending limits." (`:244`) and a "Create AI" `IconButton` (`Plus`);
  - the list renders `AiRow`s whose press opens `AiActionsSheet` (`:279-281`).
- **`apps/mobile/src/components/ais/ai-row.tsx` (47 lines):** a 44 px `EntityAvatar` (`ai`), the name, `AiBadge`, a status word badge (`runStateLabel`), `template · model`, and `formatLimits(limits)`.
- **`apps/mobile/src/lib/ais-api.ts`:** `PublicAi` (`:28-50`) and `toPublicAi` (`:119-135`) drop the wire's `usage` and `lastFailure`. The contract has them: `usage` is `{ todayUsd, windowUsd } | null` optional, and `lastFailure` is `{ kind, at } | null` optional (`packages/api-contract/src/ais.ts`).
- **The web rules (T-1510)**, first match wins:
  1. `status !== 'active'`: "Stopped", grey dot;
  2. `lastFailure`: red; the reason and fix by kind are `key_rejected` "Key rejected" with "Replace key", `model_not_found` "Model not found" with "Change model", `rate_limited` "Rate limited", `budget` "Provider budget reached", `context_too_long` "Too much context", `timeout` "Timed out", anything else "Last reply failed";
  3. paused (`limits.perDayUsd !== null && usage != null && usage.todayUsd >= limits.perDayUsd`): amber, "Daily limit reached";
  4. otherwise: green, "Working".
- **The spend:** `usage` null gives "—"; no limit gives `$0.42`; with a limit, `$0.00 / $2` and a 72 × 4 bar (amber when full).

### Steps
1. **New `packages/chat-core/src/ai-health.ts`** (export it from the package index):
   - `aiHealth(ai: { status; limits: { perDayUsd: number | null }; usage?: { todayUsd: number } | null; lastFailure?: { kind: string } | null }): { state: 'working' | 'failing' | 'paused' | 'stopped'; reason?: string; fix?: 'replace_key' | 'change_model' }`, implementing the rules above;
   - `formatUsd(value)` (the same output as web's);
   - `spendFraction(ai)`, a number in 0..1, or `null` when there is no limit or no usage.
   - Add a small test, `packages/chat-core/src/ai-health.test.ts`, covering the four states and the reason table.
2. **`apps/mobile/src/lib/ais-api.ts`:** `PublicAi` gains `usage?: { todayUsd: number; windowUsd: number } | null` and `lastFailure?: { kind: string; at: string } | null`, mapped in `toPublicAi`.
3. **`apps/mobile/src/components/ais/ai-row.tsx`, redrawn after `Phone.dc.html`:**
   - a 40 px `EntityAvatar` (`ai`) with a 12 px health dot at its lower right (ring 2 px in the surface colour, `accessibilityLabel` "Working" / "Failing" / "Paused by its limit" / "Stopped"), coloured green, red, amber or muted;
   - the name (16 px, 600) and `AiBadge`;
   - the muted line (14 px):
     - when failing, the reason in red, then " · ", then a pressable fix text: "Replace key" goes to `/settings/connections`, and "Change model" goes to `/ais/<id>`;
     - when paused, "Daily limit reached" in amber, " · ", then the model;
     - when stopped, "Stopped · <model>";
     - otherwise, the model;
   - at the right, the spend in mono 12 px, and under it the 72 × 4 bar when there is a limit.
   - The row press stays (it opens the actions sheet). Remove the status word, the template label and `formatLimits`.
4. **`ais.tsx`:**
   - drop the shell subtitle;
   - the add key's label is "New AI";
   - the list is one rounded card (`overflow-hidden rounded-2xl border border-divider bg-surface`, rows divided by a hairline).

### Not in scope
- web;
- the server;
- `AiActionsSheet`;
- the AI screen.

### Allowed files
- `packages/chat-core/src/ai-health.ts` (new)
- `packages/chat-core/src/ai-health.test.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/mobile/src/lib/ais-api.ts`
- `apps/mobile/src/components/ais/ai-row.tsx`
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `work/T-1517-mobile-ai-health.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/ai-health.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- On the phone mock:
  - **Dev-1:** green dot, `gpt-4o`, `$0.42`;
  - **QA-1:** red dot, "Key rejected · Replace key", `—`;
  - **Marketing AI:** amber dot, "Daily limit reached · claude-sonnet-5", `$5.00 / $5` with a full amber bar.
- No status words.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

- Added the shared, pure health helper `packages/chat-core/src/ai-health.ts` (`aiHealth`, `formatUsd`, `spendFraction`, types `AiHealthState`/`AiFix`/`AiHealth`/`AiHealthInput`) implementing the T-1510 rules first-match-wins (stopped → failing → paused → working), the failure-kind reason table and the two fixes, plus `packages/chat-core/src/ai-health.test.ts` (9 tests: four states, reason table, fixes, fail-over-pause, `formatUsd`, `spendFraction`). Exported it from `packages/chat-core/src/index.ts` (one added line, above `./ai-limits`).
- `apps/mobile/src/lib/ais-api.ts`: `PublicAi` gained `usage?: { todayUsd; windowUsd } | null` and `lastFailure?: { kind; at } | null`, mapped in `toPublicAi` (`ai.usage ?? null`, `ai.lastFailure ?? null`); comment updated.
- `apps/mobile/src/components/ais/ai-row.tsx`: redrawn after `Phone.dc.html` — 40 px `EntityAvatar` with a 12 px health dot (2 px `border-surface` ring, `accessibilityLabel` Working / Failing / Paused by its limit / Stopped, green / red / amber / muted), name (16/600) + `AiBadge`, the 14 px muted line (failing: reason in red + a pressable `Replace key` → `/settings/connections` or `Change model` → `/ais/[id]`; paused: amber "Daily limit reached · model"; stopped: "Stopped · model"; else the model), and the right column with the mono 12 px spend and the 72 × 4 bar (amber when full). Row press stays (opens the actions sheet); removed `ChevronRight`, the status-word badge, the template label and `formatLimits`.
- `apps/mobile/src/app/(tabs)/ais.tsx`: dropped the shell subtitle, the add key is now `label="New AI"`, and the ready list is one card (`overflow-hidden rounded-2xl border border-divider bg-surface`, rows split by a `border-b border-divider` hairline on every row but the last, via a new `last` prop on `AiRow`).

### Checks run

- `pnpm --filter @zilar/chat-core exec vitest run src/ai-health.test.ts --reporter=dot` → `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
- `pnpm gate` (from the repo root) → exit 0, `GATE PASS`, summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (0.9s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.2s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/chat-core  (2.4s)
  PASS  tests @zilar/mobile  (2.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- `git status --porcelain`: the 7 changed files are exactly the Allowed files (2 new, 5 modified).

### Notes for the lead

- **Deviation (small):** for a failing kind with no fix (`rate_limited`, `budget`, `context_too_long`, `timeout`, unknown) the muted line is `reason · model`, mirroring the web reference `AiHealthRow.tsx`; the spec's step 3 only spelled out the two fix cases. The helper returns `reason` only for the `failing` state (the field is optional); the paused and stopped words ("Daily limit reached", "Stopped") are the fixed strings from the spec, kept in the row as web does.
- **Deviation (native vs. web):** the health-dot ring is a 2 px `border-surface` (native has no `ring`), the same pattern as the avatar online dot in `apps/mobile/src/components/chat/avatar.tsx`.
- **Task text vs. mockup:** the spec text says a 40 px avatar and a 72 × 4 bar, while `Phone.dc.html` draws 48 px and 56 px; I followed the task text. Row dividers use `border-b border-divider` (the repo's `ApprovalRow`/`Card` pattern) rather than an explicit hairline width.
- **Review fix:** the muted line is now one `Text` with nested `Text` spans (reason, " · ", model or the fix link) and `numberOfLines={2}`, so it reads as a whole sentence and wraps instead of truncating each piece.
- The rows are ready-state UI only; per `AGENTS.md` UI gets no tests, so no mobile test was added. I did not run the phone app (the lead's smoke covers that).

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit and 2 follow-ups, for head `4b992c578`, after one lead fix round: the muted line is now one wrapping `Text`.
- **Phone smoke (mock build, emulator):** `/ais` passed.
  - "My AIs" with the Add key, and one rounded list:
    - **Dev-1:** green dot, `gpt-4o`, `$0.42`;
    - **QA-1:** red dot, "Key rejected · Replace key", `—`;
    - **Marketing AI:** amber dot, "Daily limit reached · claude-sonnet-5" wrapping to two lines, and `$5.00 / $5` with a full amber bar.
  - No status words.
- **Shared:** the health rules now live in `packages/chat-core/src/ai-health.ts`, with a test. Web can switch to it next time it touches `AiHealthRow.tsx`.
- **Follow-ups:** `runStateLabel` and `formatLimits` on the phone are now unused.

