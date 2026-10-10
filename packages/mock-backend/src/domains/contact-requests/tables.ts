// The contact-requests domain's table. Like every domain it extends the shared
// `MockSeed`/`MockData` from its own folder (module augmentation), so a new
// domain is a folder plus one line in `src/domains/index.ts`.

import type { ContactRequestRow } from '@zilar/api-contract';

/** One contact-request row, mirroring the contract's `ContactRequestRow`. */
export type MockContactRequest = ContactRequestRow;

declare module '../../data' {
  interface MockSeed {
    readonly contactRequests: readonly MockContactRequest[];
  }
}

declare module '../../state' {
  interface MockData {
    readonly contactRequests: readonly MockContactRequest[];
    findContactRequest(id: string): MockContactRequest | undefined;
    /** Replace the row with the same id, or append it when it is new. */
    putContactRequest(request: MockContactRequest): void;
    /** The next `cr-N` id, like web's `nextContactRequestSequence`. */
    nextContactRequestId(): string;
  }
}
