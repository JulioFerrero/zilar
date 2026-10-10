---
id: T-1079
title: "Mock H2-7 (mobile): sticker management runs on @zilar/mock-backend through mockFetch; delete stickers-mock.ts"
status: merged
milestone: M5
branch: task/T-1079-mobile-stickers-on-mock-backend
model: auto
effort: default
depends_on: [T-1078]
estimate: 0.25 day
---

# T-1079: Mobile stickers on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
The lead read main (2026-10-11):
- **The hook:** `apps/mobile/src/components/stickers/use-stickers-api.ts` (44 lines) picks `createMockStickersApi(scenario)` from `components/stickers/stickers-mock.ts` (314 lines) at `:29-43`. Its scenarios are `'default' | 'empty' | 'error'`.
- **Callers:**
  - `use-pack-editor.ts:82` and `use-stickers-panel.ts:31` read `{ api }`;
  - `require-stickers-auth.tsx:14` reads `scenario` only to skip `RequireAuth` in mock mode. That is the `RequireAisAuth` pattern, which reads `mock` since T-1063.
- **The only importer of `stickers-mock`** is the hook. `setStickersMockTelegramImport` and `resetStickersMock` have no callers outside the file.
- **The factory** `createStickersApi(getToken, fetchImpl, apiUrl, binaryUpload)` (`apps/mobile/src/lib/stickers-api.ts:206-210`) uploads sticker files through a **native** `binaryUpload.upload(url, uri, headers)`. That is an `expo-file-system` POST to `${apiUrl}/api/sticker-packs/:id/stickers` (`:137-154`, `:226-230`), which `mockFetch` never sees.
- **The backend has a `stickers` domain** with pack routes, including `POST /sticker-packs/:id/stickers` (`packages/mock-backend/src/domains/stickers/packs.ts:56`).
- **The pattern:** `apps/mobile/src/components/machines/use-machines-api.ts` (`mockToken`, a guarded `require('@/mock/backend')`, `{ api, mock }`). T-1077 did the same native-upload workaround for avatars, in `apps/mobile/src/components/settings/use-profile-api.ts`.

### What to build
1. **Probe first,** with a throwaway script that you do not commit. Call `createMockBackend({ delayMs: 0 }).http(path, init)` for every method and path `createStickersApi` uses, including the sticker upload, the Telegram import and discover. If any call gets no `Response`, list it, and keep this task to what is served (see step 4).
2. **`use-stickers-api.ts`** builds `createStickersApi(mockToken, mockFetch, API_URL, mockBinaryUpload)` in mock mode.
   - `mockBinaryUpload.upload(url, uri, headers)` calls `mockFetch(url, { method: 'POST', headers, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })` and returns `{ status, body: await response.text() }`. Comment that mock mode has no file bytes.
   - The handle becomes `{ api, mock }`, and the scenarios are gone (mock-plan Q2).
3. **`require-stickers-auth.tsx`** reads `mock` instead of `scenario`, exactly as `RequireAisAuth` does.
4. **Delete `stickers-mock.ts`** only if every call in step 1 was served, after `grep -rn` across `apps/mobile` confirms that nothing else imports it. Otherwise keep it, and report the unserved calls.
5. **Keep** `apps/mobile/src/mock/stickers.ts` (still used by `lib/stickers-api.ts`, `lib/stickers-storage.ts` and others) and `mock/gifs.ts`. No other changes, and no tests.

The lead runs a phone smoke in mock mode:
- Settings › Stickers lists the packs;
- open a pack;
- the composer sticker panel lists packs.

### Read first
`AGENTS.md`, `apps/mobile/src/components/stickers/use-stickers-api.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/require-stickers-auth.tsx`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/components/machines/use-machines-api.ts`, and `packages/mock-backend/src/domains/stickers/`.

### Allowed files
`apps/mobile/src/components/stickers/use-stickers-api.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/require-stickers-auth.tsx`, `work/T-1079-mobile-stickers-on-mock-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe table and the grep for `stickers-mock`.

---

## Report (written by the worker when done)

### What I did

