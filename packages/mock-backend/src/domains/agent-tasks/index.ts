import { defineDomain } from '../domain';
import { handleAgentTasks } from './routes';

export const agentTasksDomain = defineDomain({
  name: 'agent-tasks',
  routes: handleAgentTasks,
});
