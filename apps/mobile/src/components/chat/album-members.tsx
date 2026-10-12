import type { UiMessage } from '@zilar/chat-core';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * The album item's loaded members, provided by the list row that owns the run
 * (T-1271). `groupMessages` already scoped them to one sender, one day and the
 * group window, so the grid draws exactly that run instead of re-deriving it
 * from the store by `album.id` (which would merge a peer's colliding id, or a
 * far sibling the grouping kept apart). A head drawn outside the list (a lone
 * marker) has no provider and falls back to itself.
 */
const AlbumMembersContext = createContext<readonly UiMessage[] | null>(null);

/** Provides one album item's members to the grid drawn in its head bubble. */
export function AlbumMembersProvider({
  messages,
  children,
}: {
  messages: readonly UiMessage[] | null;
  children: ReactNode;
}) {
  return <AlbumMembersContext.Provider value={messages}>{children}</AlbumMembersContext.Provider>;
}

/** The album item's members, or null when the bubble is drawn outside the list. */
export function useAlbumMembers(): readonly UiMessage[] | null {
  return useContext(AlbumMembersContext);
}
