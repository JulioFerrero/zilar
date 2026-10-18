// Owner only: an unknown task and one the caller may not see answer the same 404.
import { runApi, type TaskSteps } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

export type { TaskSteps };

export interface AgentTasksApi {
  /** One task's card steps with their actions, oldest step first. */
  getTaskSteps(taskId: string): Promise<TaskSteps>;
}

export function createAgentTasksApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AgentTasksApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    getTaskSteps: (taskId) => runApi(client.agentTasks.steps({ params: { taskId } })),
  };
}
