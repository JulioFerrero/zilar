---
id: T-0333
title: "Web kit: the sticker panel's Stickers / GIFs / Emoji tabs use SegmentedControl"
status: todo
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

## Review (written by Claude)
