// Owner only: an unknown task and one the caller may not see answer the same 404, which
// rejects with ApiError.
import type { TaskSteps } from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

export type { TaskSteps };

export function getTaskSteps(taskId: string): Promise<TaskSteps> {
  return callApi((client) => client.agentTasks.steps({ params: { taskId } }));
}
