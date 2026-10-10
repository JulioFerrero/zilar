/**
 * Stands in for `@/store/mockStore` in a production build without
 * `VITE_MOCK=1` (see the alias in `vite.config.ts`), so the in-memory store and
 * its fixtures stay out of the bundle. Mock mode is off there, so nothing
 * calls it.
 */
export function createChatStore(): never {
  throw new Error('The mock store is not part of this build');
}
