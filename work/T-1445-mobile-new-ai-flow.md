---
id: T-1445
title: "Mobile New AI flow from the approved phone boards: one hugging bottom sheet with Provider → Key → Model (orb sub-view) → Setup → Create AI, opened from the AIs tab"
status: merged
milestone: M5
branch: task/T-1445-mobile-new-ai-flow
model: auto
effort: default
depends_on: [T-1432, T-1442]
estimate: 1 day
---

# T-1445: Mobile New AI flow

## Spec (written by Claude, do not edit)

### Why
Julio approved this design on 2026-10-15 ("10/10").

**The boards are the spec for the look.** Read `docs/design/mockups/new-ai/README.md`, then each phone board with `git show main:docs/design/mockups/new-ai/<file>`: `Mobile.dc.html` (Provider), `PhoneCompatible.dc.html`, `PhoneKey.dc.html`, `PhoneModel.dc.html`, `PhoneOrb.dc.html` (interactive) and `PhoneSetup.dc.html`. Copy their sizes, colors and copy. The canvas link is private; don't fetch it.

The rules the boards set:
- the sheet hugs its content;
- no subtitles or hints;
- a status is a dot or icon, never a word;
- one way out: the close key, the grabber or Android back (**no Cancel key**);
- the footer is Back plus one primary;
- a selected choice is the light key.

The web twin is T-1444, which runs in parallel.

### Facts (the lead read them on main, 2026-10-15)
- **Today's flow** is a full-screen route, `apps/mobile/src/app/ais/new.tsx` (349 lines). It is opened only from `apps/mobile/src/app/(tabs)/ais.tsx:205` and `:229` (`router.push('/ais/new')`). It uses:
  - `components/ais/provider-step.tsx`, `review-step.tsx`, `template-cards.tsx` and `wizard-steps.tsx` (only this screen uses them);
  - `model-picker.tsx`, `limits-fields.tsx` and `provider-picker.tsx` (`app/ais/[id].tsx` also uses those);
  - `buildCreateInput` from `components/ais/form`;
  - `api.createAi`, then `router.replace({ pathname: '/ais', params: { highlight } })` (`new.tsx:154-160`).
- **The kit (T-1432):**
  - `apps/mobile/src/components/ui/bottom-sheet.tsx`: `BottomSheet` with `title`, `onBack`, `headerRight`, `footer` (sticky, above the keyboard), and `maxHeightClassName`. It hugs its content.
  - The reference usage, a New AI sample with a close key, `StepTrack` and a footer, is `apps/mobile/src/mock/dev-kit-screen.tsx:314-351`.
  - `ui/step-track.tsx`: `StepTrack({ steps: { value, label, done? }[], current, onStepPress })`.
  - `ui/select-sheet.tsx`: `SelectSheet({ label, value, options: { value, label, dot?: 'online' }[], onChange, footerOption: { label, onPress } })`, which filters above 8 options.
  - `ui/segmented-control.tsx`: `tone="choice"`, `icon` per option.
- **Shared logic (T-1442), from `@zilar/chat-core`:**
  - `providerChoices`, `filterProviderChoices`, `keyPageFor`, `keyPlaceholderFor`, `keyCheckMessage`;
  - `ORB_HUES`, `ORB_RIMS`, `clampOrbLight`, `shuffleOrb`;
  - `checkKey` and `abandonKeyCheck`;
  - `orbParamsFor(seed)`, `orbSvg(params, idSeed)`. The default orb is seeded by the AI's **name**.
- **API:**
  - `apps/mobile/src/lib/ais-api.ts`: `createAi`, `updateAi` (accepts `computerMode`: `'off' | 'cloud' | 'runner' | 'auto'`), `getAiCatalog`, `getComputerOptions`;
  - `apps/mobile/src/lib/connections-api.ts`: `listConnections`, `createConnection`, `testConnection`, `deleteConnection`, `replaceConnectionKey`;
  - `apps/mobile/src/lib/machines-api.ts`: `listMachines`.
  - A machine is assigned with `applyMachineChange(machinesApi, aiId, next, previous)` (`apps/mobile/src/components/machines/machine-change.ts:20`).
