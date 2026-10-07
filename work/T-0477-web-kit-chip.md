---
id: T-0477
title: "Web kit: new Chip component (pill toggle) for reaction chips and the search scope chip; new-topic Type chips on SegmentedControl"
status: todo
milestone: M5
branch: task/T-0477-web-kit-chip
model: auto
effort: low
depends_on: [T-0467]
estimate: 0.3 day
---

# T-0477: the Chip kit component

## Spec (written by Claude, do not edit)

### Why
Batch 2 "W-chips" in `docs/audit/ui-kit-leftovers.md` (W3) needed a kit decision. The lead decided: add one `Chip` to the web kit for small pill buttons. This task migrates the reaction chips and the search scope chip onto it, and moves the new-topic "Type" choice onto the existing `SegmentedControl` (radio). The Public/Private choice in the same dialog already uses it.

### Verified facts (do not re-derive)
- **Reaction chips:** `apps/web/src/components/ReactionChips.tsx:36-52` renders one raw `<button aria-pressed aria-label title onClick className="reaction-chip … rounded-full px-2 py-0.5 text-[13px]">` per reaction, plus `reaction-chip-mine` when it is mine. The emoji and a mono count sit inside. `reaction-chip` and `reaction-chip-mine` are `@utility` classes in `apps/web/src/index.css:288` and `:310`, with reduced-motion rules near line 639. Tests: `apps/web/src/components/ReactionChips.test.tsx`.
- **The search scope chip:** `apps/web/src/components/SearchBar.tsx:45-53` is a raw `<button onClick={clearScope} title aria-label="Searching only in {title}. Activate to search all chats." className="max-w-[120px] shrink-0 truncate rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-medium">`. It is tested through `apps/web/src/components/ChatList.test.tsx`.
- **The new-topic Type chips:**
  - `apps/web/src/components/NewTopicDialog.tsx:15` defines `TYPE_CHIPS: { kind, label }[]`;
  - lines 230-250 render a `role="group" aria-labelledby="new-topic-type"` of raw `<button aria-pressed>` pills;
  - `apps/web/src/components/NewTopicDialog.test.tsx:25` clicks `getByRole('button', { name: 'Task' })`;
  - Public/Private already uses `SegmentedControl` (tests at lines 43 and 119 use `role="radio"`).
- **`SegmentedControl({ options: {value,label}[], value, onChange, ariaLabel, mode?: 'tabs'|'radio' })`** is in `apps/web/src/components/ui/segmented-control.tsx`.
- **Kit conventions:** each `components/ui/*.tsx` has a `*.fixture.tsx` (React Cosmos), and `apps/web/src/components/ui/kit.test.tsx` tests the kit. `cn` comes from `@/lib/utils`.

### What to build
1. **New `apps/web/src/components/ui/chip.tsx`:** `Chip({ pressed?, onClick, ariaLabel?, title?, tone?: 'neutral' | 'accent', className?, children })`.
   - It renders `<button type="button">` with `aria-pressed` only when `pressed` is given.
   - Base classes: `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`.
   - Tone `accent` adds `bg-accent/20 font-medium text-foreground`. Tone `neutral` (the default) adds nothing beyond the base.
   - `className` is merged last, so callers can add the reaction utilities.
   
   Add `chip.fixture.tsx` (neutral, pressed, accent), and a test in `kit.test.tsx` covering `aria-pressed` on and off, the name, and the click.
2. **`ReactionChips.tsx`:** each chip becomes `<Chip pressed={reaction.mine} ariaLabel={chipLabel(reaction)} title=… onClick=… className={cn('reaction-chip', reaction.mine && 'reaction-chip-mine')}>` with the same children. **The look stays the same,** through the utilities.
3. **`SearchBar.tsx`:** the scope chip becomes `<Chip tone="accent" ariaLabel=… title=… onClick={clearScope} className="max-w-[120px] shrink-0 truncate text-[11px]">`.
4. **`NewTopicDialog.tsx`:** the Type chips become `<SegmentedControl mode="radio" ariaLabel="Type" options={TYPE_CHIPS.map(c => ({ value: c.kind, label: c.label }))} value={kind} onChange={(v) => setKind(v as TopicKind)} />`. Keep the visible "Type" label span. Update `NewTopicDialog.test.tsx:25` to click `getByRole('radio', { name: 'Task' })`.
5. **Tests:** the existing `ReactionChips` and `ChatList` tests pass unchanged, keeping the same names and `aria-pressed`.

### Read first
`AGENTS.md`, `docs/audit/ui-kit-leftovers.md` (W3, batch 2), `apps/web/src/components/ui/button.tsx` (kit style), `apps/web/src/components/ui/badge.tsx` and `badge.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/ReactionChips.tsx`, `apps/web/src/components/SearchBar.tsx:30-60`, `apps/web/src/components/NewTopicDialog.tsx:1-40` and `:220-260`.

### Allowed files
`apps/web/src/components/ui/chip.tsx`, `apps/web/src/components/ui/chip.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ReactionChips.tsx`, `apps/web/src/components/ReactionChips.test.tsx`, `apps/web/src/components/SearchBar.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/NewTopicDialog.test.tsx`, `work/T-0477-web-kit-chip.md`.

If the Cosmos fixtures test (`apps/web/src/components/ui/fixtures.test.tsx`) needs the new fixture registered, that file is allowed too. If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit fixtures ReactionChips NewTopicDialog ChatList
pnpm gate
```

### Acceptance
- The web kit has a `Chip` with a fixture and tests.
- Reaction chips and the search scope chip use it with an unchanged look and names.
- The new-topic Type uses `SegmentedControl` (radio).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
