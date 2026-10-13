// The contact-requests seed (T-1067, extended by T-1336): two incoming pending
// requests so the chat-list rows and the requests screens have something to
// show in the mock. The senders are the mock's synthetic strangers
// (`u-handle-<name>`, resolved by `handleProfileForId` in
// `../handles/check.ts`): every person in `data/people.ts` counts as a contact
// (`../contacts/routes.ts`, `contactsOf`), so a real seed person would read as a
// request from an existing contact. Their ids are `cr-seed-*`, not `cr-<n>`, so
// `nextContactRequestId` (which starts at `cr-1`) never clobbers a seeded row.

import type { MockSeed } from '../../data';
import { currentUser } from '../../data/people';
import type { MockContactRequest } from './tables';

export function seedContactRequestsTable(): Partial<MockSeed> {
  const requests: readonly MockContactRequest[] = [
    {
      id: 'cr-seed-1',
      fromUserId: 'u-handle-nora',
      toUserId: currentUser.id,
      status: 'pending',
      createdAt: '2026-10-12T09:00:00.000Z',
    },
    {
      id: 'cr-seed-2',
      fromUserId: 'u-handle-theo',
      toUserId: currentUser.id,
      status: 'pending',
      createdAt: '2026-10-12T09:05:00.000Z',
    },
  ];
  return { contactRequests: requests };
}
