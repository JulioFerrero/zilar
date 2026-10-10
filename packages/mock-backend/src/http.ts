// effect-plain: in-memory mock backend; the delay mirrors the old mock's
// setTimeout and the matching itself is pure

// The mock HTTP layer. `createMockHttp(data)` returns a handler shaped like
// `fetch` minus the network: it tries each domain's route handler from
// `src/domains/index.ts` in turn and returns the first `Response`, or `undefined`
// for every other path.
//
// The `undefined` contract matters for the app cutovers (plan tasks G and H):
// the app dispatcher tries this backend first and, on `undefined`, falls back to
// the old per-app mock routes until the migration is complete. A path and method
// this backend serves always answer a `Response`; anything else answers
// `undefined`.
import { domains } from './domains';
import { DEFAULT_DELAY_MS, parseRequest, type MockRoute } from './http/shared';
import type { MockData } from './state';

export { DEFAULT_DELAY_MS };

export type MockHttp = (path: string, init?: RequestInit) => Promise<Response | undefined>;

const routes: readonly MockRoute[] = domains.map((domain) => domain.routes);

export function createMockHttp(
  data: MockData,
  getDelayMs: () => number = () => DEFAULT_DELAY_MS,
): MockHttp {
  return async (path, init = {}) => {
    await delay(getDelayMs());
    const request = parseRequest(path, init);
    for (const route of routes) {
      const response = route(data, request);
      if (response !== undefined) {
        return response;
      }
    }
    return undefined;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
