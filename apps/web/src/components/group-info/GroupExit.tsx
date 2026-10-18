import { Effect } from 'effect';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteGroup } from '@/lib/api/groups';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { ConfirmDialog } from '../ConfirmDialog';
import { FieldError } from '../ais/AiPageShell';
import { PanelFailure, apiStep, messageOf } from '../panels/groupPanelOps';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { ListRow } from '../ui/list-row';
import { TextInput } from '../ui/text-input';

export function LeaveGroupRow({
  chatId,
  title,
  onClose,
}: {
  chatId: string;
  title: string;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const [state, runLeave] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change,
  );
  const busy = isWaiting(state);
  const error = messageOf(state);

  const leaveGroup = (): void => {
    setConfirming(false);
    runLeave(
      apiStep(() => storeApi.getState().leaveChannel(chatId), 'Could not leave the group.').pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            onClose();
            navigate('/');
          }),
        ),
      ),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ListRow
          icon={<LogOut className="size-4" aria-hidden="true" />}
          title="Leave group"
          danger
          onClick={() => {
            if (!busy) {
              setConfirming(true);
            }
          }}
        />
      </div>
      {error !== undefined && <FieldError>{error}</FieldError>}
      {confirming && (
        <ConfirmDialog
          title={`Leave ${title}?`}
          body="You will stop receiving messages from this group. You can be added back later."
          confirmLabel="Leave"
          onCancel={() => setConfirming(false)}
          onConfirm={leaveGroup}
        />
      )}
    </div>
  );
}

export function DeleteGroupDialog({
  groupId,
  title,
  open,
  onClose,
  onDeleted,
  noun = 'group',
}: {
  groupId: string | undefined;
  title: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  noun?: 'group' | 'channel';
}) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const [state, runDelete] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change,
  );
  const busy = isWaiting(state);
  const error = messageOf(state);

  const dismiss = (): void => {
    if (busy) {
      return;
    }
    setName('');
    onClose();
  };

  const deleteGroupNow = (): void => {
    if (groupId === undefined) {
      return;
    }
    runDelete(
      apiStep(() => deleteGroup(groupId), `Could not delete the ${noun}.`).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            storeApi.getState().refreshChats();
            onDeleted();
            navigate('/');
          }),
        ),
      ),
    );
  };

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title={`Delete ${noun}`}
      ariaLabel={`Delete ${noun}`}
      size="sm"
      busy={busy}
      error={error}
      actions={
        <>
          <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={dismiss}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            disabled={busy || name.trim() !== title}
            onClick={deleteGroupNow}
          >
            Delete {noun}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted-foreground">
        Delete {title} for everyone? All topics and messages go away. This can&apos;t be undone.
      </p>
      <TextInput
        className="mt-3"
        aria-label={`Type the ${noun} name to confirm`}
        placeholder={title}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    </Dialog>
  );
}
