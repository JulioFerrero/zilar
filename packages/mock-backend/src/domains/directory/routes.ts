// The Explore directory (T-0164): public groups and channels only, never users,
// 20 per page with an opaque cursor, mirroring web's `directory` route. `q`
// matches a handle or title prefix (at least 2 characters) and `kind` filters
// the two public kinds; both are validated like the server.
import type { MockData } from '../../state';
import { errorResponse, jsonResponse, type MockHttpRequest } from '../../http/shared';
import { directoryEntryOf, publicGroups } from './groups';

const PAGE_SIZE = 20;

export function handleDirectory(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head] = request.segments;
  if (head !== 'directory' || request.method !== 'GET') {
    return undefined;
  }
  const q = (request.query.get('q') ?? '').trim();
  const kind = request.query.get('kind');
  if (q !== '' && q.length < 2) {
    return errorResponse('invalid_request', 'Search needs at least 2 characters', 400);
  }
  if (kind !== null && kind !== 'group' && kind !== 'channel') {
    return errorResponse('invalid_request', 'Invalid kind filter', 400);
  }
  const lower = q.toLowerCase();
  const rows = publicGroups(data)
    .filter((row) => kind === null || row.kind === kind)
    .filter(
      (row) =>
        q === '' ||
        (row.handle !== null && row.handle.toLowerCase().startsWith(lower)) ||
        row.title.toLowerCase().startsWith(lower),
    )
    .reverse();
  const start = decodeDirectoryCursor(request.query.get('cursor'));
  if (start === null) {
    return errorResponse('invalid_request', 'Invalid cursor', 400);
  }
  const page = rows.slice(start, start + PAGE_SIZE).map(directoryEntryOf);
  return jsonResponse({
    entries: page,
    next: start + PAGE_SIZE < rows.length ? encodeDirectoryCursor(start + PAGE_SIZE) : null,
  });
}

// The opaque page cursor web's mock uses: `dir_<offset>`, base64url encoded. It
// is hand-rolled so the route needs neither `btoa`/`atob` (absent on some
// Hermes builds) nor `Buffer` (absent in the browser).
const CURSOR_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeDirectoryCursor(start: number): string {
  const bytes = [...`dir_${start}`].map((char) => char.charCodeAt(0));
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += CURSOR_ALPHABET.charAt(first >> 2);
    out += CURSOR_ALPHABET.charAt(((first & 3) << 4) | ((second ?? 0) >> 4));
    if (second !== undefined) {
      out += CURSOR_ALPHABET.charAt(((second & 15) << 2) | ((third ?? 0) >> 6));
    }
    if (third !== undefined) {
      out += CURSOR_ALPHABET.charAt(third & 63);
    }
  }
  return out;
}

function decodeDirectoryCursor(raw: string | null): number | null {
  if (raw === null || raw === '') {
    return 0;
  }
  const values: number[] = [];
  for (const char of raw) {
    const value = CURSOR_ALPHABET.indexOf(char);
    if (value === -1) {
      return null;
    }
    values.push(value);
  }
  const bytes: number[] = [];
  for (let index = 0; index < values.length; index += 4) {
    const first = values[index] ?? 0;
    const second = values[index + 1];
    const third = values[index + 2];
    const fourth = values[index + 3];
    bytes.push((first << 2) | ((second ?? 0) >> 4));
    if (third !== undefined) {
      bytes.push((((second ?? 0) & 15) << 4) | (third >> 2));
    }
    if (fourth !== undefined) {
      bytes.push((((third ?? 0) & 3) << 6) | fourth);
    }
  }
  const decoded = String.fromCharCode(...bytes);
  const match = /^dir_(\d+)$/.exec(decoded);
  if (match === null) {
    return null;
  }
  const start = Number(match[1]);
  return Number.isSafeInteger(start) ? start : null;
}
