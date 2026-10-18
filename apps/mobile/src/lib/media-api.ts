import { Exit, Schema } from 'effect';
import { ApiError, MediaItem as ContractMediaItem, runApi } from '@zilar/api-contract';

import { createApiClient } from './effect/api-client';

/**
 * The page schema drops a malformed row, and a `next` of the wrong type reads as `null`. `at` is ISO, and the optional fields depend on `kind`.
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

export const MediaApiError = ApiError;
export type MediaApiError = ApiError;

function toMediaItem(row: ContractMediaItem): MediaItem | null {
  if (Number.isNaN(Date.parse(row.at))) {
    return null;
  }
  const { waveform, ...rest } = row;
  return { ...rest, ...(waveform === undefined ? {} : { waveform: [...waveform] }) };
}

export function parseMediaItem(value: unknown): MediaItem | null {
  const decoded = Schema.decodeUnknownExit(ContractMediaItem)(value);
  return Exit.isSuccess(decoded) ? toMediaItem(decoded.value) : null;
}

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
