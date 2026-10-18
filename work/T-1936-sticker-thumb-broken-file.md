---
id: T-1936
title: "Stickers: a thumbnail whose file is gone shows its emoji, and a dead Recent entry drops out (web + phone)"
status: merged
milestone: M5
branch: task/T-1936-sticker-thumb-broken-file
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1936: No broken images in the sticker panel

## Spec (written by Claude, do not edit)

### Why
Julio, on the web sticker panel on 2026-10-18: "the stickers are broken in the drawer". The lead checked it live.
- The Recent tab holds a sticker whose file no longer exists: `GET /api/stickers/9717419f-…/file` returns 404.
- The browser draws its broken-image icon with the alt text "🦆" squeezed beside it.
- Stickers in the Test pack load fine.

Recents live in local storage and are never re-checked, so a deleted sticker stays there for good.

### Facts (read by the lead on 2026-10-18)
- **Web `apps/web/src/components/sticker/StickerThumb.tsx`:**
  - `StickerThumb({ sticker, size })` renders the emoji tile for untrusted URLs (`:14-27`) and otherwise a plain `<img>` with no `onError` (`:28-37`).
  - It is used by `apps/web/src/components/sticker/StickerGrid.tsx:162` and `apps/web/src/routes/StickerPackPage.tsx:192`.
- **Web `apps/web/src/components/sticker/StickerGrid.tsx`:**
  - the tiles are mapped at `:143-170`;
  - the Recent tab is active when `activePackId === undefined || activePackId === 'recent'` (`:59`).
- **Web `apps/web/src/components/StickerPanel.tsx`:**
  - `recents` state (`:117`) is read from storage by `readStoredRecents`;
  - `activeStickers` uses `recents.map(toChoice)` for the Recent tab (`:203-204`);
  - `pick` writes recents through `rememberRecentSticker(panelStorage(), …)` (`:210-219`).
- **Web `apps/web/src/lib/stickers.ts`:** `RECENT_STICKERS_KEY` (`:8`), `readRecentStickers` (`:49`), and `rememberRecentSticker`, which writes with `orFallback` (`:73-88`).
- **Phone `apps/mobile/src/components/chat/sticker-panel.tsx`:**
  - `StickerGrid` (`:96`) builds `recentChoices` from `recents` (`:125`), and `choices` is `recentChoices` when `activePackId === undefined` (`:127-129`);
  - the private `StickerThumb` (`:308-333`) renders an expo-image `Image` with no `onError`.

### Steps
1. **Web `StickerThumb.tsx`:**
   - Add `const [broken, setBroken] = useState(false)` and `onError={() => { setBroken(true); onBroken?.(); }}` on the `<img>`.
   - When `broken` is set, render the same emoji tile as the untrusted branch.
   - Add an optional prop `onBroken?: () => void`.
2. **Web `apps/web/src/lib/stickers.ts`:** add `forgetRecentSticker(storage: Storage | null, stickerId: string): RecentStickerEntry[]`. It reads the recents, drops that id, writes them back with the same `orFallback` guard as `rememberRecentSticker`, and returns the new list.
3. **Web `StickerPanel.tsx` and `StickerGrid.tsx`:**
   - Add an optional `onBrokenRecent?: (stickerId: string) => void` prop to `StickerGrid`.
   - On the Recent tab only, pass `onBroken={() => onBrokenRecent?.(sticker.stickerId)}` to `StickerThumb`.
   - `StickerPanel` passes `onBrokenRecent={(id) => setRecents(forgetRecentSticker(panelStorage(), id))}`.
4. **Phone `sticker-panel.tsx`:**
   - Give `StickerThumb` a local `broken` state, set by expo-image's `onError`; when it's set, render the emoji `Text` fallback.
   - In `StickerGrid`, keep a `brokenRecentIds` state (`Set<string>`), filled from an `onBroken` callback passed to `StickerThumb` on the Recent tab only. Filter `recentChoices` by it.
   - Persisting this on the phone is out of scope: the list reloads from storage on each open.
5. Keep every file at 400 lines or fewer. **No tests** (UI).

### Allowed files
- `apps/web/src/components/sticker/StickerThumb.tsx`
- `apps/web/src/components/sticker/StickerGrid.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/lib/stickers.ts`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `work/T-1936-sticker-thumb-broken-file.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On the web, a Recent sticker whose file returns 404 disappears from Recent after the panel opens, and stays gone after a reload.
- A pack sticker whose file fails shows its emoji instead of a broken-image icon (web and phone).
- On the phone, a dead Recent sticker is hidden instead of leaving an empty tile.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/web/src/components/sticker/StickerThumb.tsx`**: added local `broken` state set by the `<img>`'s `onError`, and an optional `onBroken` prop called at the same time. A broken image now renders the same emoji tile (or the `Smile` icon for an emoji-less sticker) as the untrusted-URL branch, instead of the browser's broken-image icon.
- **`apps/web/src/lib/stickers.ts`**: added `forgetRecentSticker(storage, stickerId)`. It reads the recents, drops the matching id, writes the rest back under the same `orFallback` guard as `rememberRecentSticker`, and returns the new list. A `null`/blocked storage still returns the filtered list.
- **`apps/web/src/components/sticker/StickerGrid.tsx`**: added optional `onBrokenRecent?: (stickerId: string) => void`. On the Recent tab only (`activePackId` undefined or `'recent'`), tiles pass `onBroken={() => onBrokenRecent(sticker.stickerId)}`; pack and favorites tabs get no callback and only show the emoji fallback.
- **`apps/web/src/components/StickerPanel.tsx`**: passes `onBrokenRecent={(id) => setRecents(forgetRecentSticker(panelStorage(), id))}`, so a 404'd Recent sticker is dropped from state and from `localStorage` in one step — it disappears immediately and stays gone after a reload.
- **`apps/mobile/src/components/chat/sticker-panel.tsx`**: `StickerThumb` has a local `broken` state set by expo-image's `onError`; when set it renders the existing emoji `Text` fallback. `StickerGrid` keeps `brokenRecentIds: ReadonlySet<string>` filled from `onBroken` (Recent tab only) and filters `recentChoices` by it, so a dead Recent sticker is hidden rather than leaving an empty tile. Nothing is persisted on the phone, per the spec: recents reload from storage on each open.
- No tests added (UI change, spec says none). No dependencies, no `any`, no `@ts-ignore`.

