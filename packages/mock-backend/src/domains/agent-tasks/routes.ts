// `GET /agents/tasks/:taskId/events` (T-1426): the scripted session log for
// the mock "Writing release notes" card, and `…/steps` (T-1535): the card's
// steps with their actions for the "Reviewing the open PRs" card. An unknown
// task id answers the same 404 the server does.
import type { MockData } from '../../state';
import { jsonResponse, notFound, type MockHttpRequest } from '../../http/shared';
import { mockTaskEvents } from './events';
import { mockTaskSteps } from './steps';

function firstQuery(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function handleAgentTasks(_data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'agents' || request.segments[1] !== 'tasks') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  const taskId = decodeURIComponent(request.segments[2] ?? '');
  const resource = request.segments[3];
  if (resource === 'events') {
    const after = firstQuery(request.query.get('after')) ?? 0;
    const limit = Math.min(100, Math.max(1, firstQuery(request.query.get('limit')) ?? 50));
    const page = mockTaskEvents(taskId, after, limit);
    if (page === null) {
      return notFound('Task not found');
    }
    return jsonResponse(page);
  }
  if (resource === 'steps') {
    const steps = mockTaskSteps(taskId);
    if (steps === null) {
      return notFound('Task not found');
    }
    return jsonResponse(steps);
  }
  return undefined;
}