- **Pictures:**
  - mobile uploads only the **user's** picture today (`apps/mobile/src/components/settings/use-profile-avatar.ts:40-75`, through `createAvatarFileUploader().upload(url, picked, token)` in `components/settings/avatar-native.ts:48-58,247`, path `/api/avatars/user/<id>`, `lib/profile-api.ts:163`);
  - the server route is `PUT /avatars/:kind/:ownerId` (`apps/server/src/avatars/api.ts:57`), mounted under `/api` like `avatarPutPath`; for an AI, kind is `ai` and the owner is the AI id. It takes PNG or WebP, 64-512 px, at most 256 KiB;
  - `react-native-svg` 15.15.4 is installed, and its `Svg` ref has `toDataURL(cb, { width, height })` (a base64 PNG).
- **Labels:** Julio's computer labels are **Off · Zilar · Machine · Auto**. `apps/mobile/src/components/ais/computer-picker.tsx:30-51` still says "Zilar cloud" and "My machine".

### What to build
**Files.** Each stays at 400 lines or fewer.
- New files in `apps/mobile/src/components/ais/new-ai/`:
  - `new-ai-sheet.tsx` (the sheet, the stepper, the footer and step routing);
  - `use-new-ai-flow.ts` (state and actions);
  - `provider-step.tsx`, `key-step.tsx`, `model-step.tsx`, `orb-view.tsx`, `setup-step.tsx`;
  - `orb-upload.ts`.
- The AIs tab (`app/(tabs)/ais.tsx`) opens `NewAiSheet` from both buttons with local state, instead of pushing `/ais/new`.
- **Delete** `app/ais/new.tsx`, plus `provider-step.tsx`, `review-step.tsx`, `template-cards.tsx` and `wizard-steps.tsx` under `components/ais/` (and `wizard-progress.ts` if it exists and is unused). Grep before deleting, and keep anything `app/ais/[id].tsx` still uses.

**The sheet:** one `BottomSheet`.
- `title` is "New AI";
- `headerRight` is the close `IconButton` as in the dev kit;
- the body starts with `StepTrack`: Provider · Key · Model · Setup. A done step shows its value, for example "DeepSeek", and tapping it goes back;
- `footer` is Back (from step 2 on) plus the one primary (Continue, then **Create AI**);
- closing before create calls `abandonKeyCheck`.

**The steps:**
1. **Provider:** a `SelectSheet` of `providerChoices(catalog, connections)` with `dot: 'online'` when there is a key, and `footerOption` "OpenAI-compatible".
   - OpenAI-compatible shows **Base URL** and **Name** fields (`PhoneCompatible.dc.html`). The Base URL dot goes green once the key check passes.
   - While the catalog loads, use `providerChoices(null, …)`.
2. **Key:** a field with a lock icon, a show toggle and a green dot when verified, plus "Get one ↗" (`Linking.openURL(keyPageFor(...))`) when there is a page.
   - Continue runs `checkKey`; on failure, show `message` under the field.
   - If the provider has an active connection, preselect the newest: placeholder "Saved key", green dot, and Continue needs no typing.
3. **Model** (`PhoneModel.dc.html`): the orb with an edit badge (tapping it opens the orb view), **Name**, the model `SelectSheet` from the catalog (prefilled like today), and **Template** as `SegmentedControl tone="choice"` with Dev / Marketing / Fun.
4. **Orb view** (`PhoneOrb.dc.html`): the same sheet switches content.
   - `onBack` returns to Model, and `headerRight` holds **Shuffle** and **Reset**;
   - 14 hue swatches and 7 rim swatches;
   - a big orb where a pan gesture moves the light live (`clampOrbLight`; use `react-native-gesture-handler` if the app already has it, otherwise `PanResponder`);
   - until the user edits it, the orb follows `orbParamsFor(name)`.
