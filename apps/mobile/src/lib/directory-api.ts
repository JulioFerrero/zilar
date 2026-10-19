// effect-plain: Promise port over the shared directory API; the contract client owns the Effect edge.
import { runApi } from '@zilar/api-contract';
import {
  makeDirectoryApi,
  type DirectoryEntry,
  type DirectoryPage,
  type GroupVisibilityState,
  type HandleCheck,
  type PublicJoinResult,
  type SearchDirectoryInput,
  type SetGroupVisibilityInput,
} from '@zilar/client-core';

import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * Public groups and channels only, never users or private groups; reads are rate limited 30 per 10 minutes. Errors are the shared `ApiError` (404 = unknown or private, 409 = full / handle taken, 429 = rate limited).
 */

export type {
  DirectoryEntry,
  DirectoryKind,
  DirectoryPage,
  GroupVisibility,
  GroupVisibilityState,
  HandleCheck,
  HandleCheckReason,
  PublicJoinResult,
  SearchDirectoryInput,
  SetGroupVisibilityInput,
} from '@zilar/client-core';

export interface DirectoryApi {
  searchDirectory(input?: SearchDirectoryInput): Promise<DirectoryPage>;
  lookupGroupByHandle(handle: string): Promise<DirectoryEntry>;
  joinPublicGroup(groupId: string): Promise<PublicJoinResult>;
  getGroupVisibility(groupId: string): Promise<GroupVisibilityState>;
  setGroupVisibility(groupId: string, input: SetGroupVisibilityInput): Promise<void>;
  checkGroupHandle(handle: string): Promise<HandleCheck>;
}

export function createDirectoryApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): DirectoryApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeDirectoryApi((call) => runApi(call(client)));
  return {
    ...api,
    async setGroupVisibility(groupId, input) {
      await api.setGroupVisibility(groupId, input);
    },
  };
}
