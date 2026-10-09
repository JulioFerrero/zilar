import { useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Brain, Trash2 } from 'lucide-react';
import { clearAiMemory, forgetAiMemoryFact, getAiMemory, type AiMemory } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// The cover lines carry a leading block reference (`#16` or `#0-15`) that is
// only meaningful to the server; the section strips it before showing a line.
const LINE_PREFIX = /^#\d+(?:-\d+)? /;

type LoadStatus = 'loading' | 'ready' | 'error';

const isNotFound = (failure: ApiFailure): boolean => failure.status === 404;

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
  const [forgetError, setForgetError] = useState('');
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [clearError, setClearError] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Facts forgotten since the last read: they stay hidden until the next read.
  const [forgottenIds, setForgottenIds] = useState<ReadonlySet<string>>(() => new Set());

  // The memory is read only while the section is open. A closed section holds
  // the read back with Effect.never; opening it builds the real read.
  const [loaded, reload] = useQuery(
    (): Effect.Effect<AiMemory, ApiFailure> =>
      open ? fromApi(() => getAiMemory(chat, aiId)) : Effect.never,
    [open, chat, aiId],
  );
  const loadedMemory = AsyncResult.isSuccess(loaded) && !isWaiting(loaded) ? loaded.value : null;
  const loadFailure = isWaiting(loaded) ? undefined : failureOf(loaded);
  const status: LoadStatus =
    loadedMemory !== null ? 'ready' : loadFailure !== undefined ? 'error' : 'loading';
  const memory =
    loadedMemory === null
      ? null
      : {
          ...loadedMemory,
          facts: loadedMemory.facts.filter((fact) => !forgottenIds.has(fact.id)),
        };

  // Clears the local state of the last read: a retry, a show or the read after a clear.
  const resetLocal = (): void => {
    setForgottenIds(new Set());
    setForgetError('');
    setClearError('');
  };

  const startLoad = (): void => {
    resetLocal();
    reload();
  };

  // Ignore further clicks while a forget is in flight (mode 'ignore'), so one
  // request runs at a time. A 404 means the fact is already gone, so the
  // outcome the owner asked for holds: the row drops without a false error.
  const [, forget] = useAction((factId: string) =>
    Effect.sync(() => {
      setForgetError('');
      setForgettingId(factId);
    }).pipe(
      Effect.andThen(
        fromApi(() => forgetAiMemoryFact(chat, aiId, factId)).pipe(
          Effect.catchIf(isNotFound, () => Effect.void),
          Effect.tap(() => Effect.sync(() => setForgottenIds((ids) => new Set(ids).add(factId)))),
          Effect.tapError(() => Effect.sync(() => setForgetError('Could not forget that fact'))),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setForgettingId(null))),
    ),
  );

  const [, clear] = useAction<void, void, ApiFailure>(() =>
    Effect.sync(() => {
      setConfirmingClear(false);
      setClearError('');
    }).pipe(
      Effect.andThen(fromApi(() => clearAiMemory(chat, aiId))),
      Effect.tap(() => Effect.sync(() => startLoad())),
      Effect.tapError(() => Effect.sync(() => setClearError('Could not clear the memory'))),
    ),
  );

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
              resetLocal();
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
                        onClick={() => forget(fact.id)}
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
          onConfirm={() => clear()}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </section>
  );
}
