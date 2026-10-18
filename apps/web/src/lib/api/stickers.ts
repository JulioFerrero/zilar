// effect-plain: the promise edge over the Effect client.
import {
  Sticker as StickerSchema,
  type GifResult,
  type PushConfig,
  type PushDevice,
  type RegisteredDevice,
  type Sticker,
} from '@zilar/api-contract';
import { makeGifsApi, makeStickersApi, type GifPage as SharedGifPage } from '@zilar/client-core';
import { callApi, callApiAbortable } from '@/lib/effect/api-client';
import { API_BASE, uploadBytes } from './http';

// Files are served same-origin so the renderer can auto-load them without leaking the
// viewer's IP; uploadStickerFile posts raw bytes and stays outside the derived client.
export type { Sticker };
export type {
  PanelPack,
  StickerPack,
  StickerPackDetail,
  TelegramImportResult,
} from '@zilar/client-core';
export type { GifResult };

const api = makeStickersApi(callApi);

export const {
  addStickerFavorite,
  addStickerPanelPack,
  createStickerPack,
  deletePackSticker,
  deleteStickerPack,
  discoverStickerPacks,
  getStickerPack,
  importTelegramStickers,
  listStickerFavorites,
  listStickerPacks,
  patchStickerPack,
  removeStickerFavorite,
  removeStickerPanelPack,
  reorderStickerPanelPacks,
} = api;

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

// Privacy: the browser never contacts the provider. Media arrives as an opaque mediaToken
// minted for this user and loads through the same-origin proxy.

// A caller may abort a search, so the calls go through the abortable edge.
export type GifPage = SharedGifPage<GifResult>;

const gifs = makeGifsApi<GifResult>(callApiAbortable, (row) => row);

export const { searchGifs, trendingGifs } = gifs;

export function gifMediaUrl(mediaToken: string): string {
  return `${API_BASE}/gifs/media/${encodeURIComponent(mediaToken)}`;
}
