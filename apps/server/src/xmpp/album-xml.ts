// The `<album xmlns='urn:zilar:album:0' id index count/>` marker on every photo
// of an album, read with regexes. The bounds mirror the stanza parser, so a
// malformed marker leaves the message a single photo.

const ALBUM_MARKER = 'urn:zilar:album:0';
const ALBUM_ID_MAX = 64;
const ALBUM_MAX = 10;

export interface AlbumInfo {
  id: string;
  count: number;
}

export function albumInfoFromXml(xml: string): AlbumInfo | undefined {
  if (!xml.includes(ALBUM_MARKER)) {
    return undefined;
  }
  const tag = xml.match(/<album\b[^>]*\bxmlns\s*=\s*(["'])urn:zilar:album:0\1[^>]*\/?>/)?.[0];
  if (tag === undefined) {
    return undefined;
  }
  const id = tag.match(/\bid\s*=\s*(["'])(.*?)\1/)?.[2];
  if (id === undefined || id === '' || id.length > ALBUM_ID_MAX) {
    return undefined;
  }
  const index = numericAttribute(tag, 'index');
  const count = numericAttribute(tag, 'count');
  if (index === undefined || count === undefined) {
    return undefined;
  }
  if (count < 2 || count > ALBUM_MAX || index >= count) {
    return undefined;
  }
  return { id, count };
}

// A non-negative integer attribute; anything else makes the marker unusable.
function numericAttribute(tag: string, name: string): number | undefined {
  const value = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(\\d+)\\1`))?.[2];
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
