// effect-plain: the promise edge over the Effect client.
import {
  Sticker as StickerSchema,
  omitUndefined,
  type GifResult,
  type GifResultPage,
  type PushConfig,
  type PushDevice,
  type RegisteredDevice,
  type Sticker,
  type StickerPack as ContractStickerPack,
  type StickerPackDetail as ContractStickerPackDetail,
  type TelegramImportResult as ContractTelegramImportResult,
} from '@zilar/api-contract';
import { callApi, callApiAbortable } from '@/lib/effect/api-client';
import { API_BASE, uploadBytes } from './http';

// Files are served same-origin so the renderer can auto-load them without leaking the
// viewer's IP; uploadStickerFile posts raw bytes and stays outside the derived client.
export type { Sticker };

// The pack keeps a mutable `stickers` array, the shape its editor takes.
export type StickerPack = Omit<ContractStickerPack, 'stickers'> & { stickers: Sticker[] };

function toStickerPack(pack: ContractStickerPack): StickerPack {
  return { ...pack, stickers: [...pack.stickers] };
}

export type StickerPackDetail = Omit<ContractStickerPackDetail, 'stickers'> & {
  stickers: Sticker[];
};

export function listStickerPacks(): Promise<StickerPack[]> {
  return callApi((client) => client.stickers.listPacks()).then((body) =>
    body.packs.map(toStickerPack),
  );
}

/** One pack by id, for its link page; a 404 rejects with an `ApiError`. */
export function getStickerPack(packId: string): Promise<StickerPackDetail> {
  return callApi((client) => client.stickers.getPack({ params: { id: packId } })).then((pack) => ({
    ...pack,
    stickers: [...pack.stickers],
  }));
}

// The contract encodes the trimmed title (the server trimmed it anyway).
export function createStickerPack(input: {
  title: string;
  visibility?: 'private' | 'server';
}): Promise<StickerPack> {
  return callApi((client) =>
    client.stickers.createPack({
      payload: omitUndefined({ ...input, title: input.title.trim() }),
    }),
  ).then(toStickerPack);
}

export function discoverStickerPacks(
  query?: string,
): Promise<{ packs: StickerPack[]; next: string | null }> {
  const q = query?.trim();
  return callApi((client) =>
    client.stickers.discover({ query: q === undefined || q === '' ? {} : { q } }),
  ).then((page) => ({
    packs: page.packs.map(toStickerPack),
    next: page.next,
  }));
}

export async function addStickerPanelPack(packId: string): Promise<void> {
  await callApi((client) => client.stickers.addPanelPack({ params: { packId } }));
}

export async function removeStickerPanelPack(packId: string): Promise<void> {
  await callApi((client) => client.stickers.removePanelPack({ params: { packId } }));
}

// Enabling push sends the enable IQ over the user's own XMPP session (ejabberd requires it);
// the device list carries labels and dates only, never the endpoint URL or keys.

// The server decodes these bodies by hand: their step order and error codes are part of the wire.
export type { PushConfig, PushDevice, RegisteredDevice };

export function getPushConfig(): Promise<PushConfig> {
  return callApi((client) => client.push.config());
}

export interface RegisterPushDeviceInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | undefined;
}

export function registerPushDevice(input: RegisterPushDeviceInput): Promise<RegisteredDevice> {
  return callApi((client) =>
    client.push.subscribe({
      payload: {
        endpoint: input.endpoint,
        keys: input.keys,
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      },
    }),
  );
}

export function listPushDevices(): Promise<PushDevice[]> {
  return callApi((client) => client.push.list()).then((body) => [...body.devices]);
}

export function removePushDevice(id: string): Promise<void> {
  return callApi((client) => client.push.remove({ params: { id } })).then(() => undefined);
}

export function getPushSettings(): Promise<{ showPreviews: boolean }> {
  return callApi((client) => client.push.settings());
}

export function setPushSettings(showPreviews: boolean): Promise<{ showPreviews: boolean }> {
  return callApi((client) => client.push.updateSettings({ payload: { showPreviews } }));
}

