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

// --- Integrations settings (T-0162 + Email follow-up) ----------------------
// The server owner's key shelf: the Telegram bot token (sticker import)
// and the sign-in mail sender + Resend key. The token and the key are
// never returned by the server, not even masked — only `configured` and
// `source` say whether one is set.

// The schemas and endpoints live in `@zilar/api-contract` (`integrations.ts`,
// T-0895); these are thin wrappers over the derived client. The contract
// encodes the trimmed form, so the secrets are trimmed before sending (the
// server trimmed them anyway).
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

// --- Voice transcripts (T-0170) --------------------------------------------
// Transcription is off by default and configured by the server owner (an
// OpenAI-compatible endpoint); the web shows "Show transcript" on voice
// messages only while the server says it is enabled. The per-session cache
// in `VoiceMessage` keeps a tap from refetching; the server caches per URL.
export interface SaveVoiceTranscriptionInput {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
}

export function getVoiceTranscriptionStatus(): Promise<{ enabled: boolean }> {
  return request('/voice/transcription', struct({ enabled: Schema.Boolean }));
}

export function getVoiceTranscript(url: string): Promise<{ text: string }> {
  return request('/voice/transcript', struct({ text: Schema.String }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export async function saveVoiceTranscriptionSettings(
  input: SaveVoiceTranscriptionInput,
): Promise<void> {
  const body: Record<string, string> = { baseUrl: input.baseUrl };
  if (input.apiKey !== undefined) {
    body['apiKey'] = input.apiKey;
  }
  if (input.model !== undefined) {
    body['model'] = input.model;
  }
  await request('/settings/integrations/voice-transcription', struct({ ok: Schema.Boolean }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function removeVoiceTranscriptionSettings(): Promise<void> {
  await request('/settings/integrations/voice-transcription', struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

// --- Audit log (T-0079, T-0084) --------------------------------------------
// The wire contract lives in apps/server/src/audit/api.ts and service.ts.

export type { PublicAuditEntry };

export interface ListAuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

// T-0086: the audit endpoint answers one of `?aiId=…` or `?groupId=…`, never
// both, and the server answers 400 otherwise. The discriminated union makes
// "exactly one of the two keys" a compile error: passing both or neither
// fails type-checking.
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

// --- First-run setup (T-0161) ------------------------------------------------
// A fresh server has no users: whoever opens it first finishes the setup
// screen (Resend key + admin email) and becomes the first admin by
// completing the emailed sign-in code. The invite code stays in memory in
// the setup page (never in storage, URL or logs) and rides the sign-up
// request itself.

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

// --- Avatars (T-0165) ------------------------------------------------------
// Profile pictures for people, AIs, groups and channels. The browser crops
// and resizes (see `AvatarUploader`); the client uploads the raw bytes and
// the server validates by magic bytes (static WebP/PNG only, square,
// 64–512 px, ≤ 256 KB). The response carries the new `url`
// (`/api/avatars/<id>`), which every list route also serves as `avatarUrl`.
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

// --- Chat background images (T-0464) ---------------------------------------
// Personal wallpapers for the chat background dialog. The client resizes and
// re-encodes before upload (`lib/background-image.ts`); the server validates
// by magic bytes (WebP/PNG, 64-2048 px, at most 1 MiB, at most 20 per user).
// The schemas live in `@zilar/api-contract` (`backgrounds.ts`, T-0895). The
// upload stays outside the derived client: it posts raw image bytes.
export type { BackgroundImage, BackgroundListItem };

// A raw-body upload with a mock branch, `apiErrorFromBody` on failure and an
// Effect Schema parse of the reply, shared with the avatar and sticker
// uploads through `uploadBytes`.
export function uploadBackground(blob: Blob): Promise<BackgroundImage> {
  return uploadBytes('POST', '/backgrounds', blob, BackgroundImageSchema);
}

export function listBackgrounds(): Promise<BackgroundListItem[]> {
  return callApi((client) => client.backgrounds.list()).then((body) => [...body.backgrounds]);
}

export async function deleteBackground(id: string): Promise<void> {
  await callApi((client) => client.backgrounds.remove({ params: { id } }));
}
