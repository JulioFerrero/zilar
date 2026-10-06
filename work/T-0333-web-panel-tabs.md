---
id: T-0333
title: "Web kit: the sticker panel's Stickers / GIFs / Emoji tabs use SegmentedControl"
status: merged
milestone: M5
branch: task/T-0333-web-panel-tabs
model: auto
effort: low
depends_on: [T-0330]
estimate: 0.1 day
---

# T-0333: sticker panel tabs on SegmentedControl

## Spec (written by Claude, do not edit)

### Why
The sticker panel's top tabs are a hand-rolled tablist. It has no arrow-key support, and it looks different from the kit's segmented tabs. The kit `SegmentedControl` (tabs mode is the default) gives roving focus, ArrowLeft and ArrowRight, Home and End, and the shared look.

### Verified facts (do not re-derive)
- **`apps/web/src/components/StickerPanel.tsx`:**
  - line 82: `PANEL_TABS = ['stickers', 'gifs', 'emoji']`;
  - line 139: `const [tab, setTab] = useState<Tab>('stickers')`;
  - lines 359-375: `<div role="tablist" aria-label="Panel tabs" className="flex gap-1 border-b border-edge p-2">`, which maps `PANEL_TABS.filter((name) => name !== 'gifs' || gifsEnabled !== false)` to raw `role="tab"` buttons with `aria-selected={visibleTab === name}` and `onClick={() => setTab(name)}`;
  - labels: Stickers, GIFs, Emoji.

  The panel uses `visibleTab`, not `tab`, to pick the content. Lines 404 and on hold a second tablist, the pack tabs. **Leave it.**
- **`apps/web/src/components/ui/segmented-control.tsx`:**
  - props: `options: { value, label, count? }[]`, `value`, `onChange(value: string)`, `ariaLabel` and `mode?: 'tabs' | 'radio'`;
  - tabs mode renders `role="tablist"` and `role="tab"` with `aria-selected`;
  - since T-0330, `onChange` fires only on a real change.
- **`apps/web/src/components/StickerPanel.test.tsx`** finds and clicks `getByRole('tab', { name: 'Stickers' | 'GIFs' | 'Emoji' })` (lines 57-59, 68, 87-89, 101 and 126). It must pass unchanged.

### What to build
1. Replace lines 359-375 with `<div className="border-b border-edge p-2"><SegmentedControl ariaLabel="Panel tabs" options={…} value={visibleTab} onChange={…} /></div>`.
   - The options are the same filtered tabs with the same labels.
   - `onChange` narrows the string to `Tab` safely: look it up in `PANEL_TABS`, and do not cast.
2. Keep `cn` if other code still uses it.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/StickerPanel.tsx:75-145` and `:350-405`, and `apps/web/src/components/StickerPanel.test.tsx`.

### Allowed files
`apps/web/src/components/StickerPanel.tsx`, `work/T-0333-web-panel-tabs.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickerPanel
pnpm gate
```

### Acceptance
- The panel's top tabs render through `SegmentedControl`; the pack tabs are unchanged.
- `StickerPanel.test.tsx` passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced the hand-rolled top tablist (lines 359-375) with the kit
`SegmentedControl` in default tabs mode, wrapped in the same
`border-b border-edge p-2` container. Options are the same filtered
`PANEL_TABS` with the same labels (Stickers / GIFs / Emoji), `value`
is `visibleTab`, and `onChange` narrows via `PANEL_TABS.find` (no
cast). The pack tablist below is untouched; `cn` is still used by the
pack tabs and grid tiles. Added one import line only, no test changes.

Files changed:
- `apps/web/src/components/StickerPanel.tsx` (import + top tabs block)
- `work/T-0333-web-panel-tabs.md` (front matter + this report)

Commands and real results:
- `pnpm install`: done in 11.4s, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickerPanel`: 1 file passed, 24 tests passed (3.77s), exit 0. `StickerPanel.test.tsx` unchanged.
- `pnpm gate`: PASS install (1.4s), PASS format (15.3s), PASS lint (1.5s), PASS typecheck (6.8s), PASS tests @zilar/web (16.4s); "scope: every changed file is inside the Allowed files"; GATE PASS. Changed files: `apps/web/src/components/StickerPanel.tsx`, `work/T-0333-web-panel-tabs.md`.

Security checklist: no secrets/tokens touched; no deletes/updates; no caps; no permission changes; no new routes; no audit entries.

Problems / deviations: none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). The sticker panel's Stickers / GIFs / Emoji tabs render through `SegmentedControl` (tabs mode), driven by `visibleTab` and narrowed safely through `PANEL_TABS`. They gain arrow-key navigation and roving focus. The pack tabs are unchanged, and `StickerPanel.test.tsx` passes unchanged.
