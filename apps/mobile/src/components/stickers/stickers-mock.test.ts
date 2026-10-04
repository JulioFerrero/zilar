import { describe, expect, it } from 'vitest';

import { createMockStickersApi, resetStickersMock, stickersMockScenario } from './stickers-mock';

describe('stickersMockScenario', () => {
  it('stays on the real API without a mock request', () => {
    expect(stickersMockScenario({}, undefined, true)).toBeNull();
    expect(stickersMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '0' }, undefined, true)).toBeNull();
    expect(stickersMockScenario({}, { mock: 'default' }, false)).toBeNull();
  });

  it('picks the default scenario for a bare opt-in', () => {
    expect(stickersMockScenario({ EXPO_PUBLIC_ZILAR_MOCK: '1' }, undefined, true)).toBe('default');
    expect(stickersMockScenario({}, { mock: 'empty' }, true)).toBe('empty');
  });
});

describe('createMockStickersApi', () => {
  it('lists the panel and the favorites', async () => {
    resetStickersMock();
    const api = createMockStickersApi('default');
    const packs = await api.listStickerPacks();
    expect(packs.length).toBeGreaterThan(0);
    const favorites = await api.listStickerFavorites();
    expect(favorites.length).toBeGreaterThan(0);
  });

  it('adds, removes and reorders panel packs', async () => {
    resetStickersMock();
    const api = createMockStickersApi('default');
    const before = await api.listStickerPacks();
    await api.addStickerPanelPack('33333333-3333-4333-8333-333333333333');
    const added = await api.listStickerPacks();
    expect(added).toHaveLength(before.length + 1);
    const order = added.map((pack) => pack.id).reverse();
    await api.reorderStickerPanelPacks(order);
    const reordered = await api.listStickerPacks();
    expect(reordered.map((pack) => pack.id)).toEqual(order);
    await api.removeStickerPanelPack(order[0] as string);
    expect(await api.listStickerPacks()).toHaveLength(order.length - 1);
  });

  it('removes a favorite and keeps the rest', async () => {
    resetStickersMock();
    const api = createMockStickersApi('default');
    const favorites = await api.listStickerFavorites();
    await api.removeStickerFavorite(favorites[0]?.id ?? '');
    const rest = await api.listStickerFavorites();
    expect(rest).toHaveLength(favorites.length - 1);
  });

  it('searches discover by title and stays empty in the empty scenario', async () => {
    resetStickersMock();
    const api = createMockStickersApi('default');
    const cats = await api.discoverStickerPacks('cats');
    expect(cats.packs.map((pack) => pack.title)).toContain('Cats');
    const none = await api.discoverStickerPacks('no-such-pack');
    expect(none.packs).toEqual([]);
    resetStickersMock();
    const empty = createMockStickersApi('empty');
    expect(await empty.listStickerPacks()).toEqual([]);
    expect(await empty.listStickerFavorites()).toEqual([]);
  });

  it('fails every call in the error scenario', async () => {
    resetStickersMock();
    const api = createMockStickersApi('error');
    await expect(api.listStickerPacks()).rejects.toMatchObject({ status: 500 });
    await expect(api.discoverStickerPacks()).rejects.toMatchObject({ status: 500 });
    await expect(api.listStickerFavorites()).rejects.toMatchObject({ status: 500 });
  });
});
