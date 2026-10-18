import { useClientVersionCheck as useSharedClientVersionCheck } from '@zilar/client-core';
import { protocolVersion } from '@zilar/protocol';
import { Effect } from 'effect';
import { onForeground } from '@/lib/foreground';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';

// A mock server answers `/health` with 404, so a mock session never shows the banner.
const healthRequest = (): Promise<Response> =>
  Effect.runPromise(
    Effect.promise(() =>
      isMockApiEnabled()
        ? loadMockRequest().then((dispatch) => dispatch('/health', { method: 'GET' }))
        : fetch('/health', { method: 'GET', credentials: 'same-origin' }),
    ),
  );

/** True when this build is older than the server's minimum protocol. */
export function useClientVersionCheck(): boolean {
  return useSharedClientVersionCheck(healthRequest, onForeground, protocolVersion);
}
