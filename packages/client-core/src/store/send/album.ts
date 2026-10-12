import type { AlbumRef, UiMessage } from '@zilar/chat-core';

/**
 * A fresh album id. The web composer stamps one on a picked album with
 * `crypto.randomUUID()` (`apps/web/src/components/composer/useComposerAttachments.ts:295`);
 * mobile installs the same polyfill (`apps/mobile/src/lib/polyfills.ts`), so the
 * forwards this module groups carry the same kind of id the pick did.
 */
function newAlbumId(): string {
  return crypto.randomUUID();
}

/**
 * The album marker each forwarded copy should carry (T-1273, `albums-plan` §4.3).
 * Copies that share a source `album.id` and a sender are regrouped, under one
 * fresh id, with `index` by their position here and `count` the group size. A
 * copy that is not part of a group of two or more gets no marker, so a forward
 * of a single photo (or of unrelated ones) still arrives as single messages.
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
