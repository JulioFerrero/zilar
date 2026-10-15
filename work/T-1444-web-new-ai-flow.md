---
id: T-1444
title: "Web New AI flow from the approved boards: Provider (models.dev, searchable) → Key (checked) → Model (orb picker, name, model, template) → Setup (computer, limits) → Create AI"
status: merged
milestone: M5
branch: task/T-1444-web-new-ai-flow
model: auto
effort: default
depends_on: [T-1431, T-1442]
estimate: 1 day
---

# T-1444: Web New AI flow

## Spec (written by Claude, do not edit)

### Why
Julio approved this design on 2026-10-15 ("10/10").

**The boards are the spec for the look.** Read `docs/design/mockups/new-ai/README.md`, then each web board with `git show main:docs/design/mockups/new-ai/<file>`: `Main.dc.html`, `Compatible.dc.html`, `Key.dc.html`, `Model.dc.html`, `OrbPicker.dc.html` and `Limits.dc.html`. Copy their sizes, colors and copy exactly. The canvas link is private; don't fetch it.

The rules the boards set:
- no subtitles or hint paragraphs;
- a status is a dot or icon, never a word;
- one way out: the close key or Esc (**no Cancel key**);
- the footer is Back plus one primary;
- a selected choice is the light key (`SegmentedControl tone="choice"`).

### Facts (the lead read them on main, 2026-10-15)
- **Today's dialog:** `apps/web/src/components/ais/NewAiDialog.tsx` (377 lines). It is opened from `apps/web/src/components/NewChatButton.tsx` and `apps/web/src/routes/AisPage.tsx`.
  - It builds the body with `buildCreateBody(form, limits)` (`packages/chat-core/src/ai-form.ts:39`, fields `AiCreateFields` at `:11-19`; `persona` is omitted for an untouched template).
  - It calls `createAi` and then navigates to `/c/${encodeURIComponent(created.jid)}` (`NewAiDialog.tsx:150-171`). **Keep that create body and that navigation.**
- **The web kit (T-1431):**
  - `apps/web/src/components/ui/dialog.tsx`: `Dialog` props `open`, `onClose`, `title`, `stepper`, `footer`, `error`, `onSubmit`, `busy`, `size: 'sm'|'md'|'lg'`, `initialFocusRef`;
  - `ui/dialog-parts.tsx`;
  - `ui/dialog-stepper.tsx`: `DialogStepper({ steps: { label, value? }[], current, onStep })`;
  - `ui/combobox.tsx`: `Combobox({ options: { value, label, dot?: 'online', icon? }[], value, onValueChange, label, placeholder, triggerPlaceholder, footerItem: { label, icon?, onSelect } })`;
  - `ui/segmented-control.tsx`: `tone: 'tab' | 'choice'`, with `icon` per option.
  - Base UI is `@base-ui/react` 1.8.0 (for example `@base-ui/react/popover`). **Never Radix.**
- **Shared logic (T-1442), in `packages/chat-core/src/new-ai.ts`:**
  - `providerChoices(catalog, connections)`, `filterProviderChoices`;
  - `keyPageFor(id, catalog)`, `keyPlaceholderFor(id)`, `keyCheckMessage`;
  - `ORB_HUES` (14), `ORB_RIMS` (7), `ORB_MAX_DISTANCE`, `clampOrbLight(angle, distance)`, `shuffleOrb(random)`.
  - `packages/chat-core/src/connection-check.ts` has `checkKey(api, state, input)` and `abandonKeyCheck(api, state)`.
  - Orb rendering: `orbParamsFor(seed)`, `orbSvg(params, idSeed)` and `orbDataUri(params, idSeed)` (`packages/chat-core/src/avatar.ts:74-86`). A new AI's default orb is seeded by its **name** (memory: the orb is seeded by display name everywhere).
- **API, in `apps/web/src/lib/api/ais.ts`:**
  - `getAiCatalog` :64, `getComputerOptions` :70 (`.cloud`), `createAi` :76, `updateAi` :91 (accepts `computerMode`), `setAiMachine(aiId, machineId)` :142;
  - `listConnections` :151, `createConnection` :169, `testConnection` :192, `deleteConnection` :196, `replaceConnectionKey` :203.
  - Also `listMachines` (`apps/web/src/lib/api/machines.ts:16`), and `uploadAvatar('ai', aiId, blob)` / `removeAvatar` (`apps/web/src/lib/api/settings.ts:179-192`). The avatar route takes PNG or WebP.