5. **Setup** (`PhoneSetup.dc.html`):
   - **Computer:** Off · Zilar · Machine · Auto (`SegmentedControl tone="choice"`, icons as on the board). Zilar is disabled when `getComputerOptions().cloud` is false.
   - Machine and Auto show a machine `SelectSheet` (`listMachines`, green dot when online).
   - **Per day** and **Per month** `$` fields (empty = no limit; reuse `limits-fields.tsx` / `validateLimits`).

**Create**, in this order:
1. `createAi(buildCreateInput(...))`.
2. If the orb was edited, render the orb `Svg` off-screen, `toDataURL` it at 256×256, write the PNG to the cache dir, and upload it to the AI's avatar path (kind `ai`, owner the new AI's id) with `createAvatarFileUploader().upload` and the session token, the same way `use-profile-avatar.ts` does.
3. If the computer isn't Off: `applyMachineChange(..., machineId, null)` when a machine was chosen, then `updateAi(id, { computerMode })`.
4. Close the sheet and open the AI's chat with `router.push('/chat/' + encodeURIComponent(ai.jid))`. If that route shape is wrong, use whatever `app/(tabs)/ais.tsx` uses to open an AI's chat, and name it in the Report.

A failure in step 2 or 3 still opens the chat, plus one line wherever the app shows notices (find it): "AI created. Some settings could not be saved."

**Labels:** in `computer-picker.tsx`, "Zilar cloud" → "Zilar" and "My machine" → "Machine".

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`, `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`, `apps/mobile/src/components/ais/new-ai/provider-step.tsx`, `apps/mobile/src/components/ais/new-ai/key-step.tsx`, `apps/mobile/src/components/ais/new-ai/model-step.tsx`, `apps/mobile/src/components/ais/new-ai/orb-view.tsx`, `apps/mobile/src/components/ais/new-ai/setup-step.tsx`, `apps/mobile/src/components/ais/new-ai/orb-upload.ts`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts` (added by the lead on 2026-10-15: key-state tests are in the crucial "keys" area)
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/ais/new.tsx` (delete)
- `apps/mobile/src/components/ais/provider-step.tsx`, `apps/mobile/src/components/ais/review-step.tsx`, `apps/mobile/src/components/ais/template-cards.tsx`, `apps/mobile/src/components/ais/wizard-steps.tsx`, `apps/mobile/src/components/ais/wizard-progress.ts` (delete when unused)
- `apps/mobile/src/components/ais/computer-picker.tsx`, `apps/mobile/src/components/ais/model-picker.tsx`, `apps/mobile/src/components/ais/limits-fields.tsx`, `apps/mobile/src/components/ais/form.ts`
- `work/T-1445-mobile-new-ai-flow.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every file stays at 400 lines or fewer.
- The lead runs a phone smoke in mock mode, opening the sheet from the AIs tab and walking every step.

---

## Report (written by the worker when done)

### What I did
Rebuilt the mobile New AI flow as one hugging bottom sheet opened from the AIs tab, replacing the full-screen `/ais/new` route.

New files under `apps/mobile/src/components/ais/new-ai/`:
- `new-ai-sheet.tsx` — the `BottomSheet` (title "New AI", close key in `headerRight`, footer Back + primary), the orb sub-view swap and step routing.
- `use-new-ai-flow.ts` — state and actions: the four steps, provider/connection preselection, `checkKey`, orb state, the setup choices and the create sequence.
- `provider-step.tsx` — `SelectSheet` of `providerChoices` (green dot when a key exists), OpenAI-compatible pinned as `footerOption`, plus Base URL (green dot once the key passes) and Name.
- `key-step.tsx` — lock + show toggle + green dot, "Get one ↗", message under the field.
- `model-step.tsx` — orb with edit badge, Name, model `SelectSheet` from the catalog (prefilled), Template `SegmentedControl tone="choice"` (Dev / Marketing / Fun).
- `orb-view.tsx` — the orb sub-view: 14 hue and 7 rim swatches and a big orb whose light follows a `Gesture.Pan` drag (`clampOrbLight`). `OrbSvg` is drawn with react-native-svg primitives, matching `ballSvg`; `OrbCapture` rasterises it with `toDataURL`.
- `setup-step.tsx` — Computer `SegmentedControl tone="choice"` (Off · Zilar · Machine · Auto), machine `SelectSheet` for Machine/Auto, and `LimitsFields`.
- `orb-upload.ts` — writes the 256×256 base64 PNG to the cache dir and PUTs it to `/api/avatars/ai/<id>` through the settings uploader.

