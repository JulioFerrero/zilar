---
id: T-1394
title: "Provider picker becomes a searchable dropdown (web Base UI Select, mobile native sheet list) in the add-key form and the AI wizard; GitHub is hidden from the Create an AI flow (it is not an LLM provider)"
status: merged
milestone: M5
branch: task/T-1394-provider-dropdown
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1394: Provider dropdown

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, looking at the inline add-key form in Create an AI step 3: "provider can it be a drop down". The list will grow (models.dev catalog T-1395, OpenAI-compatible T-1396), so chips don't scale. Also, **GitHub** shows in the AI wizard although a GitHub key can't run an AI: the server already refuses it (`apps/server/src/ais/litellm-model.ts:6-7`, `isLlmProvider`, error `connection_not_llm`).

**Today's chip lists:**
- `apps/web/src/components/connections/AddConnectionForm.tsx:12` (`PROVIDERS`);
- `apps/mobile/src/components/connections/add-connection-form.tsx:16` (`PROVIDERS`);
- the wizard pickers: `apps/web/src/components/ais/ConnectionPicker.tsx`, `apps/mobile/src/components/ais/provider-picker.tsx`.

Web primitives are **Base UI** (`@base-ui/react`, never Radix; see `apps/web/src/components/ui/menu.tsx`). Mobile sheets are the native true-sheet kit (`apps/mobile/src/components/ui/bottom-sheet.tsx`).

### What to build
1. **Web:** a kit `Select` in `apps/web/src/components/ui/select.tsx` on Base UI `Select`, styled like `menu.tsx`, keyboard-accessible, with a filter input when there are more than 8 options. Use it for the provider in `AddConnectionForm.tsx`.
2. **Mobile:** `apps/mobile/src/components/ui/select-sheet.tsx`, a field that shows the current value and opens the `BottomSheet` with a list of options (a search field when there are more than 8, checkmark on the selected one). Use it in `add-connection-form.tsx`.
3. **Hide GitHub from Create an AI** on both apps:
   - the add-key forms take an optional `providers` prop (default: all); the wizard passes the LLM providers only;
   - the wizard's connection pickers drop connections whose provider is `github`, and the "no key" empty state counts only LLM connections;
   - put the LLM-provider list in one shared place (`packages/chat-core/src/ai-models.ts` or a new `packages/chat-core/src/ai-providers.ts`), with the same ids as `LITELLM_MODEL_PREFIX` in `apps/server/src/ais/litellm-model.ts:8-15`.
4. **Settings → Connections** still lists every provider, GitHub included.
5. **Tests:** none (UI). Every file stays at most 400 lines.

### Read first
`AGENTS.md`, the files above, `apps/web/src/components/ui/menu.tsx`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/mobile/src/components/ais/provider-step.tsx`.

### Allowed files
`apps/web/src/components/ui/select.tsx`, `apps/web/src/components/ui/select.fixture.tsx`, `apps/web/src/components/connections/AddConnectionForm.tsx`, `apps/web/src/components/ais/ConnectionPicker.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/mobile/src/components/ui/select-sheet.tsx`, `apps/mobile/src/components/connections/add-connection-form.tsx`, `apps/mobile/src/components/ais/provider-picker.tsx`, `apps/mobile/src/components/ais/provider-step.tsx`, `apps/mobile/src/components/ais/providers.ts`, `apps/mobile/src/app/ais/new.tsx`, `packages/chat-core/src/ai-models.ts`, `packages/chat-core/src/ai-providers.ts`, `packages/chat-core/src/index.ts`, `work/T-1394-provider-dropdown.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check** (web mock plus the phone):
  - the provider is a dropdown in Settings → Connections and in the wizard;
  - GitHub is absent from the wizard but present in Connections.

---

## Report (written by the worker when done)

### What I did

