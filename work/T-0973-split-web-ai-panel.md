---
id: T-0973
title: "Size split T23: apps/web/src/components/ais/AiPanel.tsx (870 lines) into ais/{aiPanelOps,AiUsageSection,AiPictureSection,AiFormFields,AiMachineSection,AiDelegationSection,AiDangerZone}; one writeAi helper"
status: merged
milestone: M5
branch: task/T-0973-split-web-ai-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0973: Split `AiPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ais/AiPanel.tsx` is 870 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #19 (task T23). The new files go in `apps/web/src/components/ais/`:
- `aiPanelOps.ts`;
- `AiUsageSection.tsx`, `AiPictureSection.tsx`, `AiFormFields.tsx`, `AiMachineSection.tsx`, `AiDelegationSection.tsx`, `AiDangerZone.tsx`.

`AiPanel.tsx` keeps the panel and every export it has today.

The in-file Dedup is in scope. The stop, resume, delete and delegation actions repeat the same steps: clear the error, call `fromApi`, tap `setAi`, catch, then set the error and refetch. They become one `writeAi` helper in `aiPanelOps.ts`, and each action keeps its own error text.

The lead checks it in Chrome in mock mode: open an AI's panel, then use stop or resume, the machine picker, delegation and the delete confirmation.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #19, and `apps/web/src/components/ais/AiPanel.tsx`.

### Allowed files
`apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/aiPanelOps.ts`, `apps/web/src/components/ais/AiUsageSection.tsx`, `apps/web/src/components/ais/AiPictureSection.tsx`, `apps/web/src/components/ais/AiFormFields.tsx`, `apps/web/src/components/ais/AiMachineSection.tsx`, `apps/web/src/components/ais/AiDelegationSection.tsx`, `apps/web/src/components/ais/AiDangerZone.tsx`, `work/T-0973-split-web-ai-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

### Status
Done. Split `apps/web/src/components/ais/AiPanel.tsx` (870 → 360 lines) into `aiPanelOps.ts` and six section components, following `docs/audit/split-rules.md` and the plan entry §2.2 #19. No behaviour change; only the task's Allowed files were touched.

### Files and line counts (`wc -l`)
| File | Before | After |
| --- | --- | --- |
| `apps/web/src/components/ais/AiPanel.tsx` | 870 | 360 |
| `apps/web/src/components/ais/aiPanelOps.ts` | — | 68 |
| `apps/web/src/components/ais/AiUsageSection.tsx` | — | 70 |
| `apps/web/src/components/ais/AiPictureSection.tsx` | — | 25 |
| `apps/web/src/components/ais/AiFormFields.tsx` | — | 107 |
| `apps/web/src/components/ais/AiMachineSection.tsx` | — | 109 |
| `apps/web/src/components/ais/AiDelegationSection.tsx` | — | 69 |
| `apps/web/src/components/ais/AiDangerZone.tsx` | — | 214 |

Every file is under 400 lines.

### Mode of each new file (split-rules item 6)
All five files that carry Effect code import it, so they classify as `effect`; the three presentational files (`AiUsageSection`, `AiPictureSection`, `AiFormFields`) are `plain`. The gate's `effect` step passed, so no `// effect-plain:` markers were needed.

### Export list before and after (`grep -E "^export"`)
Before, on `main` (`AiPanel.tsx`):
```
135:export function UsageBlock({ ai }: { ai: PublicAi }) {
168:export function AiPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
```
After, on the barrel plus the new files:
```
AiPanel.tsx:41:export { UsageBlock };
AiPanel.tsx:48:export function AiPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
aiPanelOps.ts:7:export type PanelStatus = 'loading' | 'ready' | 'missing' | 'error';
aiPanelOps.ts:12:export function describeFailure(failure: ApiFailure, fallback: string): AiErrorInfo {
aiPanelOps.ts:24:export const refetchAi = (id: string, apply: (next: PublicAi) => void) =>
aiPanelOps.ts:32:export function stripAvatarUrl(ai: PublicAi): PublicAi {
aiPanelOps.ts:44:export function writeAi<A>(options: {
AiUsageSection.tsx:44:export function UsageBlock({ ai }: { ai: PublicAi }) {
AiPictureSection.tsx:7:export function AiPictureSection({
AiFormFields.tsx:9:export function AiFormFields({
AiFormFields.tsx:82:export function AiLimitsFields({
AiMachineSection.tsx:14:export function AiMachineSection({
AiDelegationSection.tsx:11:export function AiDelegationSection({
AiDangerZone.tsx:15:export function AiDangerZone({
```
The barrel (`AiPanel.tsx`) still exports exactly `AiPanel` and `UsageBlock`, with the same names and kinds. The only importer, `apps/web/src/routes/ChatView.tsx` (imports `AiPanel`), is unchanged.

### Dedup (in scope)
The stop, resume, delete and delegation actions now share one `writeAi` helper in `aiPanelOps.ts` (clear error → `fromApi` → `onSuccess` → on failure the action's own fixed sentence, then an optional `refetchAi`). Each action keeps its own error text. Delete and delegation do not refetch on failure, which the helper models with an optional `refetch`; stop's `Effect.ensuring` reset of the confirm step wraps the `writeAi` call so it still runs on interruption. The machine action kept its own shape (it updates optimistically before the call), and the save action kept its own failure fallback, so neither was funnelled through `writeAi`.

### Deviations from the plan entry / notices
- The plan lists `AiFormFields.tsx` with two ranges, `557–610` and `692–705`, which are not adjacent in the panel (the limits fields sit below the memory and picture sections). To keep the DOM order identical, the file exports two small components: `AiFormFields` (name/persona/provider/model) and `AiLimitsFields`, rendered at their original positions. Splitting the file's contents into one component would have moved the limits fields above the machine, usage, delegation, memory and picture sections — a visible reorder.
- `AiMachineSection` owns the machines `useQuery` (plan range `249–267`), so that read now mounts with the ready branch instead of the panel root. The rendered select is identical; only the moment the request starts moves slightly later.

### Commands run
- `pnpm install` (frozen-free): done, `Done in 12.6s` (one pre-existing peer-dependency warning from `apps/mobile`, untouched).
- `pnpm --filter @zilar/web build`: `✓ built in 900ms` (only the pre-existing >500 kB chunk-size warning).
- `pnpm exec prettier --write` on the eight edited/new `ais` files: `aiPanelOps.ts` reformatted, the rest `(unchanged)`.
- `pnpm gate` from the repo root:
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (2.8s)
PASS  format  (1.0s)
PASS  lint  (1.9s)
PASS  typecheck  (6.4s)
PASS  effect  (2.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
No tests were added or edited (split-rules item 5); the gate found no nearby test files for `@zilar/web` to run.

### Open questions
None. The lead's Chrome check (open an AI's panel; stop/resume, the machine picker, delegation and the delete confirmation) is the remaining acceptance item.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `AiPanel.tsx` (870 lines) is now 360 lines, plus seven files in `components/ais/`, the largest `AiDangerZone.tsx` at 214. One `writeAi` helper replaces the four repeated action bodies.
- **Accepted behaviour change:** the machines query now mounts with the ready branch, so the list request starts a little later. The rendered select is the same.
- **The lead checked it in Chrome on `/c/ai-dev-1%40zilar.test?mock=1`:**
  - "Open Dev AI settings" shows the name, persona, provider, model, limits, Stop AI and Delete, the activity, always-allowed, the tools and the routines;
  - Stop AI asks for confirmation, then the button becomes Resume;
  - Resume brings back Stop AI, so `writeAi` works both ways.
- **Check:** the gate passed, and so did the web build.
