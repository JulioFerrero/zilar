import type { MentionMember } from '@galena/chat-core';

const you: MentionMember = { jid: 'u-you@galena.test', name: 'You' };
const ana: MentionMember = { jid: 'u-ana@galena.test', name: 'Ana' };
const luis: MentionMember = { jid: 'u-luis@galena.test', name: 'Luis' };
const marta: MentionMember = { jid: 'u-marta@galena.test', name: 'Marta' };
const marco: MentionMember = { jid: 'u-marco@galena.test', name: 'Marco' };
const sofia: MentionMember = { jid: 'u-sofia@galena.test', name: 'Sofía' };
const dev1: MentionMember = { jid: 'ai-dev-1@galena.test', name: 'Dev-1' };
const qa1: MentionMember = { jid: 'ai-qa-1@galena.test', name: 'QA-1' };

/** Members of each mock group chat, keyed by the chat id. */
export const mockGroupMembers: Record<string, MentionMember[]> = {
  'c-devteam': [you, ana, luis, marco, dev1, qa1],
  'c-viernes': [you, luis, marta, ana, marco],
  'c-familia': [you, sofia],
  'c-qa': [you, luis, qa1],
  'c-gym': [you, marco],
  'c-product': [you, ana],
};
