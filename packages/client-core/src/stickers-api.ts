// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
// The shared stickers and GIFs calls: web and phone each supply the transport.
import type { Effect } from 'effect';
import {
  omitUndefined,
  type GifResult,
  type GifResultPage,
  type Sticker as ContractSticker,
  type StickerPack as ContractStickerPack,
  type StickerPackDetail as ContractStickerPackDetail,
  type TelegramImportResult as ContractTelegramImportResult,
  type ZilarClient,
} from '@zilar/api-contract';

/** The pack keeps a mutable `stickers` array, the shape its editor takes. */
export type Sticker = ContractSticker;
export type StickerPack = Omit<ContractStickerPack, 'stickers'> & { stickers: Sticker[] };
export type StickerPackDetail = Omit<ContractStickerPackDetail, 'stickers'> & {
  stickers: Sticker[];
};
/** A sticker as the panels render it: every contract field except the byte count. */
export type PanelSticker = Omit<Sticker, 'bytes'>;
export interface PanelPack {
  id: string;
  title: string;
  ownerId?: string | undefined;
  visibility?: 'private' | 'server' | undefined;
  importedFrom?: string | undefined;
  ownerHandle?: string | null | undefined;
  stickers: PanelSticker[];
}
export type TelegramImportResult = Omit<ContractTelegramImportResult, 'pack'> & {
  pack: StickerPack;
};

export interface StickerPackPage {
  packs: StickerPack[];
  next: string | null;
}

export interface CreateStickerPackInput {
  title: string;
  visibility?: 'private' | 'server';
}

export interface PatchStickerPackInput {
  title?: string;
  visibility?: 'private' | 'server';
  order?: string[];
}

export interface GifPage<T> {
  items: T[];
  nextPos?: string | undefined;
}

type StickersCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

type GifsCall = <A, E>(
  call: (client: ZilarClient) => Effect.Effect<A, E>,
  signal?: AbortSignal,
) => Promise<A>;

function toStickerPack(pack: ContractStickerPack): StickerPack {
  return { ...pack, stickers: [...pack.stickers] };
}

export function makeStickersApi(call: StickersCall) {
  return {
    listStickerPacks: (): Promise<StickerPack[]> =>
      call((c) => c.stickers.listPacks()).then(({ packs }) => packs.map(toStickerPack)),
    getStickerPack: (packId: string): Promise<StickerPackDetail> =>
      call((c) => c.stickers.getPack({ params: { id: packId } })).then((pack) => ({
        ...pack,
        stickers: [...pack.stickers],
      })),
    // The contract encodes the trimmed title (the server trimmed it anyway).
    createStickerPack: (input: CreateStickerPackInput): Promise<StickerPack> =>
      call((c) =>
        c.stickers.createPack({ payload: omitUndefined({ ...input, title: input.title.trim() }) }),
      ).then(toStickerPack),
    discoverStickerPacks: (query?: string): Promise<StickerPackPage> => {
      const q = query?.trim();
      return call((c) =>
        c.stickers.discover({ query: q === undefined || q === '' ? {} : { q } }),
      ).then((page) => ({ packs: page.packs.map(toStickerPack), next: page.next }));
    },
    addStickerPanelPack: async (packId: string): Promise<void> => {
      await call((c) => c.stickers.addPanelPack({ params: { packId } }));
    },
    removeStickerPanelPack: async (packId: string): Promise<void> => {
      await call((c) => c.stickers.removePanelPack({ params: { packId } }));
    },
    /** Reorders the caller's whole panel atomically (exact id permutation). */
    reorderStickerPanelPacks: async (order: string[]): Promise<void> => {
      await call((c) => c.stickers.reorderPanel({ payload: { order } }));
    },
    patchStickerPack: (packId: string, input: PatchStickerPackInput): Promise<StickerPack> =>
      call((c) =>
        c.stickers.patchPack({
          params: { id: packId },
          payload: omitUndefined({
            ...input,
            ...(input.title === undefined ? {} : { title: input.title.trim() }),
          }),
        }),
      ).then(toStickerPack),
    deleteStickerPack: (packId: string): Promise<{ warning: string }> =>
      call((c) => c.stickers.deletePack({ params: { id: packId } })),
    deletePackSticker: async (packId: string, stickerId: string): Promise<void> => {
      await call((c) => c.stickers.deleteSticker({ params: { id: packId, stickerId } }));
    },
    // At most 200, oldest first.
    listStickerFavorites: (): Promise<Sticker[]> =>
      call((c) => c.stickers.listFavorites()).then(({ favorites }) => [...favorites]),
    addStickerFavorite: (stickerId: string): Promise<Sticker> =>
      call((c) => c.stickers.addFavorite({ payload: { sticker_id: stickerId } })),
    removeStickerFavorite: async (stickerId: string): Promise<void> => {
      await call((c) => c.stickers.removeFavorite({ query: { sticker_id: stickerId } }));
    },
    // The Telegram bot token lives on the server; the client never sees it. Animated and
    // video stickers are skipped, and imported packs stay private (importedFrom is set).
    importTelegramStickers: (input: string): Promise<TelegramImportResult> =>
      call((c) => c.stickers.importTelegram({ payload: { input } })).then((result) => ({
        ...result,
        pack: toStickerPack(result.pack),
      })),
  };
}

const posQuery = (pos: string | undefined) => (pos === undefined || pos === '' ? {} : { pos });

/**
 * The GIF calls both apps make. Items carry opaque `mediaToken`s, never provider URLs;
 * each app maps a row to what its views render.
 */
export function makeGifsApi<T>(call: GifsCall, toItem: (row: GifResult) => T) {
  const pageOf = (
    request: (client: ZilarClient) => Effect.Effect<GifResultPage, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<GifPage<T>> =>
    call(request, signal).then((page) => {
      const nextPos = page.nextPos;
      return {
        items: page.items.map(toItem),
        ...(nextPos === undefined || nextPos === '' ? {} : { nextPos }),
      };
    });

  return {
    searchGifs: (query: string, pos?: string, signal?: AbortSignal): Promise<GifPage<T>> =>
      pageOf((c) => c.gifs.search({ query: { q: query, ...posQuery(pos) } }), signal),
    trendingGifs: (pos?: string, signal?: AbortSignal): Promise<GifPage<T>> =>
      pageOf((c) => c.gifs.trending({ query: posQuery(pos) }), signal),
  };
}
