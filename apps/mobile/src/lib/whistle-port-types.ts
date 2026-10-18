/**
 * Kept free of the native module: the port resolves the real type only through `import('zilar-whistle')`.
 */
export interface WhistleTranscript {
  text: string;
  language: string;
  ttftMs: number;
  decodeTps: number;
  audioMs: number;
  wallMs: number;
}
