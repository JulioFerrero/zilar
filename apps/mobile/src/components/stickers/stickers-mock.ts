import { StickersApiError, type StickersApi } from '../../lib/stickers-api';
import type { StickerItem, StickerPack } from '../../lib/stickers';
import { mockDemoStickerPacks } from '../../mock/stickers';

/**
 * Mock sticker packs and favorites for `EXPO_PUBLIC_ZILAR_MOCK=1` or
 * `?mock=<scenario>`. It lives beside the hook (not in `src/mock/`) so
 * T-0187 touches only its allowed files; the pattern otherwise mirrors
 * `components/machines/machines-mock.ts`.
 */

export type StickersMockScenario = 'default' | 'empty' | 'error';

export function stickersMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): StickersMockScenario | null {
  const rawParam = params?.['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : env['EXPO_PUBLIC_ZILAR_MOCK'];
  if (requested === undefined || requested === '' || requested === '0') {
    return null;
  }
  if (requested === '1') {
    return normalizeScenario(env['EXPO_PUBLIC_ZILAR_MOCK_SCENARIO']) ?? 'default';
  }
  return normalizeScenario(requested);
}

function normalizeScenario(value: string | undefined): StickersMockScenario | null {
  switch (value) {
    case 'default':
    case 'empty':
    case 'error':
      return value;
    default:
      return null;
  }
}

function clonePack(pack: StickerPack): StickerPack {
  return { ...pack, stickers: pack.stickers.map((sticker) => ({ ...sticker })) };
}

function cloneItem(item: StickerItem): StickerItem {
  return { ...item };
}

/** One shared pack that is never on the panel at first, so Add renders too. */
function extraSharedPack(): StickerPack {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Party',
    stickers: [
      {
        id: '31111111-1111-4111-8111-111111111311',
        packId: '33333333-3333-4333-8333-333333333333',
        url: '/api/stickers/31111111-1111-4111-8111-111111111311/file',
        emoji: null,
        width: 200,
        height: 200,
        mime: 'image/png',
      },
    ],
  };
}

// Kept at module scope so mutations survive navigation between the screens.
const panelStates = new Map<StickersMockScenario, StickerPack[]>();
const favoriteStates = new Map<StickersMockScenario, StickerItem[]>();

function panelFor(scenario: StickersMockScenario): StickerPack[] {
  const existing = panelStates.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const created = scenario === 'empty' ? [] : mockDemoStickerPacks();
  panelStates.set(scenario, created);
  return created;
}

function favoritesFor(scenario: StickersMockScenario): StickerItem[] {
  const existing = favoriteStates.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const panel = panelFor(scenario);
  const created = scenario === 'empty' ? [] : (panel[0]?.stickers.slice(0, 2).map(cloneItem) ?? []);
  favoriteStates.set(scenario, created);
  return created;
}

/**
 * Clears the per-scenario state. Tests call this between cases so they do
 * not depend on the order they run in.
 */
export function resetStickersMock(): void {
  panelStates.clear();
  favoriteStates.clear();
}

/** A `StickersApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockStickersApi(scenario: StickersMockScenario = 'default'): StickersApi {
  const fail = (): never => {
    throw new StickersApiError(500, 'internal_error', 'The server hit an unexpected error');
  };
  const panel = panelFor(scenario);
  const favorites = favoritesFor(scenario);

  return {
    async listStickerPacks() {
      if (scenario === 'error') fail();
      return panel.map(clonePack);
    },
    async discoverStickerPacks(query?: string) {
      if (scenario === 'error') fail();
      const trimmed = query?.trim().toLowerCase() ?? '';
      // Discover is the demo packs plus one shared pack that is not on
      // the panel, so Add and Remove both render in screenshots.
      const shared: StickerPack[] = [...mockDemoStickerPacks(), extraSharedPack()];
      const byId = new Map(shared.map((pack) => [pack.id, pack]));
      const unique = [...byId.values()];
      const matched =
        trimmed === ''
          ? unique
          : unique.filter((pack) => pack.title.toLowerCase().includes(trimmed));
      return { packs: matched, next: null };
    },
    async addStickerPanelPack(packId: string) {
      if (scenario === 'error') fail();
      if (panel.some((pack) => pack.id === packId)) {
        return;
      }
      const shared = [...mockDemoStickerPacks(), extraSharedPack()].find(
        (pack) => pack.id === packId,
      );
      if (shared === undefined) {
        throw new StickersApiError(404, 'not_found', 'Pack not found');
      }
      panel.push(clonePack(shared));
    },
    async removeStickerPanelPack(packId: string) {
      if (scenario === 'error') fail();
      const index = panel.findIndex((pack) => pack.id === packId);
      if (index !== -1) {
        panel.splice(index, 1);
      }
    },
    async reorderStickerPanelPacks(order: string[]) {
      if (scenario === 'error') fail();
      const byId = new Map(panel.map((pack) => [pack.id, pack]));
      const next: StickerPack[] = [];
      for (const id of order) {
        const pack = byId.get(id);
        if (pack !== undefined) {
          byId.delete(id);
          next.push(pack);
        }
      }
      panel.length = 0;
      panel.push(...next, ...byId.values());
    },
    async listStickerFavorites() {
      if (scenario === 'error') fail();
      return favorites.map(cloneItem);
    },
    async removeStickerFavorite(stickerId: string) {
      if (scenario === 'error') fail();
      const index = favorites.findIndex((item) => item.id === stickerId);
      if (index !== -1) {
        favorites.splice(index, 1);
      }
    },
  };
}
