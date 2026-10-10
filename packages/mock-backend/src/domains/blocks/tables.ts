// The blocks domain's table. Like every domain it extends the shared
// `MockSeed`/`MockData` from its own folder (module augmentation), so a new
// domain is a folder plus one line in `src/domains/index.ts`.

/** One blocked-person row, mirroring web's `MockBlockedUser` (`userId` plus when). */
export interface MockBlockedUser {
  readonly userId: string;
  readonly blockedAt: string;
}

declare module '../../data' {
  interface MockSeed {
    readonly blockedUsers: readonly MockBlockedUser[];
  }
}

declare module '../../state' {
  interface MockData {
    readonly blockedUsers: readonly MockBlockedUser[];
    isBlocked(userId: string): boolean;
    /** Idempotent, like web's mock: blocking an already-blocked user changes nothing. */
    blockUser(userId: string): void;
    unblockUser(userId: string): void;
  }
}
