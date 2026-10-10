// The pins seed (T-0114): one text pin in the Ana DM, mirroring web's mock
// (`apps/web/src/mock/api.ts:987-1010`). The chat is the DM peer's bare JID and
// the message id is a real one from the Ana thread.

import type { MockSeed } from '../../data';
import type { DomainContext } from '../domain';
import { currentUser } from '../../data/people';

const ANA_CHAT_JID = 'ana@zilar.test';
const THIRTY_MINUTES_MS = 30 * 60_000;

export function seedPinsTable(context: DomainContext): Partial<MockSeed> {
  return {
    pins: [
      {
        id: 'pin-ana-1',
        chat: ANA_CHAT_JID,
        messageId: 'ana-17',
        senderName: 'You',
        text: 'Deal',
        kind: 'text',
        pinnedBy: currentUser.id,
        pinnedAt: new Date(context.now().getTime() - THIRTY_MINUTES_MS).toISOString(),
      },
    ],
  };
}
