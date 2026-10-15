import { describe, expect, it } from 'vitest';
import type { ServerDatabase } from '../db/client';
import { buildToolAdapters } from '../tools/adapters';
import type { ToolRunner } from '../tools/types';
import { buildWebToolsAdapters } from '../web-tools/adapters';
import { buildRegistry, decodeActionArgs, type ActionAdapter } from './registry';

// The web, tool and routine adapters as production registers them. The
// database and the runner are placeholders: the test reads only
// `argsSchema` and `argsExample`, and never calls `execute`.
function registeredAdapters(): ActionAdapter<unknown>[] {
  const db = null as unknown as ServerDatabase;
  const runner = null as unknown as ToolRunner;
  return [
    ...buildWebToolsAdapters(),
    ...buildToolAdapters({ db, runner, post: async () => false }),
  ];
}

const adapters = registeredAdapters();
const required = adapters.filter((adapter) => /^(web|tool|routine)\./.test(adapter.name));

describe('action args examples', () => {
  it('registers the web, tool and routine adapters', () => {
    const names = adapters.map((adapter) => adapter.name);
    expect(names).toContain('web.price');
    expect(names).toContain('web.wikipedia');
    expect(names).toContain('tool.save');
    expect(names).toContain('routine.schedule');
  });

  it('every web, tool and routine adapter ships an args example', () => {
    const missing = required
      .filter((adapter) => adapter.argsExample === undefined)
      .map((adapter) => adapter.name);
    expect(missing).toEqual([]);
  });

  for (const adapter of required) {
    const example = adapter.argsExample as string;
    it(`${adapter.name}: argsExample decodes with argsSchema`, () => {
      expect(example.length).toBeLessThanOrEqual(200);
      const parsed: unknown = JSON.parse(example);
      const decoded = decodeActionArgs(adapter.argsSchema, parsed);
      expect(decoded.ok, `${adapter.name} argsExample does not decode`).toBe(true);
    });
  }

  it('builds a valid registry from every adapter with an example', () => {
    expect(() => buildRegistry(adapters)).not.toThrow();
  });
});
