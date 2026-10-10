import { PERSONA_SUMMARY_MAX_LENGTH, REMEMBERED_FACT_MAX_LENGTH } from './schemas';

// One line the gateway appends to the AI's text reply after a successful
// `update_persona`, so the owner sees what happened without relying on the
// model to say it.
export function formatPersonaUpdatedLine(summary: string): string {
  const clean = sanitizeSummary(summary);
  return `\n\n✏️ Persona updated: ${clean === '' ? 'updated' : clean}. Say "undo" to revert.`;
}

export const PERSONA_RESTORED_LINE = '\n\n↩️ Persona restored.';

// One plain line the gateway appends to the AI's text reply after a successful
// `remember`, so everyone in the chat sees which fact was pinned. No emoji.
export function formatRememberedLine(text: string): string {
  return `\n\nRemembered: ${sanitizeLine(text, REMEMBERED_FACT_MAX_LENGTH)}`;
}

// The summary rides into the DM text, so it stays one short line: newlines
// and control characters become spaces, runs collapse, and it caps at 200.
export function sanitizeSummary(summary: string): string {
  return sanitizeLine(summary, PERSONA_SUMMARY_MAX_LENGTH);
}

// Shared by the persona and memory reply lines: control characters become
// spaces, whitespace runs collapse, and the result caps at `maxLength`.
function sanitizeLine(text: string, maxLength: number): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
