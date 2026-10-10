---
id: T-0990
title: "Size split T65: apps/web/src/components/ChannelPanel.tsx (559 lines) into components/panels/{channelPanelOps,ChannelAdminsSection,ChannelHeader}"
status: merged
milestone: M5
branch: task/T-0990-split-web-channel-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0990: Split `ChannelPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChannelPanel.tsx` is 559 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #61 (task T65): `components/panels/channelPanelOps.ts`, `panels/ChannelAdminsSection.tsx`, `panels/ChannelHeader.tsx`, under `apps/web/src/`. `ChannelPanel.tsx` keeps the state, the actions, the composition and every export it has today.

- **Skip both Dedup items:** `panelFailure.ts` and the shared `GroupAiRow` both cross files.
- **The local `GroupAiRow`:** keep it, either in `ChannelPanel.tsx` or in one of your own new files, whichever keeps every file at or under 400 lines.

The lead checks it in Chrome in mock mode: the Acme Announcements channel's info panel.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #61, and `apps/web/src/components/ChannelPanel.tsx`.

### Allowed files
`apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/panels/channelPanelOps.ts`, `apps/web/src/components/panels/ChannelAdminsSection.tsx`, `apps/web/src/components/panels/ChannelHeader.tsx`, `work/T-0990-split-web-channel-panel.md`.

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

Split `apps/web/src/components/ChannelPanel.tsx` exactly as `docs/audit/size-plan.md`
§2.3 #61 (task T65) lists, following `docs/audit/split-rules.md`:

- `components/panels/channelPanelOps.ts` — the `ChannelFailure` type and
  `storeCall` / `failureText` / `describeFailure` moved unchanged (old lines 42–75).
- `components/panels/ChannelHeader.tsx` — the `<header>` block moved unchanged
  (old lines 256–278), as `ChannelHeader({ chat, count, onClose })`.
- `components/panels/ChannelAdminsSection.tsx` — the subscribers/admins ternary
  moved unchanged (old lines 291–374), as
  `ChannelAdminsSection({ isManager, audience, isOwner, me, roleBusy, flipRole, roleError, adminsLoaded, adminsFailure, admins })`.
  The ternary is preserved as-is (no behavioural rewrite).
- `ChannelPanel.tsx` keeps the state, the actions, the composition and its one
  export (`ChannelPanel`). It now imports the new modules.

Both Dedup items were skipped as the spec says (both cross files): no
`panels/panelFailure.ts`, no shared `panels/GroupAiRow.tsx`.

The local `GroupAiRow` was moved to `ChannelAdminsSection.tsx` (same directory
as the other extracted pieces) because keeping it in `ChannelPanel.tsx` left the
main at 432 lines. With it out, the main is 379 lines. This is the only
deviation; the shared-row dedup with `GroupPanel.tsx` remains the separate
follow-up task.

### wc -l (old vs new)

- old: `apps/web/src/components/ChannelPanel.tsx` = **559**
- new: `apps/web/src/components/ChannelPanel.tsx` = **379**
- new: `apps/web/src/components/panels/channelPanelOps.ts` = **43**
- new: `apps/web/src/components/panels/ChannelAdminsSection.tsx` = **162**
- new: `apps/web/src/components/panels/ChannelHeader.tsx` = **40**

Every file is at or under 400 lines; no `max-lines` warning.

### Export list before → after (`grep -E "^export"`)

Before (`git show HEAD:apps/web/src/components/ChannelPanel.tsx`):

```
85:export function ChannelPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
```

After (original path plus the new files):

```
ChannelPanel.tsx:52:export function ChannelPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
channelPanelOps.ts:7:export type ChannelFailure = ApiFailure | StoreFailed;
channelPanelOps.ts:12:export function storeCall<A>(
channelPanelOps.ts:27:export function failureText(failure: ChannelFailure, fallback: string): string {
channelPanelOps.ts:35:export function describeFailure(failure: ChannelFailure, fallback: string): string {
ChannelAdminsSection.tsx:20:export function ChannelAdminsSection({
ChannelAdminsSection.tsx:114:export function GroupAiRow({
ChannelHeader.tsx:7:export function ChannelHeader({
```

`ChannelPanel` still comes from the same path with the same kind (value), so no
importer changed (`routes/ChatView.tsx` is the only importer). The new modules
export only new names used inside this file set.

### Commands run (real results)

- `pnpm install` — done (no errors; one pre-existing peer-dependency warning in `apps/mobile`).
- `pnpm --filter @zilar/web build` — passed (`✓ built in 1.50s`; only the
  pre-existing "chunks larger than 500 kB" warnings).
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (2.1s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.0s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single test files: none. There are no tests next to
  `apps/web/src/components/**` (the gate skipped `@zilar/web`), and AGENTS.md
  gives UI code no tests. I did not run `format`, `lint`, `typecheck` or a suite
  outside the gate.

### Effect ratchet

No `// effect-plain:` marker was needed. `channelPanelOps.ts` and
`ChannelAdminsSection.tsx` use Effect and classify as `effect`;
`ChannelHeader.tsx` is plain JSX. The gate's `effect` step passed.

### Problems / deviations

- Only deviation: `GroupAiRow` lives in `ChannelAdminsSection.tsx` instead of the
  plan's shared `panels/GroupAiRow.tsx` (the spec says skip that cross-file
  dedup), and instead of `ChannelPanel.tsx` (which would then be 432 lines). It
  keeps its own name and exports, used only by `ChannelPanel.tsx`.
- No open questions.

### Not verified here

I did not run the app in the browser (the lead's Chrome mock-mode check covers
the Acme Announcements channel info panel).

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `ChannelPanel.tsx` (559 lines) is now 379 lines, plus `panels/channelPanelOps.ts`, `ChannelAdminsSection.tsx` (162) and `ChannelHeader.tsx`. The cross-file dedups were skipped, as the spec said.
- **The lead checked it in Chrome at `?mock=1`, on the Acme Announcements channel info:**
  - the subscribers list You (owner), Ana (admin) and Luis;
  - the AIs, activity, always-allowed, pinned and invite links sections show;
  - Promote on Luis makes him admin, and Demote takes it back.
- **Check:** the gate passed, and so did the web build.
