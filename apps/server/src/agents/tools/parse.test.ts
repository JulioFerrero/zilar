import { describe, expect, it } from 'vitest';
import { parseToolArguments, stripTaskTitle } from './parse';

// T-1745: the optional `task_title` names the work card only. It must be
// dropped before the strict decode, so no tool ever sees it.
describe('task_title', () => {
  it('is stripped before the strict decode and never reaches a tool', () => {
    expect(
      parseToolArguments('bash', '{"command":"echo hi","task_title":"Check the prices"}'),
    ).toEqual({ ok: true, tool: 'bash', args: { command: 'echo hi' } });
    expect(stripTaskTitle('{"command":"echo hi","task_title":"Check the prices"}')).toBe(
      '{"command":"echo hi"}',
    );
  });
});
