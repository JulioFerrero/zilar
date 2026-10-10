// Push routes (T-0119): the VAPID config, subscribe/list/remove a device, the
// preview setting and the test notification, mirroring web's mock
// (`apps/web/src/mock/api.ts:1330-1405`). The mock has one user and no XMPP
// session, so subscribing only stores the row and returns the enable pair.

import type { PushConfig, PushSettings, RegisteredDevice } from '@zilar/api-contract';
import type { MockPushDevice } from './tables';
import type { MockData } from '../../state';
import {
  errorResponse,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';

const PUSH_JID = 'push.mock.test';
const VAPID_PUBLIC_KEY = 'mock-vapid-public-key';

export function handlePush(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head !== 'push' || first === undefined) {
    return undefined;
  }
  if (first === 'config' && request.segments.length === 2 && request.method === 'GET') {
    const config: PushConfig = { vapidPublicKey: VAPID_PUBLIC_KEY, pushJid: PUSH_JID };
    return jsonResponse(config);
  }
  if (first === 'subscriptions') {
    if (second === undefined) {
      if (request.method === 'GET') {
        return listDevices(data);
      }
      if (request.method === 'POST') {
        return createDevice(data, request);
      }
    }
    if (second !== undefined && request.method === 'DELETE') {
      return removeDevice(data, decodeURIComponent(second));
    }
  }
  if (first === 'settings' && request.segments.length === 2) {
    if (request.method === 'GET') {
      return getSettings(data);
    }
    if (request.method === 'PUT') {
      return putSettings(data, request);
    }
  }
  if (first === 'test' && request.segments.length === 2 && request.method === 'POST') {
    return testDevice(data, request);
  }
  return undefined;
}

function listDevices(data: MockData): Response {
  return jsonResponse({ devices: [...data.pushDevices] });
}

function createDevice(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  if (
    typeof body.endpoint !== 'string' ||
    body.endpoint === '' ||
    typeof body.keys !== 'object' ||
    body.keys === null
  ) {
    return errorResponse('invalid_subscription', 'The push subscription is invalid');
  }
  const id = data.nextPushDeviceId();
  const device: MockPushDevice = {
    id,
    userAgent: typeof body.userAgent === 'string' ? body.userAgent : null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    inactive: false,
  };
  data.putPushDevice(device);
  const registered: RegisteredDevice = { id, node: `mock-node-${id}`, jid: PUSH_JID };
  return jsonResponse(registered);
}

function removeDevice(data: MockData, id: string): Response {
  if (data.findPushDevice(id) === undefined) {
    return notFound('Push device not found');
  }
  data.removePushDevice(id);
  return jsonResponse({ removed: true });
}

function getSettings(data: MockData): Response {
  const settings: PushSettings = { showPreviews: data.pushShowPreviews };
  return jsonResponse(settings);
}

function putSettings(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  if (typeof body.showPreviews !== 'boolean') {
    return errorResponse('invalid_request', 'showPreviews must be a boolean');
  }
  data.setPushShowPreviews(body.showPreviews);
  const settings: PushSettings = { showPreviews: data.pushShowPreviews };
  return jsonResponse(settings);
}

function testDevice(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const target =
    typeof body.subscriptionId === 'string' ? data.findPushDevice(body.subscriptionId) : undefined;
  if (target === undefined) {
    return notFound('Push device not found');
  }
  return jsonResponse({ sent: true });
}
