// T-1562: the phone's "View steps" read, the mobile twin of web's
// `apps/web/src/lib/api/agent-tasks.ts`. The route lives in
// `packages/api-contract/src/agent-tasks.ts` (T-1530) and is owner only: an
// unknown task and one the caller may not see answer the same 404, which
// rejects with `ApiError`.
import { runApi, type TaskSteps } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

export type { TaskSteps };

export interface AgentTasksApi {
  /** One task's card steps with their actions, oldest step first. */
  getTaskSteps(taskId: string): Promise<TaskSteps>;
}

/** The production `AgentTasksApi`: bearer auth, `fetch`, and the build-time API URL. */
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
