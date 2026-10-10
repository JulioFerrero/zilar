// The message seed, one file per thread. Keyed by the thread's bare chat JID:
// a contact's JID for a DM, an AI's JID for an AI DM, a room JID for a group.
import { acmeMessages } from './acme';
import { anaMessages } from './ana';
import { devAiMessages } from './dev-ai';
import { devTeamMessages } from './dev-team';
import { familiaMessages } from './familia';
import { gymMessages } from './gym';
import { luisMessages } from './luis';
import { marketingAiMessages } from './marketing-ai';
import { martaMessages } from './marta';
import { productMessages } from './product';
import { qaMessages } from './qa';
import type { MockMessageSeed } from './shared';
import { viernesMessages } from './viernes';

export type { MockMessageSeed } from './shared';

export const messageSeeds: Readonly<Record<string, readonly MockMessageSeed[]>> = {
  'ana@zilar.test': anaMessages,
  'acme@rooms.zilar.test': acmeMessages,
  'dev-team@rooms.zilar.test': devTeamMessages,
  'viernes@rooms.zilar.test': viernesMessages,
  'dev-1@ai.zilar.test': devAiMessages,
  'marta@zilar.test': martaMessages,
  'familia@rooms.zilar.test': familiaMessages,
  'qa@rooms.zilar.test': qaMessages,
  'luis@zilar.test': luisMessages,
  'marketing@ai.zilar.test': marketingAiMessages,
  'gym@rooms.zilar.test': gymMessages,
  'product@rooms.zilar.test': productMessages,
};