export function sendTestPushNotification(subscriptionId: string): Promise<void> {
  return callApi((client) => client.push.test({ payload: { subscriptionId } })).then(
    () => undefined,
  );
}

/** Reorders the caller's whole panel atomically (exact id permutation). */
export async function reorderStickerPanelPacks(order: string[]): Promise<void> {
  await callApi((client) => client.stickers.reorderPanel({ payload: { order } }));
}

export function patchStickerPack(
  packId: string,
  input: { title?: string; visibility?: 'private' | 'server'; order?: string[] },
): Promise<StickerPack> {
  return callApi((client) =>
    client.stickers.patchPack({
      params: { id: packId },
      payload: omitUndefined({
        ...input,
        ...(input.title === undefined ? {} : { title: input.title.trim() }),
      }),
    }),
  ).then(toStickerPack);
}

export function deleteStickerPack(packId: string): Promise<{ warning: string }> {
  return callApi((client) => client.stickers.deletePack({ params: { id: packId } }));
}

export function deletePackSticker(packId: string, stickerId: string): Promise<{ ok: boolean }> {
  return callApi((client) => client.stickers.deleteSticker({ params: { id: packId, stickerId } }));
}

/** Raw bytes, not multipart. The emoji travels percent-encoded because header values are
 * latin1 and a raw emoji throws in fetch: new Headers({'x-emoji':'🐱'}) is a TypeError. */
export function uploadStickerFile(packId: string, blob: Blob, emoji?: string): Promise<Sticker> {
  const headers: Record<string, string> = {};
  if (emoji !== undefined && emoji !== '') {
    headers['x-emoji'] = encodeURIComponent(emoji);
  }
  return uploadBytes(
    'POST',
    `/sticker-packs/${encodeURIComponent(packId)}/stickers`,
    blob,
    StickerSchema,
    headers,
  );
}

// At most 200, oldest first.

export function listStickerFavorites(): Promise<Sticker[]> {
  return callApi((client) => client.stickers.listFavorites()).then((body) => [...body.favorites]);
}

export function addStickerFavorite(stickerId: string): Promise<Sticker> {
  return callApi((client) => client.stickers.addFavorite({ payload: { sticker_id: stickerId } }));
}

export async function removeStickerFavorite(stickerId: string): Promise<void> {
  await callApi((client) => client.stickers.removeFavorite({ query: { sticker_id: stickerId } }));
}

// The Telegram bot token lives on the server; the browser never sees it. Animated and
// video stickers are skipped, and imported packs stay private (importedFrom is set).

export type TelegramImportResult = Omit<ContractTelegramImportResult, 'pack'> & {
  pack: StickerPack;
};

export function importTelegramStickers(input: string): Promise<TelegramImportResult> {
  return callApi((client) => client.stickers.importTelegram({ payload: { input } })).then(
    (result) => ({ ...result, pack: toStickerPack(result.pack) }),
  );
}

// Privacy: the browser never contacts the provider. Media arrives as an opaque mediaToken
// minted for this user and loads through the same-origin proxy.

// A caller may abort a search, so the calls go through callApiAbortable.
export type { GifResult };

export interface GifPage {
  items: GifResult[];
  nextPos?: string | undefined;
}

function toGifPage(page: GifResultPage): GifPage {
  const { items, nextPos } = page;
  return { items: [...items], ...(nextPos === undefined ? {} : { nextPos }) };
}

export function searchGifs(query: string, pos?: string, signal?: AbortSignal): Promise<GifPage> {
  return callApiAbortable(
    (client) =>
      client.gifs.search({
        query: { q: query, ...(pos === undefined || pos === '' ? {} : { pos }) },
      }),
    signal,
  ).then(toGifPage);
}

export function trendingGifs(pos?: string, signal?: AbortSignal): Promise<GifPage> {
  return callApiAbortable(
    (client) => client.gifs.trending({ query: pos === undefined || pos === '' ? {} : { pos } }),
    signal,
  ).then(toGifPage);
}

export function gifMediaUrl(mediaToken: string): string {
  return `${API_BASE}/gifs/media/${encodeURIComponent(mediaToken)}`;
}