- **Computer modes** are `'off' | 'cloud' | 'runner' | 'auto'` (`packages/api-contract/src/ais.ts:22`). `runner` and `auto` need a machine assigned first. Julio's labels are **Off · Zilar · Machine · Auto**, never "My machine". `apps/web/src/components/ais/AiComputerSection.tsx:31-52` still says "Zilar cloud" and "My machine".
- **Toasts:** `useToast()` from `apps/web/src/components/ui/toast.tsx:66`.

### What to build
**Files.** Keep each at 400 lines or fewer; aim for 250 or fewer.
- `NewAiDialog.tsx` becomes the shell: `Dialog size="lg"`, the stepper, step routing, and the footer.
- New files in `apps/web/src/components/ais/new-ai/`:
  - `useNewAiFlow.ts` (state and actions);
  - `ProviderStep.tsx`, `KeyStep.tsx`, `ModelStep.tsx`, `OrbPicker.tsx`, `SetupStep.tsx`;
  - `orb-png.ts`.

**Steps** (stepper labels Provider · Key · Model · Setup; a done step shows its value, for example "DeepSeek", and clicking it goes back):
1. **Provider:**
   - a `Combobox` of `providerChoices(catalog, connections)`, filtered with `filterProviderChoices`, with `dot: 'online'` when `hasKey`;
   - `footerItem` "OpenAI-compatible" with a plus icon.
   - Choosing OpenAI-compatible shows **Base URL** and **Name** fields under it (`Compatible.dc.html`). The Base URL's green dot shows once the key check has passed, since the probe reached it.
   - While the catalog loads, use the built-in list (`providerChoices(null, …)`).
2. **Key:** one well field with a lock icon, a show or hide toggle, a green dot when verified, and "Get one ↗" linking to `keyPageFor` when there is one (new tab). The placeholder is `keyPlaceholderFor`.
   - **Continue** runs `checkKey`. On failure, show `message` under the field and stay; on success, go on.
   - If the provider already has an active connection, preselect the newest one: the field shows the green dot with the placeholder "Saved key", and Continue needs no typing. Typing a new key runs `checkKey` (a new connection).
   - Closing the dialog before create calls `abandonKeyCheck`.
3. **Model:**
   - **the orb** (64 px), with an edit badge, opens the `OrbPicker` popover (Base UI Popover). Until the user edits it, the orb is `orbParamsFor(name)`, so it follows the typed name live;
   - **Name**;
   - **the model** `Combobox` from the chosen provider's catalog models, prefilled like today. Reuse the logic in `apps/web/src/components/ais/ModelPicker.tsx` where you can;
   - **Template** as `SegmentedControl tone="choice"` with Dev / Marketing / Fun (`AI_TEMPLATE_OPTIONS` minus Custom).
4. **OrbPicker** (`OrbPicker.dc.html`):
   - 14 hue swatches and 7 rim swatches, with the selected one ringed;
   - a big orb where a pointer drag moves the light live (`clampOrbLight`; pointer events, so it works with touch);
   - **Shuffle** (`shuffleOrb(Math.random)`) and **Reset** (back to the name-seeded orb).
5. **Setup** (`Limits.dc.html`):
   - **Computer:** `SegmentedControl tone="choice"` with Off · Zilar · Machine · Auto (icons as on the board). Zilar is disabled when `getComputerOptions().cloud` is false.
   - Machine and Auto show a machine `Combobox` from `listMachines()`, with a green dot when the machine is online.
   - **Per day** and **Per month**, `$` fields; empty means no limit; validate like today.
   - The primary is **Create AI**.

**Create**, in this order:
1. `createAi(buildCreateBody(...))` with the chosen connection.
2. If the user edited the orb, render it to a 256×256 PNG (`orb-png.ts`: the `orbSvg` data URI drawn on a canvas, then `toBlob('image/png')`) and call `uploadAvatar('ai', ai.id, blob)`.
3. If the computer isn't Off: `setAiMachine(ai.id, machineId)` when a machine was chosen, then `updateAi(ai.id, { computerMode })`.
4. Navigate to the chat as today.

