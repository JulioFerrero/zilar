// Background-image routes (T-1045): upload, list, serve and delete, mirroring
// web's mock (`apps/web/src/mock/api.ts:2685`). POST takes a raw body (the mock
// ignores the bytes) and caps the caller at 20 images, like the server. GET
// `/:id` serves the stored `data:` URL's bytes so the app's wallpaper URL
// (`/api/backgrounds/:id`) resolves.
import {
  BACKGROUND_HEIGHT,
  BACKGROUND_WIDTH,
  backgroundDataUrl,
  type MockBackground,
} from './seed';
import type { MockData } from '../../state';
import {
  conflict,
  jsonResponse,
  noContent,
  notFound,
  type MockHttpRequest,
} from '../../http/shared';

const MAX_BACKGROUNDS = 20;

export function handleBackgrounds(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head !== 'backgrounds') {
    return undefined;
  }
  if (first === undefined && second === undefined) {
    if (request.method === 'POST') {
      return uploadBackground(data);
    }
    if (request.method === 'GET') {
      return jsonResponse({ backgrounds: data.backgrounds });
    }
    return undefined;
  }
  if (first !== undefined && second === undefined) {
    const id = decodeURIComponent(first);
    if (request.method === 'GET') {
      return serveBackground(data, id);
    }
    if (request.method === 'DELETE') {
      return deleteBackground(data, id);
    }
  }
  return undefined;
}

function uploadBackground(data: MockData): Response {
  if (data.backgrounds.length >= MAX_BACKGROUNDS) {
    return conflict('too_many_backgrounds', 'Too many background images');
  }
  const id = `bg-mock-${data.nextBackgroundSequence}`;
  data.nextBackgroundSequence += 1;
  const row: MockBackground = {
    id,
    url: backgroundDataUrl(),
    width: BACKGROUND_WIDTH,
    height: BACKGROUND_HEIGHT,
    createdAt: new Date().toISOString(),
  };
  data.backgrounds = [row, ...data.backgrounds];
  return jsonResponse({ id: row.id, url: row.url, width: row.width, height: row.height }, 201);
}

function serveBackground(data: MockData, id: string): Response {
  const row = data.backgrounds.find((background) => background.id === id);
  if (row === undefined) {
    return notFound('Background not found');
  }
  return fileResponse(row);
}

function deleteBackground(data: MockData, id: string): Response {
  if (!data.backgrounds.some((background) => background.id === id)) {
    return notFound('Background not found');
  }
  data.backgrounds = data.backgrounds.filter((background) => background.id !== id);
  return noContent();
}

/** The stored `data:` URL back as raw bytes with its mime type. */
function fileResponse(row: MockBackground): Response {
  const match = /^data:([^,]*),(.*)$/s.exec(row.url);
  if (match === null) {
    return notFound('Background not found');
  }
  const mime = (match[1] ?? '').split(';')[0] || 'application/octet-stream';
  const body = decodeURIComponent(match[2] ?? '');
  return new Response(body, { status: 200, headers: { 'Content-Type': mime } });
}
