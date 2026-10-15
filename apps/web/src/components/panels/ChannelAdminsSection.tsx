import { Effect } from 'effect';
import type { GroupAi } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { GroupAiRowView } from './GroupAiRowView';
import { type ChannelFailure, describeFailure, storeCall } from './channelPanelOps';

/**
 * One channel AI row with its own Remove action, so two AIs can be removed at
 * once; a second click on the same row waits for the first.
 */
export function GroupAiRow({
  chatId,
  ai,
  addedBy,
  canRemove,
  confirming,
  onConfirm,
  onError,
}: {
  chatId: string;
  ai: GroupAi;
  addedBy: string;
  canRemove: boolean;
  confirming: boolean;
  onConfirm: (aiId: string | undefined) => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [removeState, removeAi] = useAction<void, void, ChannelFailure>(() =>
    Effect.sync(() => onError('')).pipe(
      Effect.andThen(
        storeCall(
          () => storeApi.getState().removeGroupAi(chatId, ai.aiId),
          'Could not remove the AI',
        ),
      ),
      Effect.tap(() => Effect.sync(() => onConfirm(undefined))),
      Effect.asVoid,
      Effect.tapError((failure) =>
        Effect.sync(() => onError(describeFailure(failure, 'Could not remove the AI'))),
      ),
    ),
  );
  const removing = isWaiting(removeState);

  return (
    <GroupAiRowView
      ai={ai}
      addedBy={addedBy}
      canRemove={canRemove}
      confirming={confirming}
      busy={removing}
      removeLabel={`Remove ${ai.name} from the channel`}
      onAskRemove={() => onConfirm(ai.aiId)}
      onConfirmRemove={() => removeAi()}
      onCancel={() => onConfirm(undefined)}
    />
  );
}
