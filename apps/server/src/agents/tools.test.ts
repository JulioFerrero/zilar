import { describe, expect, it } from 'vitest';
import {
  formatPersonaUpdatedLine,
  parseToolArguments,
  PERSONA_RESTORED_LINE,
  PERSONA_TOOLS,
  REVERT_PERSONA_TOOL,
  sanitizeSummary,
  UPDATE_PERSONA_TOOL,
} from './tools';

describe('parseToolArguments', () => {
  it('parses valid update_persona arguments', () => {
    const parsed = parseToolArguments(
      UPDATE_PERSONA_TOOL,
      JSON.stringify({ persona: 'Answer in Spanish.', summary: 'Spanish answers' }),
    );
    expect(parsed).toEqual({
      ok: true,
      tool: UPDATE_PERSONA_TOOL,
      persona: 'Answer in Spanish.',
      summary: 'Spanish answers',
    });
  });

  it('parses valid revert_persona arguments', () => {
    expect(parseToolArguments(REVERT_PERSONA_TOOL, '{}')).toEqual({
      ok: true,
      tool: REVERT_PERSONA_TOOL,
    });
  });

  it('rejects an empty persona', () => {
    const parsed = parseToolArguments(
      UPDATE_PERSONA_TOOL,
      JSON.stringify({ persona: '   ', summary: 'something' }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects a persona over 4000 characters', () => {
    const parsed = parseToolArguments(
      UPDATE_PERSONA_TOOL,
      JSON.stringify({ persona: 'x'.repeat(4001), summary: 'too long' }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects a missing summary', () => {
    const parsed = parseToolArguments(
      UPDATE_PERSONA_TOOL,
      JSON.stringify({ persona: 'Answer in Spanish.' }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects non-JSON arguments', () => {
    const parsed = parseToolArguments(UPDATE_PERSONA_TOOL, '{not json');
    expect(parsed).toEqual({ ok: false, reason: 'arguments are not valid JSON' });
  });

  it('rejects extra keys', () => {
    const parsed = parseToolArguments(
      UPDATE_PERSONA_TOOL,
      JSON.stringify({ persona: 'Answer in Spanish.', summary: 'x', model: 'gpt-9' }),
    );
    expect(parsed.ok).toBe(false);
    const revert = parseToolArguments(REVERT_PERSONA_TOOL, JSON.stringify({ force: true }));
    expect(revert.ok).toBe(false);
  });

  it('rejects unknown tools without executing anything', () => {
    const parsed = parseToolArguments('delete_everything', '{}');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain('unknown tool');
    }
  });

  it('never echoes argument values in the rejection reason', () => {
    const secret = 'persona-text-that-must-never-leak-0123456789';
    const parsed = parseToolArguments(
      UPDATE_PERSONA_TOOL,
      JSON.stringify({ persona: secret, summary: 'x'.repeat(500) }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).not.toContain(secret);
    }
  });
});

describe('PERSONA_TOOLS', () => {
  it('exposes exactly the two persona tools', () => {
    expect(PERSONA_TOOLS.map((tool) => tool.function.name).sort()).toEqual(
      [REVERT_PERSONA_TOOL, UPDATE_PERSONA_TOOL].sort(),
    );
  });
});

describe('sanitizeSummary', () => {
  it('strips newlines and control characters and caps at 200', () => {
    expect(sanitizeSummary('short\nanswers\x00please')).toBe('short answers please');
    expect(sanitizeSummary(`  spaced\t\tout  `)).toBe('spaced out');
    expect(sanitizeSummary('x'.repeat(500))).toHaveLength(200);
  });
});

describe('persona reply lines', () => {
  it('formats the exact updated line', () => {
    expect(formatPersonaUpdatedLine('Spanish answers')).toBe(
      '\n\n✏️ Persona updated: Spanish answers. Say "undo" to revert.',
    );
  });

  it('sanitizes the summary inside the updated line', () => {
    expect(formatPersonaUpdatedLine('a\nb')).toBe(
      '\n\n✏️ Persona updated: a b. Say "undo" to revert.',
    );
  });

  it('holds the exact restored line', () => {
    expect(PERSONA_RESTORED_LINE).toBe('\n\n↩️ Persona restored.');
  });
});
