// GIF routes (T-1046): `GET /gifs/search` and `GET /gifs/trending`, mirroring
// web's mock (`apps/web/src/mock/api.ts:2483-2498`). `q` filters by title and
// `pos` paginates with the contract's `nextPos`; the media proxy is not faked,
// so each row's token is a `data:` URL the panel renders offline.
import type { MockData } from '../../state';
import { jsonResponse, type MockHttpRequest } from '../../http/shared';
import { mockGifItems } from './seed';

const PAGE_SIZE = 25;

export function handleGifs(_data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first] = request.segments;
  if (head !== 'gifs' || (first !== 'search' && first !== 'trending')) {
    return undefined;
  }
  if (request.method !== 'GET') {
    return jsonResponse(
      { error: { code: 'mock_not_implemented', message: 'This request has no mock handler' } },
      404,
    );
  }
  const query = (request.query.get('q') ?? '').trim().toLowerCase();
  const pos = Number(request.query.get('pos') ?? '0');
  const start = Number.isInteger(pos) && pos > 0 ? pos : 0;
  const all = mockGifItems().filter(
    (item) => query === '' || item.title.toLowerCase().includes(query),
  );
  const items = all.slice(start, start + PAGE_SIZE);
  const next = start + PAGE_SIZE < all.length ? String(start + PAGE_SIZE) : undefined;
  return jsonResponse({ items, ...(next === undefined ? {} : { nextPos: next }) });
}
