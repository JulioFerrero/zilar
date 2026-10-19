import { useState, type Dispatch, type SetStateAction } from 'react';
import { Effect } from 'effect';
import { useNavigate } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
import { deleteAi, resumeAi, stopAi, type PublicAi } from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';
import { Button } from '@/components/ui/button';
import { FieldError } from './AiPageShell';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { writeAi } from './aiPanelOps';
import { isWaiting } from '@zilar/client-core';

export function AiDangerZone({
  ai,
  setAi,
  chat,
  onClose,
}: {
  ai: PublicAi;
  setAi: Dispatch<SetStateAction<PublicAi | null>>;
  chat: ChatSummary;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [stopError, setStopError] = useState('');
  const [resumeError, setResumeError] = useState('');

  const [deleteState, runDelete] = useAction<void, void, never>(() => {
    const target = ai;
    return writeAi({
      clearError: () => setDeleteError(''),
      setError: setDeleteError,
      failedText: 'Could not delete the AI',
      call: () => deleteAi(target.id),
      onSuccess: () => {
        storeApi.setState((state) => ({
          chats: state.chats.filter((chatItem) => chatItem.id !== chat.id),
        }));
        onClose();
        navigate('/');
      },
    });
  });
  const deleting = isWaiting(deleteState);

  const [stopState, runStop] = useAction<void, void, never>(() => {
    const target = ai;
    return writeAi({
      clearError: () => setStopError(''),
      setError: setStopError,
      failedText: 'Could not stop the AI',
      call: () => stopAi(target.id),
      onSuccess: (fresh) => setAi(fresh),
      refetch: { id: target.id, apply: setAi },
    }).pipe(Effect.ensuring(Effect.sync(() => setConfirmingStop(false))));
  });
  const stopping = isWaiting(stopState);

  const [resumeState, runResume] = useAction<void, void, never>(() => {
    const target = ai;
    return writeAi({
      clearError: () => setResumeError(''),
      setError: setResumeError,
      failedText: 'Could not resume the AI',
      call: () => resumeAi(target.id),
      onSuccess: (fresh) => setAi(fresh),
      refetch: { id: target.id, apply: setAi },
    });
  });
  const resuming = isWaiting(resumeState);

  return (
    <>
      {/* The error renders above the buttons, not inside the confirm branch, so it
       * survives the confirm step resetting on a failed call.
       */}
      <div className="mt-1 flex flex-col gap-2 border-t border-divider pt-4">
        {ai.status === 'active' && stopError !== '' && <FieldError>{stopError}</FieldError>}
        {ai.status === 'active' &&
          (confirmingStop ? (
            <>
              <p className="text-[14px] text-danger">
                Stop {ai.name}? It goes offline at once and any reply in flight is dropped. Resume
                to bring it back.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  className="rounded-full px-4"
                  disabled={stopping}
                  onClick={() => runStop()}
                >
                  {stopping ? 'Stopping…' : 'Stop AI'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="rounded-full px-4"
                  disabled={stopping}
                  onClick={() => {
                    setConfirmingStop(false);
                    setStopError('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="self-start rounded-full px-4"
              onClick={() => {
                setConfirmingStop(true);
                setStopError('');
              }}
            >
              Stop AI
            </Button>
          ))}
        {ai.status === 'stopped' && (
          <>
            {resumeError !== '' && <FieldError>{resumeError}</FieldError>}
            <Button
              type="button"
              size="lg"
              className="self-start rounded-full px-4"
              disabled={resuming}
              onClick={() => runResume()}
            >
              {resuming ? 'Resuming…' : 'Resume'}
            </Button>
          </>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-2 border-t border-divider pt-4">
        {confirmingDelete ? (
          <>
            <p className="text-[14px] text-danger">
              Delete {ai.name}? This removes the AI and its chat. Your provider connection stays.
            </p>
            {deleteError !== '' && <FieldError>{deleteError}</FieldError>}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="rounded-full px-4"
                disabled={deleting}
                onClick={() => runDelete()}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="rounded-full px-4"
                disabled={deleting}
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError('');
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={() => {
              setConfirmingDelete(true);
              setDeleteError('');
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </>
  );
}
