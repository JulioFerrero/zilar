export type PhaseId =
  | 'coding'
  | 'fixing'
  | 'starting-prereview'
  | 'prereview'
  | 'waiting-lead'
  | 'blocked'
  | 'idle'
  | 'quota';

export interface PhaseInput {
  taskStatus: string;
  sessionState: string;
  quotaError: boolean;
  autoFixRounds: number;
  prereviewForHead: boolean;
  prereviewSessionState: string;
  prereviewFilePresent: boolean;
  packetReady: boolean;
}

export interface Phase {
  id: PhaseId;
  label: string;
  needsLead: boolean;
}

export function derivePhase(input: PhaseInput): Phase {
  if (input.taskStatus === 'blocked') {
    return { id: 'blocked', label: 'Blocked, needs a decision', needsLead: true };
  }
  if (input.quotaError) {
    return { id: 'quota', label: 'Waiting for model quota', needsLead: false };
  }
  if (input.taskStatus === 'review') {
    if (input.sessionState === 'running') {
      const label =
        input.autoFixRounds > 0
          ? `Fixing review findings (auto round ${input.autoFixRounds})`
          : 'Fixing review findings';
      return { id: 'fixing', label, needsLead: false };
    }
    if (!input.prereviewForHead) {
      return { id: 'starting-prereview', label: 'Starting the pre-review', needsLead: false };
    }
    if (input.prereviewSessionState === 'running') {
      return { id: 'prereview', label: 'Pre-review running', needsLead: false };
    }
    if (input.packetReady && input.prereviewFilePresent) {
      return { id: 'waiting-lead', label: 'Packet ready, waiting for the lead', needsLead: true };
    }
    return { id: 'prereview', label: 'Pre-review finishing', needsLead: false };
  }
  if (input.sessionState === 'running') {
    return { id: 'coding', label: 'Coding', needsLead: false };
  }
  return { id: 'idle', label: 'Idle, not in review (stalled?)', needsLead: true };
}

// "4 min", "1 h 20 min", "2 d 3 h": the dashboard's age strings.
export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) {
    return 'under 1 min';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

export interface SnapshotTask {
  id: string;
  title: string;
  model: string;
  phase: Phase;
  phaseSince: string;
  phaseAge: string;
  startedAt: string;
  totalAge: string;
  lastActivity: string;
  lastActivityAge: string;
  commits: number;
  autoFixRounds: number;
  lastEscalation: string;
}

export interface MergedToday {
  id: string;
  time: string;
  summary: string;
}

export interface QueuedTask {
  id: string;
  title: string;
  status: string;
}

export interface Snapshot {
  generatedAt: string;
  active: SnapshotTask[];
  queued: QueuedTask[];
  mergedToday: MergedToday[];
}

export function sortActive(tasks: SnapshotTask[]): SnapshotTask[] {
  const rank = (task: SnapshotTask): number => (task.phase.needsLead ? 0 : 1);
  return [...tasks].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}
