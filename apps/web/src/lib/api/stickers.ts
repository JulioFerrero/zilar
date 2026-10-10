// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
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
  type TelegramImportResult as ContractTelegramImportResult,
} from '@zilar/api-contract';
import { callApi, callApiAbortable } from '@/lib/effect/api-client';
import { API_BASE, uploadBytes } from './http';

// --- Stickers (T-0120) -----------------------------------------------------
// User-made packs: the panel lists mine in order (with stickers), discover
// lists `server`-visible packs, and files are served same-origin so the
// renderer can auto-load them without leaking the viewer's IP.
// The schemas and endpoints live in `@zilar/api-contract` (`stickers.ts`,
// T-0895). `uploadStickerFile` posts raw image bytes, so it stays outside the
// client and decodes with the contract's reply schema.
export type { Sticker };

// The pack keeps a mutable `stickers` array, the shape its editor takes.
export type StickerPack = Omit<ContractStickerPack, 'stickers'> & { stickers: Sticker[] };

function toStickerPack(pack: ContractStickerPack): StickerPack {
  return { ...pack, stickers: [...pack.stickers] };
}

export function listStickerPacks(): Promise<StickerPack[]> {
  return callApi((client) => client.stickers.listPacks()).then((body) =>
    body.packs.map(toStickerPack),
  );
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

// --- Push notifications (T-0119) -------------------------------------------
// The wire contract lives in apps/server/src/push/api.ts. The browser
// registers its Web Push subscription, stores it, then enables the push
// pair over its own XMPP session (ejabberd requires the enable IQ from the
// user's session). The device list carries labels and dates only — never
// the endpoint URL or keys.

// The contract (`@zilar/api-contract`, `push.ts`, T-0895) types the replies and
// the three payloads; the server decodes those bodies by hand (their step order
// and error codes are part of the wire).
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

/**
 * Uploads one prepared sticker file. Raw bytes (not multipart): the server
 * reads an optional `x-emoji` header, so the client never builds a form.
 * The emoji travels percent-encoded: header values are latin1 ByteStrings,
 * and a raw emoji throws in real `fetch` (`new Headers({'x-emoji':'🐱'})`
 * is a TypeError). The server decodes and validates it.
 */
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

// --- Sticker favorites (T-0121) --------------------------------------------
// One user's starred stickers, at most 200, oldest first.

export function listStickerFavorites(): Promise<Sticker[]> {
  return callApi((client) => client.stickers.listFavorites()).then((body) => [...body.favorites]);
}

export function addStickerFavorite(stickerId: string): Promise<Sticker> {
  return callApi((client) => client.stickers.addFavorite({ payload: { sticker_id: stickerId } }));
}

export async function removeStickerFavorite(stickerId: string): Promise<void> {
  await callApi((client) => client.stickers.removeFavorite({ query: { sticker_id: stickerId } }));
}

// --- Telegram import (T-0123) -------------------------------------------------
// A public Telegram pack's static stickers, imported into a private Zilar
// pack through the server (`TELEGRAM_BOT_TOKEN` lives there; the browser
// never sees it). Animated/video stickers are skipped and counted;
// `partial` means the request budget ran out — running the import again
// fills the gaps. Imported packs are personal-use only (`importedFrom` is
// set, visibility stays private, the UI says so).

export type TelegramImportResult = Omit<ContractTelegramImportResult, 'pack'> & {
  pack: StickerPack;
};

export function importTelegramStickers(input: string): Promise<TelegramImportResult> {
  return callApi((client) => client.stickers.importTelegram({ payload: { input } })).then(
    (result) => ({ ...result, pack: toStickerPack(result.pack) }),
  );
}

// --- GIFs (T-0122) --------------------------------------------------------
// Privacy-preserving search: the browser never contacts the provider. Every
// media URL arrives as an opaque `mediaToken` minted for this user; previews
// and the send path load through the same-origin proxy
// (`/api/gifs/media/:token`). An unconfigured provider answers 501
// `gifs_unavailable` and the panel hides the tab.

// The reply schemas and the query keys live in `@zilar/api-contract`
// (`gifs.ts`, T-0895). The server decodes the query by hand, after its provider
// check and limiter, so every key travels as a plain string. A caller may
// abort a search, so the calls go through `callApiAbortable`.
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

/** The same-origin proxy URL for one GIF result's media. */
export function gifMediaUrl(mediaToken: string): string {
  return `${API_BASE}/gifs/media/${encodeURIComponent(mediaToken)}`;
}
