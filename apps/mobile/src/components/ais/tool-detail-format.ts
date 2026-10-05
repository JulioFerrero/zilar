import type { ToolDetail, ToolListItem, ToolRun } from '../../lib/tools-api';

/**
 * A tool run's status line, e.g. `ok · v3 · manual · 120 ms · <date>` or
 * `error (timeout) · v2 · routine · 5000 ms · <date>`, like web
 * `runStatusText` in `ToolDetailPanel.tsx`.
 */
export function runStatusText(run: ToolRun): string {
  const at = new Date(run.createdAt);
  const label = run.status === 'ok' ? 'ok' : `error (${run.errorKind ?? 'failed'})`;
  return `${label} · v${run.version} · ${run.trigger} · ${run.durationMs} ms · ${at.toLocaleString()}`;
}

/**
 * The hosts a tool declares that nobody approved yet. Missing
 * `approvedHosts` reads as none approved, like web.
 */
export function waitingHosts(tool: ToolListItem | ToolDetail): string[] {
  const approved = tool.approvedHosts ?? [];
  return tool.hosts.filter((host) => !approved.includes(host));
}

export interface NumberedLine {
  n: number;
  text: string;
}

/**
 * Source split into numbered lines, for the read-only source block. An
 * empty source reads as no lines; a trailing newline does not add one.
 */
export function numberedLines(source: string): NumberedLine[] {
  if (source === '') return [];
  const lines = source.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map((text, index) => ({ n: index + 1, text }));
}
