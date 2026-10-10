import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockTool } from './seed';

function cloneTool(tool: MockTool): MockTool {
  return {
    ...tool,
    approvedHosts: [...tool.approvedHosts],
    versions: tool.versions.map((version) => ({ ...version, hosts: [...version.hosts] })),
  };
}

/**
 * The tools and runs tables plus the sequences that mint new version and run
 * ids. Rows are cloned from the seed, so a caller-supplied seed is never
 * changed; a revert or a run mutates the live table and its sequence.
 */
export function createToolsState(seed: MockSeed): Partial<MockData> {
  return {
    tools: seed.tools.map(cloneTool),
    runs: seed.runs.map((run) => ({ ...run })),
    nextToolSequence: 100,
    nextRunSequence: 100,
  };
}
