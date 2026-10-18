// Routine routes (T-0941): list by AI, group or topic, the caller's own list
// (T-1976), pause, resume and delete, mirroring web's mock. Pausing an active
// routine sets `pausedReason: 'user'`; resuming a `needs_approval` routine
// answers 409 `needs_approval`, like the server.

import type { MockData } from '../../state';
import type { MockRoutine } from './seed';
import { errorResponse, jsonResponse, noContent, type MockHttpRequest } from '../../http/shared';

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
  if (
    head === 'topics' &&
    second === 'routines' &&
    request.method === 'GET' &&
    first !== undefined
  ) {
    return jsonResponse(
      data.routines
        .filter((routine) => !routine.deleted && routine.topicId === first)
        .map((row) => routineRow(data, row)),
    );
  }
  if (head === 'routines' && first === undefined) {
    return request.method === 'GET' ? jsonResponse(myRoutineRows(data)) : undefined;
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

// `GET /routines` (T-1976): every non-deleted routine of the caller's AIs. The
// mock has one user, so every AI in the table is theirs. Running first, then by
// title, the order the real server sends and the page groups by.
function myRoutineRows(data: MockData): Record<string, unknown>[] {
  const rows: {
    id: string;
    title: string;
    status: MockRoutine['status'];
    row: Record<string, unknown>;
  }[] = [];
  for (const routine of data.routines) {
    if (routine.deleted) {
      continue;
    }
    const ai = data.findAi(routine.aiId);
    if (ai === undefined) {
      continue;
    }
    const chat = routineChat(data, routine, ai.jid);
    if (chat === undefined) {
      continue;
    }
    rows.push({
      id: routine.id,
      title: routine.title,
      status: routine.status,
      row: {
        ...routineRow(data, routine),
        aiName: ai.name,
        aiAvatarUrl: ai.avatarUrl,
        chatName: chat.name,
        chatJid: chat.jid,
      },
    });
  }
  rows.sort(
    (a, b) =>
      routineRank(a.status) - routineRank(b.status) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  return rows.map((entry) => entry.row);
}

// The chat a routine runs in: a personal one is the AI's own DM, with no topic
// name; a group one is its topic's room, named by the topic, or by the group
// when the topic is its General. A topic the mock cannot resolve is skipped.
function routineChat(
  data: MockData,
  routine: MockRoutine,
  aiJid: string,
): { name: string | null; jid: string } | undefined {
  if (routine.topicId === null) {
    return { name: null, jid: aiJid };
  }
  const topic = data.findTopic(routine.topicId);
  if (topic === undefined) {
    return undefined;
  }
  const name = topic.isGeneral ? (data.findGroup(topic.groupId)?.title ?? topic.name) : topic.name;
  return { name, jid: topic.chatJid };
}

function routineRank(status: MockRoutine['status']): number {
  return status === 'active' ? 0 : 1;
}
