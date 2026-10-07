---
id: T-0478
title: "Listener W1 (web): group panel listener switch + eagerness (owners/admins); AI panel 'Can delegate' and 'Accepts tasks' switches (owner)"
status: merged
milestone: M5
branch: task/T-0478-web-listener-settings
model: auto
effort: low
depends_on: [T-0474]
estimate: 0.4 day
---

# T-0478: web settings for the listener and delegation

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/listener-delegation-plan.md` §5.3 and §8, task W1. T-0474 added the server settings. This task adds the web controls:
- in the **group panel**, owners and admins turn the listener on and pick an eagerness (Quiet, Normal or Eager);
- in the **AI panel**, the AI's owner sets "Can delegate" and "Accepts tasks".

**No emoji, icons only.**

### Verified facts (do not re-derive)
- **Server (T-0474):**
  - `GET` and `PATCH /api/groups/:id` details carry `listener: { enabled: boolean; eagerness: 'quiet'|'normal'|'eager'; available: boolean }`, where `available` is the server flag `LISTENER_ENABLED`;
  - `PATCH /api/groups/:id` accepts `listenerEnabled?` and `listenerEagerness?` (owner or admin; a member gets 403);
  - `PATCH /api/ais/:id` accepts `canDelegate?` and `acceptsDelegation?` (owner), and `PublicAi` returns both booleans.
- **Web API (`apps/web/src/lib/api.ts`):**
  - `groupDetailSchema` is at line 143 (T-0466 added `background`);
  - `setMembersCanCreateTopics(groupId, value)` (lines 581-590) is the `PATCH /groups/:id` pattern;
  - `publicAiSchema` is at lines 1127-1148;
  - `UpdateAiInput` is at lines 1171-1177;
  - `updateAi(id, input)` is at lines 1203-1209.
- **Store (`apps/web/src/store/realStore.ts`):** `setMembersCanCreateTopics` (around line 3712) resolves the `groupId`, calls the API, then `applyGroupDetail`. `setGroupBackground` (line 3746) follows the same pattern. Both are declared in `apps/web/src/store/store.ts` and implemented in its mock store.
- **Group panel (`apps/web/src/components/GroupPanel.tsx`):**
  - the manager-only "Topic settings" section (lines 552-564) has a `Switch` with busy and error state (`flipTopicSwitch`, lines 263-278; `switchBusy` at line 65; `FieldError`);
  - `isManager` is at line 53;
  - `info = store.groupInfo(chat.id)`.
- **AI panel (`apps/web/src/components/ais/AiPanel.tsx`):** the AI form (name, persona, limits, model) saves through `updateAi` in `save()` (around lines 334-360). There is a `Usage` section (line 110).
  
  Tests: `apps/web/src/components/ais/AiPanel.test.tsx` and `apps/web/src/components/GroupPanel.test.tsx`.
- **Kit:** `Switch` and `SegmentedControl` (`mode="radio"`) are in `apps/web/src/components/ui/`.

### What to build
1. **API:**
   - `groupDetailSchema` gets `listener` as an optional object with the three fields;
   - add `setGroupListener(groupId, input: { listenerEnabled?: boolean; listenerEagerness?: 'quiet'|'normal'|'eager' }): Promise<GroupDetail>`;
   - `publicAiSchema` gets `canDelegate` and `acceptsDelegation` as `z.boolean().optional()`;
   - `UpdateAiInput` gets both as optional booleans.
2. **Store:** `setGroupListener(chatId, input)` follows the `setMembersCanCreateTopics` pattern. Declare it in `store.ts` and implement it in the mock store and the real store.
3. **`GroupPanel.tsx`:** add a manager-only section, `aria-label="AI listener"`, after "Topic settings":
   - a `Switch` labelled "Let AIs answer without @mention", checked from `info.listener?.enabled`;
   - below it, a `SegmentedControl` (`mode="radio"`, `ariaLabel="Eagerness"`) with Quiet, Normal and Eager, shown when enabled;
   - one muted helper line: "Normal suits most groups. Quiet wakes AIs only for clear asks.";
   - **when `info.listener?.available !== true`:** both controls are disabled, and the helper says "Turned off on this server";
   - **busy and error** handling copies `flipTopicSwitch`.
4. **`AiPanel.tsx`:** add a section `aria-label="Delegation"` with two `Switch`es that **save immediately** through `updateAi(ai.id, { canDelegate })` or `{ acceptsDelegation }`, separately from the main form's Save:
   - "Can delegate", with the helper "Hand tasks to other AIs in a group";
   - "Accepts tasks", with the helper "Other AIs in a group can hand this AI tasks. It works on them with its own model and budget".
   
   On success, update the local `ai` state. On failure, show an inline error (`role="alert"`) and keep the old value.
5. **Tests:**
   - **`GroupPanel.test.tsx`:**
     - an admin sees the section, and a member doesn't;
     - flipping the switch calls `setGroupListener` with `{ listenerEnabled: true }`;
     - picking Quiet sends `{ listenerEagerness: 'quiet' }`;
     - with `available: false`, the controls are disabled with the server line.
   - **`AiPanel.test.tsx`:**
     - both switches reflect the AI's values;
     - flipping "Accepts tasks" calls `updateAi` with `{ acceptsDelegation: true }` and updates;
     - a rejected save shows the alert and reverts.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §5.3 and §8, `apps/web/src/lib/api.ts:140-170`, `:575-595` and `:1120-1215`, `apps/web/src/store/realStore.ts:3705-3770`, `apps/web/src/store/store.ts` (search `setMembersCanCreateTopics`), `apps/web/src/components/GroupPanel.tsx:40-80`, `:255-280` and `:540-600`, `apps/web/src/components/ais/AiPanel.tsx:90-130`, `:300-380` and `:500-640`, `apps/web/src/components/ui/switch.tsx`, `apps/web/src/components/ui/segmented-control.tsx`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`, `apps/web/src/mock/api.ts`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `apps/web/src/store/realStore.test.tsx`, `work/T-0478-web-listener-settings.md`.

