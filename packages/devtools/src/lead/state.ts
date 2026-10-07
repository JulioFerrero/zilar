import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Result, Schema } from 'effect';
import {
  schemaIssues,
  stateFileSchema,
  type DoctorRecord,
  type StateFile,
  type TaskRecord,
} from './types.js';

// The state file lives outside the repo so worktree removals and rebases can
// never touch it. It holds session ids and bookkeeping only: no secrets.
export function stateFilePath(): string {
  const override = process.env['ZILAR_LEAD_STATE'];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.zilar-lead', 'state.json');
}

export function logFilePath(statePath: string): string {
  return path.join(path.dirname(statePath), 'lead.log');
}

export function emptyState(): StateFile {
  return { version: 1, tasks: {}, doctor: undefined };
}

export function loadState(statePath: string): StateFile {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch {
    return emptyState();
  }
  const parsed: unknown = JSON.parse(raw);
  const validated = Schema.decodeUnknownResult(stateFileSchema)(parsed);
  if (Result.isFailure(validated)) {
    const [first] = schemaIssues(validated.failure);
    throw new Error(`invalid state file at ${statePath}: ${first?.message ?? 'unknown'}`);
  }
  const data = validated.success;
  const tasks: Record<string, TaskRecord> = {};
  for (const [key, value] of Object.entries(data.tasks)) {
    const entry: TaskRecord = {
      task: value.task,
      sessionId: value.sessionId,
      worktree: value.worktree,
      model: value.model,
      role: value.role,
      startedAt: value.startedAt,
      switchedAt: value.switchedAt,
      nudgesSent: value.nudgesSent,
      lastQuotaRetryAt: value.lastQuotaRetryAt,
      lastQuotaEscalatedAt: value.lastQuotaEscalatedAt,
      prereview: value.prereview,
      packetReadyForHead: value.packetReadyForHead,
      prereviewStalledEscalated: value.prereviewStalledEscalated,
      autoFixRounds: value.autoFixRounds,
      escalatedPermissionIds: value.escalatedPermissionIds,
      escalatedQuestionIds: value.escalatedQuestionIds,
      stalledEscalated: value.stalledEscalated,
      blockedEscalatedText: value.blockedEscalatedText,
      lastEscalation: value.lastEscalation,
    };
    tasks[key] = entry;
  }
  const doctor: DoctorRecord | undefined =
    data.doctor === undefined
      ? undefined
      : {
          sessionId: data.doctor.sessionId,
          head: data.doctor.head,
          since: data.doctor.since,
          startedAt: data.doctor.startedAt,
          reportedForHead: data.doctor.reportedForHead,
          stalledReportedForHead: data.doctor.stalledReportedForHead,
          model: data.doctor.model,
        };
  return { version: 1, tasks, doctor };
}

export function saveState(statePath: string, state: StateFile): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const staging = `${statePath}.tmp.${process.pid}`;
  fs.writeFileSync(staging, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(staging, statePath);
}

// Loads the file fresh, applies `mutate`, and saves atomically, so the read
// happens right before the write and concurrent writers lose nothing.
export function updateState(statePath: string, mutate: (state: StateFile) => void): StateFile {
  const state = loadState(statePath);
  mutate(state);
  saveState(statePath, state);
  return state;
}

export function appendLog(statePath: string, line: string): void {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.appendFileSync(logFilePath(statePath), stamped);
}
