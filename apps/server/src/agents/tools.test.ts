import { describe, expect, it } from 'vitest';
import {
  ACTION_NAME_MAX_LENGTH,
  buildGroupTools,
  buildTools,
  formatPersonaUpdatedLine,
  MEMORY_TOOLS,
  MEMORY_ZOOM_TOOL,
  parseToolArguments,
  PERSONA_RESTORED_LINE,
  PERSONA_TOOLS,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  safeToolName,
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

  it('parses a valid request_action call', () => {
    const parsed = parseToolArguments(
      REQUEST_ACTION_TOOL,
      JSON.stringify({ action: 'demo.echo', args: { text: 'hi' } }),
    );
    expect(parsed).toEqual({
      ok: true,
      tool: REQUEST_ACTION_TOOL,
      action: 'demo.echo',
      args: { text: 'hi' },
    });
  });

  it('rejects request_action with unknown keys', () => {
    const parsed = parseToolArguments(
      REQUEST_ACTION_TOOL,
      JSON.stringify({ action: 'demo.echo', args: {}, model: 'gpt-9' }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects request_action with non-object args', () => {
    for (const bad of [[1, 2, 3], 'a string', 42, null]) {
      const parsed = parseToolArguments(
        REQUEST_ACTION_TOOL,
        JSON.stringify({ action: 'demo.echo', args: bad }),
      );
      expect(parsed.ok).toBe(false);
    }
  });

  it('rejects request_action with a malformed action name', () => {
    for (const name of ['noDot', 'Demo.echo', '1demo.echo', 'demo.', '.echo', '']) {
      const parsed = parseToolArguments(
        REQUEST_ACTION_TOOL,
        JSON.stringify({ action: name, args: {} }),
      );
      expect(parsed.ok).toBe(false);
    }
  });

  it('rejects request_action with an over-long action name', () => {
    const tooLong = `a.${'b'.repeat(ACTION_NAME_MAX_LENGTH)}`;
    expect(tooLong.length).toBeGreaterThan(ACTION_NAME_MAX_LENGTH);
    const parsed = parseToolArguments(
      REQUEST_ACTION_TOOL,
      JSON.stringify({ action: tooLong, args: {} }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('never echoes argument values in the rejection reason for request_action', () => {
    const secret = 'arg-secret-text-9876543210';
    const parsed = parseToolArguments(
      REQUEST_ACTION_TOOL,
      JSON.stringify({ action: 'noDot', args: { text: secret } }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).not.toContain(secret);
    }
  });

  it('still rejects invalid JSON for request_action', () => {
    const parsed = parseToolArguments(REQUEST_ACTION_TOOL, '{not json');
    expect(parsed).toEqual({ ok: false, reason: 'arguments are not valid JSON' });
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

  it('parses valid recall, memory_zoom and remember calls', () => {
    expect(parseToolArguments(RECALL_TOOL, JSON.stringify({ query: 'launch friday' }))).toEqual({
      ok: true,
      tool: RECALL_TOOL,
      query: 'launch friday',
    });
    expect(parseToolArguments(MEMORY_ZOOM_TOOL, JSON.stringify({ block: '64-79' }))).toEqual({
      ok: true,
      tool: MEMORY_ZOOM_TOOL,
      block: '64-79',
    });
    expect(
      parseToolArguments(REMEMBER_TOOL, JSON.stringify({ text: '  The launch is Friday. ' })),
    ).toEqual({
      ok: true,
      tool: REMEMBER_TOOL,
      text: 'The launch is Friday.',
    });
  });

  it('rejects an empty recall query', () => {
    const parsed = parseToolArguments(RECALL_TOOL, JSON.stringify({ query: '   ' }));
    expect(parsed.ok).toBe(false);
  });

  it('rejects a recall query over 100 characters', () => {
    const parsed = parseToolArguments(RECALL_TOOL, JSON.stringify({ query: 'x'.repeat(101) }));
    expect(parsed.ok).toBe(false);
  });

  it('rejects a malformed memory_zoom block', () => {
    for (const block of ['a-b', '64', '64-', '-79', '64_79']) {
      const parsed = parseToolArguments(MEMORY_ZOOM_TOOL, JSON.stringify({ block }));
      expect(parsed.ok).toBe(false);
    }
  });

  it('rejects a remember text over 280 characters', () => {
    const parsed = parseToolArguments(REMEMBER_TOOL, JSON.stringify({ text: 'x'.repeat(281) }));
    expect(parsed.ok).toBe(false);
  });

  it('rejects extra keys on every memory tool', () => {
    expect(parseToolArguments(RECALL_TOOL, JSON.stringify({ query: 'x', chat: 'other' })).ok).toBe(
      false,
    );
    expect(
      parseToolArguments(MEMORY_ZOOM_TOOL, JSON.stringify({ block: '1-2', ai: 'other' })).ok,
    ).toBe(false);
    expect(
      parseToolArguments(REMEMBER_TOOL, JSON.stringify({ text: 'x', chatKey: 'other' })).ok,
    ).toBe(false);
  });
});

describe('safeToolName', () => {
  it('caps a 10k-char name at 64 chars and strips control characters', () => {
    expect(safeToolName(`ab\x00cd\nef\x7f${'x'.repeat(10_000)}`)).toBe(`abcdef${'x'.repeat(58)}`);
    expect(safeToolName('update_persona')).toBe('update_persona');
  });

  it('caps the echoed unknown-tool reason', () => {
    const parsed = parseToolArguments('y'.repeat(10_000), '{}');
    expect(parsed).toEqual({ ok: false, reason: `unknown tool: ${'y'.repeat(64)}` });
  });
});

describe('PERSONA_TOOLS', () => {
  it('exposes exactly the two persona tools', () => {
    expect(PERSONA_TOOLS.map((tool) => tool.function.name).sort()).toEqual(
      [REVERT_PERSONA_TOOL, UPDATE_PERSONA_TOOL].sort(),
    );
  });
});

describe('MEMORY_TOOLS', () => {
  it('exposes exactly recall, memory_zoom and remember', () => {
    expect(MEMORY_TOOLS.map((tool) => tool.function.name)).toEqual([
      RECALL_TOOL,
      MEMORY_ZOOM_TOOL,
      REMEMBER_TOOL,
    ]);
  });

  it('carries the exact descriptions the spec fixes', () => {
    const byName = new Map(MEMORY_TOOLS.map((tool) => [tool.function.name, tool]));
    expect(byName.get(RECALL_TOOL)?.function.description).toBe(
      'Search everything said in this chat, including messages older than what you ' +
        "can see. Use it before saying you don't remember. `query` is a few words; " +
        'every word must appear. Returns the newest matches as `#seq date sender: text`.',
    );
    expect(byName.get(MEMORY_ZOOM_TOOL)?.function.description).toBe(
      'Open one block of your memory of this chat, like `64-79`, into its two ' +
        'halves (shorter summaries or the messages themselves).',
    );
    expect(byName.get(REMEMBER_TOOL)?.function.description).toBe(
      'Pin one short fact for this chat. Use it only when someone asks you to ' +
        'remember something, or for a lasting decision. One line, at most 280 ' +
        'characters. Never passwords, codes, keys or tokens.',
    );
  });
});

describe('buildTools', () => {
  it('returns the persona and memory tools when no action is registered', () => {
    expect(
      buildTools([])
        .map((tool) => tool.function.name)
        .sort(),
    ).toEqual(
      [
        REVERT_PERSONA_TOOL,
        UPDATE_PERSONA_TOOL,
        RECALL_TOOL,
        MEMORY_ZOOM_TOOL,
        REMEMBER_TOOL,
      ].sort(),
    );
  });

  it('adds request_action when at least one action is registered, listing its name and description', () => {
    const tools = buildTools([
      { name: 'demo.echo', description: 'Repeats a short text back.' },
      { name: 'another.tool', description: 'Does another thing.' },
    ]);
    const names = tools.map((tool) => tool.function.name);
    expect(names).toContain(REQUEST_ACTION_TOOL);
    expect(names).toContain(UPDATE_PERSONA_TOOL);
    expect(names).toContain(REVERT_PERSONA_TOOL);
    const requestAction = tools.find((tool) => tool.function.name === REQUEST_ACTION_TOOL);
    expect(requestAction?.function.description).toContain('demo.echo');
    expect(requestAction?.function.description).toContain('Repeats a short text back.');
    expect(requestAction?.function.description).toContain('another.tool');
    expect(requestAction?.function.description).toContain('Does another thing.');
  });

  it('lists the actions in the order they are passed in (gateway sorts before calling)', () => {
    const tools = buildTools([
      { name: 'alpha.first', description: 'a' },
      { name: 'zeta.last', description: 'z' },
    ]);
    const requestAction = tools.find((tool) => tool.function.name === REQUEST_ACTION_TOOL);
    expect(requestAction?.function.description.indexOf('alpha.first')).toBeLessThan(
      requestAction?.function.description.indexOf('zeta.last') ?? Number.MAX_SAFE_INTEGER,
    );
  });
});

describe('buildGroupTools', () => {
  it('always returns the three memory tools, with no action registered', () => {
    expect(buildGroupTools([]).map((tool) => tool.function.name)).toEqual([
      RECALL_TOOL,
      MEMORY_ZOOM_TOOL,
      REMEMBER_TOOL,
    ]);
  });

  it('adds request_action on top of the memory tools when at least one action is registered', () => {
    const tools = buildGroupTools([
      { name: 'demo.echo', description: 'Repeats a short text back.' },
    ]);
    const names = tools.map((tool) => tool.function.name);
    expect(names).toEqual([RECALL_TOOL, MEMORY_ZOOM_TOOL, REMEMBER_TOOL, REQUEST_ACTION_TOOL]);
    // Persona tools must never appear in a group turn.
    expect(names).not.toContain(UPDATE_PERSONA_TOOL);
    expect(names).not.toContain(REVERT_PERSONA_TOOL);
  });

  it('lists every registered action name and description in the request_action tool', () => {
    const tools = buildGroupTools([
      { name: 'demo.echo', description: 'Repeats a short text back.' },
      { name: 'another.tool', description: 'Does another thing.' },
    ]);
    const requestAction = tools.find((tool) => tool.function.name === REQUEST_ACTION_TOOL);
    expect(requestAction?.function.description).toContain('demo.echo');
    expect(requestAction?.function.description).toContain('Repeats a short text back.');
    expect(requestAction?.function.description).toContain('another.tool');
    expect(requestAction?.function.description).toContain('Does another thing.');
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
