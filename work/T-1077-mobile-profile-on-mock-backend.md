---
id: T-1077
title: "Mock H2-6 (mobile): profile runs on @zilar/mock-backend through mockFetch; delete mock/profile.ts"
status: merged
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
   - instead `mockFetch` a `PUT /api/avatars/:kind/:ownerId` (kind `user`, the path from `avatarPutPath(ownerId)`) with body `new Uint8Array([0x89, 0x50, 0x4e, 0x47])` and `content-type: blob.type || 'image/png'`;
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

### What I did

The mobile profile hook now runs on `@zilar/mock-backend`, like the machines hook.

1. **Probe first (throwaway, not committed).** I wrote
   `packages/mock-backend/src/t1077-probe.test.ts`, called
   `createMockBackend({ delayMs: 0 }).http(path, init)` for every method and path
   `createProfileApi` uses (the avatar PUT with a `Uint8Array` body), printed
   each `Response`, and deleted the file before the gate. Every call answered a
   `Response` — the probe table is below.
2. **`apps/mobile/src/components/settings/use-profile-api.ts`** rewritten to the
   `use-machines-api.ts` pattern:
   - `createMockProfile()` builds `createProfileApi(mockToken, mockFetch, API_URL)`
     behind a guarded `require('@/mock/backend')` inside
     `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK`, and wraps only
     `uploadAvatar`: when an `uploader` is passed it is skipped, and the hook
     `mockFetch`es `PUT ${API_URL}${avatarPutPath(ownerId)}` (kind `user`) with
     body `new Uint8Array([0x89, 0x50, 0x4e, 0x47])` and
     `content-type: blob.type || 'image/png'`, returning the `{ url }` the backend
     answers. When no `uploader` is passed it delegates to the real factory (the
     test-only path).
   - The gate is a pure `profileMockActive(envMock, params, paramAllowed)` copied
     from `machinesMockActive` (a `?mock=` param, else `EXPO_PUBLIC_ZILAR_MOCK`;
     `false` is the one opt-out; the old named scenarios keep the mock on).
   - The handle is now `{ api, mock }`; the scenario type is gone, and no caller
     changed (all five use `{ api }` only).
   - A comment says the stored url's bytes are not a real picture, so the screens
     fall back to the dither, as the old mock fell back to initials.
3. **Deleted `apps/mobile/src/mock/profile.ts`** after the grep below showed
   nothing under `apps/mobile` imports it.
4. **No other change.** The five callers are untouched. The hook's `ProfileApi`
   type is unchanged, so none needs a change.

### Files changed

- Modified: `apps/mobile/src/components/settings/use-profile-api.ts`
- Deleted: `apps/mobile/src/mock/profile.ts`
- Modified: `work/T-1077-mobile-profile-on-mock-backend.md`

### Commands and real results

- `pnpm install`: done (10.1s, only the pre-existing `@types/react` peer warning).
- Probe (throwaway test, deleted before the gate):
  `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/t1077-probe.test.ts`
  → **1 passed**; the table below is its real stdout.
- `grep -rn "mock/profile" apps/mobile` (excluding `node_modules`) → **no matches**
  (exit 1). The spec names `apps/mobile/src`, `apps/mobile/app` and
  `apps/mobile/test`; only `apps/mobile/src` exists (the routes live at
  `src/app`), so the grep over `apps/mobile` covers all three.
- `pnpm gate` (repo root):

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (0.7s)
PASS  lint  (0.8s)
PASS  typecheck  (3.7s)
PASS  effect  (0.6s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

I ran no single mobile test file: the change is UI code and there is no test
near it (the gate's mobile step reports "no nearby test files"), so there was no
file to run.

### Probe table (real output)

| method + path | status | body |
| --- | --- | --- |
| `GET /api/me` | 200 | `{"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":null,"jid":"you@zilar.test"}` |
| `GET /api/handles/check?handle=ada_fresh` | 200 | `{"available":true}` |
| `GET /api/handles/check?handle=taken_user` | 200 | `{"available":false,"reason":"taken"}` |
| `PUT /api/me/handle` (JSON `{handle:"ada_fresh"}`) | 200 | `{"handle":"ada_fresh"}` |
| `PUT /api/avatars/user/u-you` (`Uint8Array` 0x89 50 4e 47) | 200 | `{"url":"data:image/png;base64,iVBORw=="}` |
| `DELETE /api/avatars/user/u-you` | 200 | `{"ok":true}` |

No path answered `undefined`.

### Deviations and notes

- The spec's phone smoke says "the Profile tab shows Ada". The shared backend's
  `GET /me` seeds the viewer as `{"id":"u-you","name":"You",...}` (see the probe
  table), not "Ada" — the old `mock/profile.ts` seeded `name: 'Ada'`. This is a
  seed difference in `@zilar/mock-backend` (`packages/mock-backend/src/data/people.ts`),
  outside this task's Allowed files, so I did not change it. If the smoke must
  show Ada, that is a seed task; otherwise the tab will show "You".
- The uploader-less `uploadAvatar` delegates to the real factory. On the phone
  the settings screens always pass an uploader, so this branch is only the
  test/default path; I did not put the `Uint8Array` swap there because the spec
  says to wrap only the `uploader` case.
- `ProfileApiError` is imported to answer `invalid_response` when the backend's
  body carries no `url`. On the probed happy paths the backend always answers one.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:**
  - `use-profile-api.ts` builds `createProfileApi(mockToken, mockFetch, API_URL)` in mock mode;
  - in mock mode `uploadAvatar` skips the native uploader and PUTs a 4-byte placeholder through `mockFetch`;
  - the handle is `{ api, mock }`;
  - `mock/profile.ts` (198 lines) is deleted.
- **The lead's phone smoke** (mock):
  - **Profile** shows "You" with `you@zilar.test`. That is the shared seed's viewer, so the spec's "Ada" was wrong;
  - **Settings › Profile:** `taken_user` shows "That username is taken. Try another.", and `ada_fresh` shows "@ada_fresh is available", then "Saved.";
  - **Settings** opens.
  - **Not tested:** Set photo, because it needs the system image picker.
- **Check:** the gate passed.
