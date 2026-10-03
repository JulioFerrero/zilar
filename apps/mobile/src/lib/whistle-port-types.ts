/**
 * The `WhistleTranscript` type without importing the native module (T-0177):
 * the dev screen renders this shape, and the port plus the wrapper resolve
 * the real module type only through `import('zilar-whistle')`.
 */
export interface WhistleTranscript {
  text: string;
  language: string;
  ttftMs: number;
  decodeTps: number;
  audioMs: number;
  wallMs: number;
}
