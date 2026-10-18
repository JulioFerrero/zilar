import { TopicNotInRow } from '../Composer';

const noop = (): void => {};

export default {
  Idle: <TopicNotInRow name="Deepseek" topicTitle="Financial" state="idle" onAdd={noop} />,
  Busy: <TopicNotInRow name="Deepseek" topicTitle="Financial" state="busy" onAdd={noop} />,
  Failed: <TopicNotInRow name="Deepseek" topicTitle="Financial" state="failed" onAdd={noop} />,
};
