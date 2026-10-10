// Routine routes (T-0941): list by AI or group, pause, resume and delete,
// mirroring web's mock. Pausing an active routine sets `pausedReason: 'user'`;
// resuming a `needs_approval` routine answers 409 `needs_approval`, like the
// server.

import type { MockData } from '../state';
import type { MockRoutine } from '../data/tools';
import { errorResponse, jsonResponse, noContent, type MockHttpRequest } from './shared';

export function handleRoutines(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head === 'ais' && second === 'routines' && request.method === 'GET' && first !== undefined) {
    return jsonResponse(
      data.routines
        .filter((routine) => !routine.deleted && routine.aiId === first)
        .map((row) => routineRow(data, row)),
    );
  }
  if (
    head === 'groups' &&
    second === 'routines' &&
    request.method === 'GET' &&
    first !== undefined
  ) {
    return jsonResponse(
      data.routines
        .filter((routine) => !routine.deleted && routine.groupId === first)
        .map((row) => routineRow(data, row)),
    );
  }
  if (head !== 'routines' || first === undefined) {
    return undefined;
  }
  const routineId = decodeURIComponent(first);
  if (second === undefined && request.method === 'DELETE') {
    const raw = data.routines.find((routine) => routine.id === routineId);
    if (raw === undefined) {
      return errorResponse('not_found', 'Routine not found', 404);
    }
    raw.deleted = true;
    return noContent();
  }
  if (second !== 'pause' && second !== 'resume') {
    return undefined;
  }
  const routine = data.routines.find((item) => item.id === routineId && !item.deleted);
  if (routine === undefined) {
    return errorResponse('not_found', 'Routine not found', 404);
  }
  if (request.method !== 'POST') {
    return undefined;
  }
  if (second === 'pause') {
    if (routine.status === 'active') {
      routine.status = 'paused';
      routine.pausedReason = 'user';
    }
    return jsonResponse(routineRow(data, routine));
  }
  if (routine.status === 'needs_approval') {
    return errorResponse('needs_approval', 'The routine needs re-approval', 409);
  }
  if (routine.status === 'paused') {
    routine.status = 'active';
    routine.pausedReason = null;
  }
  return jsonResponse(routineRow(data, routine));
}

function routineRow(data: MockData, routine: MockRoutine): Record<string, unknown> {
  const tool = data.tools.find((item) => item.id === routine.toolId);
  return {
    id: routine.id,
    aiId: routine.aiId,
    groupId: routine.groupId,
    topicId: routine.topicId,
    toolId: routine.toolId,
    title: routine.title,
    toolName: tool?.name ?? '',
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt,
    lastRunAt: routine.lastRunAt,
    lastStatus: routine.lastStatus,
    approvedHosts: routine.approvedHosts,
    scope: routine.groupId === null ? 'personal' : 'group',
  };
}
