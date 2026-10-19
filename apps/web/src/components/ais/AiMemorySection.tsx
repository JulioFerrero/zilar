import { Brain, Trash2 } from 'lucide-react';
import { aiMemoryApi } from '@/lib/api';
import { LINE_PREFIX, MEMORY_LOAD_FAILED_MESSAGE, useAiMemory } from '@zilar/client-core';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { ConfirmDialog } from '@/components/ConfirmDialog';

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
  const { state, actions } = useAiMemory(aiMemoryApi, chat, aiId, initiallyOpen);
  const { open, status, memory, forgetError, forgettingId, clearError, confirmingClear } = state;

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
            onClick={actions.onHide}
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
            onClick={actions.onShow}
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
          title={MEMORY_LOAD_FAILED_MESSAGE}
          action={{
            label: 'Retry',
            onClick: actions.onRetry,
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
                        onClick={() => actions.onForget(fact.id)}
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
                onClick={actions.onAskClear}
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
          onConfirm={actions.onConfirmClear}
          onCancel={actions.onCancelClear}
        />
      )}
    </section>
  );
}