1. **Shared provider list** (`packages/chat-core/src/ai-providers.ts`, exported from `index.ts`): `AI_PROVIDERS` (all seven, GitHub included), `AI_PROVIDER_IDS`, `LLM_PROVIDER_IDS` (the six the server's `LITELLM_MODEL_PREFIX` accepts, GitHub absent), `LLM_PROVIDERS`, `isLlmProvider` and `providerLabel`. Web and mobile now read labels and the LLM subset from this one place. `ai-models.ts` is unchanged.

2. **Web kit `Select`** (`apps/web/src/components/ui/select.tsx`) on Base UI `Select` (`@base-ui/react/select`), styled like `menu.tsx` (same PANEL/ITEM classes), keyboard support from Base UI (arrows, Home/End, typeahead, Escape, focus back to the trigger), and a filter input above the list when there are more than 8 options. A react-cosmos fixture is in `select.fixture.tsx` (default and filterable).

3. **Web add-key form** (`AddConnectionForm.tsx`): the native `<select>` is replaced by the kit `Select`; the form takes an optional `providers` prop (default: every provider) and `providerLabel` is re-exported from chat-core so `ConnectionsPage` is untouched. The wizard (`NewAiDialog.tsx`) passes `LLM_PROVIDERS` and filters the connection list to LLM providers, so the "no key" empty state counts only LLM connections; `ConnectionPicker.tsx` also drops non-LLM connections.

4. **Mobile kit `SelectSheet`** (`apps/mobile/src/components/ui/select-sheet.tsx`): a field that shows the current value and opens the native `BottomSheet` with the options, a checkmark on the selected row, and a `SearchField` when there are more than 8 options.

5. **Mobile add-key form** (`add-connection-form.tsx`): the chips are replaced by `SelectSheet`; the form takes an optional `providers` prop (default: all ids). `provider-step.tsx` passes `LLM_PROVIDER_IDS`. `new.tsx` filters the active connection list to LLM providers, and `provider-picker.tsx` drops non-LLM connections too. `providers.ts` now re-exports `providerLabel` from chat-core.

Settings → Connections is untouched on both apps, so every provider (GitHub included) is still offered there: `ConnectionsPage.tsx` (web) and `settings/connections.tsx` (mobile) render `AddConnectionForm` with the default provider list.

### Files changed (all inside Allowed files)

`packages/chat-core/src/ai-providers.ts` (new), `packages/chat-core/src/index.ts`, `apps/web/src/components/ui/select.tsx` (new), `apps/web/src/components/ui/select.fixture.tsx` (new), `apps/web/src/components/connections/AddConnectionForm.tsx`, `apps/web/src/components/ais/ConnectionPicker.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/mobile/src/components/ui/select-sheet.tsx` (new), `apps/mobile/src/components/connections/add-connection-form.tsx`, `apps/mobile/src/components/ais/provider-picker.tsx`, `apps/mobile/src/components/ais/provider-step.tsx`, `apps/mobile/src/components/ais/providers.ts`, `apps/mobile/src/app/ais/new.tsx`, `work/T-1394-provider-dropdown.md`.

### Commands I ran

- `pnpm install` — done, 12.1s (a pre-existing `@types/react` peer warning in mobile).
- `pnpm exec prettier --write` on the changed files — all reported "unchanged".
- `pnpm gate` — first run FAILed on lint only: `apps/mobile/src/app/ais/new.tsx:2:10 Identifier 'LLM_PROVIDER_IDS' is imported but never used` (I had imported it but only used `isLlmProvider`). I removed the unused import and re-ran.
- `pnpm gate` (second run) — **GATE PASS**:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.7s)
  PASS  lint  (0.7s)
  PASS  typecheck  (5.5s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/chat-core  (2.0s)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No files outside the Allowed files. The only lint warnings were the pre-existing `max-lines` warnings in `apps/server` and `packages/runner-tunnel`/`devtools`, which are not mine.

Tests: no test file was written (UI, per the spec). The gate found no nearby test files for web and mobile; chat-core's tests ran and passed.

### Deviations and notes

- The task says "put the LLM-provider list in one shared place ... with the same ids as `LITELLM_MODEL_PREFIX`". I put it in chat-core as asked. chat-core does not depend on `@zilar/api-contract`, so `AI_PROVIDERS` duplicates the ids in `PROVIDER_IDS` (`packages/api-contract/src/connections.ts`); that file is outside the Allowed files, so I left it alone. Sharing one list instead would need an api-contract → chat-core dependency decision.
- The wizard's connection pickers both drop non-LLM connections, and the wizard screens also filter the list before counting, so the empty state ("Add a provider key to continue.") appears when the user has only a GitHub connection. The picker-level filter is defensive; the screen-level filter is what drives the counts.
- I could not run the phone/web smoke check myself; the acceptance's live checks are for the lead.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN (nit 2, follow-up 1: provider ids live in three places, to unify during the Effect AI work). Web checked headless in mock mode: Settings > Connections shows the Base UI dropdown with all 7 providers, GitHub included. Phone smoke PASS (mock build). On the emulator: the Connections sheet lists 7 providers and picking xAI updates the field; the wizard step 3 lists the mock connections.
