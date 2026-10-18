import { Result, Schema } from 'effect';
import type { ChangedFile } from './changed-files.js';
import type { SessionSpeed } from './speed.js';

export interface WatchEntry {
  id: string;
  title: string;
  modelLabel: string;
  model: string;
  effort: string | undefined;
  totalAge: string;
  autoFixRounds: number;
  phaseId: string;
  phaseLabel: string;
  needsLead: boolean;
  running: boolean;
  step: string | null;
  files: ChangedFile[];
  speed: SessionSpeed | null;
}

export interface WatchView {
  clock: string;
  refreshFailed: boolean;
  mergedToday: number;
  entries: WatchEntry[];
}

// Parses the one JSON line of the `--data` child; junk of any kind returns `null` so
// the watcher keeps the previous view.
const FileSchema = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['created', 'modified', 'deleted']),
});

const SpeedSchema = Schema.Struct({
  tokPerSec: Schema.Number,
  secPerStep: Schema.Number,
  context: Schema.Number,
  spark: Schema.mutable(Schema.Array(Schema.Number)),
});

const EntrySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  modelLabel: Schema.String,
  model: Schema.String,
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  totalAge: Schema.String,
  autoFixRounds: Schema.Number,
  phaseId: Schema.String,
  phaseLabel: Schema.String,
  needsLead: Schema.Boolean,
  running: Schema.Boolean,
  step: Schema.NullOr(Schema.String),
  files: Schema.mutable(Schema.Array(FileSchema)),
  speed: Schema.optional(Schema.NullOr(SpeedSchema)),
});

const ViewSchema = Schema.Struct({
  clock: Schema.String,
  refreshFailed: Schema.Boolean,
  mergedToday: Schema.Number,
  entries: Schema.mutable(Schema.Array(EntrySchema)),
});

export function parseWatchView(line: string): WatchView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = Schema.decodeUnknownResult(ViewSchema)(parsed);
  if (Result.isFailure(result)) {
    return null;
  }
  return {
    ...result.success,
    entries: result.success.entries.map((entry) => ({
      ...entry,
      effort: entry.effort ?? undefined,
      speed: entry.speed ?? null,
    })),
  };
}

// Phase ids that mean the worker is still busy. `waiting-lead`, `blocked`, `idle` and
// `quota` are steady states.
export function isRunningPhase(phaseId: string): boolean {
  return (
    phaseId === 'coding' ||
    phaseId === 'fixing' ||
    phaseId === 'prereview' ||
    phaseId === 'starting-prereview'
  );
}

// While the pre-review runs the worker is silent, so use the pre-review's messages.
export function chooseSessionId(
  phaseId: string,
  workerSessionId: string,
  prereviewSessionId: string | undefined,
): string {
  if (
    (phaseId === 'prereview' || phaseId === 'starting-prereview') &&
    prereviewSessionId !== undefined
  ) {
    return prereviewSessionId;
  }
  return workerSessionId;
}
