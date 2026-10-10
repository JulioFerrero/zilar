import { Exit, Schema } from 'effect';
import { ApiError, MediaItem as ContractMediaItem, runApi } from '@zilar/api-contract';

import { createApiClient } from './effect/api-client';

/**
 * The mobile media-gallery client (T-0436), the twin of `pins-api.ts`: it
 * pages `GET /api/media?chat&type&before&limit` (T-0431), returning
 * `{ items, next }`.
 *
 * A Promise port over the client derived from the shared contract
 * (`@zilar/api-contract`, `media.ts`, T-0910). The contract's page schema
 * drops a malformed row and keeps the rest (`lenientArray`), and reads a
 * `next` of the wrong type as `null`.
 *
 * A `MediaItem` is display metadata only: `messageId` is the jump key, `at`
 * is ISO, and the optional fields depend on `kind`.
 */

export type MediaTab = 'media' | 'files' | 'links' | 'voice';

export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';

export interface MediaItem {
  messageId: string;
  chat: string;
  at: string;
  senderName: string;
  kind: MediaKind;
  url?: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  linkUrl?: string;
  linkHost?: string;
}

/** One page of the gallery, newest first; `next` is the paging cursor. */
export interface MediaPage {
  items: MediaItem[];
  next: string | null;
}

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export interface MediaApi {
  listChatMedia(input: ListChatMediaInput): Promise<MediaPage>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const MediaApiError = ApiError;
export type MediaApiError = ApiError;

/** One contract row as the gallery shows it; an unparseable `at` returns null. */
function toMediaItem(row: ContractMediaItem): MediaItem | null {
  if (Number.isNaN(Date.parse(row.at))) {
    return null;
  }
  const { waveform, ...rest } = row;
  return { ...rest, ...(waveform === undefined ? {} : { waveform: [...waveform] }) };
}

/** A gallery row the viewer may see; a malformed row returns null and is dropped. */
export function parseMediaItem(value: unknown): MediaItem | null {
  const decoded = Schema.decodeUnknownExit(ContractMediaItem)(value);
  return Exit.isSuccess(decoded) ? toMediaItem(decoded.value) : null;
}

/** The production `MediaApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createMediaApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): MediaApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listChatMedia: ({ chat, type, before, limit }) =>
      runApi(
        client.media.gallery({
          query: {
            chat,
            type,
            ...(before === undefined ? {} : { before }),
            ...(limit === undefined ? {} : { limit: String(limit) }),
          },
        }),
      ).then((page) => ({
        items: page.items.flatMap((row) => toMediaItem(row) ?? []),
        next: page.next,
      })),
  };
}
