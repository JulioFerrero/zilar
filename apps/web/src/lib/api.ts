import { Effect } from 'effect';
import { callApi } from '@/lib/effect/api-client';
import { runWeb } from '@/lib/effect/runtime';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';
import { API_BASE } from './api/http';
import type { Me } from './api/chats';
import {
  Machine,
  type MachineStatus,
  type PairingCode,
  Topic as topicSchema,
  type ApproverRole,
  type Topic as ContractTopic,
  type TopicAi,
  type TopicMember,
  type TopicRole,
  type TopicVisibility,
} from '@zilar/api-contract';
import {
  makeMachinesApi,
  makeTopicsApi,
  type CreateTopicInput,
  type PatchTopicInput,
  type SetTopicRolesInput,
  type TopicTool,
} from '@zilar/client-core';

export type Topic = ContractTopic;
export type { Machine, MachineStatus, PairingCode };
export { Machine as machineSchema };
export { topicSchema };
export type { ApproverRole, TopicAi, TopicMember, TopicRole, TopicVisibility };
export type { CreateTopicInput, PatchTopicInput, SetTopicRolesInput, TopicTool };

const api = makeTopicsApi(callApi);
export const {
  addTopicAi,
  addTopicMember,
  archiveTopic,
  createTopic,
  getTopic,
  getTopicPreview,
  joinTopic,
  listGroupTopics,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  patchTopic,
  removeTopicAi,
  removeTopicMember,
  setTopicRoles,
} = api;

export const {
  approveMachine,
  createPairingCode,
  deleteMachine,
  denyMachine,
  listMachines,
  renameMachine,
  revokeMachine,
} = makeMachinesApi(callApi);

export * from './api/http';

// In mock mode the mock backend answers the same path; the real call is a same-origin fetch.
const exportRequest = (): Effect.Effect<Response, unknown> =>
  Effect.suspend(() =>
    isMockApiEnabled()
      ? Effect.flatMap(
          Effect.tryPromise({
            try: () => loadMockRequest(),
            catch: (cause) => cause,
          }),
          (dispatch) =>
            Effect.tryPromise({
              try: () => dispatch('/me/export', { method: 'GET' }),
              catch: (cause) => cause,
            }),
        )
      : Effect.tryPromise({
          try: () => fetch(`${API_BASE}/me/export`, { credentials: 'include' }),
          catch: (cause) => cause,
        }),
  );

/** The route answers a streamed JSON download with a Content-Disposition filename, so the caller
 * gets the raw Response to save; only an unreachable server rejects. */
export function fetchExport(): Promise<Response> {
  return runWeb(exportRequest());
}

// PATCH /me requires the display name, so it rides along unchanged.
export function updateMeProfile(name: string, bio: string): Promise<Me> {
  return callApi((client) => client.auth.patchMe({ payload: { name: name.trim(), bio } }));
}

export * from './api/chats';
export * from './api/groups';
export * from './api/ais';
export * from './api/stickers';
export * from './api/media';
export * from './api/people';
export * from './api/settings';
