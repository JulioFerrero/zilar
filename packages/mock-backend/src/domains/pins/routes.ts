// Pins routes (T-0114): list by chat, pin a message and unpin by id, mirroring
// web's mock (`apps/web/src/mock/api.ts:2916-2984`). `chat` is a room bare JID
// or a DM peer's bare JID; pins arrive newest first and a chat caps at 20.

import type { MockPin } from './tables';
import type { MockData } from '../../state';
import { currentUser } from '../../data/people';
import {
  conflict,
  errorResponse,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';

const PIN_LIMIT = 20;
const PIN_SENDER_NAME_MAX = 80;
const PIN_TEXT_MAX = 300;

export function handlePins(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first] = request.segments;
  if (head !== 'pins') {
    return undefined;
  }
  if (first === undefined) {
    if (request.method === 'GET') {
      return listPins(data, request);
    }
    if (request.method === 'POST') {
      return createPin(data, request);
    }
    return undefined;
  }
  if (request.method === 'DELETE') {
    return removePin(data, decodeURIComponent(first));
  }
  return undefined;
}

function listPins(data: MockData, request: MockHttpRequest): Response {
  const chat = request.query.get('chat') ?? '';
  const pins = data.pins
    .filter((pin) => pin.chat === chat)
    .sort((a, b) => (a.pinnedAt < b.pinnedAt ? 1 : a.pinnedAt > b.pinnedAt ? -1 : 0));
  return jsonResponse({ pins });
}

function createPin(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const chat = typeof body.chat === 'string' ? body.chat : '';
  const messageId = typeof body.messageId === 'string' ? body.messageId : '';
  const senderName =
    typeof body.senderName === 'string' ? body.senderName.trim().slice(0, PIN_SENDER_NAME_MAX) : '';
  const text = typeof body.text === 'string' ? body.text.slice(0, PIN_TEXT_MAX) : '';
  const kind =
    body.kind === 'image' || body.kind === 'file' || body.kind === 'voice' || body.kind === 'card'
      ? body.kind
      : 'text';
  if (chat === '' || messageId === '' || senderName === '') {
    return errorResponse('invalid_request', 'chat, messageId and senderName are required');
  }
  if (data.pins.some((pin) => pin.chat === chat && pin.messageId === messageId)) {
    return conflict('pin_exists', 'That message is already pinned');
  }
  if (data.pins.filter((pin) => pin.chat === chat).length >= PIN_LIMIT) {
    return errorResponse('pin_limit', 'Too many pins');
  }
  const pin: MockPin = {
    id: data.nextPinId(),
    chat,
    messageId,
    senderName,
    text: kind === 'text' ? text : '',
    kind,
    pinnedBy: currentUser.id,
    pinnedAt: new Date().toISOString(),
  };
  data.putPin(pin);
  return jsonResponse(pin, 201);
}

function removePin(data: MockData, id: string): Response {
  const pin = data.findPin(id);
  if (pin === undefined) {
    return notFound('Pin not found');
  }
  data.removePin(id);
  return jsonResponse(pin);
}
