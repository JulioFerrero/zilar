import { Effect, Exit, Schema } from 'effect';
import {
  ApiError,
  runApi,
  Sticker as ContractSticker,
  type ZilarClient,
} from '@zilar/api-contract';
import {
  makeStickersApi,
  type Sticker,
  type TelegramImportResult as SharedTelegramImportResult,
} from '@zilar/client-core';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';

export type TelegramImportResult = SharedTelegramImportResult;
export type { PanelPack, StickerPack, StickerPackDetail } from '@zilar/client-core';

export type TokenProvider = () => Promise<string | undefined>;

/**
 * Injected so tests never touch the native modules; production uses an `expo-file-system` binary upload.
 */
export interface StickerBinaryUpload {
  upload(
    url: string,
    uri: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }>;
}

async function defaultBinaryUpload(
  url: string,
  uri: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const { File, UploadType } = await import('expo-file-system');
  const source = new File(uri);
  try {
    const result = await source.upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
    });
    return { status: result.status, body: result.body };
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server');
  }
}

const INVALID_RESPONSE = 'The server sent an unexpected response';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function decodeSticker(value: unknown): Sticker {
  const decoded = Schema.decodeUnknownExit(ContractSticker)(value);
  if (Exit.isFailure(decoded)) {
    throw new ApiError(200, 'invalid_response', INVALID_RESPONSE);
  }
  return decoded.value;
}

type SharedStickersApi = ReturnType<typeof makeStickersApi>;

export interface StickersApi extends SharedStickersApi {
  /**
   * Raw bytes, not multipart; the emoji travels percent-encoded in `x-emoji` because header values are latin1 and a raw emoji throws in fetch.
   */
  uploadStickerFile(
    packId: string,
    file: { uri: string; mimeType: string },
    emoji?: string,
  ): Promise<Sticker>;
}

export function createStickersApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
  binaryUpload: StickerBinaryUpload = { upload: defaultBinaryUpload },
): StickersApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });

  function call<A, E>(request: (client: ZilarClient) => Effect.Effect<A, E>): Promise<A> {
    return runApi(request(client));
  }

  const uploadStickerFile: StickersApi['uploadStickerFile'] = async (packId, file, emoji) => {
    const token = await getToken();
    if (token === undefined) {
      throw new ApiError(401, 'unauthorized', 'No session');
    }
    const headers: Record<string, string> = {
      'content-type': file.mimeType,
      authorization: `Bearer ${token}`,
    };
    if (emoji !== undefined && emoji !== '') {
      headers['x-emoji'] = encodeURIComponent(emoji);
    }
    const result = await binaryUpload.upload(
      `${apiUrl}/api/sticker-packs/${encodeURIComponent(packId)}/stickers`,
      file.uri,
      headers,
    );
    const body = parseJson(result.body);
    if (result.status < 200 || result.status >= 300) {
      const error = errorFieldsOf(body);
      throw new ApiError(
        result.status,
        error.code ?? 'request_failed',
        error.message ?? `Request failed (${result.status})`,
      );
    }
    return decodeSticker(body);
  };

  return { ...makeStickersApi(call), uploadStickerFile };
}
