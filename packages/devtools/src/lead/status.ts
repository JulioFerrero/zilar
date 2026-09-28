import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { summarizeSession } from './session.js';
import { loadState } from './state.js';
import { findTaskFile } from './launch.js';
import { parseFrontMatter } from './task-file.js';

export interface StatusRow {
  task: string;
  role: string;
  model: string;
  session: string;
  taskStatus: string;
  lastEscalation: string;
}

export interface StatusDeps {
  client: OpenCodeClient;
  statePath: string;
}

function taskStatusOf(worktree: string, task: string): string {
  try {
    const file = findTaskFile(worktree, task);
    const fields = parseFrontMatter(fs.readFileSync(path.join(worktree, 'work', file), 'utf8'));
    return fields['status'] ?? '(no status)';
  } catch {
    return '(missing)';
  }
}

export async function collectStatus(deps: StatusDeps): Promise<StatusRow[]> {
  const state = loadState(deps.statePath);
  const rows: StatusRow[] = [];
  const tasks = Object.keys(state.tasks).sort();
  for (const task of tasks) {
    const record = state.tasks[task];
    if (record === undefined) {
      continue;
    }
    let session = 'unknown';
    try {
      const summary = summarizeSession(await deps.client.listMessages(record.sessionId, 2));
      session =
        summary.state === 'idle'
          ? `idle${summary.outcome === undefined ? '' : `/${summary.outcome}`}`
          : summary.state;
    } catch {
      session = '(api error)';
    }
    rows.push({
      task,
      role: record.role,
      model: record.model,
      session,
      taskStatus: taskStatusOf(record.worktree, task),
      lastEscalation: record.lastEscalation ?? '—',
    });
  }
  return rows;
}

export function formatStatus(rows: StatusRow[]): string {
  const widths = {
    task: 8,
    role: 8,
    model: 5,
    session: 7,
    status: 11,
  };
  for (const row of rows) {
    widths.task = Math.max(widths.task, row.task.length);
    widths.role = Math.max(widths.role, row.role.length);
    widths.model = Math.max(widths.model, row.model.length);
    widths.session = Math.max(widths.session, row.session.length);
    widths.status = Math.max(widths.status, row.taskStatus.length);
  }
  const lines = [
    `${'TASK'.padEnd(widths.task)}  ${'ROLE'.padEnd(widths.role)}  ${'MODEL'.padEnd(widths.model)}  ${'SESSION'.padEnd(widths.session)}  ${'TASK-STATUS'.padEnd(widths.status)}  LAST-ESCALATION`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.task.padEnd(widths.task)}  ${row.role.padEnd(widths.role)}  ${row.model.padEnd(widths.model)}  ${row.session.padEnd(widths.session)}  ${row.taskStatus.padEnd(widths.status)}  ${row.lastEscalation}`,
    );
  }
  return lines.join('\n');
}
