import { defineDomain } from '../domain';
import { handleTopics } from './routes';
import { seedTopics } from './seed';
import { createTopicsState } from './state';

export const topicsDomain = defineDomain({
  name: 'topics',
  seed: seedTopics,
  createState: createTopicsState,
  routes: handleTopics,
});
