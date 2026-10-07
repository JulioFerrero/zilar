import { useEffect, useState } from 'react';
import { Brain, Trash2 } from 'lucide-react';
import { ApiError, clearAiMemory, forgetAiMemoryFact, getAiMemory, type AiMemory } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// The cover lines carry a leading block reference (`#16` or `#0-15`) that is
// only meaningful to the server; the section strips it before showing a line.
const LINE_PREFIX = /^#\d+(?:-\d+)? /;

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * T-0443: the AI's memory in this DM. It stays collapsed, and makes no
 * request, until the owner opens it; then it lists the pinned facts and the
 * cover lines, and lets the owner forget a fact or clear the whole memory.
 *
 * T-0447: `initiallyOpen` mounts it already expanded, for the rooms dialog;
 * then it loads at once and shows neither the Show nor the Hide button.
 */
export function AiMemorySection({
  chat,
  aiId,
  aiName,
  initiallyOpen = false,
}: {
  chat: string;
  aiId: string;
  aiName: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [memory, setMemory] = useState<AiMemory | null>(null);
  const [forgetError, setForgetError] = useState('');
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [clearError, setClearError] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    getAiMemory(chat, aiId)
      .then((loaded) => {
        if (!active) {
          return;
        }
        setMemory(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [open, chat, aiId, reloadTick]);

  // The loading state is set from the event that starts a load (open, retry
  // or the reload after a clear), not synchronously inside the effect.
  const startLoad = (): void => {
    setStatus('loading');
    setForgetError('');
    setClearError('');
    setReloadTick((tick) => tick + 1);
  };

  const forget = async (factId: string): Promise<void> => {
    // Ignore further clicks while a forget is in flight: the row's button is
    // disabled while it is the one being forgotten, and this guard stops a
    // second request for any fact.
    if (forgettingId !== null) {
      return;
    }
    setForgetError('');
    setForgettingId(factId);
    try {
      await forgetAiMemoryFact(chat, aiId, factId);
    } catch (error) {
      // A 404 means the fact is already gone, so the outcome the owner asked
      // for holds; drop the row instead of showing a false error.
      if (!(error instanceof ApiError && error.status === 404)) {
        setForgetError('Could not forget that fact');
        setForgettingId(null);
        return;
      }
    }
    setMemory((current) =>
      current === null
        ? current
        : { ...current, facts: current.facts.filter((fact) => fact.id !== factId) },
    );
    setForgettingId(null);
  };

  const confirmClear = async (): Promise<void> => {
    setConfirmingClear(false);
    setClearError('');
    try {
      await clearAiMemory(chat, aiId);
      startLoad();
    } catch {
      setClearError('Could not clear the memory');
    }
  };

  return (
    <section aria-label="Memory" className="flex flex-col gap-2 border-t border-divider pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-medium">Memory</h3>
        {open && !initiallyOpen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full text-muted-foreground"
            onClick={() => setOpen(false)}
          >
            Hide memory
          </Button>
        )}
      </div>

      {!open && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[13px] text-muted-foreground">
            What {aiName} remembers from this chat. It reads this before replying.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="rounded-full px-4"
            onClick={() => {
              setOpen(true);
              startLoad();
            }}
          >
            <Brain className="size-4" aria-hidden="true" />
            Show memory
          </Button>
        </div>
      )}

      {open && status === 'loading' && (
        <StateMessage kind="loading" size="inline" title="Loading the memory…" />
      )}

      {open && status === 'error' && (
        <StateMessage
          kind="error"
          title="Could not load the memory"
          action={{
            label: 'Retry',
            onClick: startLoad,
          }}
        />
      )}

      {open && status === 'ready' && memory !== null && (
        <>
          <div className="flex flex-col gap-2">
            <h4 className="text-[13px] font-medium text-muted-foreground">Pinned facts</h4>
            {forgetError !== '' && (
              <p role="alert" className="text-[13px] text-danger">
                {forgetError}
              </p>
            )}
            {memory.facts.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing pinned yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {memory.facts.map((fact) => (
                  <li key={fact.id} className="flex items-start justify-between gap-2 text-[13px]">
                    <span className="break-words whitespace-pre-wrap">{fact.text}</span>
                    {memory.canChange && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Forget this fact"
                        className="rounded-full text-muted-foreground"
                        disabled={forgettingId === fact.id}
                        onClick={() => void forget(fact.id)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-[13px] font-medium text-muted-foreground">Earlier in this chat</h4>
            {memory.lines.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing older than the recent messages yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {memory.lines.map((line, index) => (
                  <li
                    key={index}
                    className="break-words whitespace-pre-wrap text-[13px] text-muted-foreground"
                  >
                    {line.replace(LINE_PREFIX, '')}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {memory.canChange && (
            <div className="flex flex-col items-start gap-2">
              {clearError !== '' && (
                <p role="alert" className="text-[13px] text-danger">
                  {clearError}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="rounded-full border-danger/40 px-4 text-danger hover:bg-danger/10"
                onClick={() => {
                  setClearError('');
                  setConfirmingClear(true);
                }}
              >
                Clear memory
              </Button>
            </div>
          )}
        </>
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="Clear memory?"
          body={`${aiName} forgets the pinned facts and the summaries of this chat. The messages stay, and it still reads the recent ones.`}
          confirmLabel="Clear"
          onConfirm={() => void confirmClear()}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </section>
  );
}
