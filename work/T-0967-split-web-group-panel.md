---
id: T-0967
title: "Size split T20: apps/web/src/components/GroupPanel.tsx (995 lines) into components/panels/{groupPanelOps,GroupAiSection,GroupPictureSection,GroupRolesSection,GroupSettingSwitch}"
status: merged
milestone: M5
branch: task/T-0967-split-web-group-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0967: Split `GroupPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/GroupPanel.tsx` is 995 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #16 (task T20). The new files go in the existing `apps/web/src/components/panels/` folder:
- `groupPanelOps.ts`;
- `GroupAiSection.tsx`, `GroupPictureSection.tsx`, `GroupRolesSection.tsx`, `GroupSettingSwitch.tsx`.

`GroupPanel.tsx` keeps the info panel and the background and visibility wiring, plus every export it has today.

- **In scope:** the in-file Dedup (the two `Switch` + `FieldError` rows become one `GroupSettingSwitch`).
- **Out of scope:** moving `GroupAiRow` out of `ChannelPanel.tsx`, because it crosses files.

There are no web UI tests. The lead checks the group panel in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #16, and `apps/web/src/components/GroupPanel.tsx`.

### Allowed files
`apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/panels/groupPanelOps.ts`, `apps/web/src/components/panels/GroupAiSection.tsx`, `apps/web/src/components/panels/GroupPictureSection.tsx`, `apps/web/src/components/panels/GroupRolesSection.tsx`, `apps/web/src/components/panels/GroupSettingSwitch.tsx`, `work/T-0967-split-web-group-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/GroupPanel.tsx` (995 → 362 lines) into the five
files the plan names (§2.2 #16, task T20), moving the code unchanged.
`GroupPanel.tsx` still exports `GroupPanel` (a function value) from the same
path, so no importer changed: `routes/ChatView.tsx` still does
`import { GroupPanel } from '@/components/GroupPanel'`.

- `components/panels/groupPanelOps.ts` — failure mapping and loaders: `PanelFailure`,
  `apiStep`, `storeStep`, `settingText`, `addAiText`, `removeAiText`, `messageOf`,
  `loadLinks`, `loadRoles`, `RolesView`, `rolesViewOf` (old lines 57–137).
- `components/panels/GroupAiSection.tsx` — the AIs section (old 384–436) plus
  `GroupAiRow` and `AddAiOption` (old 595–701).
- `components/panels/GroupPictureSection.tsx` — the group picture (old 708–737).
- `components/panels/GroupRolesSection.tsx` — the roles CRUD section (old 745–995,
  renamed `RolesSection` → `GroupRolesSection` to match the file name; nothing else
  imported the old name).
- `components/panels/GroupSettingSwitch.tsx` — the dedup: the topic-settings row
  (old 491–505) and the AI-listener row (old 509–546) become one
  `GroupSettingSwitch` primitive, plus the two wired wrappers `GroupTopicSetting`
  and `GroupListenerSetting` (see the rule-4 deviation below).

In scope dedup done: the two `Switch`+`FieldError` rows now render the single
`GroupSettingSwitch`. Out of scope and untouched: moving `GroupAiRow` out of
`ChannelPanel.tsx` (crosses files), per the spec.

### `wc -l`

```
old:   apps/web/src/components/GroupPanel.tsx (main)          995
apps/web/src/components/GroupPanel.tsx (barrel)               362
apps/web/src/components/panels/groupPanelOps.ts                97
apps/web/src/components/panels/GroupAiSection.tsx             210
apps/web/src/components/panels/GroupPictureSection.tsx         39
apps/web/src/components/panels/GroupRolesSection.tsx          271
apps/web/src/components/panels/GroupSettingSwitch.tsx         148
```

Every new file and the barrel are ≤ 400 lines.

### Export list (before → after)

Before (`git show main:apps/web/src/components/GroupPanel.tsx | grep -E "^export"`):

```
export function GroupPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
```

After (`grep -nE "^export"` on the barrel + new files):

```
GroupPanel.tsx:41:                        export function GroupPanel({
panels/groupPanelOps.ts:11:               export class PanelFailure ...
panels/groupPanelOps.ts:22:               export function apiStep<A>(
panels/groupPanelOps.ts:35:               export function storeStep<A>(
panels/groupPanelOps.ts:45:               export function settingText(error: unknown): string {
panels/groupPanelOps.ts:49:               export function addAiText(error: unknown): string {
panels/groupPanelOps.ts:53:               export function removeAiText(error: unknown): string {
panels/groupPanelOps.ts:58:               export function messageOf<A>(state: ActionState<A, PanelFailure>): string | undefined {
panels/groupPanelOps.ts:63:               export function loadLinks(
panels/groupPanelOps.ts:76:               export function loadRoles(groupId: string | undefined): Effect.Effect<GroupRole[], PanelFailure> {
panels/groupPanelOps.ts:83:               export type RolesView = {
panels/groupPanelOps.ts:89:               export function rolesViewOf(result: AsyncResult.AsyncResult<GroupRole[], PanelFailure>): RolesView {
panels/GroupAiSection.tsx:18:            export function GroupAiSection({
panels/GroupPictureSection.tsx:10:       export function GroupPictureSection({
panels/GroupRolesSection.tsx:21:       export function GroupRolesSection({
panels/GroupSettingSwitch.tsx:17:       export function GroupSettingSwitch({
panels/GroupSettingSwitch.tsx:56:       export function GroupTopicSetting({
panels/GroupSettingSwitch.tsx:87:       export function GroupListenerSetting({
```

The old file's only export, `GroupPanel` (a function value), is preserved with
the same name and kind. The new files export their own helper/component APIs;
no other module imported them before, and none does now.

### Commands run (real results)

- `pnpm install` — done, `@types/react-dom` peer warning only (pre-existing).
- `pnpm --filter @zilar/web build` — success, `✓ built in 662ms`; only the
  pre-existing ">500 kB chunk" warning.
- `pnpm gate` — `GATE PASS`:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.3s)
PASS  lint  (0.6s)
PASS  typecheck  (2.6s)
PASS  effect  (0.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: none. `apps/web` has no GroupPanel tests and the gate's
  nearest-test step skipped the package ("no nearby test files"). Per AGENTS.md,
  UI code gets no tests.

No `// effect-plain:` marker was needed; the gate's effect step passed (each new
file that carries Effect code imports it, and `GroupPictureSection.tsx` holds no
signals).

