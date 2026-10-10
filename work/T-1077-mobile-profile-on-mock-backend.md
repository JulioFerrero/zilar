---
id: T-1077
title: "Mock H2-6 (mobile): profile runs on @zilar/mock-backend through mockFetch; delete mock/profile.ts"
status: todo
milestone: M5
branch: task/T-1077-mobile-profile-on-mock-backend
model: auto
effort: default
depends_on: [T-1076]
estimate: 0.25 day
---

# T-1077: Mobile profile on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
The lead read main (2026-10-11):
- **The hook today:** `apps/mobile/src/components/settings/use-profile-api.ts` (43 lines) picks `createMockProfileApi(scenario)` from `apps/mobile/src/mock/profile.ts` (198 lines) in mock mode, at `:28-42`.
- **The only importers of `mock/profile`** are `use-profile-api.ts` itself and `mock/profile.ts`.
- **Callers:** all five use only `{ api }`, never `scenario`:
  - `app/(tabs)/profile.tsx:53`, `app/(tabs)/settings.tsx:128`, `app/(tabs)/_layout.tsx:30`;
  - `app/welcome/handle.tsx:48`, `components/settings/use-profile-settings.ts:50`.
- **The backend serves every route the factory calls,** after T-1067 and T-1076: `GET /me`, `GET /handles/check`, `PUT /me/handle`, and `PUT`/`DELETE /avatars/user/:id`. The factory is `createProfileApi(getToken, fetchImpl, apiUrl)` in `apps/mobile/src/lib/profile-api.ts`.
- **The upload exception.** Both callers upload through a **native uploader**: `uploadAvatar(ownerId, new Blob([]), uploader)`, at `components/settings/use-profile-avatar.ts:128` and `app/(tabs)/profile.tsx:134`. The factory then PUTs through `expo-file-system` to `${apiUrl}/api/avatars/user/<id>` (`lib/profile-api.ts:288-303`), a real network call that `mockFetch` never sees.
  - The old mock also could not reach it. It caught the failure and minted `/api/avatars/mock-N` (`mock/profile.ts:147-166`), so the picture never showed in mock mode and the fallback appeared.
- **The pattern:** `apps/mobile/src/components/machines/use-machines-api.ts`:
  - `mockToken` comes from `@/mock/gate`;
  - `mockFetch` comes from a guarded `require('@/mock/backend')` inside `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK`;
  - the gate is a pure `…MockActive(envMock, params, paramAllowed)` function;
  - the handle is `{ api, mock: boolean }`.

### What to build
1. **Probe first,** with a throwaway script that you do not commit. Call `createMockBackend({ delayMs: 0 }).http(path, init)` for every method and path `createProfileApi` uses. For the avatar, send a `Uint8Array` body. If any call gets no `Response`, stop and report.
2. **`use-profile-api.ts`** follows the machines pattern. The mock branch builds `createProfileApi(mockToken, mockFetch, API_URL)` and wraps only `uploadAvatar`:
   - when an `uploader` is passed, skip it;
   - instead `mockFetch` a `PUT /api/avatars/user/<ownerId>` with body `new Uint8Array([0x89, 0x50, 0x4e, 0x47])` and `content-type: blob.type || 'image/png'`;
   - return the `{ url }` it answers.

   The backend then stores the viewer's `avatarUrl`. That `data:` url is not a real picture, so the screens fall back to the dither, as the old mock fell back to initials. Say so in a comment.
   - The handle becomes `{ api, mock }`; the scenarios are gone.
3. **Delete `apps/mobile/src/mock/profile.ts`,** after `grep -rn` across `apps/mobile` (`src`, `app`, `test`) confirms that nothing else imports it.
4. **No other change.** Keep the five callers as they are. If one needs a change because of the type, report it instead of editing it.

The lead runs a phone smoke in mock mode:
- the Profile tab shows Ada;
- claim `ada_fresh`, then try `taken_user`;
- Set photo, then the fallback still shows and nothing errors;
- the Settings tab opens.

### Read first
`AGENTS.md`, `apps/mobile/src/components/settings/use-profile-api.ts`, `apps/mobile/src/mock/profile.ts`, `apps/mobile/src/lib/profile-api.ts`, `apps/mobile/src/components/machines/use-machines-api.ts`, and `work/T-1076-mock-backend-avatars.md` (its Report).

### Allowed files
`apps/mobile/src/components/settings/use-profile-api.ts`, `apps/mobile/src/mock/profile.ts`, `work/T-1077-mobile-profile-on-mock-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe table and the grep for `mock/profile`.

---

## Report (written by the worker when done)

## Review (written by Claude)
