// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
import type { Effect } from 'effect';
import {
  HANDLE_CHECK_MAX,
  HANDLE_CHECK_MIN,
  type DirectoryEntry,
  type DirectoryQuery,
  type GroupDetail,
  type GroupJoinResult,
  type HandleCheck,
  type ZilarClient,
} from '@zilar/api-contract';

// Public groups and channels only, never users or private groups; the server
// reads are rate limited (30 per 10 minutes), and an unknown handle and a private
// group answer the same 404.
export type {
  DirectoryEntry,
  DirectoryKind,
  HandleCheck,
  HandleCheckReason,
} from '@zilar/api-contract';

export interface DirectoryPage {
  entries: DirectoryEntry[];
  next: string | null;
}

export type SearchDirectoryInput = DirectoryQuery;
export type PublicJoinResult = GroupJoinResult;
export type GroupVisibility = 'private' | 'public';

export interface GroupVisibilityState {
  visibility: GroupVisibility;
  handle: string | null;
}

export interface SetGroupVisibilityInput {
  visibility: GroupVisibility;
  handle?: string;
}

type DirectoryCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

// A handle outside 1..64 characters is answered here, as a success body (`invalid`),
// before the derived client encodes the query.
function checkHandleKindWith(
  call: DirectoryCall,
  handle: string,
  kind?: 'user' | 'group',
): Promise<HandleCheck> {
  if (handle.length < HANDLE_CHECK_MIN || handle.length > HANDLE_CHECK_MAX) {
    return Promise.resolve({ available: false, reason: 'invalid' });
  }
  return call((client) =>
    client.handles.check({ query: kind === undefined ? { handle } : { handle, kind } }),
  );
}

export function makeHandlesApi(call: DirectoryCall) {
  return {
    checkHandleKind: (handle: string, kind?: 'user' | 'group'): Promise<HandleCheck> =>
      checkHandleKindWith(call, handle, kind),
    checkHandle: (handle: string): Promise<HandleCheck> => checkHandleKindWith(call, handle),
    // Unique violations answer 409 handle_taken; the 14-day interval answers
    // handle_change_too_soon with nextChangeAt in the error detail.
    claimHandle: (handle: string): Promise<{ handle: string }> =>
      call((client) => client.handles.claim({ payload: { handle } })),
  };
}

// An older server omits both keys: absent reads as private with no handle.
function visibilityOf(group: GroupDetail): GroupVisibilityState {
  return { visibility: group.visibility ?? 'private', handle: group.handle ?? null };
}

// A private visibility clears the handle; a public one sends the typed one only.
function visibilityPayload(input: SetGroupVisibilityInput) {
  return input.visibility === 'public' && input.handle !== undefined
    ? { visibility: 'public' as const, handle: input.handle }
    : { visibility: input.visibility };
}

/**
 * The directory, public join and group visibility calls both apps make, over the
 * caller's `call`. The search query drops empty strings, as the server reads them.
 */
export function makeDirectoryApi(call: DirectoryCall) {
  return {
    searchDirectory(input: SearchDirectoryInput = {}): Promise<DirectoryPage> {
      const query = {
        ...(input.q === undefined || input.q === '' ? {} : { q: input.q }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.cursor === undefined || input.cursor === '' ? {} : { cursor: input.cursor }),
      };
      return call((client) => client.directory.search({ query })).then((page) => ({
        entries: [...page.entries],
        next: page.next,
      }));
    },

    lookupGroupByHandle: (handle: string): Promise<DirectoryEntry> =>
      call((client) => client.directory.byHandle({ params: { handle } })),

    // Private or unknown answers the same 404, a full group 409 group_full;
    // joining twice is harmless.
    joinPublicGroup: (groupId: string): Promise<PublicJoinResult> =>
      call((client) => client.groups.join({ params: { id: groupId } })),

    getGroupVisibility: (groupId: string): Promise<GroupVisibilityState> =>
      call((client) => client.groups.detail({ params: { id: groupId } })).then(visibilityOf),

    // Owner-only. The detail repaints the panel, so the full row comes back.
    setGroupVisibility: (groupId: string, input: SetGroupVisibilityInput): Promise<GroupDetail> =>
      call((client) =>
        client.groups.patch({ params: { id: groupId }, payload: visibilityPayload(input) }),
      ),

    // Live availability, with the same reserved words and uniqueness as usernames;
    // the asker's own group reservation counts as available.
    checkGroupHandle: (handle: string): Promise<HandleCheck> =>
      checkHandleKindWith(call, handle, 'group'),
  };
}
