/**
 * The only way production code reaches the mock HTTP layer. The condition is
 * written inline so Vite folds it at build time: a production build without
 * `VITE_MOCK=1` drops the branch, and the mock backend never reaches the
 * bundle (T-0847). Dev builds and the unit-test run keep the same behaviour
 * as `gate.ts`.
 */
export async function loadMockRequest(): Promise<typeof import('./api').mockRequest> {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_MOCK === '1') {
    const { mockRequest } = await import('./api');
    return mockRequest;
  }
  throw new Error('The mock backend is not part of this build');
}
