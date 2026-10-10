// Pure live-step helpers for `lead watch`, moved unchanged from `lead/watch.ts`
// (size split).

import path from 'node:path';

// The newest message of the session decides the step. Messages come back
// newest-first from `session.message.list`. We read defensively: any shape
// we don't understand falls through to the next branch and never breaks
// the loop.
export function liveStep(messages: unknown[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const newest = messages[0];
  if (!isRecord(newest)) {
    return null;
  }
  if (newest['type'] === 'idle') {
    return null;
  }
  const content = newest['content'];
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }
  const last = content[content.length - 1];
  if (!isRecord(last)) {
    return null;
  }
  const type = last['type'];
  if (type === 'reasoning') {
    return 'thinking';
  }
  if (type === 'text') {
    return 'writing a reply';
  }
  if (type === 'tool') {
    return stepFromTool(last);
  }
  return null;
}

function stepFromTool(tool: Record<string, unknown>): string | null {
  const name = tool['name'];
  const state = isRecord(tool['state']) ? tool['state'] : {};
  const input = isRecord(state['input']) ? (state['input'] as Record<string, unknown>) : {};
  if (name === 'edit' || name === 'write') {
    const filePath = input['path'];
    if (typeof filePath === 'string') {
      return `editing ${path.basename(filePath)}`;
    }
    // The step is read while the tool call is still arriving and its
    // `input.path` is not there yet: never show `<unknown>`.
    return 'editing…';
  }
  if (name === 'read') {
    const filePath = input['path'];
    if (typeof filePath === 'string') {
      return `reading ${path.basename(filePath)}`;
    }
    return 'reading…';
  }
  if (name === 'shell') {
    const command = input['command'];
    if (typeof command !== 'string') {
      return 'running a shell command';
    }
    if (command.includes('pnpm gate')) {
      return 'running the gate';
    }
    if (/\btest\b/.test(command)) {
      return 'running tests';
    }
    if (/^\s*git\s+commit\b/.test(command)) {
      return 'committing';
    }
    return `running ${command.slice(0, 30)}`;
  }
  if (typeof name === 'string') {
    return `using ${name}`;
  }
  return null;
}

// The plan's dedup (`lead/is-record.ts`) is skipped because it crosses files;
// this file keeps the one definition and exports it for `speed.ts`.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
