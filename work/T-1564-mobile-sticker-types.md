---
id: T-1564
title: "Phone sticker types tell the truth (follow-ups of T-1525 and T-1557): a kept moving file declares its real MIME type (the server sniffs bytes anyway); the upload MIME fields widen to string; Discover packs are typed PanelPack; stale comments go"
status: merged
milestone: M5
branch: task/T-1564-mobile-sticker-types
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1564: Phone sticker types tell the truth

## Spec (written by Claude, do not edit)

### Why
- **The upload type:** T-1525 keeps a moving GIF, MP4 or WebP as it is, but declares it `image/webp` (or `image/png`) because the upload types only allow those two. The server never trusts that header:
  - `apps/server/src/stickers/api-upload.ts:33-36` only checks multipart against raw;
  - the bytes are sniffed in `apps/server/src/stickers/image.ts`.
  So the phone should declare the real type.
- **The Discover type:** T-1557's pre-review found that Discover packs carry `ownerHandle` at run time while the state is typed `StickerPack[]`.
- **Stale comments:** two comments are out of date.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/stickers/sticker-native.ts` (375 lines):**
  - `PreparedStickerImage.mimeType: 'image/webp' | 'image/png'` (`:52`);
  - the raw moving branch returns `mimeType: image.mimeType === 'image/png' ? 'image/png' : 'image/webp'` (`:204-212`);
  - the static re-encodes return `'image/webp'` (`:245`, `:260`) or `'image/png'` (`:292`);
  - `PickedStickerImage.mimeType?: string` (`:33`).
- **`apps/mobile/src/components/stickers/pack-editor.ts` (329 lines):** `mimeType: 'image/webp' | 'image/png'` at `:15`, `:123` and `:142`.
- **`apps/mobile/src/lib/stickers-api.ts` (325 lines):**
  - `uploadStickerFile`'s `file: { uri: string; mimeType: 'image/webp' | 'image/png' }` (`:217`);
  - the comment over `PanelPack` (`:64-67`) still says the list and Discover payloads do not carry the handle yet (T-1531 added it);
  - `discoverStickerPacks` returns `{ packs: StickerPack[] … }` (`:184`, `:285`) while `toStickerPack` returns `PanelPack`.
- **`apps/mobile/src/components/stickers/use-stickers-panel.ts:38`:** `useState<StickerPack[] | undefined>` for `discover`.
- **`apps/mobile/src/components/stickers/pack-card.tsx:27`:** the comment ends "Discover keeps its own card", but Discover uses the same list since T-1557.
- **`apps/mobile/src/components/stickers/use-pack-items.ts` (389 lines):** copies `prepared.image.mimeType` (`:132`) and sends `item.mimeType` (`:270`). It must not grow.
- **Leave these unions alone:** they describe a sent sticker, which the server always stores as WebP or PNG.
  - `apps/mobile/src/lib/stickers.ts:42/53/64`;
  - `apps/mobile/src/store/send-types.ts:41`;
  - `packages/client-core/src/store/send/context.ts:51`;
  - the mock seed.

### Steps
1. **`sticker-native.ts`:** `PreparedStickerImage.mimeType: string`. The raw moving branch declares `image.mimeType ?? 'application/octet-stream'`. The re-encode branches are unchanged.
2. **`pack-editor.ts`:** the three `mimeType` fields become `string`.
3. **`stickers-api.ts`:**
   - `uploadStickerFile`'s `mimeType: string`;
   - `discoverStickerPacks` returns `PanelPack[]` in its type and its value;
   - rewrite the `PanelPack` comment to say the list, Discover and detail rows carry the owner's handle when set.
4. **`use-stickers-panel.ts`:** `discover` state is `PanelPack[] | undefined`. Fix any type that follows in its callers within the Allowed files.
5. **`pack-card.tsx:27`:** the comment says My packs, Added and Discover all render it inside one bordered list.
6. **No behaviour change** other than the declared upload type of a kept moving file. Every file stays under 400 lines.

### Tests
None.

### Allowed files
- `apps/mobile/src/components/stickers/sticker-native.ts`
- `apps/mobile/src/components/stickers/pack-editor.ts`
- `apps/mobile/src/lib/stickers-api.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `apps/mobile/src/components/stickers/pack-card.tsx`
- `apps/mobile/src/components/stickers/discover-tab.tsx` (only if a type follows)
- `apps/mobile/src/components/stickers/use-pack-items.ts` (only if a type follows; must not grow)
- `work/T-1564-mobile-sticker-types.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `git grep -n "'image/webp' | 'image/png'" -- apps/mobile/src/components/stickers apps/mobile/src/lib/stickers-api.ts` prints nothing.
- The gate passes.
- The Report lists each changed type.

---

## Report (written by the worker when done)

### What I did

Changed types, file by file:

- **`apps/mobile/src/components/stickers/sticker-native.ts`**
  - `PreparedStickerImage.mimeType`: `'image/webp' | 'image/png'` → `string` (`:52`).
  - The raw moving branch now declares `image.mimeType ?? 'application/octet-stream'` (`:208`) instead of folding everything to WebP/PNG.
  - The two WebP re-encode returns and the PNG re-encode return are unchanged; their `'image/webp'`/`'image/png'` literals still satisfy `string`.
  - Refreshed the `keepMovingEffect` doc comment (`:173-181`): it still claimed "the declared type stays WebP (PNG for an APNG) ... the tile and upload seams only carry `image/webp` | `image/png`", which is now false. New text says the declared type is the asset's own type or `application/octet-stream`, and the bytes decide.
- **`apps/mobile/src/components/stickers/pack-editor.ts`**
  - `EditorNewItem.mimeType` (`:15`): `'image/webp' | 'image/png'` → `string`.
  - `SavePendingItem.mimeType` (`:123`): `'image/webp' | 'image/png'` → `string`.
  - `SavePackApi.uploadStickerFile` file `mimeType` (`:142`): `'image/webp' | 'image/png'` → `string`.
- **`apps/mobile/src/lib/stickers-api.ts`**
  - `uploadStickerFile`'s `file.mimeType` (`:217`): `'image/webp' | 'image/png'` → `string`.
  - `discoverStickerPacks` return type (`:184`): `packs: StickerPack[]` → `packs: PanelPack[]`. The value already produced `PanelPack[]` (`toStickerPack(p) ?? []`), so no value change was needed.
  - Rewrote the `PanelPack` comment (`:63-68`): it no longer claims the handle is missing until T-1531; it now says the list, Discover and detail payloads carry the owner's handle when set.
- **`apps/mobile/src/components/stickers/use-stickers-panel.ts`**
  - `discover` state (`:38`): `StickerPack[] | undefined` → `PanelPack[] | undefined`, with a new `import type { PanelPack } from '@/lib/stickers-api'`.
- **`apps/mobile/src/components/stickers/discover-tab.tsx`** (type that follows)
  - `discover` prop: `StickerPack[] | undefined` → `PanelPack[] | undefined`; `onRemove` prop: `(pack: StickerPack) => void` → `(pack: PanelPack) => void`; import switched from `StickerPack` to `PanelPack`.
- **`apps/mobile/src/components/stickers/pack-card.tsx`**
  - Comment only (`:24-28`): now says My packs, Added and Discover all render the row inside one bordered list (was "Discover keeps its own card").

Not changed:
- `apps/mobile/src/components/stickers/use-pack-items.ts` — it already copies `prepared.image.mimeType` (`:132`) and sends `item.mimeType` (`:270`); both still typecheck against the widened `string` fields, so it did not grow and was left untouched.
- The sent-sticker unions the task says to leave alone were left alone: `apps/mobile/src/lib/stickers.ts:42/53/64`, `apps/mobile/src/store/send-types.ts:41`, `packages/client-core/src/store/send/context.ts:51`, mock seed.

The only behaviour change is the declared `Content-Type` of a kept moving file; the server sniffs the bytes anyway.

### Checks run

- `git grep -n "'image/webp' | 'image/png'" -- apps/mobile/src/components/stickers apps/mobile/src/lib/stickers-api.ts` → no output (grep exit 1). Acceptance met.
- `pnpm gate` (from repo root) → `GATE PASS`. Summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.0s)
  PASS  effect  (2.0s)
  PASS  tests @zilar/mobile  (2.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says "Tests: None", and the change is UI typing. The gate's `tests @zilar/mobile` run covers the package touched (PASS).
- `git status --porcelain` shows exactly the 7 allowed files (6 source/UI + the task file); nothing outside scope.

### Notes for the lead

- Deviation/extra, within the changed file: I also updated the stale `keepMovingEffect` comment in `sticker-native.ts`, which described the old "declared type stays WebP/PNG" behaviour. It is directly on the changed code and would otherwise be false.
- `discover-tab.tsx` was included because the `discover` prop type follows the widened state; `use-pack-items.ts` needed no change.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Type:** no `'image/webp' | 'image/png'` union is left in the sticker components or `stickers-api.ts`. The sent-sticker unions (`stickers.ts`, `send-types.ts`, client-core) stay as the spec said.
  - **The kept moving file** now declares `image.mimeType ?? 'application/octet-stream'`. That is safe:
    - the server's upload route only branches on multipart against raw and sniffs the bytes (`apps/server/src/stickers/api-upload.ts:33-36`);
    - the mock's upload maps any type to WebP or PNG (`packages/mock-backend/src/domains/stickers/packs.ts:158-159`).
  - **Discover** is typed `PanelPack[]`, and both stale comments are rewritten.
  - **Size:** `use-pack-items.ts` is unchanged at 389 lines.
- **No smoke:** nothing visible changed.
- **On Julio's next phone build,** check that a moving GIF upload still works; it is on the same list as T-1525.

