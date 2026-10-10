// Integrations routes (T-1078): the owner's Telegram bot, sign-in email sender
// and voice-transcription endpoint, on the shared backend. The contract routes
// are `GET /settings/integrations`,
// `PUT`/`DELETE /settings/integrations/telegram` and
// `PUT /settings/integrations/email`; the voice-transcription settings route
// is not in the contract yet (`apps/server/src/voice-transcription/`).
//
// Secrets are write-only, exactly like the server: a save records only
// "configured" and the non-secret fields (the email `from`, the voice base URL
// and model). The bot token, the Resend key and the transcription key are
// never stored and never echoed back.

import type { MockData } from '../../state';
import { badRequest, jsonResponse, readJsonBody, type MockHttpRequest } from '../../http/shared';

const BOT_TOKEN_MAX = 256;
const EMAIL_FROM_MAX = 320;
const DEFAULT_VOICE_MODEL = 'whisper-1';

export function handleIntegrations(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head !== 'settings' || first !== 'integrations') {
    return undefined;
  }
  if (second === undefined) {
    return request.method === 'GET' ? jsonResponse(data.integrationsStatus()) : undefined;
  }
  if (second === 'telegram') {
    if (request.method === 'PUT') {
      return setTelegram(data, request);
    }
    if (request.method === 'DELETE') {
      data.removeIntegrationsTelegram();
      return jsonResponse({ ok: true });
    }
    return undefined;
  }
  if (second === 'email') {
    return request.method === 'PUT' ? setEmail(data, request) : undefined;
  }
  if (second === 'voice-transcription') {
    if (request.method === 'PUT') {
      return setVoice(data, request);
    }
    if (request.method === 'DELETE') {
      data.removeIntegrationsVoice();
      return jsonResponse({ ok: true });
    }
    return undefined;
  }
  return undefined;
}

function setTelegram(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
  if (botToken === '' || botToken.length > BOT_TOKEN_MAX || /\s/.test(botToken)) {
    return badRequest('invalid_request', 'botToken must be a non-empty token without spaces');
  }
  data.saveIntegrationsTelegram();
  return jsonResponse({ ok: true });
}

function setEmail(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  // `resendApiKey` is accepted and dropped: a secret is write-only.
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  if (from === '' || from.length > EMAIL_FROM_MAX) {
    return badRequest('invalid_request', 'from must be a valid sender address');
  }
  data.saveIntegrationsEmail(from);
  return jsonResponse({ ok: true });
}

function setVoice(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  // `apiKey` is accepted and dropped: a secret is write-only.
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  if (baseUrl === '') {
    return badRequest('invalid_request', 'baseUrl must not be empty');
  }
  const model =
    typeof body.model === 'string' && body.model.trim() !== ''
      ? body.model.trim()
      : DEFAULT_VOICE_MODEL;
  data.saveIntegrationsVoice(baseUrl, model);
  return jsonResponse({ ok: true });
}
