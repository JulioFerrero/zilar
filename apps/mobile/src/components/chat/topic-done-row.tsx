import { CheckCircle2, RotateCcw } from 'lucide-react-native';

import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { ICON } from '@/lib/colors';
import type { PatchTopicInput } from '@/lib/topics-api';

type TopicDoneRowProps = {
  /** The topic's done time (T-1521); null while the topic is open. */
  doneAt: string | null;
  /** The chat screen's topic patch; a failure lands in the sheet's error line. */
  patch: (input: PatchTopicInput) => void;
  onError: (message: string) => void;
};

/**
 * Mark the topic done or reopen it (T-1540): any member who can see the topic
 * may flip it, so the row is not gated. "Mark as done" shows a check, "Reopen"
 * a counter-clockwise arrow.
 */
export function TopicDoneRow({ doneAt, patch, onError }: TopicDoneRowProps) {
  const done = doneAt !== null;
  return (
    <ListRow
      icon={
        <IconTile>
          {done ? <RotateCcw size={16} color={ICON} /> : <CheckCircle2 size={16} color={ICON} />}
        </IconTile>
      }
      title={done ? 'Reopen' : 'Mark as done'}
      chevron={false}
      accessibilityLabel={done ? 'Reopen topic' : 'Mark topic as done'}
      onPress={() => {
        onError('');
        patch({ done: !done });
      }}
    />
  );
}
