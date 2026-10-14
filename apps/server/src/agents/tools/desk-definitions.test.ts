import { describe, expect, it } from 'vitest';
import { buildGroupTools, buildTools, deskToolDefinitions, parseToolArguments } from '../tools';

// T-1409: the desk tools are advertised only when the turn says the AI has a
// cloud computer, and the parser refuses bad arguments before anything runs.
describe('desk tool definitions', () => {
  it('offers no desk tool when the desk is off', () => {
    const dm = buildTools([]).map((tool) => tool.function.name);
    const group = buildGroupTools([]).map((tool) => tool.function.name);
    for (const name of ['bash', 'read', 'write', 'edit', 'grep', 'glob', 'git']) {
      expect(dm).not.toContain(name);
      expect(group).not.toContain(name);
    }
  });

  it('offers all seven desk tools when the desk is on', () => {
    const expected = ['bash', 'read', 'write', 'edit', 'grep', 'glob', 'git'];
    expect(buildTools([], { desk: true }).map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(expected),
    );
    expect(
      buildGroupTools([], undefined, { desk: true }).map((tool) => tool.function.name),
    ).toEqual(expect.arrayContaining(expected));
    expect(deskToolDefinitions()).toHaveLength(7);
  });

  it('refuses bad desk arguments and accepts good ones', () => {
    expect(parseToolArguments('bash', '{}').ok).toBe(false);
    expect(parseToolArguments('bash', '{"command":123}').ok).toBe(false);
    expect(parseToolArguments('read', '{"path":"a","nope":1}').ok).toBe(false);
    expect(parseToolArguments('git', '{"args":"status"}').ok).toBe(false);
    expect(parseToolArguments('bash', '{"command":"echo hi"}')).toEqual({
      ok: true,
      tool: 'bash',
      args: { command: 'echo hi' },
    });
    expect(parseToolArguments('glob', '{"pattern":"*.ts"}')).toEqual({
      ok: true,
      tool: 'glob',
      args: { pattern: '*.ts' },
    });
  });
});
