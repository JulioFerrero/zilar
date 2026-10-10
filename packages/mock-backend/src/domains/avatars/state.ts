// The avatars table: a map from `${kind}:${ownerId}` to the url the last
// upload minted. It starts empty (there is no seed), like the server's rows.
// Like every domain it extends the shared `MockData` from its own folder
// (module augmentation), so `src/domains/index.ts` is the only list of
// domains.

import type { MockData } from '../../state';

declare module '../../state' {
  interface MockData {
    /** Every stored avatar url, keyed by `${kind}:${ownerId}`. */
    readonly avatarUrls: ReadonlyMap<string, string>;
    putAvatarUrl(key: string, url: string): void;
    removeAvatarUrl(key: string): void;
  }
}

export function createAvatarsState(): Partial<MockData> {
  const avatarUrls = new Map<string, string>();
  return {
    get avatarUrls(): ReadonlyMap<string, string> {
      return avatarUrls;
    },
    putAvatarUrl(key: string, url: string): void {
      avatarUrls.set(key, url);
    },
    removeAvatarUrl(key: string): void {
      avatarUrls.delete(key);
    },
  };
}