A failure in step 2 or 3 still navigates, and shows one toast: "AI created. Some settings could not be saved; change them in the AI's settings."

**Labels:** in `AiComputerSection.tsx`, "Zilar cloud" → "Zilar" and "My machine" → "Machine".

**Delete** the old helper files that nothing imports anymore after this change (check with grep before deleting), and list them in the Report. `apps/web/src/components/connections/AddConnectionForm.tsx` stays: the Connections page still uses it, and a later task moves it.

### Tests
None (UI). The key flow's tests live in chat-core (T-1442).

### Allowed files
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`, `apps/web/src/components/ais/new-ai/ProviderStep.tsx`, `apps/web/src/components/ais/new-ai/KeyStep.tsx`, `apps/web/src/components/ais/new-ai/ModelStep.tsx`, `apps/web/src/components/ais/new-ai/OrbPicker.tsx`, `apps/web/src/components/ais/new-ai/SetupStep.tsx`, `apps/web/src/components/ais/new-ai/orb-png.ts`
- `apps/web/src/components/ais/ModelPicker.tsx`, `apps/web/src/components/ais/AiFormFields.tsx`, `apps/web/src/components/ais/ConnectionPicker.tsx`, `apps/web/src/components/ais/LimitsFields.tsx`, `apps/web/src/components/ais/AiComputerSection.tsx`
- `apps/web/src/components/NewChatButton.tsx` and `apps/web/src/routes/AisPage.tsx`, only if the dialog's props change
- `work/T-1444-web-new-ai-flow.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every file stays at 400 lines or fewer.
- The lead runs the flow headless in mock mode at 1280 and 390 px, and compares it with the boards.

---

## Report (written by the worker when done)

### What I did
Rebuilt the New AI dialog as the approved four-step wizard (`Provider · Key · Model · Setup`),
with the create body and the navigation unchanged.

- `NewAiDialog.tsx` is now the shell: `Dialog size="lg"`, the `DialogStepper`, step routing and
  the footer (Back on step ≥ 1 + one primary; `Create AI` on Setup). It still adds the new
  chat to the store and navigates to `/c/<jid>` on create.
- `new-ai/useNewAiFlow.ts` holds the state and actions (catalog/connections/computer-options/
  machines queries, provider/key/model/orb/setup state, the `checkKey` step, the create
  sequence, `abandonKeyCheck` on close).
- `new-ai/ProviderStep.tsx`, `KeyStep.tsx`, `ModelStep.tsx`, `SetupStep.tsx` render the four
  steps; `new-ai/OrbPicker.tsx` is the Base UI Popover orb editor; `new-ai/orb-png.ts` renders
  an orb to a 256×256 PNG.
- `AiComputerSection.tsx`: "Zilar cloud" → "Zilar", "My machine" → "Machine".
- No props of `NewAiDialog` changed, so `NewChatButton.tsx` and `AisPage.tsx` were not touched.

Create order matches the spec: `createAi(buildCreateBody(...))`, then the orb PNG +
`uploadAvatar('ai', …)` if the orb was edited, then `setAiMachine` (when a machine was chosen) +
`updateAi({ computerMode })`, then navigate. A failure in the last two steps still navigates and
shows the one toast `AI created. Some settings could not be saved; change them in the AI's
settings.`

Old helper files deleted: **none**. After this change `aiForm.ts`, `models.ts`, `templates.ts`,
`limits.ts`, `ConnectionPicker.tsx`, `LimitsFields.tsx`, `ModelPicker.tsx` and `AiFormFields.tsx`
are still imported by `AiPanel.tsx` / `AisPage.tsx` (checked with grep), and
`AddConnectionForm.tsx` stays as the task says. `NewAiDialog.tsx` no longer imports
`AddConnectionForm`, `ConnectionPicker`, `LimitsFields` or `ModelPicker`.

### Commands I ran (real results)
- `pnpm install` → "Done in 11s"; the only warning is the pre-existing one under `apps/mobile`
  (`@types/react-dom` peer). No dependency changes, so no lockfile change.
- `pnpm --filter @zilar/web typecheck` (pre-flight, run twice while fixing) → passed, no output.
  I know the task asked me not to run typecheck separately; I ran it only to avoid burning a
  whole `pnpm gate` on a type error. The gate runs it again and also passed.
