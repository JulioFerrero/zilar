import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ChatSummary } from '@galena/chat-core';
import { X } from 'lucide-react';
import { deleteAi, listAis, updateAi, type PublicAi } from '@/lib/api';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Button, FieldError } from './AiPageShell';
import { describeAiError } from './errors';
import { LimitsFields } from './LimitsFields';
import { validateLimits } from './limits';
import { buildPatch } from './aiForm';

type PanelStatus = 'loading' | 'ready' | 'missing' | 'error';

/**
 * The AI side panel of an AI DM: it finds the AI by the chat's jid and edits its
 * name, persona and limits, plus Delete. It slides in from the right, matching
 * the app's other sheets.
 */
export function AiPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();

  const [status, setStatus] = useState<PanelStatus>('loading');
  const [ai, setAi] = useState<PublicAi | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let active = true;
    listAis()
      .then((list) => {
        if (!active) {
          return;
        }
        const found = list.find((item) => item.jid === chat.id) ?? null;
        if (found === null) {
          setStatus('missing');
          return;
        }
        setAi(found);
        setName(found.name);
        setPersona(found.persona);
        setDay(String(found.limits.perDayUsd));
        setMonth(String(found.limits.perMonthUsd));
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setErrorMessage(describeAiError(error, 'Could not load the AI').message);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [chat.id]);

  const limits = validateLimits(day, month);
  const patch =
    ai === null
      ? null
      : buildPatch({
          name,
          originalName: ai.name,
          persona,
          originalPersona: ai.persona,
          limits: limits.limits,
          originalLimits: ai.limits,
        });
  const canSave =
    ai !== null && name.trim() !== '' && limits.limits !== null && patch !== null && !busy;

  const markEdited = (): void => {
    setSaved(false);
    setSaveError('');
  };

  const save = async (): Promise<void> => {
    if (ai === null || patch === null || !canSave) {
      return;
    }
    setBusy(true);
    setSaveError('');
    try {
      const updated = await updateAi(ai.id, patch);
      setAi(updated);
      setName(updated.name);
      setPersona(updated.persona);
      setDay(String(updated.limits.perDayUsd));
      setMonth(String(updated.limits.perMonthUsd));
      setSaved(true);
      storeApi.setState((state) => ({
        chats: state.chats.map((chatItem) =>
          chatItem.id === chat.id ? { ...chatItem, title: updated.name } : chatItem,
        ),
      }));
    } catch (error) {
      setSaveError(describeAiError(error, 'Could not update the AI').message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (ai === null) {
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAi(ai.id);
      storeApi.setState((state) => ({
        chats: state.chats.filter((chatItem) => chatItem.id !== chat.id),
      }));
      onClose();
      navigate('/');
    } catch (error) {
      setDeleteError(describeAiError(error, 'Could not delete the AI').message);
      setDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${chat.title} AI settings`}
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col bg-background shadow-xl sm:w-[380px]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <Avatar id={ai?.id ?? chat.id} name={ai?.name ?? chat.title} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[16px] font-semibold">{ai?.name ?? chat.title}</span>
              <AiBadge />
            </div>
            <p className="text-[13px] text-muted-foreground">AI settings</p>
          </div>
          <button
            type="button"
            aria-label="Close AI panel"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}

          {status === 'missing' && (
            <p className="text-[15px] text-muted-foreground">This AI no longer exists.</p>
          )}

          {status === 'error' && (
            <p role="alert" className="text-[15px] text-danger">
              {errorMessage}
            </p>
          )}

          {status === 'ready' && ai !== null && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Name</span>
                <input
                  aria-label="Name"
                  value={name}
                  maxLength={64}
                  onChange={(event) => {
                    setName(event.target.value);
                    markEdited();
                  }}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Persona</span>
                <textarea
                  aria-label="Persona"
                  rows={10}
                  maxLength={4000}
                  value={persona}
                  onChange={(event) => {
                    setPersona(event.target.value);
                    markEdited();
                  }}
                  placeholder="Describe how this AI should behave…"
                  className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Model</span>
                <p className="rounded-lg border border-divider bg-muted px-3 py-2 text-[15px]">
                  {ai.model}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  The model is set when the AI is created and can&apos;t be changed here yet.
                </p>
              </div>

              <LimitsFields
                day={day}
                month={month}
                dayError={limits.dayError}
                monthError={limits.monthError}
                onDayChange={(value) => {
                  setDay(value);
                  markEdited();
                }}
                onMonthChange={(value) => {
                  setMonth(value);
                  markEdited();
                }}
              />

              {saveError !== '' && <FieldError>{saveError}</FieldError>}
              {saved && (
                <p role="status" className="text-[13px] text-online">
                  Saved
                </p>
              )}

              <div className="mt-1 flex flex-col gap-2 border-t border-divider pt-4">
                {confirmingDelete ? (
                  <>
                    <p className="text-[14px] text-danger">
                      Delete {ai.name}? This removes the AI and its chat. Your provider connection
                      stays.
                    </p>
                    {deleteError !== '' && <FieldError>{deleteError}</FieldError>}
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="lg"
                        className="rounded-full px-4"
                        disabled={deleting}
                        onClick={() => void confirmDelete()}
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
          )}
        </div>

        {status === 'ready' && ai !== null && (
          <footer className="shrink-0 border-t border-divider p-4">
            <Button
              type="button"
              size="lg"
              className="rounded-full px-5"
              disabled={!canSave}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
