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
  // Public while no user exists, the same 404 as an unknown route once setup is done.
  const setupApi = createSetupApi({ ...base, mailer, audit, ...deps.setup });
  mounts.push(setupApi);
  const contactsApi = createContactsApi({ ...base, adminClient });
  mounts.push(contactsApi);
  const handlesApi = createHandlesApi({ ...base, audit });
  mounts.push(handlesApi);
  const contactRequestsApi = createContactRequestsApi({ ...base, adminClient, audit });
  mounts.push(contactRequestsApi);
  const blocksApi = createBlocksApi({ ...base, adminClient, audit });
  mounts.push(blocksApi);
  // Public rows only, session-required and rate limited.
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
  const agentTasksApi = createAgentTasksApi({ ...base });
  mounts.push(agentTasksApi);
  const pinsApi = createPinsApi({ ...base, audit });
  mounts.push(pinsApi);
  // Hand the gateway's `TurnWatcher` read model to the topic-list routes.
  const gateway = deps.getGateway;
  const getTurnWatcher =
    gateway === undefined ? undefined : (): TurnWatcher | null => turnWatcherOf(gateway());
  const topicsApi = createTopicsApi({
    ...base,
    adminClient,
    audit,
    // Reads the MUC archive for non-members; without a pool the route answers 501.
    ...opt('archive', deps.archive),
    ...opt('getGateway', getTurnWatcher),
  });
  mounts.push(topicsApi);
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
  const chatPrefsApi = createChatPrefsApi({ ...base });
  mounts.push(chatPrefsApi);
  const chatFoldersApi = createChatFoldersApi({ ...base });
  mounts.push(chatFoldersApi);
  // Mounted always: with push off or unconfigured every route answers 404/503.
  const pushApi = createPushApi({
    ...base,
    adminClient,
    push: deps.push ?? loadPushConfig({}),
    ...opt('archive', deps.archive),
  });
  mounts.push(pushApi);
  // Without an archive pool every search answers 501, so the web can hide the feature.
  const searchApi = createSearchApi({
    ...base,
    ...opt('archive', deps.archive),
    ...opt('now', deps.searchNow),
  });
  mounts.push(searchApi);
  // Without an archive pool every request answers 501.
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
