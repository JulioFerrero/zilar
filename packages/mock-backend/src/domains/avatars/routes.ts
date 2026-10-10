// Avatar routes (T-1076): `PUT`/`DELETE /avatars/:kind/:ownerId` and a
// `GET /avatars/:id` that always answers 404. The mock mints a url the apps
// can render without a server: a `blob:` url for a Blob body (web uploads
// one), else a base64 `data:` url. An unknown kind answers 404 `not_found`,
// like the server, and an empty body answers 400 `avatar_empty`.

import type { MockData } from '../../state';
import { badRequest, jsonResponse, notFound, type MockHttpRequest } from '../../http/shared';

const AVATAR_KINDS = new Set(['user', 'ai', 'group']);
const DEFAULT_MIME = 'image/png';
const EMPTY_BODY_MESSAGE = 'The picture file is empty';

export function handleAvatars(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, kind, ownerId, extra] = request.segments;
  if (head !== 'avatars' || kind === undefined || extra !== undefined) {
    return undefined;
  }
  if (ownerId === undefined) {
    // `GET /avatars/:id`: every mock url is a `data:` or `blob:` url, so no id
    // can ever be served here.
    return request.method === 'GET' ? notFound('Avatar not found') : undefined;
  }
  if (!AVATAR_KINDS.has(kind)) {
    return notFound('Avatar not found');
  }
  const owner = decodeURIComponent(ownerId);
  if (request.method === 'PUT') {
    return putAvatar(data, kind, owner, request);
  }
  if (request.method === 'DELETE') {
    return removeAvatar(data, kind, owner);
  }
  return undefined;
}

// The viewer's own picture also lands on the `me` row (like `PUT /me/handle`
// writes `handle`), so `GET /me` carries it.
function putAvatar(
  data: MockData,
  kind: string,
  ownerId: string,
  request: MockHttpRequest,
): Response {
  const url = urlForBody(request);
  if (url === undefined) {
    return badRequest('avatar_empty', EMPTY_BODY_MESSAGE);
  }
  data.putAvatarUrl(avatarKey(kind, ownerId), url);
  if (isViewer(kind, ownerId, data)) {
    Object.assign(data.me, { avatarUrl: url });
  }
  return jsonResponse({ url });
}

function removeAvatar(data: MockData, kind: string, ownerId: string): Response {
  data.removeAvatarUrl(avatarKey(kind, ownerId));
  if (isViewer(kind, ownerId, data)) {
    // An undefined value is dropped by `JSON.stringify`, so `GET /me` no
    // longer carries `avatarUrl`, the shape the contract's optional field
    // wants after a remove.
    Object.assign(data.me, { avatarUrl: undefined });
  }
  return jsonResponse({ ok: true });
}

function avatarKey(kind: string, ownerId: string): string {
  return `${kind}:${ownerId}`;
}

function isViewer(kind: string, ownerId: string, data: MockData): boolean {
  return kind === 'user' && ownerId === data.me.id;
}

/** The url to store for a request body, or `undefined` when it is empty. */
function urlForBody(request: MockHttpRequest): string | undefined {
  const body = request.init.body;
  if (isEmptyBody(body)) {
    return undefined;
  }
  if (body instanceof Blob && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(body);
  }
  const bytes = toBytes(body);
  if (bytes === undefined || bytes.byteLength === 0) {
    return undefined;
  }
  const mime = headerValue(request.init.headers, 'content-type') || DEFAULT_MIME;
  return `data:${mime};base64,${toBase64(bytes)}`;
}

function isEmptyBody(body: BodyInit | null | undefined): boolean {
  if (body === null || body === undefined) {
    return true;
  }
  if (body instanceof Blob) {
    return body.size === 0;
  }
  if (typeof body === 'string') {
    return body === '';
  }
  return false;
}

function toBytes(body: BodyInit | null | undefined): Uint8Array | undefined {
  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return undefined;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (headers === undefined) {
    return '';
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? '';
  }
  if (Array.isArray(headers)) {
    const entry = headers.find((pair) => pair[0]?.toLowerCase() === name);
    return entry?.[1] ?? '';
  }
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1] ?? '';
}
