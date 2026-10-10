// Chat-prefs routes (T-0113, T-0462): list the caller's per-chat rows, apply a
// partial update, and read/write the per-user background default, mirroring
// web's mock (`apps/web/src/mock/api.ts:2502-2530`, `:2634-2684`). A write that
// lands back on all defaults deletes the row.

import type { MockChatPref } from './tables';
import type { MockData } from '../../state';
import { errorResponse, jsonResponse, readJsonBody, type MockHttpRequest } from '../../http/shared';

const PINNED_CHAT_CAP = 20;

const PREF_FIELDS = new Set([
  'mutedUntil',
  'archived',
  'pinned',
  'backgroundPreset',
  'backgroundImageId',
  'backgroundDim',
]);

const BACKGROUND_FIELDS = new Set(['backgroundPreset', 'backgroundImageId', 'backgroundDim']);

export function handleChatPrefs(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first] = request.segments;
  if (head === 'chat-prefs' && first === undefined && request.method === 'GET') {
    return jsonResponse({ prefs: data.chatPrefs });
  }
  if (head === 'chat-prefs' && first !== undefined && request.method === 'PUT') {
    return putChatPref(data, request, decodeURIComponent(first));
  }
  if (head === 'chat-background' && first === undefined) {
    if (request.method === 'GET') {
      return jsonResponse({ defaultBackground: data.backgroundDefault });
    }
    if (request.method === 'PUT') {
      return putBackgroundDefault(data, request);
    }
  }
  return undefined;
}

function putChatPref(data: MockData, request: MockHttpRequest, chatJid: string): Response {
  const body = readJsonBody(request.init);
  for (const key of Object.keys(body)) {
    if (!PREF_FIELDS.has(key)) {
      return errorResponse('invalid_request', `Unknown field: ${key}`);
    }
  }
  if (Object.keys(body).length === 0) {
    return errorResponse('invalid_request', 'Nothing to update');
  }
  if (!isValidPrefBody(body)) {
    return errorResponse('invalid_request', 'Invalid preference body');
  }
  const existing = data.findChatPref(chatJid);
  const mutedUntil = !('mutedUntil' in body)
    ? (existing?.mutedUntil ?? null)
    : (body.mutedUntil as string | null);
  if (mutedUntil !== null && Number.isNaN(Date.parse(mutedUntil))) {
    return errorResponse('invalid_request', 'mutedUntil must be a valid date');
  }
  const archived = !('archived' in body)
    ? (existing?.archived ?? false)
    : (body.archived as boolean);
  const pinnedAt = !('pinned' in body)
    ? (existing?.pinnedAt ?? null)
    : (body.pinned as boolean)
      ? (existing?.pinnedAt ?? new Date().toISOString())
      : null;
  const backgroundPreset = !('backgroundPreset' in body)
    ? (existing?.backgroundPreset ?? null)
    : (body.backgroundPreset as string | null);
  const backgroundImageId = !('backgroundImageId' in body)
    ? (existing?.backgroundImageId ?? null)
    : (body.backgroundImageId as string | null);
  const backgroundDim = !('backgroundDim' in body)
    ? (existing?.backgroundDim ?? null)
    : (body.backgroundDim as number | null);
  if (backgroundPreset !== null && backgroundImageId !== null) {
    return errorResponse('invalid_request', 'Set a preset or an image, not both');
  }
  if (
    mutedUntil === null &&
    archived === false &&
    pinnedAt === null &&
    backgroundPreset === null &&
    backgroundImageId === null &&
    backgroundDim === null
  ) {
    data.removeChatPref(chatJid);
    return jsonResponse({ prefs: null });
  }
  const row: MockChatPref = {
    chatJid,
    mutedUntil,
    archived,
    pinnedAt,
    updatedAt: new Date().toISOString(),
    backgroundPreset,
    backgroundImageId,
    backgroundDim,
  };
  data.putChatPref(row);
  // Pin cap of 20, mirroring the server: roll the write back when it overflows.
  if (data.chatPrefs.filter((pref) => pref.pinnedAt !== null).length > PINNED_CHAT_CAP) {
    data.removeChatPref(chatJid);
    if (existing !== undefined) {
      data.putChatPref(existing);
    }
    return errorResponse('too_many_pins', 'Too many pinned chats', 409);
  }
  return jsonResponse(row);
}

function isValidPrefBody(body: Record<string, unknown>): boolean {
  return !(
    ('mutedUntil' in body && body.mutedUntil !== null && typeof body.mutedUntil !== 'string') ||
    ('archived' in body && typeof body.archived !== 'boolean') ||
    ('pinned' in body && typeof body.pinned !== 'boolean') ||
    ('backgroundPreset' in body &&
      body.backgroundPreset !== null &&
      typeof body.backgroundPreset !== 'string') ||
    ('backgroundImageId' in body &&
      body.backgroundImageId !== null &&
      typeof body.backgroundImageId !== 'string') ||
    ('backgroundDim' in body &&
      body.backgroundDim !== null &&
      typeof body.backgroundDim !== 'number')
  );
}

function putBackgroundDefault(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  for (const key of Object.keys(body)) {
    if (!BACKGROUND_FIELDS.has(key)) {
      return errorResponse('invalid_request', `Unknown field: ${key}`);
    }
  }
  if (
    ('backgroundPreset' in body &&
      body.backgroundPreset !== null &&
      typeof body.backgroundPreset !== 'string') ||
    ('backgroundImageId' in body &&
      body.backgroundImageId !== null &&
      typeof body.backgroundImageId !== 'string') ||
    ('backgroundDim' in body &&
      body.backgroundDim !== null &&
      typeof body.backgroundDim !== 'number')
  ) {
    return errorResponse('invalid_request', 'Invalid background body');
  }
  const backgroundPreset =
    'backgroundPreset' in body ? (body.backgroundPreset as string | null) : null;
  const backgroundImageId =
    'backgroundImageId' in body ? (body.backgroundImageId as string | null) : null;
  const backgroundDim = 'backgroundDim' in body ? (body.backgroundDim as number | null) : null;
  if (backgroundPreset !== null && backgroundImageId !== null) {
    return errorResponse('invalid_request', 'Set a preset or an image, not both');
  }
  data.putBackgroundDefault({ backgroundPreset, backgroundImageId, backgroundDim });
  return jsonResponse({ defaultBackground: data.backgroundDefault });
}
