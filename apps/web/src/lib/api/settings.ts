import { Schema } from 'effect';
import {
  BackgroundImage as BackgroundImageSchema,
  type BackgroundImage,
  type BackgroundListItem,
  type IntegrationsStatus,
  type PublicAuditEntry,
} from '@zilar/api-contract';
import { makeAuditApi, makeIntegrationsApi } from '@zilar/client-core';
import { struct } from '@zilar/protocol';
import { callApi } from '@/lib/effect/api-client';
import { request, uploadBytes } from './http';

// Bot tokens and mail keys are never returned; only configured and source say whether one is set.
export type { IntegrationsStatus, PublicAuditEntry };
export const {
  getIntegrationsStatus,
  getVoiceTranscriptionStatus,
  getVoiceTranscript,
  removeTelegramBotToken,
  removeVoiceTranscriptionSettings,
  saveEmailSettings,
  saveTelegramBotToken,
  saveVoiceTranscriptionSettings,
} = makeIntegrationsApi(callApi);

export const auditApi = makeAuditApi(callApi);

// A fresh server's first visitor finishes setup (Resend key + admin email) and becomes the
// first admin. The invite code stays in memory (never storage, URL or logs).

const setupStatusSchema = struct({
  needsSetup: Schema.Boolean,
  mailConfigured: Schema.Boolean,
});

export type SetupStatus = typeof setupStatusSchema.Type;

export function getSetupStatus(): Promise<SetupStatus> {
  return request('/setup/status', setupStatusSchema);
}

const setupResultSchema = struct({
  ok: Schema.Boolean,
  inviteCode: Schema.String,
});

export type SetupResult = typeof setupResultSchema.Type;

export interface SetupInput {
  resendApiKey: string;
  from: string;
  adminEmail: string;
}

export function postSetup(input: SetupInput): Promise<SetupResult> {
  return request('/setup', setupResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// The client uploads cropped raw bytes and the server validates by magic bytes (static
// WebP/PNG, square, 64–512 px, ≤ 256 KB); the reply's url is /api/avatars/<id>.
const avatarUrlSchema = struct({ url: Schema.String });

export function uploadAvatar(
  kind: 'user' | 'ai' | 'group',
  ownerId: string,
  blob: Blob,
): Promise<{ url: string }> {
  return uploadBytes(
    'PUT',
    `/avatars/${kind}/${encodeURIComponent(ownerId)}`,
    blob,
    avatarUrlSchema,
  );
}

export async function removeAvatar(kind: 'user' | 'ai' | 'group', ownerId: string): Promise<void> {
  await request(`/avatars/${kind}/${encodeURIComponent(ownerId)}`, struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

// The client resizes and re-encodes before upload; the server validates by magic bytes
// (WebP/PNG, 64-2048 px, at most 1 MiB, at most 20 per user) and the upload posts raw bytes.
export type { BackgroundImage, BackgroundListItem };

export function uploadBackground(blob: Blob): Promise<BackgroundImage> {
  return uploadBytes('POST', '/backgrounds', blob, BackgroundImageSchema);
}

export function listBackgrounds(): Promise<BackgroundListItem[]> {
  return callApi((client) => client.backgrounds.list()).then((body) => [...body.backgrounds]);
}

export async function deleteBackground(id: string): Promise<void> {
  await callApi((client) => client.backgrounds.remove({ params: { id } }));
}
