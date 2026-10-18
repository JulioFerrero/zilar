import type { AlbumRef, UiMessage } from '@zilar/chat-core';

/**
 * A fresh album id. The web composer stamps one with `crypto.randomUUID()`; mobile
 * installs the same polyfill, so the forwards this module groups carry the same kind of
 * id the pick did.
 */
function newAlbumId(): string {
  return crypto.randomUUID();
}

/**
 * The album marker each forwarded copy carries. Copies that share a source `album.id`
 * and a sender are regrouped under one fresh id, with `index` and `count`; a copy that is
 * not part of a group of two or more gets no marker.
 */
export function forwardedAlbumRefs(
  messages: readonly UiMessage[],
  id: () => string = newAlbumId,
): Map<UiMessage, AlbumRef> {
  const groups = new Map<string, UiMessage[]>();
  for (const message of messages) {
    if (message.album === undefined) {
      continue;
    }
    const key = `${message.album.id}\u0000${message.senderId}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [message]);
    } else {
      group.push(message);
    }
  }
  const refs = new Map<UiMessage, AlbumRef>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const albumId = id();
    group.forEach((message, index) => {
      refs.set(message, { id: albumId, index, count: group.length });
    });
  }
  return refs;
}
