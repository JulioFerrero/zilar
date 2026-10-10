import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockContactRequest } from './tables';

/**
 * The contact-requests table. Rows are cloned from the seed, so a caller-supplied
 * seed is never changed; a create or a decision replaces the array, never mutates
 * in place.
 */
export function createContactRequestsState(seed: MockSeed): Partial<MockData> {
  let contactRequests: MockContactRequest[] = seed.contactRequests.map((row) => ({ ...row }));
  let contactRequestSequence = 1;
  return {
    get contactRequests(): readonly MockContactRequest[] {
      return contactRequests;
    },
    findContactRequest(id: string): MockContactRequest | undefined {
      return contactRequests.find((row) => row.id === id);
    },
    putContactRequest(request: MockContactRequest): void {
      contactRequests = contactRequests.some((row) => row.id === request.id)
        ? contactRequests.map((row) => (row.id === request.id ? request : row))
        : [...contactRequests, request];
    },
    nextContactRequestId(): string {
      const id = `cr-${contactRequestSequence}`;
      contactRequestSequence += 1;
      return id;
    },
  };
}
