// The one list of mock-backend domains. To add a domain: create
// `src/domains/<name>/` with `seed.ts`, `state.ts`, `routes.ts` and an `index.ts`
// that exports a `defineDomain({ name, seed, createState, routes })` object, then
// import it here and add one line in alphabetical order. `src/state.ts` and
// `src/http.ts` build the backend from this array, so nothing else lists domains.
import { aiMemoryDomain } from './ai-memory';
import { aisDomain } from './ais';
import { approvalRulesDomain } from './approval-rules';
import { approvalsDomain } from './approvals';
import { auditDomain } from './audit';
import { chatPrefsDomain } from './chat-prefs';
import { chatsDomain } from './chats';
import { connectionsDomain } from './connections';
import { contactsDomain } from './contacts';
import { directoryDomain } from './directory';
import type { Domain } from './domain';
import { gifsDomain } from './gifs';
import { groupsDomain } from './groups';
import { inviteLinksDomain } from './invite-links';
import { machinesDomain } from './machines';
import { meDomain } from './me';
import { messagesDomain } from './messages';
import { pinsDomain } from './pins';
import { publicGroupsDomain } from './public-groups';
import { rolesDomain } from './roles';
import { routinesDomain } from './routines';
import { searchDomain } from './search';
import { stickersDomain } from './stickers';
import { toolsDomain } from './tools';
import { topicsDomain } from './topics';
import { xmppTokenDomain } from './xmpp-token';

export const domains: readonly Domain[] = [
  aiMemoryDomain,
  aisDomain,
  approvalRulesDomain,
  approvalsDomain,
  auditDomain,
  chatPrefsDomain,
  chatsDomain,
  connectionsDomain,
  contactsDomain,
  directoryDomain,
  gifsDomain,
  groupsDomain,
  inviteLinksDomain,
  machinesDomain,
  meDomain,
  messagesDomain,
  pinsDomain,
  publicGroupsDomain,
  rolesDomain,
  routinesDomain,
  searchDomain,
  stickersDomain,
  toolsDomain,
  topicsDomain,
  xmppTokenDomain,
];