Files changed (all inside Allowed files):
- `apps/web/src/components/sticker/StickerThumb.tsx`
- `apps/web/src/components/sticker/StickerGrid.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/lib/stickers.ts`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `work/T-1936-sticker-thumb-broken-file.md`

Line counts: web `StickerThumb` 72, `StickerGrid` 217, `StickerPanel` 298, `stickers.ts` 136, mobile `sticker-panel.tsx` 400 — all at or under 400.

### Checks run

- `pnpm install`: Done in 14.8s using pnpm v10.32.1.
- No single test file was run: no test file references `StickerThumb`, `StickerGrid` or `StickerPanel` (checked with `grep`), and the spec says no tests (UI).
- `pnpm gate` from the repo root, real output:

```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (1.1s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Round (fix round 1, 2026-10-18)

**Findings fixed**
- **Finding 1 (should-fix), hover preview**: `apps/web/src/components/sticker/StickerGrid.tsx` now keeps `failedPreviewUrl` state. The hover preview `<img>` reports its URL on `onError`, and the preview box is not rendered while `preview.url === failedPreviewUrl`, so a dead pack sticker no longer draws the browser's broken-image icon in the 160 px preview. The tile already showed the emoji tile; this closes the last path named by the finding.
- **Finding 2 (nit), mobile `onBroken` prop shape**: not touched. The instructions say not to touch nits unless they are in a line already changed, and this fix round changes no line in `apps/mobile/src/components/chat/sticker-panel.tsx`.

**Tests added**
- None. Finding 1 names no test, the Spec says "No tests (UI)", and `AGENTS.md` says UI code gets no tests. No existing test file references `StickerGrid`, `StickerThumb` or `StickerPanel` (checked with `grep`), so there was no nearby test to adjust either.

**Checks**
- `pnpm gate` from the repo root, real output:

```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.6s)
PASS  lint  (0.7s)
PASS  typecheck  (3.2s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run: this round changes only UI code with no nearby test, and the mobile package was covered by the gate.

Line counts after the round: web `StickerThumb` 72, `StickerGrid` 221, `StickerPanel` 298, `stickers.ts` 136, mobile `sticker-panel.tsx` 400 — all at or under 400.

### Round (verification, 2026-10-18)

The fix round above was already committed as `68b0a92f6`; this session re-checked it against `PREREVIEW.md` and re-ran the gate.

- **Findings**: must-fix 0, should-fix 1 (hover preview) — fixed by `68b0a92f6` and present in `StickerGrid.tsx`; nit 1 (mobile prop shape) left alone per the "don't touch nits in untouched lines" rule. No disagreements.
- **Tests added**: none, same reason as the round above (finding names no test, Spec says "No tests (UI)").
- **Spec check**: all five steps are implemented in the current tree; line counts are still 72 / 221 / 298 / 136 / 400.
- `pnpm gate` from the repo root, real output:

```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (0.8s)
PASS  typecheck  (0.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run this session: the remaining change is UI-only and no test file references these components.

### Notes for the lead

- I did not run the app in a browser or on a phone, and I did not reproduce the live 404. The two acceptance points that can only be seen live — the 404'd Recent sticker vanishing and staying gone after reload, and the pack-sticker emoji fallback on a real broken file — follow from the code but are for your smoke test / Julio's live check.
- Web: `onError` fires both the local emoji fallback and the recents removal; since each removal knows its own sticker id, several dead recents in one render are each removed and the list is re-read from storage per removal, so no update is lost.
- Web: a pack/favorites sticker with a dead file stays in the grid as its emoji tile (per acceptance). The hover preview `<img>` in `StickerGrid` now hides itself after a failed load (`failedPreviewUrl`), so it no longer draws the broken-image icon either.
- Mobile: the `brokenRecentIds` filter is in-memory only (spec), so the dead Recent entry comes back on the next panel open and is hidden again once its image errors.

## Review (written by Claude)

Merged on 2026-10-18 at HEAD `65bdbe1a6`.
- **The packet was stale.** It came from round 1, at 11:33, before the fix commit `68b0a92f6` at 11:34. So I read the fix myself: the hover preview now hides itself on `onError` (`failedPreviewUrl`), which closes the should-fix.
- **Web mock** (vite on the branch):
  - I planted a dead Recent entry (`/api/stickers/dead-1/file`, 🦆) in `zilar:recentStickers`, then opened the panel.
  - The entry was dropped and storage became `[]`; Recent shows its empty state, with no broken image.
- **Phone smoke** passes (mock, `/chat/marta@zilar.test`). The Stickers tab opens, and the mock stickers now show their emoji instead of blank tiles.