### Deviations from the spec (split rules)

1. **Rule 4, the barrel over 400.** The plan's ranges leave `GroupPanel.tsx` at
   455 lines once the moved sections are removed but their JSX usages are added
   back (the plan's "~350" counted only the removal, not the re-added props). Rule
   4 says to split once more. The switch wiring (old 251–291: `switchState`,
   `listenerState`, the flip functions, `chooseEagerness`) and the AI-listener
   eagerness fieldset moved into `GroupSettingSwitch.tsx` as `GroupTopicSetting`
   and `GroupListenerSetting`, which both render the shared `GroupSettingSwitch`.
   That is the boundary the entry names for this file (the switch rows), and it
   brings the barrel to 362. Behaviour is unchanged: the same store calls, the
   same disable/error conditions, the same rendered rows.
2. `RolesSection` was renamed `GroupRolesSection` to match the file name given by
   the plan; it had no importers as a named export. The inline `rolesState` prop
   type now reuses the exported `RolesView` type (same shape), a within-scope dedup.

### Problems hit and fixed

- First `pnpm gate` failed at `format` on the three edited files; ran
  `pnpm exec prettier --write` on exactly those three (all inside the Allowed files).
- Second gate failed at `lint` (`'ChatBackgroundDialog' is not defined`): the
  import was dropped while rewriting the import block; added it back.
- Third gate failed at `typecheck`: `GroupRolesSection.tsx` does
  `new PanelFailure(...)`, so `PanelFailure` must be a value import there, not
  `import type`. Fixed; fourth gate `GATE PASS`.

### Security checklist

This is an internal web UI refactor: no secrets, no deletes/updates, no routes,
no caps, no audit entries. Nothing on the checklist applies. No dependency was
added; no check, test or lint rule was disabled.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `GroupPanel.tsx` (995 lines) is now 362 lines, plus five files in `panels/`, the largest `GroupRolesSection.tsx` at 271.
- **The lead checked it in Chrome at `/c/qa%40rooms.zilar.test?mock=1`:** the QA squad group panel shows the picture, the members (Luis owner, You admin), the roles empty state with Add role, the AIs (QA-1, Add my AI), activity, always-allowed and tools.
- **Check:** the gate passed, and so did the web build.
