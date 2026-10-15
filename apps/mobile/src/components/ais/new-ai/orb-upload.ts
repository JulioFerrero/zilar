// effect-plain: the AI picture write and the orb rasterisation are native
// promise edges (expo-file-system upload, react-native-svg toDataURL), the same
// shape as the settings avatar uploader; there is no product flow here to model.
import type Svg from 'react-native-svg';

import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';

/**
 * T-1445: the AI's picture upload. The orb is rendered off-screen (orb-view's
 * `OrbCapture`), rasterised here to a 256×256 base64 PNG, written to the cache
 * dir and PUT to the AI's avatar slot (kind `ai`, owner the new AI's id) through
 * the same `expo-file-system` uploader the settings screen uses. React Native's
 * `fetch` cannot send binary bodies, so the file goes up with
 * `createAvatarFileUploader`.
 */

/** The exported square side; matches the settings avatar export and the server cap. */
export const ORB_EXPORT_SIZE = 256;

/** A capture that overruns this is treated as a partial failure, like a failed upload. */
const ORB_CAPTURE_TIMEOUT_MS = 5000;

/** The AI's avatar slot, resolved against the API origin (the path is relative). */
export function aiAvatarUrl(aiId: string): string {
  return `${API_URL}/api/avatars/ai/${encodeURIComponent(aiId)}`;
}

/** Decodes a base64 PNG (with or without a `data:` prefix) into bytes. */
export function pngBytesFromBase64(base64: string): Uint8Array {
  const comma = base64.indexOf(',');
  const payload = base64.startsWith('data:') && comma !== -1 ? base64.slice(comma + 1) : base64;
  const binary = globalThis.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The mounted orb as a base64 PNG, or null when the view has no node yet. */
export function captureOrbPng(node: Svg | null): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (node === null) {
      resolve(null);
      return;
    }
    node.toDataURL((base64: string) => resolve(base64), {
      width: ORB_EXPORT_SIZE,
      height: ORB_EXPORT_SIZE,
    });
  });
}

/** Writes the orb bytes to the cache dir and uploads them as the AI's picture. */
export async function uploadOrbAvatar(
  aiId: string,
  bytes: Uint8Array,
  token: string,
): Promise<void> {
  const { File, Paths } = await import('expo-file-system');
  const { createAvatarFileUploader } = await import('@/components/settings/avatar-native');
  const file = new File(Paths.cache, `ai-orb-${aiId}.png`);
  file.create({ overwrite: true });
  file.write(bytes);
  await createAvatarFileUploader().upload(
    aiAvatarUrl(aiId),
    { uri: file.uri, mimeType: 'image/png', width: ORB_EXPORT_SIZE, height: ORB_EXPORT_SIZE },
    token,
  );
}

/** Captures the orb, giving up after the timeout so a stuck view cannot hang Create. */
async function captureTimed(capture: () => Promise<string | null>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      capture(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ORB_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Captures the orb and uploads it; false when there is nothing, or it is over the server cap. */
export async function saveOrbAvatar(
  aiId: string,
  capture: (() => Promise<string | null>) | null,
): Promise<boolean> {
  const base64Png = capture === null ? null : await captureTimed(capture);
  const token = base64Png === null ? undefined : await getSessionToken();
  if (base64Png === null || token === undefined) return false;
  const bytes = pngBytesFromBase64(base64Png);
  const { AVATAR_UPLOAD_MAX_BYTES } = await import('@/components/settings/avatar-native');
  if (bytes.byteLength > AVATAR_UPLOAD_MAX_BYTES) return false;
  await uploadOrbAvatar(aiId, bytes, token);
  return true;
}
