import { useClientVersionCheck as useSharedClientVersionCheck } from '@zilar/client-core';
import { protocolVersion } from '@zilar/protocol';
import { Effect } from 'effect';
import { API_URL } from './auth';
import { onForeground } from './foreground';

const healthRequest = (): Promise<Response> =>
  Effect.runPromise(
    Effect.promise(() => fetch(`${API_URL}/health`, { method: 'GET', credentials: 'omit' })),
  );

/** True when this build is older than the server's minimum protocol. */
export function useClientVersionCheck(): boolean {
  return useSharedClientVersionCheck(healthRequest, onForeground, protocolVersion);
}
