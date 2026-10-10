import { describe, expect, it, vi } from 'vitest';

import { createGifsApi, parseGifItem } from './gifs-api';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const API = 'http://127.0.0.1:3188';

const ROW = {
  id: 'gif-1',
  title: 'dancing cat',
  mediaToken: 'tok-1',
  kind: 'image',
  width: 200,
  height: 150,
};

describe('gifs schema', () => {
  it('drops an unknown extra field from an item row', () => {
    expect(parseGifItem({ ...ROW, extra: 'ignored' }, API)).toEqual({
      id: 'gif-1',
      title: 'dancing cat',
      url: 'http://127.0.0.1:3188/api/gifs/media/tok-1',
      kind: 'image',
      width: 200,
      height: 150,
    });
  });
});

describe('gifs page envelope', () => {
  it('ignores a non-string nextPos instead of failing the page', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [ROW], nextPos: 25 }));
    const api = createGifsApi(async () => 'tok', fetchImpl as unknown as typeof fetch, API);

    const page = await api.trendingGifs();

    expect(page.items).toHaveLength(1);
    expect(page.nextPos).toBeUndefined();
  });
});
