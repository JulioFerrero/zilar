// Voice-transcription routes (T-0170): the enabled flag and the on-demand
// transcript, using the shared response shapes from `@zilar/api-contract`. The
// mock has an endpoint configured, so the control shows and one tap resolves to
// a fixed sentence per URL. The real routes live on the server
// (`apps/server/src/voice-transcription/api.ts`), group `voiceTranscription`.

import type { EnabledStatus, TranscriptResult } from '@zilar/api-contract';
import { errorResponse, jsonResponse, readJsonBody, type MockHttpRequest } from '../../http/shared';
import type { MockData } from '../../state';

export function handleVoiceTranscription(
  data: MockData,
  request: MockHttpRequest,
): Response | undefined {
  const [head, first] = request.segments;
  if (head !== 'voice' || request.segments.length !== 2) {
    return undefined;
  }
  if (first === 'transcription' && request.method === 'GET') {
    const status: EnabledStatus = { enabled: data.integrations.voiceConfigured };
    return jsonResponse(status);
  }
  if (first === 'transcript' && request.method === 'POST') {
    const body = readJsonBody(request.init);
    const url = typeof body.url === 'string' ? body.url : '';
    if (url === '') {
      return errorResponse('invalid_request', 'url must not be empty');
    }
    const result: TranscriptResult = { text: `Transcript of ${url}` };
    return jsonResponse(result);
  }
  return undefined;
}
