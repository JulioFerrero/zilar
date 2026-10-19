import type { UiMessage } from '@zilar/chat-core';
import { createContext, createElement, useContext, type ReactNode } from 'react';

/** The row's grouped members, not re-derived by `album.id`, which would merge
 *  a peer's colliding id or a far sibling the grouping kept apart. */
const AlbumMembersContext = createContext<readonly UiMessage[] | null>(null);

export function AlbumMembersProvider({
  messages,
  children,
}: {
  messages: readonly UiMessage[] | null;
  children: ReactNode;
}) {
  return createElement(AlbumMembersContext.Provider, { value: messages }, children);
}

export function useAlbumMembers(): readonly UiMessage[] | null {
  return useContext(AlbumMembersContext);
}
