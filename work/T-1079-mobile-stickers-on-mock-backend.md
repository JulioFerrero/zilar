---
id: T-1079
title: "Mock H2-7 (mobile): sticker management runs on @zilar/mock-backend through mockFetch; delete stickers-mock.ts"
status: todo
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

## Review (written by Claude)