Changed: `app/(tabs)/ais.tsx` (both Create buttons open the sheet with local state; the AIs tab Toast shows the partial-save notice; `onCreated` opens the new AI's chat via `router.push({ pathname: '/chat/[id]', params: { id: ai.jid } })`). `components/ais/computer-picker.tsx` labels: "Zilar cloud" → "Zilar", "My machine" → "Machine".

Deleted (grep-confirmed unused after `new.tsx`): `app/ais/new.tsx`, `components/ais/provider-step.tsx`, `review-step.tsx`, `template-cards.tsx`, `wizard-steps.tsx`, `wizard-progress.ts`.

Create order: `createAi(buildCreateInput(...))`, then (if the orb was edited) the avatar upload, then (if the computer is not Off) `applyMachineChange(..., machineId, null)` and `updateAi(id, { computerMode })`. A failure in the last two still opens the chat and sets the notice.

### Commands and results
- `pnpm install` — done, 1137 packages, no changes to the lockfile.
- `pnpm gate` (from the repo root):
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single tests: none run. The change is UI only (the spec says "Tests: None (UI)"), and the gate found no nearby test files for the mobile package.

### Deviations from the spec / decisions
1. **Notice surface.** The only notice component the app has is the per-screen `Toast` (`components/ui/toast.tsx`); there is no global one. I wired it into the AIs tab. Because `onCreated` immediately pushes the chat, that toast sits behind the chat screen and may not be seen. Making it reliably visible needs a global notice surface (or a param on the chat route), both outside this task's Allowed files. Flagging rather than guessing.
2. **Footer Back vs the boards.** The phone boards (`PhoneKey`/`PhoneModel`/`PhoneSetup`) draw a back key in the header; the spec's `BottomSheet` bullet and the rules line call for Back + one primary in the *footer*, and the web board (`Key.dc.html`) shows exactly that. I followed the spec: header `headerRight` is the close key only, footer is Back (from step 2) + primary. The orb sub-view uses `onBack` (returns to Model) with Shuffle and Reset in `headerRight`, as the spec says.
3. **Chat route.** The spec suggested `router.push('/chat/' + encodeURIComponent(ai.jid))`; I used the shape the AIs tab itself uses for an AI row, `router.push({ pathname: '/chat/[id]', params: { id: ai.jid } })`, so the new AI opens the same way.
4. **Zilar "disabled".** `SegmentedControl` has no per-option disabled state. The Computer control always shows all four, and `setComputer` ignores `cloud` while `getComputerOptions().cloud` is false (functionally disabled, but not greyed like the old `computer-picker`).
5. **`effect-plain` markers.** The gate's Effect ratchet flags new files with promise signals. `use-new-ai-flow.ts` (async key-check/create over the injected promise APIs) and `orb-upload.ts` (expo-file-system upload + svg `toDataURL`) carry `// effect-plain:` markers with reasons, the repo's documented escape, rather than being rewritten as Effect programs.
6. **`highlight` param.** Left the `highlight` handling in `ais.tsx` untouched: `AiRow` requires `highlighted`, and `ai-row.tsx` is not in the Allowed files. Nothing sets `highlight` now that `new.tsx` is gone, so it is inert (the list reloads on focus after create).

### Not done / not verified
- No on-device run: the lead's phone smoke covers that. The orb rasterise-and-upload path (`toDataURL` → cache file → avatar PUT) is written but not exercised here.
- Mock mode: the shared mock backend serves the catalog, computer options, connections and create; it has no avatar PUT route, so in mock mode the orb upload would land in the "some settings could not be saved" path.

### Open questions
- Where should the "AI created. Some settings could not be saved." notice live so it is visible after the chat opens? A global toast, or a param on the chat route, would need files outside this task's scope.

### Round (fix round, 2026-10-15)

Fixed the PREREVIEW must-fix and should-fix findings. Nits 4–5 left alone (the
round's instructions say not to touch nits).

- **Finding 1 (must-fix) — stale sheet state.** The sheet now gets a `key` from a
  `newAiSession` counter that `openNewAi` bumps (both open buttons use it), so a
  re-open remounts it fresh while it stays mounted to animate its close.
  `apps/mobile/src/app/(tabs)/ais.tsx`.
- **Finding 2 (must-fix) — saved key overwritten.** New pure
  `keyCheckBaseState(keyValue, state)` in `use-new-ai-flow.ts`: a typed key over a
  connection this flow did not create (`created: false`) checks from
  `EMPTY_KEY_STATE`, so `checkKey` creates a fresh (abandonable) connection and
  never runs `replaceConnectionKey` on the saved one; a connection this flow
  created is reused on a retry. `advance()` now passes it to `checkKey`.
- **Finding 3 (should-fix) — orphaned connection on a provider switch.**
  `selectProvider` calls `abandonKeyCheck(connectionsApi, keyState)` before it
  switches, so a created-but-unverified connection (holding a user-typed key) is
  deleted.

Tests: `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts` (new) — three
cases for `keyCheckBaseState`: keeps a saved connection when nothing is typed,
starts a fresh one when a key is typed over a saved connection, and reuses our own
connection on a retry. Run:
`pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/ais/new-ai/use-new-ai-flow.test.ts`
→ 3 passed.

Findings 1 and 3 are React state wiring. The remount (finding 1) is asserted by the
lead's phone smoke; `selectProvider`'s abandon (finding 3) is a side effect. The
repo's mobile tests render statically (`react-dom/server`) and there is no hook
renderer, so neither has a pure seam to unit-test; the findings name no test for
them.

Gate (`pnpm gate`, from the repo root):
```
gate: 18 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.5s)
PASS  lint  (0.9s)
PASS  typecheck  (3.2s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (1.3s)
scope: 1 file(s) outside the Allowed files:
  apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The one out-of-scope file is the new test. The task's Allowed files name no test
path, and this round asks for a test per behaviour fix, so the test necessarily
sits outside it; every other changed file is in scope. `use-new-ai-flow.ts` stays
at exactly 400 lines (trimmed comments to make room).

### Round 2 (fix round, 2026-10-15)

Fixed the must-fix and should-fix findings. Both live in
`apps/mobile/src/components/ais/new-ai/`; no nits or follow-ups touched. Nothing
outside the Allowed files changed except the test file noted below.

- **Finding 1 (must-fix) — editing Base URL after a passed key check.** New pure
  `keyStateAfterBaseUrlEdit(state)` (`use-new-ai-flow.ts`) returns `EMPTY_KEY_STATE`
  when the state is verified. `setBaseUrl` is now a small wrapper that applies it, so
  editing Base URL after a check drops the verified state: the Base URL dot and the
  "Saved key" hint follow `keyState.verified`, and the Key step asks for the key again
  instead of reusing the connection made for the old endpoint. The now-redundant
  `keySaved` state was removed in favour of `keyState.verified` (same placeholder).
- **Finding 2 (should-fix) — untracked in-flight key check.** A `checkToken` ref
  numbers each check. New async `settleNewAiKeyCheck(api, token, current, result)`
  applies a result only while it is still the latest; otherwise it `abandonKeyCheck`s
  the connection the check created. The token is bumped by `selectProvider` (a provider
  switch), by `abandon` (close) and by the loader effect's cleanup (unmount), so a check
  that settles after the flow moved on can no longer wire the new AI to the previous
  provider's connection, and can no longer leave a created connection behind.
  `goToStep` also ignores StepTrack taps while a check is in flight (the footer Back is
  already disabled while busy), so scenario (a) cannot be reached mid-check.

Tests (`apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts`, adjusted):
`keyStateAfterBaseUrlEdit` — a verified state (created or saved) resets, an unverified
one is left; `settleNewAiKeyCheck` over a fake connections API — the latest applies and
deletes nothing, a stale created-but-unverified connection is deleted, a verified one
and a saved one are never deleted. Run:
`pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/ais/new-ai/use-new-ai-flow.test.ts`
→ 10 passed (10).

Size: `use-new-ai-flow.ts` was exactly 400 lines, so the fix would not fit. To stay
within the cap, the step-track label helpers (`shortModelLabel`, the provider label and
the `trackSteps` array) moved to `new-ai-sheet.tsx`, which renders the `StepTrack`
(a separate commit, both files are in Allowed). `use-new-ai-flow.ts` is now 398 lines,
`new-ai-sheet.tsx` 139.

Gate (`pnpm gate`, from the repo root):
```
gate: 18 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.5s)
PASS  lint  (0.7s)
PASS  typecheck  (2.5s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.1s)
scope: 1 file(s) outside the Allowed files:
  apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The one out-of-scope file is the test this round asks for (the Allowed files name no
test path); it is the same file the earlier round added (follow-up F1).

Follow-ups F2 (the partial-save notice sits behind the chat) and F3 (Computer "Zilar"
is tap-inert but not greyed when cloud is off) still need files outside Allowed and are
left as the reviewer listed them.

S1 (lead decision, 2026-10-15): a Base URL edit now also deletes the connection this flow created for the old URL, best effort (`dropCreatedKey`), and a saved key is never deleted; the test file is now allow-listed, so the gate reports `scope: every changed file is inside the Allowed files` — GATE PASS.

S2 (lead decision, 2026-10-15): `selectProvider` now clears Base URL and Name on every choice and never preselects a saved `openai-compatible` connection (each endpoint is its own, so the user re-enters URL/Name/key); other providers still preselect the newest active one — pure `providerSelection` in `use-new-ai-flow.ts`, tested (15 passed), gate GATE PASS at 400 lines (the orb capture+token+upload moved to `saveOrbAvatar` in `orb-upload.ts` to make room).

S3 (lead phone smoke, 2026-10-15): the footer's fragment is now a `flex-row` `View` (Back left, primary taking the rest; the orb "Done" branch gets the same full-width row), so the primary no longer collapses to a thin bar — `new-ai-sheet.tsx` only, as on `PhoneSetup.dc.html`.

S4 (lead decisions, 2026-10-15): the create failure now shows `describeAisError(...).message` only for an `AisApiError` (fixed sentence otherwise) in `use-new-ai-flow.ts`, and `saveOrbAvatar` refuses a PNG over `AVATAR_UPLOAD_MAX_BYTES` before the PUT so it reports the partial result (`orb-upload.ts`, which now writes the exact bytes it sized); gate GATE PASS, 15 tests passed.

S5 (lead decisions, 2026-10-15): a `useRef` guard now makes one Create POST once (`createRef`, cleared in a `finally`) and one Continue run one `checkKey` (`keyCheckRef`, same pattern); any Base URL or Name edit now drops our connection (verified → deleted, unverified → `abandonKeyCheck`) and ends in `EMPTY_KEY_STATE`, and `selectProvider` deletes our verified connection too (saved keys never touched). To keep the hook within the 400-line cap the wizard's pure key-check helpers (with `EMPTY_KEY_STATE`) moved to `form.ts` (its `// effect-plain` marker added); the hook is 392 lines. Tests: `keyStateAfterBaseUrlEdit`'s "never verified untouched" case became the failed-check-ends-empty case, plus an empty-identity case — `pnpm --filter @zilar/mobile exec vitest run src/components/ais/new-ai --reporter=dot` → 16 passed; gate GATE PASS. The `createRef`/`keyCheckRef` guards and the `editEndpoint`/`selectProvider` discards are hook wiring with no renderer seam, so they rest on the lead's phone walk.

S6 (lead decisions, 2026-10-15): Setup's primary is disabled for Machine/Auto until a machine is chosen (`needsMachine`, as web), and closing or unmounting before a successful create now deletes any connection the flow made, verified or not, via `discardCreatedKey` in `form.ts` (a saved key is never deleted); the stale branch of `settleNewAiKeyCheck` uses the same discard for an in-flight check, and a successful `createAi` empties the key state so the new AI's connection is never deleted (a `keyStateRef` mirrors state for the close/unmount path). Tests: 18 passed (`discardCreatedKey` cases added, the old "stale verified left alone" case flipped to deleted); gate GATE PASS, hook 398 lines.

S7 (lead decision, 2026-10-15): `saveOrbAvatar` now races the orb `capture()` against a 5 s timeout (`captureTimed`, timer cleared in a `finally`), so a stuck capture lands in the partial path exactly like a failed upload (AI created, chat opens, notice set); no UI change, and the timeout path is left to the lead's phone walk (no test seam requested). Gate GATE PASS, `orb-upload.ts` 101 lines.

S8 (lead phone smoke, 2026-10-15): `handleCreated` in `(tabs)/ais.tsx` now prepends a `ChatSummary` for the new AI's jid (`kind: 'dm'`, `isAI: true`, `space: 'personal'`, `online: false`) to the chat store via `useChatStoreApi().setState` before pushing `/chat/[id]`, exactly as web's `NewAiDialog` does, so the new chat opens instead of "Chat not found"; a chat already in the store is kept and the roster refresh reconciles the row. Gate GATE PASS.

S9 (lead decision, 2026-10-15): `model-step.tsx` now renders the model as a well `TextField` (label "Model", placeholder "Model id", `autoCapitalize="none"`, `autoCorrect={false}`, `maxLength={256}`, bound to `flow.model`) when `flow.modelOptions` is empty — OpenAI-compatible or any provider with no catalog models — and keeps the `SelectSheet` otherwise. `primaryDisabled` already gates on `model.trim()`, and `buildCreateBody` already sends `form.model.trim()`, so no hook change was needed. Gate GATE PASS.

S10 (lead decision, 2026-10-15): closing or unmounting while a Create is in flight no longer discards the flow-created key — `abandon()` and the unmount cleanup set `closedRef` and skip the discard while `createRef` is set, and `create()`'s catch discards the key only if the sheet was closed; a success still empties the state first, so the new AI's connection is never deleted. No test seam: the rule is ref/async-create wiring inside the hook with no pure helper to call, which the item allowed to note here instead. Tests stay 18 passed, gate GATE PASS, hook 400 lines.

### Disagreements
None: all findings across rounds are real, and each is fixed as the finding describes.
Round 2 disagrees with nothing.
S4 note: the PREREVIEW labels `use-new-ai-flow.ts:232` and `:265` as raw-text sites, but only `:265` calls `describeAisError`; `:232` is the key-check message, which `keyCheckMessage` (chat-core) already maps to fixed sentences, so no raw text surfaces there and it is left unchanged.

## Review (written by Claude)
Lead, 2026-10-15: approved after many fix rounds. The final pre-review is CLEAN, with nit 1 and follow-up 3.
- **Phone walks on the emulator (mock):**
  - DeepSeek → key → model (orb by name) → Setup → Create;
  - Machine needs a machine before Create enables;
  - OpenAI-compatible → Base URL plus Name → key → free "Model id" → Create;
  - the footer is Back plus a full-height primary on every step;
  - Create lands in the new chat (with T-1470's mock chat).
- **Fixed in review:**
  - double-tap guards;
  - stale endpoints;
  - key clean-up on close and on endpoint edits;
  - a capture timeout;
  - the chat added to the store before opening;
  - the compatible model field;
  - closing during Create keeps the key.
- **Follow-ups:**
  - T-1471: the Provider label and the step chips;
  - T-1472: the partial notice on the chat, the dead highlight code, and Zilar greyed when cloud is off;
  - then the mobile Connections add-key sheet.