Touch the store test fakes and `mock/api.ts` only where a new method needs a stub. If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel AiPanel realStore
pnpm gate
```

### Acceptance
- Owners and admins switch the group listener on or off and pick an eagerness in the group panel. The controls are disabled with "Turned off on this server" when the server flag is off.
- AI owners set "Can delegate" and "Accepts tasks" in the AI panel. Both save immediately with error handling.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Web controls for the listener and delegation (plan W1).

- **`apps/web/src/lib/api.ts`**: added `groupListenerSchema` (`enabled`, `eagerness` enum, `available`) + exported `ListenerEagerness`; `groupDetailSchema` now carries `listener` as an optional object; added `SetGroupListenerInput` and `setGroupListener(groupId, input)` (PATCH `/groups/:id`). `publicAiSchema` and `UpdateAiInput` gained optional `canDelegate` / `acceptsDelegation`.
- **`apps/web/src/store/store.ts`**: declared `setGroupListener(chatId, input)` and implemented it in the mock store (calls the API, refreshes the cached detail).
- **`apps/web/src/store/realStore.ts`**: added `setGroupListener` to the `ApiClient` interface, the `realApi` map and the store implementation, following the `setMembersCanCreateTopics` pattern (resolve `groupId`, PATCH, `applyGroupDetail`).
- **`apps/web/src/components/GroupPanel.tsx`**: manager-only `aria-label="AI listener"` section after "Topic settings": the "Let AIs answer without @mention" `Switch`, a radio `SegmentedControl` (Quiet / Normal / Eager) shown when enabled, the muted helper line, the "Turned off on this server" line when `available !== true`, and busy/error handling copied from `flipTopicSwitch`.
- **`apps/web/src/components/ais/AiPanel.tsx`**: `aria-label="Delegation"` section with "Can delegate" and "Accepts tasks" switches that save immediately through `updateAi(ai.id, …)`, update the local `ai` on success, and show an inline `role="alert"` error keeping the old value on failure.
- **`apps/web/src/mock/api.ts`**: the group PATCH handles `listenerEnabled` / `listenerEagerness`; `patchAi` handles `canDelegate` / `acceptsDelegation`.
- **Tests**: 4 new cases in `GroupPanel.test.tsx` (admin vs member visibility, flip → `{ listenerEnabled: true }`, Quiet → `{ listenerEagerness: 'quiet' }`, `available: false` disables both controls with the server line) and 3 new cases in `AiPanel.test.tsx` (switches reflect flags, Accepts tasks → `updateAi({ acceptsDelegation: true })` and updates, rejected save alerts and keeps the old value).
- **Store test fakes** (`realStore.test.tsx`, `realStore.forward.test.tsx`, `realStore.media.test.tsx`, `realStore.topics.test.tsx`, `reload.test.tsx`): added the `setGroupListener` stub required by the extended `ApiClient` interface.

### Files changed
14, all inside the Allowed list: `apps/web/src/lib/api.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`, `apps/web/src/mock/api.ts`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `apps/web/src/store/realStore.test.tsx`, `work/T-0478-web-listener-settings.md`.

### Commands and results
- `pnpm install`: success (1170 packages, done in 20s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel.test.tsx`: 1 file, 29 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiPanel.test.tsx`: 1 file, 35 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel AiPanel realStore`: 6 files, 232 tests passed.
- `pnpm gate` (first run): `FAIL format` — prettier flagged `GroupPanel.tsx` and `mock/api.ts`; scope line was already `every changed file is inside the Allowed files`. I ran `pnpm exec prettier --write` on those two files, then re-ran the gate.
- `pnpm gate` (final):
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (22.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (17.6s)
  PASS  tests @zilar/web  (68.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The kit `SegmentedControl` has no `disabled` prop and `segmented-control.tsx` is not in the Allowed files, so I wrapped it in a `<fieldset disabled>` when the listener is unavailable/busy (a disabled fieldset disables descendant buttons in a real browser). I also guard `chooseEagerness` on `listenerAvailable`, so the radio does nothing when the server flag is off. The `available: false` test asserts the switch is `disabled`, the fieldset is `disabled`, and a Quiet click is a no-op.
- No new dependencies. No security-relevant code paths added (web only).

## Review (written by Claude)

Approved (lead, 2026-10-07). The group panel has an AI listener section for managers: a switch and a Quiet/Normal/Eager radio, disabled with "Turned off on this server" when unavailable. The AI panel has Delegation switches that save immediately, with an alert and a revert on failure. The API, store and mocks are extended. Nits accepted: the raw error message copies flipTopicSwitch; there is no re-entry guard beyond disabled.
