import type { Auth } from '../auth/auth';
import type { VoiceEngine } from './engine';

/** Hard cap on the uploaded recording, enforced while reading the body. */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Recordings shorter than a blink or longer than five minutes are rejected. */
export const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;

export interface VoiceRoutesDependencies {
  auth: Auth;
  /** Defaults to the real ffmpeg engine; tests inject a fake. */
  engine?: VoiceEngine;
  maxBytes?: number;
}