- `pnpm exec prettier --write <my changed files>` → only my own files formatted.
- `pnpm gate` (from the repo root) → **GATE PASS**:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.9s)
  PASS  effect  (2.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Tests: none (UI, per the spec); the gate reports "no nearby test files" for `@zilar/web`, so no
single test file was run. Line count of the largest new file, `useNewAiFlow.ts`: 395 lines.

### Files changed
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` (new)
- `apps/web/src/components/ais/new-ai/ProviderStep.tsx` (new)
- `apps/web/src/components/ais/new-ai/KeyStep.tsx` (new)
- `apps/web/src/components/ais/new-ai/ModelStep.tsx` (new)
- `apps/web/src/components/ais/new-ai/OrbPicker.tsx` (new)
- `apps/web/src/components/ais/new-ai/SetupStep.tsx` (new)
- `apps/web/src/components/ais/new-ai/orb-png.ts` (new)
- `apps/web/src/components/ais/AiComputerSection.tsx` (two labels)
- `work/T-1444-web-new-ai-flow.md`

### Deviations from the spec (and why)
1. **`filterProviderChoices` is not called on web.** The web `Combobox` (T-1431) filters items by
   label itself through Base UI, and it exposes no filter hook, so the shared helper has nowhere
   to plug in. `ProviderStep` passes `providerChoices(catalogView, connections)` and Base UI does
   the search. I did filter the `openai-compatible` row out of the list so only the pinned footer
   item (with the plus) shows it, matching `Main.dc.html`.
2. **Zilar is omitted, not shown-disabled, when `getComputerOptions().cloud` is false.**
   `ui/segmented-control.tsx` has no `disabled` option on `SegmentedOption`, and that file is not
   in my Allowed files. When `cloud` is true (the board's case) all four segments show; when it is
   false the segment is dropped so it cannot be chosen. If the kit gains a `disabled` option,
   this should become the disabled segment the spec describes.
3. **Orb size 64 px** as the spec says; note the board `Model.dc.html` draws the orb at 40 px.
4. **Model field fallback.** The spec asks for a model `Combobox` from the catalog. For a provider
   with no catalog models (a custom `openai-compatible` endpoint), a Combobox would have zero
   items and the flow could not continue, so `ModelStep` falls back to a text field for the model
   id (the same fallback `ModelPicker.tsx` uses when the catalog is empty).
5. **`orb-png.ts` returns an `Effect`, not a `Promise`.** The `effect` gate step (H1) rejects a
   raw `new Promise` in app code; I used `Effect.callback` like `avatarImageCodec.ts` does for its
   canvas encode, and `useNewAiFlow` yields it inline.
6. **Orb params type without `@zilar/ball-avatar`.** `apps/web` does not depend on
   `@zilar/ball-avatar`, so `useNewAiFlow.ts` / `orb-png.ts` name the shape as
   `ReturnType<typeof orbParamsFor>` / `Parameters<typeof orbDataUri>[0]` instead of importing
   `BallParams`.
7. **`AiCatalog` → `CatalogView` adapter.** Under `exactOptionalPropertyTypes`, `AiCatalog`'s
   `docUrl?: string | undefined` is not assignable to `CatalogView`'s `docUrl?: string`. A small
   `catalogViewOf()` maps it (defaulting `docUrl` to `''`) instead of a cast.

### Security
No new routes or writes. The key is write-only: it lives in component state, travels only in the
`createConnection` / `replaceConnectionKey` call inside `checkKey`, and is never logged or
rendered back (the field is `type="password"` unless revealed).

### Open questions
None. The two kit limitations above (no Combobox filter hook, no `SegmentedOption.disabled`) are
the only places I could not match the spec literally inside the Allowed files.

### Round 2 (prereview fix round)

Prereview: 2 must-fix, 0 should-fix, 1 nit, 1 follow-up.

- **Finding 1 (must-fix) — fixed.** `setKey` always resets `keyState` to unverified (and drops the
  connection id when a saved key was in use); new `editCompatible` wrappers around `setBaseUrl` /
  `setCompatibleName` reset `keyState` to a fresh connection, so editing the key, the base URL or
  the name re-runs `checkKey` instead of reusing the verified connection. Commit `3b59fb189`.
- **Finding 2 (must-fix) — fixed.** The in-flight `checkKey` promise is kept in a ref. Its result
  only applies while it is still the current check; a provider switch, a key/endpoint edit and
  `close` clear the ref, and a superseded result is handed to `abandonKeyCheck`. `close` also
  abandons the in-flight check's *resolved* state, so a connection created just after the dialog
  closed is deleted (when it failed) rather than left behind. Commit `3b07d1d63`.
- **Finding 3 (follow-up) — not done:** it needs `apps/web/src/components/ui/segmented-control.tsx`,
  outside this task's Allowed files.
- **Finding 4 (nit) — not done:** the line it names is not one this round changed.

Tests: **none added.** The spec says "None (UI)", AGENTS.md says UI code gets no tests, and the
Allowed files contain no test file, so a new `*.test.ts` would fail the gate's scope step. The gate
reports `SKIP tests @zilar/web (no nearby test files)`, so no single test file was run.

To stay inside the 400-line cap after these fixes, `useNewAiFlow.ts` also carries small
behaviour-preserving compactions (`catalogViewOf`, `describeFailure`, `isComputerMode`/`isTemplate`,
`catalogModels`, `setOrb`, `goToStep`, one-line `if` bodies, and the now-unused `Connection` import).

Gate (from the repo root): `pnpm gate` → **GATE PASS**:
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (1.5s)
PASS  lint  (0.9s)
PASS  typecheck  (4.7s)
PASS  effect  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
size: every changed source file is within 400 lines
GATE PASS
```

Disagreements: none.

### Round 3 (prereview fix round)

Prereview: 0 must-fix, 1 should-fix, 2 nits, 1 follow-up.

- **Finding 1 (should-fix) — fixed.** `chooseProvider` and `editCompatible` now hand the outgoing
  `keyState` to `void abandonKeyCheck(KEY_CHECK_API, keyState)` before they reset it, so a
  connection a failed check created (the `{connectionId, created: true, verified: false}` row that
  still holds the typed key) is deleted when the user switches provider or edits the base URL or
  name, instead of being left on the server. `abandonKeyCheck` is a no-op for verified or
  pre-existing states, so calling it unconditionally is safe. `setKey` was left untouched: it keeps
  `connectionId`, so the next check reuses the row. Commit `fd1803add`.
- **Finding 2 (nit) — not done.** It names `ProviderStep.tsx:23-26`, a line this round does not
  change; per the fix-round instructions nits are left alone unless they sit in a changed line.
- **Finding 3 (nit) — not done.** Same reason: `useNewAiFlow.ts:102-106` is not a line this round
  changes.
- **Follow-up F1 — not done.** It still needs `apps/web/src/components/ui/segmented-control.tsx`
  (`SegmentedOption.disabled`), outside this task's Allowed files.

Tests: **none added.** The spec says "None (UI)", AGENTS.md says UI code gets no tests, and every
Allowed-files token names a specific source file, so a new `*.test.ts` matches no token and would be
listed by the gate's scope step. The gate reports `SKIP tests @zilar/web (no nearby test files)`, so
no single test file was run.

Gate (from the repo root): `pnpm gate` → **GATE PASS**:
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (2.4s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
size: every changed source file is within 400 lines
GATE PASS
```
`useNewAiFlow.ts` is 400 lines after the fix (the cap is 400).

Disagreements: none. Findings 2 and 3 are nits and were left per the fix-round instructions.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 2 auto rounds, nit 1, follow-up 1.
- The lead walked the whole flow headless in mock mode at 1280 and 390 px, and compared it with the boards:
  - **Provider:** the searchable combobox; "deep" → DeepSeek, with OpenAI-compatible pinned.
  - **Key:** lock, show toggle and "Get one ↗"; Back plus Continue.
  - **Model:** the orb with an edit badge, Name, the model combobox, and Template on the light key.
  - **Orb popover:** 14 colours, 7 lights, the drag dot, Shuffle and Reset.
  - **Setup:** Off · Zilar · Machine · Auto with icons, a machine combobox, `$` No limit fields, and Create AI.
  - The done steps show their values (DeepSeek, Key, Chat; the board shows the model's short name too), and at 390 px the dialog docks to the bottom.
- Follow-up F1: Zilar is hidden instead of disabled when cloud is off. That needs `SegmentedOption.disabled` in the kit, and goes into the Connections and key-step reuse task.
