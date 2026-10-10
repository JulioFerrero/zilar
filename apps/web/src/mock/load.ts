/**
 * The only way production code reaches the mock backend (T-0847, T-0946). The
 * condition is written inline so Vite folds it at build time: a production build
 * without `VITE_MOCK=1` drops the branch, and `@zilar/mock-backend` (with its
 * seed and the old `mock/api.ts` fallback) never reaches the bundle.
 */
export async function loadMockRequest(): Promise<typeof import('./backend').dispatch> {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_MOCK === '1') {
    const { dispatch } = await import('./backend');
    return dispatch;
  }
  throw new Error('The mock backend is not part of this build');
}

/** The fake XMPP core factory, for the real store's `createXmpp` (task G). */
export async function loadMockXmpp(): Promise<typeof import('./backend').backend.xmpp> {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_MOCK === '1') {
    const { backend } = await import('./backend');
    return backend.xmpp;
  }
  throw new Error('The mock backend is not part of this build');
}
