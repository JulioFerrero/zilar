import type { PublicRoutine } from './service';

export function toListWire(routine: PublicRoutine) {
  return {
    id: routine.id,
    aiId: routine.aiId,
    groupId: routine.groupId,
    topicId: routine.topicId,
    toolId: routine.toolId,
    toolName: routine.toolName,
    title: routine.title,
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt.toISOString(),
    lastRunAt: routine.lastRunAt === null ? null : routine.lastRunAt.toISOString(),
    lastStatus: routine.lastStatus,
    approvedHosts: [...routine.approvedHosts],
    scope: routine.scope,
  };
}

export function toDetailWire(
  routine: {
    id: string;
    title: string;
    schedule: unknown;
    status: 'active' | 'paused' | 'needs_approval';
    pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
    nextRunAt: Date;
    lastRunAt: Date | null;
    lastStatus: 'ok' | 'error' | 'skipped' | null;
    approvedHosts: string[];
    groupId: string | null;
  },
  toolName: string,
) {
  return {
    id: routine.id,
    title: routine.title,
    toolName,
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt.toISOString(),
    lastRunAt: routine.lastRunAt === null ? null : routine.lastRunAt.toISOString(),
    lastStatus: routine.lastStatus,
    approvedHosts: [...routine.approvedHosts],
    scope: routine.groupId === null ? ('personal' as const) : ('group' as const),
  };
}
