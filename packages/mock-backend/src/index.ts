// `@zilar/mock-backend`: one in-memory, JID-keyed seed behind a `fetch`-shaped
// HTTP handler (task A). A plain `XmppCore` factory joins it in task F2. Both
// apps run their real store against it in mock mode (docs/audit/mock-plan.md).
//
// The package is deliberately plain: no React and no Effect in its own code, so
// Metro can resolve it from the mobile app without the `clientCoreDir` rewrite.
import { createSeed, type MockSeed } from './data';
import { createMockHttp, DEFAULT_DELAY_MS, type MockHttp } from './http';
import { createMockData, type MockData } from './state';

export { createSeed, defaultSeed } from './data';
export type {
  MockApproval,
  MockApprovalRule,
  MockAuditEntry,
  MockMe,
  MockMessage,
  MockPerson,
  MockRoutine,
  MockRun,
  MockSeed,
  MockTool,
  MockToolVersion,
} from './data';
export { createMockHttp } from './http';
export type { MockHttp } from './http';
export { createMockData } from './state';
export type { MockData } from './state';

export interface MockBackendOptions {
  /** Override the seed (tests); defaults to a fresh `createSeed()`. */
  seed?: MockSeed;
  /** Request delay in ms; defaults to `DEFAULT_DELAY_MS` (150). */
  delayMs?: number;
  /** Clock for the seed's relative timestamps; defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface MockBackend {
  /** The `fetch`-shaped handler; `undefined` means "not served here yet". */
  readonly http: MockHttp;
  /** The live in-memory tables (read-only view), for tests and future routes. */
  readonly data: MockData;
  reset(): void;
  setDelay(ms: number): void;
}

export function createMockBackend(options: MockBackendOptions = {}): MockBackend {
  const seed = (): MockSeed => options.seed ?? createSeed(options.now);
  let delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let data = createMockData(seed());
  let handler = createMockHttp(data, () => delayMs);
  return {
    http: (path, init) => handler(path, init),
    get data(): MockData {
      return data;
    },
    reset(): void {
      data = createMockData(seed());
      handler = createMockHttp(data, () => delayMs);
    },
    setDelay(ms: number): void {
      delayMs = ms;
    },
  };
}
