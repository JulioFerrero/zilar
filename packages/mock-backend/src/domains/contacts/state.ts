// The removed-contacts table. The contacts themselves are the shared people
// seed; a removal records the id here so `GET /contacts` drops it. It starts
// empty (there is no seed). Like every domain it extends the shared `MockData`
// from its own folder (module augmentation), so `src/domains/index.ts` is the
// only list of domains.

import type { MockData } from '../../state';

declare module '../../state' {
  interface MockData {
    /** Ids the caller removed as contacts: `GET /contacts` leaves them out. */
    readonly removedContactIds: readonly string[];
    /** True while `userId` is still one of the caller's contacts. */
    isContact(userId: string): boolean;
    /** Drop `userId` from the caller's contacts (`DELETE /contacts/:userId`). */
    removeContact(userId: string): void;
  }
}

export function createContactsState(): Partial<MockData> {
  let removedContactIds: string[] = [];
  return {
    get removedContactIds(): readonly string[] {
      return removedContactIds;
    },
    isContact(userId: string): boolean {
      return !removedContactIds.includes(userId);
    },
    removeContact(userId: string): void {
      if (!removedContactIds.includes(userId)) {
        removedContactIds = [...removedContactIds, userId];
      }
    },
  };
}
