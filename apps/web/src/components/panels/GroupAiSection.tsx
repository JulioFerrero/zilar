import { Effect } from 'effect';
import { Brain } from 'lucide-react';
import { useState } from 'react';
import type { GroupAi, PublicAi } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AiBadge } from '../AiBadge';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';
import { GroupAiRowView } from './GroupAiRowView';
import { addAiText, removeAiText, storeStep } from './groupPanelOps';
import type { PanelFailure } from './groupPanelOps';

/**
 * The group's AIs (T-0055): the rows, the memory action and the manager add
 * picker. The panel owns the picker snapshot and the memory dialog.
 */
export function GroupAiSection({
  ais,
  chatId,
  ownerNameOf,
  canRemove,
  isManager,
  eligibleAis,
  pickerChoices,
  onOpenPicker,
  onClosePicker,
  onOpenMemory,
  onError,
}: {
  ais: GroupAi[];
  chatId: string;
  ownerNameOf: (ai: GroupAi) => string;
  canRemove: (ai: GroupAi) => boolean;
  isManager: boolean;
  eligibleAis: PublicAi[];
  pickerChoices: PublicAi[] | undefined;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onOpenMemory: (ai: { id: string; name: string }) => void;
  onError: (message: string) => void;
}) {
  return (
    <section aria-label="AIs" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs</h2>
      {ais.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">No AIs in this group yet.</p>
      )}
      {ais.map((ai) => (
        <GroupAiRow
          key={ai.aiId}
          ai={ai}
          chatId={chatId}
          ownerName={ownerNameOf(ai)}
          canRemove={canRemove(ai)}
          onOpenMemory={() => onOpenMemory({ id: ai.aiId, name: ai.name })}
          onError={onError}
        />
      ))}

      {isManager && (eligibleAis.length > 0 || pickerChoices !== undefined) && (
        <div className="mt-1 flex flex-col gap-2 px-2">
          {pickerChoices !== undefined ? (
            <div className="flex flex-col gap-1">
              {pickerChoices.map((ai) => (
                <AddAiOption
                  key={ai.id}
                  ai={ai}
                  chatId={chatId}
                  onAdded={onClosePicker}
                  onError={onError}
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={onClosePicker}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              className="self-start rounded-full px-4"
              onClick={onOpenPicker}
            >
              Add my AI
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One AI in the group, with its own Remove action so two AIs can be removed
 * at once; a second click on the same row waits for the first.
 */
function GroupAiRow({
  ai,
  chatId,
  ownerName,
  canRemove,
  onOpenMemory,
  onError,
}: {
  ai: GroupAi;
  chatId: string;
  ownerName: string;
  canRemove: boolean;
  onOpenMemory: () => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [confirming, setConfirming] = useState(false);
  const [state, removeAi] = useAction<void, void, PanelFailure>(() =>
    storeStep(() => storeApi.getState().removeGroupAi(chatId, ai.aiId), removeAiText).pipe(
      Effect.asVoid,
      Effect.tap(() => Effect.sync(() => setConfirming(false))),
      Effect.tapError((failure) => Effect.sync(() => onError(failure.message))),
    ),
  );
  const busy = isWaiting(state);
  const startRemove = (): void => {
    if (busy) {
      return;
    }
    onError('');
    removeAi();
  };

  return (
    <GroupAiRowView
      ai={ai}
      addedBy={ownerName}
      extra={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`What ${ai.name} remembers`}
          className="shrink-0 text-muted-foreground"
          onClick={onOpenMemory}
        >
          <Brain className="size-4" aria-hidden="true" />
        </Button>
      }
      canRemove={canRemove}
      confirming={confirming}
      busy={busy}
      removeLabel={`Remove ${ai.name} from the group`}
      onAskRemove={() => setConfirming(true)}
      onConfirmRemove={startRemove}
      onCancel={() => setConfirming(false)}
    />
  );
}

/**
 * One of my AIs in the add picker, with its own add action so two options
 * can run at once; a second click on the same option waits for the first.
 */
function AddAiOption({
  ai,
  chatId,
  onAdded,
  onError,
}: {
  ai: PublicAi;
  chatId: string;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [state, addAi] = useAction<void, void, PanelFailure>(() =>
    storeStep(() => storeApi.getState().addGroupAi(chatId, ai.id), addAiText).pipe(
      Effect.asVoid,
      Effect.tap(() => Effect.sync(onAdded)),
      Effect.tapError((failure) => Effect.sync(() => onError(failure.message))),
    ),
  );
  const busy = isWaiting(state);
  const startAdd = (): void => {
    if (busy) {
      return;
    }
    onError('');
    addAi();
  };

  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={startAdd}
      className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
    >
      <Avatar id={ai.jid} name={ai.name} size={28} ai avatarUrl={ai.avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{ai.name}</span>
      <AiBadge />
      {busy && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}
