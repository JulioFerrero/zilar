// The identity, directory and conversation routes `createApp` mounts first, in
// mount order (T-1460, plan #48). Each `create*Api` gets the shared `base`
// deps object instead of repeating `db`/`config`/`logger`/`auth`.
import type { EffectApiMount } from '../effect/http-core';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import { createAgentTasksApi } from '../agents/log/api';
import { createAiMemoryApi } from '../agents/memory/api';
import { createAuthApi } from '../auth/api';
import { createBlocksApi } from '../blocks/api';
import { createChatFoldersApi } from '../chat-folders/api';
import { createChatPrefsApi } from '../chat-prefs/api';
import { createChatsApi } from '../chats/api';
import { createContactRequestsApi } from '../contact-requests/api';
import { createContactsApi } from '../contacts/api';
import { createDirectoryApi } from '../directory/api';
import { createDraftsApi } from '../drafts/api';
import { createFilesApi } from '../files/api';
import { createGroupsApi } from '../groups/api';
import { createHandlesApi } from '../handles/api';
import { createInviteLinksApi } from '../invite-links/api';
import { createMachinesApi } from '../machines/api';
import { createDbMachineRegistry } from '../machines/registry';
import { createMediaApi } from '../media/api';
import { cardCorrectorOf, createMessageBlocksApi, type CardCorrector } from '../message-blocks/api';
import { createPinsApi } from '../pins/api';
import { createPushApi } from '../push/api';
import { loadPushConfig } from '../push/config';
import { createRolesApi } from '../roles/api';
import { createSearchApi } from '../search/api';
import { createSetupApi } from '../setup/api';
import { createTopicsApi } from '../topics/api';
import { turnWatcherOf } from '../topics/ai-activity';
import type { RouteWiring } from './deps';
import { opt } from './opt';

/** The first group of mounts: core identity up to drafts, in mount order. */
export function messagingRoutes({
  deps,
  base,
  audit,
  mailer,
  inviteLinksOverrides,
}: RouteWiring): EffectApiMount[] {
  const { db } = base;
  const { adminClient } = deps;
  const mounts: EffectApiMount[] = [];
  const authApi = createAuthApi({ ...base, adminClient });
  mounts.push(authApi);
  // First-run setup (T-0161): public while no user exists, same 404 as an
  // unknown route once setup is done. Allowlisted in the authz sweep.
  // Without an explicit mailer the routes build one from the config, like
  // `index.ts` does for production.
  const setupApi = createSetupApi({ ...base, mailer, audit, ...deps.setup });
  mounts.push(setupApi);
  const contactsApi = createContactsApi({ ...base, adminClient });
  mounts.push(contactsApi);
  // @usernames and contact requests (T-0163): session-required, rate
  // limited; the sweep asserts every one of them answers 401 unauthenticated.
  const handlesApi = createHandlesApi({ ...base, audit });
  mounts.push(handlesApi);
  const contactRequestsApi = createContactRequestsApi({ ...base, adminClient, audit });
  mounts.push(contactRequestsApi);
  // User blocks (T-0171): session-required, write-rate-limited; the sweep
  // asserts every one of them answers 401 unauthenticated.
  const blocksApi = createBlocksApi({ ...base, adminClient, audit });
  mounts.push(blocksApi);
  // Public groups and channels (T-0164): the Explore directory and the
  // exact `@handle` lookup — public rows only, session-required, rate
  // limited; the sweep asserts both answer 401 unauthenticated.
  const directoryApi = createDirectoryApi({ ...base });
  mounts.push(directoryApi);
  const machinesApi = createMachinesApi({
    ...base,
    audit,
    registry: deps.machineRegistry ?? createDbMachineRegistry(db),
    ...opt('isMachineOnline', deps.isMachineOnline),
  });
  mounts.push(machinesApi);
  const groupsApi = createGroupsApi({ ...base, adminClient, audit });
  mounts.push(groupsApi);
  const inviteLinksApi = createInviteLinksApi({
    ...base,
    adminClient,
    audit,
    ...inviteLinksOverrides,
  });
  mounts.push(inviteLinksApi);
  const rolesApi = createRolesApi({ ...base, adminClient, audit });
  mounts.push(rolesApi);
  const aiMemoryApi = createAiMemoryApi({ ...base });
  mounts.push(aiMemoryApi);
  // The AI session log behind "View steps" (T-1426): owner-only, session
  // required, so the 401 sweep covers it.
  const agentTasksApi = createAgentTasksApi({ ...base });
  mounts.push(agentTasksApi);
  const pinsApi = createPinsApi({ ...base, audit });
  mounts.push(pinsApi);
  // T-1514: the live agent gateway is typed as a `TurnStopper` here; hand its
  // `TurnWatcher` read model to the topic-list routes when it carries one.
  const gateway = deps.getGateway;
  const getTurnWatcher =
    gateway === undefined ? undefined : (): TurnWatcher | null => turnWatcherOf(gateway());
  const topicsApi = createTopicsApi({
    ...base,
    adminClient,
    audit,
    // T-1774: the topic preview reads the MUC archive for non-members, like
    // search; without a pool the route answers 501.
    ...opt('archive', deps.archive),
    ...opt('getGateway', getTurnWatcher),
  });
  mounts.push(topicsApi);
  // T-1792: a member answers the interactive card an AI posted; the route
  // records, merges and corrects the card in the room. It never wakes the AI.
  const getCardCorrector =
    gateway === undefined ? undefined : (): CardCorrector | null => cardCorrectorOf(gateway());
  const messageBlocksApi = createMessageBlocksApi({
    ...base,
    audit,
    ...opt('getGateway', getCardCorrector),
  });
  mounts.push(messageBlocksApi);
  const chatsApi = createChatsApi({
    ...base,
    adminClient,
    archive: deps.archive,
    ...opt('getGateway', getTurnWatcher),
  });
  mounts.push(chatsApi);
  // Chat prefs and folders (T-0113/T-0232) on the Effect adapter: session
  // required, one write budget each; the sweep asserts every route answers 401
  // unauthenticated.
  const chatPrefsApi = createChatPrefsApi({ ...base });
  mounts.push(chatPrefsApi);
  const chatFoldersApi = createChatFoldersApi({ ...base });
  mounts.push(chatFoldersApi);
  // Push devices and settings (T-0119) mount always: with push off or
  // unconfigured every route answers 404/503 instead of disappearing, so
  // the web can show the matching state.
  const pushApi = createPushApi({
    ...base,
    adminClient,
    push: deps.push ?? loadPushConfig({}),
    ...opt('archive', deps.archive),
  });
  mounts.push(pushApi);
  // Message search (T-0117) mounts always: without an archive pool every
  // search answers 501 `search_unavailable` instead of 404ing, so the web
  // can hide the feature. Never used by the AI gateway.
  const searchApi = createSearchApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(searchApi);
  // Media gallery (T-0431) mounts the same way: without an archive pool every
  // request answers 501 `media_unavailable` instead of 404ing.
  const mediaApi = createMediaApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(mediaApi);
  const filesApi = createFilesApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(filesApi);
  const draftsApi = createDraftsApi({ ...base });
  mounts.push(draftsApi);

  return mounts;
}
