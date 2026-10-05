/**
 * Pinned Whistle model download: the only network host this spike touches is
 * `huggingface.co`, for this one URL.
 */
export const WHISTLE_MODEL_URL =
  'https://huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact';
export const WHISTLE_MODEL_SHA256 =
  'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb';
/** 16 919 407 bytes, so a short download is rejected before hashing. */
export const WHISTLE_MODEL_BYTES = 16919407;
export const WHISTLE_MODEL_FILENAME = 'whistle.cact';

/** The seven languages Whistle transcribes, plus null for auto-detect. */
export const WHISTLE_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl'] as const;
export type WhistleLanguage = (typeof WHISTLE_LANGUAGES)[number];

export function normalizeWhistleLanguage(language: string | null | undefined): string | null {
  if (language === null || language === undefined || language === '') {
    return null;
  }
  const lowered = language.toLowerCase();
  return (WHISTLE_LANGUAGES as readonly string[]).includes(lowered) ? lowered : null;
}
