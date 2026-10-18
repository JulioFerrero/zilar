import type { ToolDetail, ToolListItem, ToolRun } from '../../lib/tools-api';

/** A run's status line, e.g. `ok · v3 · manual · 120 ms · <date>`. */
export function runStatusText(run: ToolRun): string {
  const at = new Date(run.createdAt);
  const label = run.status === 'ok' ? 'ok' : `error (${run.errorKind ?? 'failed'})`;
  return `${label} · v${run.version} · ${run.trigger} · ${run.durationMs} ms · ${at.toLocaleString()}`;
}

/** Missing `approvedHosts` reads as none approved, like web. */
export function waitingHosts(tool: ToolListItem | ToolDetail): string[] {
  const approved = tool.approvedHosts ?? [];
  return tool.hosts.filter((host) => !approved.includes(host));
}

export interface NumberedLine {
  n: number;
  text: string;
}

/** An empty source reads as no lines; a trailing newline does not add one. */
export function numberedLines(source: string): NumberedLine[] {
  if (source === '') return [];
  const lines = source.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map((text, index) => ({ n: index + 1, text }));
}
