import { xml, type XmppElement } from '@xmpp/client';
import { ALBUM_NAMESPACE } from '../namespaces';

export interface MessageAlbum {
  id: string;
  index: number;
  count: number;
}

export const ALBUM_MAX = 10;
/** Telegram's cap, and the mobile picker's `selectionLimit`. */
export const ALBUM_ID_MAX = 64;

/**
 * The `<album xmlns='urn:zilar:album:0' id index count/>` marker on every photo of an
 * album: one message per photo, and a client without Zilar support shows a single photo.
 */
export function albumElement(album: MessageAlbum): XmppElement {
  return xml('album', {
    xmlns: ALBUM_NAMESPACE,
    id: album.id,
    index: String(album.index),
    count: String(album.count),
  });
}

/**
 * Reads the marker, dropping it when it breaks the invariants: a non-empty id of at most
 * `ALBUM_ID_MAX`, `2 <= count <= ALBUM_MAX` and `0 <= index < count`.
 */
export function parseAlbum(stanza: XmppElement): MessageAlbum | undefined {
  const element = stanza.getChild('album', ALBUM_NAMESPACE);
  if (element === undefined) return undefined;
  const id = element.attrs['id'];
  if (id === undefined || id === '' || id.length > ALBUM_ID_MAX) return undefined;
  const index = parseAlbumNumber(element.attrs['index']);
  const count = parseAlbumNumber(element.attrs['count']);
  if (index === undefined || count === undefined) return undefined;
  if (count < 2 || count > ALBUM_MAX) return undefined;
  if (index >= count) return undefined;
  return { id, index, count };
}

// A non-negative integer attribute; anything else (`x`, `1.5`, `-1`, ``) drops the marker.
function parseAlbumNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
