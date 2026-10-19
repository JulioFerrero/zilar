// effect-plain: Promise port over the shared directory API; the contract client owns the Effect edge.
import {
  makeDirectoryApi as makeSharedDirectoryApi,
  type DirectoryEntry,
  type DirectoryPage,
  type GroupVisibilityState,
  type HandleCheck,
  type PublicJoinResult,
  type SearchDirectoryInput,
  type SetGroupVisibilityInput,
} from '@zilar/client-core';

import type { ApiCall } from './effect/api-client';

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

export function makeDirectoryApi(call: ApiCall): DirectoryApi {
  const api = makeSharedDirectoryApi(call);
  return {
    ...api,
    async setGroupVisibility(groupId, input) {
      await api.setGroupVisibility(groupId, input);
    },
  };
}