- **Probe (throwaway, not committed).** I ran a temporary vitest file in `apps/mobile` that called `createMockBackend({ delayMs: 0 }).http(path, init)` once per call `createStickersApi` makes, each against a fresh backend. Every call got a `Response`; none was unserved, so I deleted `stickers-mock.ts` per step 4. Results:

  | Method | Path | Status |
  | --- | --- | --- |
  | GET | `/api/sticker-packs` | 200 |
  | GET | `/api/sticker-packs/discover` | 200 |
  | GET | `/api/sticker-packs/discover?q=cats` | 200 |
  | PUT | `/api/sticker-panel` (reorder) | 200 |
  | PUT | `/api/sticker-panel/:packId` | 200 |
  | DELETE | `/api/sticker-panel/:packId` | 200 |
  | GET | `/api/sticker-favorites` | 200 |
  | DELETE | `/api/sticker-favorites?sticker_id=:id` | 200 |
  | POST | `/api/sticker-packs` | 201 |
  | POST | `/api/sticker-packs/import/telegram` | 200 |
  | PATCH | `/api/sticker-packs/:id` | 200 |
  | DELETE | `/api/sticker-packs/:id` | 200 |
  | DELETE | `/api/sticker-packs/:id/stickers/:stickerId` | 200 |
  | POST | `/api/sticker-packs/:id/stickers` (raw upload) | 201 |

- **`use-stickers-api.ts`**: dropped the scenario machinery and the `loadMock` require. It now mirrors `use-machines-api.ts`: a `stickersMockActive` gate over `?mock=` / `EXPO_PUBLIC_ZILAR_MOCK`, a guarded `require('@/mock/backend')`, and `createStickersApi(mockToken, mockFetch, API_URL, mockBinaryUpload)`. The handle is `{ api, mock }`.
  - `createMockStickerUpload` wraps `mockFetch`: `upload(url, _uri, headers)` POSTs a 4-byte stand-in (`[0x89, 0x50, 0x4e, 0x47]`) and returns `{ status, body: await response.text() }`. The comment states mock mode has no file bytes.
- **`require-stickers-auth.tsx`**: reads `mock` instead of `scenario`, identical to `RequireAisAuth`.
- **Deleted `apps/mobile/src/components/stickers/stickers-mock.ts`** (314 lines) because the probe showed every call is served and the grep below found no remaining importer.
- Kept `apps/mobile/src/mock/stickers.ts` and `mock/gifs.ts`. No other changes, no tests added.

### Grep for `stickers-mock`

`grep -rn "stickers-mock" apps/mobile` after the change:

```
NO MATCHES in apps/mobile
```

The only remaining references in the repo are in docs/work files I am not allowed to edit (`docs/audit/mock-sweep-status.md`, `docs/audit/mock-plan.md`, `work/*.md`); none is an import.

### Files changed

- `apps/mobile/src/components/stickers/use-stickers-api.ts` (modified)
- `apps/mobile/src/components/stickers/require-stickers-auth.tsx` (modified)
- `apps/mobile/src/components/stickers/stickers-mock.ts` (deleted)
- `work/T-1079-mobile-stickers-on-mock-backend.md` (this file)

### Commands and results

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/stickers/__probe.tmp.test.ts` (throwaway probe, run twice while tuning): 1 file, 1 test passed each time; the table above is its output. File removed afterwards.
- `pnpm gate`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- The old `?mock=<scenario>` names (`empty`, `error`) are gone; as in the other migrated hooks, any non-`0`/non-`false` value now enables the shared-backend mock. This matches the migration pattern the spec points to.
- No `StickersApiHandle.scenario` consumers existed outside `require-stickers-auth.tsx` (grep for `scenario` in `*.tsx` is empty), so `{ api, mock }` is safe.
- Security checklist: no secrets/tokens involved; mock mode uses the fixed `mockToken`; the change adds no route, query or log.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `use-stickers-api.ts` runs on `mockFetch`, with a mock `binaryUpload` that POSTs a placeholder through `mockFetch`;
  - the handle is `{ api, mock }`, and `require-stickers-auth.tsx` reads `mock`;
  - `stickers-mock.ts` (314 lines) is deleted.
- **The worker's probe:** every client call was served.
- **The lead's phone smoke** (mock):
  - Settings › Stickers shows My packs, Discover and Favorites, with New pack, Import from Telegram, and Cats and Moods (6 stickers each);
  - the Cats pack by deep link opens Edit pack, which says "You can only edit your own packs.".
- **That "forbidden" is not new:** the editor checks `found.ownerId !== me.id` (`use-pack-editor.ts:152`), and `useAuthStore` `me` is null in mock mode. The old mock's packs were owned by `'mock-user'`, so main read the same. It is a follow-up task.
- **Check:** the gate passed.
