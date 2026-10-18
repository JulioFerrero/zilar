import { Schema } from 'effect';
import {
  BackgroundImage as BackgroundImageSchema,
  type BackgroundImage,
  type BackgroundListItem,
  type IntegrationsStatus,
  type PublicAuditEntry,
} from '@zilar/api-contract';
import { struct } from '@zilar/protocol';
import { callApi } from '@/lib/effect/api-client';
import { request, uploadBytes } from './http';

// The Telegram bot token and the sign-in mail key are never returned, not even masked;
// only configured and source say whether one is set.

// The contract encodes the trimmed form, so secrets are trimmed before sending.
export type { IntegrationsStatus };

export function getIntegrationsStatus(): Promise<IntegrationsStatus> {
  return callApi((client) => client.integrations.status());
}

export async function saveTelegramBotToken(botToken: string): Promise<void> {
  await callApi((client) =>
    client.integrations.setTelegram({ payload: { botToken: botToken.trim() } }),
  );
}

export async function removeTelegramBotToken(): Promise<void> {
  await callApi((client) => client.integrations.removeTelegram());
}

export interface SaveEmailSettingsInput {
  from: string;
  resendApiKey?: string | undefined;
}

export async function saveEmailSettings(input: SaveEmailSettingsInput): Promise<void> {
  const from = input.from.trim();
  await callApi((client) =>
    client.integrations.setEmail({
      payload:
        input.resendApiKey === undefined
          ? { from }
          : { from, resendApiKey: input.resendApiKey.trim() },
    }),
  );
}

// Transcription is off by default and configured by the server owner; the web offers it only
// while the server says it is enabled.
export interface SaveVoiceTranscriptionInput {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
}

export function getVoiceTranscriptionStatus(): Promise<{ enabled: boolean }> {
  return callApi((client) => client.voiceTranscription.status());
}

export function getVoiceTranscript(url: string): Promise<{ text: string }> {
  return callApi((client) => client.voiceTranscription.transcript({ payload: { url } }));
}

export async function saveVoiceTranscriptionSettings(
  input: SaveVoiceTranscriptionInput,
): Promise<void> {
  await callApi((client) =>
    client.voiceTranscription.setSettings({
      payload: {
        baseUrl: input.baseUrl,
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
        ...(input.model === undefined ? {} : { model: input.model }),
      },
    }),
  );
}

export async function removeVoiceTranscriptionSettings(): Promise<void> {
  await callApi((client) => client.voiceTranscription.removeSettings());
}

export type { PublicAuditEntry };

export interface ListAuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

// The server answers exactly one of ?aiId= or ?groupId= and 400 otherwise; the union makes
// both or neither a compile error.
export type AuditScope =
  { aiId: string; groupId?: undefined } | { groupId: string; aiId?: undefined };

export type ListAuditInput = AuditScope & {
  limit?: number;
  before?: string;
};

export async function listAudit(input: ListAuditInput): Promise<ListAuditPage> {
  const page = await callApi((client) =>
    client.audit.list({
      query: {
        ...('aiId' in input && input.aiId !== undefined
          ? { aiId: input.aiId }
          : 'groupId' in input && input.groupId !== undefined
            ? { groupId: input.groupId }
            : {}),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.before === undefined || input.before === '' ? {} : { before: input.before }),
      },
    }),
  );
  return { entries: [...page.entries], next: page.next };
}

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
