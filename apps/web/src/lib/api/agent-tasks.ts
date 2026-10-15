// T-1535: the "View steps" read. The route lives in
// `packages/api-contract/src/agent-tasks.ts` (T-1530) and is owner only: an
// unknown task and one the caller may not see answer the same 404, which
// rejects with `ApiError`.
import type { TaskSteps } from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

export type { TaskSteps };

/** One task's card steps with their actions, oldest step first. */
export function getTaskSteps(taskId: string): Promise<TaskSteps> {
  return callApi((client) => client.agentTasks.steps({ params: { taskId } }));
}
