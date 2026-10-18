import { Effect } from 'effect';
import { callApi } from '@/lib/effect/api-client';
import { runWeb } from '@/lib/effect/runtime';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';
import { API_BASE } from './api/http';
import type { Me } from './api/chats';
export { API_BASE, ApiError } from './api/http';

// In mock mode the mock backend answers the same path; the real call is a same-origin fetch.
const exportRequest = (): Effect.Effect<Response, unknown> =>
  Effect.suspend(() =>
    isMockApiEnabled()
      ? Effect.flatMap(
          Effect.tryPromise({
            try: () => loadMockRequest(),
            catch: (cause) => cause,
          }),
          (dispatch) =>
            Effect.tryPromise({
              try: () => dispatch('/me/export', { method: 'GET' }),
              catch: (cause) => cause,
            }),
        )
      : Effect.tryPromise({
          try: () => fetch(`${API_BASE}/me/export`, { credentials: 'include' }),
          catch: (cause) => cause,
        }),
  );

/** The route answers a streamed JSON download with a Content-Disposition filename, so the caller
 * gets the raw Response to save; only an unreachable server rejects. */
export function fetchExport(): Promise<Response> {
  return runWeb(exportRequest());
}

// PATCH /me requires the display name, so it rides along unchanged.
export function updateMeProfile(name: string, bio: string): Promise<Me> {
  return callApi((client) => client.auth.patchMe({ payload: { name: name.trim(), bio } }));
}

export * from './api/chats';
export * from './api/groups';
export * from './api/topics';
export * from './api/ais';
export * from './api/machines';
export * from './api/stickers';
export * from './api/media';
export * from './api/people';
export * from './api/settings';
