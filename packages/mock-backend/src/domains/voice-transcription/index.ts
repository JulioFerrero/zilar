import { defineDomain } from '../domain';
import { handleVoiceTranscription } from './routes';

/** Stateless: the mock has an endpoint configured and mints a fixed transcript. */
export const voiceTranscriptionDomain = defineDomain({
  name: 'voice-transcription',
  routes: handleVoiceTranscription,
});
